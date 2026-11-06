import { getDb } from "./db.server";
import { getSettingsRow, upsertSettings } from "./store";
import { applyDiscount, parseGateways, type DiscountSettings, type GraphQL } from "./discount";
import { countDiscountedOrder, getPlan, getUsage, type PlanCheck } from "./billing.server";
import { limitReason, monthIn, type Plan } from "./plans";

export async function getSettings(shop: string): Promise<DiscountSettings> {
  const row = await getSettingsRow(getDb(), shop);
  // A shop that never saved the form gets the schema defaults.
  const fallback = {
    enabled: true,
    percent: 5,
    gateways: "Bank Deposit",
    label: "Bank Deposit discount",
    notifyCustomer: true,
    bankDiscount: true,
    cardDiscount: false,
    cardLabel: "Card payment discount",
    codGateways: "Cash on Delivery (COD)",
  };
  const s = row ?? fallback;
  return {
    enabled: s.enabled,
    percent: s.percent,
    gateways: parseGateways(s.gateways),
    label: s.label,
    notifyCustomer: s.notifyCustomer,
    bankDiscount: s.bankDiscount,
    cardDiscount: s.cardDiscount,
    cardLabel: s.cardLabel,
    codGateways: parseGateways(s.codGateways),
  };
}

export async function saveSettings(shop: string, settings: DiscountSettings) {
  const data = {
    ...settings,
    gateways: settings.gateways.join("\n"),
    codGateways: settings.codGateways.join("\n"),
  };
  await upsertSettings(getDb(), shop, data);
}

// The storefront banner and pop-up (theme app extension), the Thank-you page
// block (checkout UI extension) and the two functions can't reach the
// database, so the settings they need are copied into metafields: the theme
// reads the app installation's, checkout and the functions read the shop's
// app-owned one.
export const SETTINGS_NAMESPACE = "payment_discount";

export type ShopInfo = { id: string; timeZone: string };

export async function getShopInfo(graphql: GraphQL): Promise<ShopInfo> {
  const { shop } = await graphql(`#graphql
    query ShopInfo {
      shop { id ianaTimezone }
    }`);
  return { id: shop.id, timeZone: shop.ianaTimezone };
}

export type PlanState = {
  plan: PlanCheck;
  month: string;
  used: number;
  // Why discounts are paused this month, or null.
  limitReason: string | null;
};

// The shop's plan and how much of this month's limit is used.
export async function getPlanState(
  shop: string,
  info: ShopInfo,
  { freshPlan = false }: { freshPlan?: boolean } = {},
): Promise<PlanState> {
  const plan = await getPlan(shop, info.id, { fresh: freshPlan });
  const month = monthIn(info.timeZone);
  const used = await getUsage(shop, month);
  return { plan, month, used, limitReason: limitReason(plan, used) };
}

// Settings with what the plan doesn't include switched off.
export function settingsForPlan(settings: DiscountSettings, plan: Plan): DiscountSettings {
  return { ...settings, cardDiscount: settings.cardDiscount && plan.cardDiscount };
}

// Writes the settings, as the shop's plan allows them, to the metafields.
// When the month's limit is used up, `pausedMonth` names that month: the
// functions, the theme and the Thank-you block compare it with the current
// month themselves, so discounts come back on the 1st without the app.
export async function publishSettings(
  graphql: GraphQL,
  shop: string,
  { freshPlan = false }: { freshPlan?: boolean } = {},
): Promise<PlanState> {
  const { shop: owner, currentAppInstallation } = await graphql(`#graphql
    query DiscountOwners {
      shop { id ianaTimezone }
      currentAppInstallation { id }
    }`);
  const state = await getPlanState(
    shop,
    { id: owner.id, timeZone: owner.ianaTimezone },
    { freshPlan },
  );
  const settings = settingsForPlan(await getSettings(shop), state.plan);
  const value = JSON.stringify({
    enabled: settings.enabled,
    percent: settings.percent,
    gateways: settings.gateways,
    label: settings.label,
    bankDiscount: settings.bankDiscount,
    cardDiscount: settings.cardDiscount,
    cardLabel: settings.cardLabel,
    codGateways: settings.codGateways,
    customize: state.plan.customize,
    pausedMonth: state.limitReason ? state.month : null,
    timeZone: owner.ianaTimezone,
  });
  const { metafieldsSet } = await graphql(
    `#graphql
    mutation PublishSettings($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      metafields: [
        { ownerId: currentAppInstallation.id, namespace: SETTINGS_NAMESPACE, key: "settings", type: "json", value },
        { ownerId: owner.id, namespace: `$app:${SETTINGS_NAMESPACE}`, key: "settings", type: "json", value },
      ],
    },
  );
  assertNoUserErrors("metafieldsSet", metafieldsSet);
  return state;
}

// Runs the discount on one order within the shop's plan, counts it towards
// the month's limit, and pauses discounts in the store once the limit is
// reached. Used by the orders/create webhook and the app's page.
export async function discountOrder(graphql: GraphQL, shop: string, orderId: string) {
  const info = await getShopInfo(graphql);
  const state = await getPlanState(shop, info);
  const settings = settingsForPlan(await getSettings(shop), state.plan);
  const result = await applyDiscount(graphql, orderId, settings, state.limitReason);
  let used = state.used;
  if (result.applied || result.discountedAtCheckout) {
    used = await countDiscountedOrder(shop, state.month);
  }
  if (state.plan.changed || limitReason(state.plan, used) !== state.limitReason) {
    await publishSettings(graphql, shop);
  }
  return { result, settings };
}

// The pop-up's choice only matters if the two functions are switched on in
// the store: the discount function through an automatic discount, the payment
// method function through a payment customization. Creates whichever is
// missing (first save, or the merchant deleted it) and remembers their IDs.
export async function ensureCheckoutSetup(graphql: GraphQL, shop: string) {
  const row = await getSettingsRow(getDb(), shop);
  const known = [row?.discountId, row?.paymentCustomizationId].filter(Boolean) as string[];
  const existing = new Set<string>();
  if (known.length) {
    const { nodes } = await graphql(
      `#graphql
      query ChoiceSetupExists($ids: [ID!]!) {
        nodes(ids: $ids) { id }
      }`,
      { ids: known },
    );
    for (const node of nodes) if (node) existing.add(node.id);
  }

  let discountId = row?.discountId && existing.has(row.discountId) ? row.discountId : null;
  if (!discountId) {
    const { discountAutomaticAppCreate: result } = await graphql(
      `#graphql
      mutation CreateChoiceDiscount($discount: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $discount) {
          automaticAppDiscount { discountId }
          userErrors { field message }
        }
      }`,
      {
        discount: {
          title: "Payment method discount",
          functionHandle: "payment-choice-discount",
          discountClasses: ["ORDER"],
          startsAt: new Date().toISOString(),
          combinesWith: { productDiscounts: true, orderDiscounts: false, shippingDiscounts: true },
        },
      },
    );
    assertNoUserErrors("discountAutomaticAppCreate", result);
    discountId = result.automaticAppDiscount.discountId as string;
  }

  let paymentCustomizationId =
    row?.paymentCustomizationId && existing.has(row.paymentCustomizationId)
      ? row.paymentCustomizationId
      : null;
  if (!paymentCustomizationId) {
    const { paymentCustomizationCreate: result } = await graphql(
      `#graphql
      mutation CreateChoiceMethods($customization: PaymentCustomizationInput!) {
        paymentCustomizationCreate(paymentCustomization: $customization) {
          paymentCustomization { id }
          userErrors { field message }
        }
      }`,
      {
        customization: {
          title: "Payment method discount: only the chosen method",
          functionHandle: "payment-choice-methods",
          enabled: true,
        },
      },
    );
    assertNoUserErrors("paymentCustomizationCreate", result);
    paymentCustomizationId = result.paymentCustomization.id as string;
  }

  if (discountId !== row?.discountId || paymentCustomizationId !== row?.paymentCustomizationId) {
    await upsertSettings(getDb(), shop, { discountId, paymentCustomizationId });
  }
  return { discountId, paymentCustomizationId };
}

// Which other discounts the app's automatic discount can be used with.
export type Combinations = {
  productDiscounts: boolean;
  orderDiscounts: boolean;
  shippingDiscounts: boolean;
};

export type CheckoutStatus = {
  // null when the app hasn't created it yet, or the merchant deleted it.
  discount: { active: boolean; combinesWith: Combinations } | null;
  paymentRuleEnabled: boolean | null;
};

// The state of the automatic discount and payment customization, read from
// the store each time, so changes made in Shopify's own Discounts and
// Payments settings show on the app's page.
export async function getCheckoutStatus(graphql: GraphQL, shop: string): Promise<CheckoutStatus> {
  const row = await getSettingsRow(getDb(), shop);
  const ids = [row?.discountId, row?.paymentCustomizationId].filter(Boolean) as string[];
  if (!ids.length) return { discount: null, paymentRuleEnabled: null };
  const { nodes } = await graphql(
    `#graphql
    query CheckoutStatus($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on DiscountAutomaticNode {
          id
          automaticDiscount {
            ... on DiscountAutomaticApp {
              status
              combinesWith { productDiscounts orderDiscounts shippingDiscounts }
            }
          }
        }
        ... on PaymentCustomization { id enabled }
      }
    }`,
    { ids },
  );
  const byId = new Map<string, any>( // eslint-disable-line @typescript-eslint/no-explicit-any
    nodes.filter(Boolean).map((node: { id: string }) => [node.id, node]),
  );
  const discount = row?.discountId ? byId.get(row.discountId)?.automaticDiscount : null;
  const rule = row?.paymentCustomizationId ? byId.get(row.paymentCustomizationId) : null;
  return {
    discount: discount?.combinesWith
      ? { active: discount.status === "ACTIVE", combinesWith: discount.combinesWith }
      : null,
    paymentRuleEnabled: rule ? Boolean(rule.enabled) : null,
  };
}

export async function setCombinations(
  graphql: GraphQL,
  discountId: string,
  combinesWith: Combinations,
) {
  const { discountAutomaticAppUpdate: result } = await graphql(
    `#graphql
    mutation SetCombinations($id: ID!, $discount: DiscountAutomaticAppInput!) {
      discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $discount) {
        automaticAppDiscount { discountId }
        userErrors { field message }
      }
    }`,
    { id: discountId, discount: { combinesWith } },
  );
  assertNoUserErrors("discountAutomaticAppUpdate", result);
}

function assertNoUserErrors(
  step: string,
  payload: { userErrors?: { message: string }[] } | null | undefined,
) {
  const errors = payload?.userErrors ?? [];
  if (errors.length) throw new Error(`${step}: ${errors.map((e) => e.message).join("; ")}`);
}

// Turns the template's admin client into the plain `graphql(query, variables)`
// function the discount logic expects.
export function toGraphQL(admin: {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}): GraphQL {
  return async (query, variables) => {
    const res = await admin.graphql(query, { variables });
    const body = (await res.json()) as {
      data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      errors?: unknown[];
    };
    if (body.errors?.length) throw new Error(JSON.stringify(body.errors));
    return body.data;
  };
}

import db from "./db.server";
import { parseGateways, type DiscountSettings, type GraphQL } from "./discount";

export async function getSettings(shop: string): Promise<DiscountSettings> {
  const row = await db.settings.findUnique({ where: { shop } });
  // A shop that never saved the form gets the schema defaults.
  const fallback = {
    enabled: true,
    percent: 5,
    gateways: "Bank Deposit",
    label: "Bank Deposit discount",
    notifyCustomer: true,
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
  await db.settings.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
}

// The storefront banner and pop-up (theme app extension), the Thank-you page
// block (checkout UI extension) and the two functions can't reach the
// database, so the settings they need are copied into metafields: the theme
// reads the app installation's, checkout and the functions read the shop's
// app-owned one.
export const SETTINGS_NAMESPACE = "payment_discount";

export async function publishSettings(
  graphql: GraphQL,
  settings: DiscountSettings,
) {
  const { shop, currentAppInstallation } = await graphql(`#graphql
    query DiscountOwners {
      shop { id }
      currentAppInstallation { id }
    }`);
  const value = JSON.stringify({
    enabled: settings.enabled,
    percent: settings.percent,
    gateways: settings.gateways,
    label: settings.label,
    cardDiscount: settings.cardDiscount,
    cardLabel: settings.cardLabel,
    codGateways: settings.codGateways,
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
        { ownerId: shop.id, namespace: `$app:${SETTINGS_NAMESPACE}`, key: "settings", type: "json", value },
      ],
    },
  );
  assertNoUserErrors("metafieldsSet", metafieldsSet);
}

// The pop-up's choice only matters if the two functions are switched on in
// the store: the discount function through an automatic discount, the payment
// method function through a payment customization. Creates whichever is
// missing (first save, or the merchant deleted it) and remembers their IDs.
export async function ensureCheckoutSetup(graphql: GraphQL, shop: string) {
  const row = await db.settings.findUnique({ where: { shop } });
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
    await db.settings.upsert({
      where: { shop },
      create: { shop, discountId, paymentCustomizationId },
      update: { discountId, paymentCustomizationId },
    });
  }
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
    const body = await res.json();
    if (body.errors?.length) throw new Error(JSON.stringify(body.errors));
    return body.data;
  };
}

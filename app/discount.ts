// Core logic: give an order a percentage discount when it was placed with one
// of the chosen payment methods. Kept free of framework imports so it can be
// tested with a fake Admin API (see test/discount.test.ts).

export type DiscountSettings = {
  enabled: boolean;
  percent: number;
  gateways: string[];
  label: string;
  notifyCustomer: boolean;
  // Card payment method names, as the merchant listed them. Only used to
  // tell whether the store takes cards; checkout treats every method that
  // isn't bank transfer or cash on delivery as card.
  cardGateways: string[];
  // Which payment choices get the discount: bank transfer and/or card.
  bankDiscount: boolean;
  cardDiscount: boolean;
  // The storefront and Thank-you blocks, switched on and off from the app
  // once they're added in the theme and checkout editors.
  showPopUp: boolean;
  showBanner: boolean;
  showThankYou: boolean;
  cardLabel: string;
  codGateways: string[];
};

export type OrderForDiscount = {
  id: string;
  name: string;
  tags: string[];
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  paymentGatewayNames: string[];
  customAttributes?: { key: string; value: string | null }[];
};

export type GraphQL = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type DiscountResult =
  | { applied: true; total: { amount: string; currencyCode: string } }
  | { applied: false; reason: string; discountedAtCheckout?: boolean };

// Cart attribute set by the "How would you like to pay?" pop-up. Orders that
// carry it got their discount at checkout from the discount function.
export const CHOICE_ATTRIBUTE = "_payment_choice";

// Tags written on orders, so merchants can filter for them in the admin.
export const APPLIED_TAG = "payment-discount";
export const FAILED_TAG = "payment-discount-failed";

const ORDER_QUERY = `#graphql
  query OrderForDiscount($id: ID!) {
    order(id: $id) {
      id
      name
      tags
      cancelledAt
      displayFinancialStatus
      paymentGatewayNames
      customAttributes { key value }
    }
  }`;

const BEGIN_EDIT = `#graphql
  mutation BeginEdit($id: ID!) {
    orderEditBegin(id: $id) {
      calculatedOrder {
        id
        lineItems(first: 250) {
          nodes {
            id
            title
            editableQuantity
          }
        }
      }
      userErrors { field message }
    }
  }`;

const ADD_DISCOUNT = `#graphql
  mutation AddDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
    orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
      addedDiscountStagedChange { id }
      userErrors { field message }
    }
  }`;

const COMMIT_EDIT = `#graphql
  mutation CommitEdit($id: ID!, $notifyCustomer: Boolean, $staffNote: String) {
    orderEditCommit(id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
      order {
        id
        currentTotalPriceSet { shopMoney { amount currencyCode } }
      }
      userErrors { field message }
    }
  }`;

const ADD_TAGS = `#graphql
  mutation AddTags($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }`;

const REMOVE_TAGS = `#graphql
  mutation RemoveTags($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }`;

// Returns null when the order should get the discount, otherwise why not.
// Only unpaid orders qualify: discounting a paid order would leave the
// merchant owing a refund instead of lowering what the customer still pays.
export function skipReason(
  order: OrderForDiscount | null,
  settings: DiscountSettings,
): string | null {
  if (!order) return "order not found";
  if (!settings.enabled) return "discount is turned off";
  if (!settings.bankDiscount) return "bank transfer discount is turned off";
  const wanted = settings.gateways.map((g) => g.trim().toLowerCase());
  const used = order.paymentGatewayNames ?? [];
  if (!used.some((g) => wanted.includes(g.trim().toLowerCase()))) {
    return `paid with ${used.join(", ") || "no payment method"}`;
  }
  if (order.customAttributes?.some((a) => a.key === CHOICE_ATTRIBUTE)) {
    return "payment method chosen before checkout, discount given there";
  }
  const tags = order.tags.map((t) => t.toLowerCase());
  if (tags.includes(APPLIED_TAG)) return "discount already applied";
  if (order.cancelledAt) return "order is cancelled";
  if (order.displayFinancialStatus !== "PENDING") {
    return `payment status is ${order.displayFinancialStatus}, not pending`;
  }
  return null;
}

// Applies the discount to every unfulfilled line item in one order edit, then
// tags the order so it is never discounted twice. If anything fails, the edit
// is never committed (so the order is unchanged) and the order is tagged for
// the merchant to retry from the app. `limit` says why the shop's plan allows
// no more discounts this month, if it doesn't.
export async function applyDiscount(
  graphql: GraphQL,
  orderId: string,
  settings: DiscountSettings,
  limit: string | null = null,
): Promise<DiscountResult> {
  const { order } = (await graphql(ORDER_QUERY, { id: orderId })) as {
    order: OrderForDiscount | null;
  };
  // Orders that went through the payment pop-up got their discount at
  // checkout from the discount function; tag the discounted ones so they are
  // listed with the rest, and never edit them. Once the month's limit is
  // reached the discount function stops too, so those orders got nothing.
  const choice = order?.customAttributes?.find((a) => a.key === CHOICE_ATTRIBUTE)?.value;
  if (order && choice) {
    const discounted =
      settings.enabled &&
      !limit &&
      ((choice === "bank" && settings.bankDiscount) ||
        (choice === "card" && settings.cardDiscount));
    if (!discounted) {
      return { applied: false, reason: "payment method chosen before checkout, no discount" };
    }
    const reason = "payment method chosen before checkout, discount given there";
    if (order.tags.map((t) => t.toLowerCase()).includes(APPLIED_TAG)) {
      return { applied: false, reason };
    }
    await changeTags(graphql, ADD_TAGS, "tagsAdd", order.id, [APPLIED_TAG]);
    return { applied: false, reason, discountedAtCheckout: true };
  }

  const reason = skipReason(order, settings) ?? limit;
  if (reason || !order) return { applied: false, reason: reason ?? "order not found" };

  try {
    const begin = (await graphql(BEGIN_EDIT, { id: order.id })).orderEditBegin;
    assertNoUserErrors("orderEditBegin", begin);
    const calculated = begin.calculatedOrder;

    const lines: { id: string; title: string }[] =
      calculated.lineItems.nodes.filter(
        (line: { editableQuantity: number }) => line.editableQuantity > 0,
      );
    if (!lines.length) return { applied: false, reason: "no unfulfilled items" };

    for (const line of lines) {
      const added = (
        await graphql(ADD_DISCOUNT, {
          id: calculated.id,
          lineItemId: line.id,
          discount: { percentValue: settings.percent, description: settings.label },
        })
      ).orderEditAddLineItemDiscount;
      assertNoUserErrors(`discount on "${line.title}"`, added);
    }

    const commit = (
      await graphql(COMMIT_EDIT, {
        id: calculated.id,
        notifyCustomer: settings.notifyCustomer,
        staffNote: `${settings.label} (${settings.percent}%) applied automatically: paid with ${order.paymentGatewayNames.join(", ")}`,
      })
    ).orderEditCommit;
    assertNoUserErrors("orderEditCommit", commit);

    await changeTags(graphql, ADD_TAGS, "tagsAdd", order.id, [APPLIED_TAG]);
    if (order.tags.includes(FAILED_TAG)) {
      await changeTags(graphql, REMOVE_TAGS, "tagsRemove", order.id, [FAILED_TAG]);
    }
    return { applied: true, total: commit.order.currentTotalPriceSet.shopMoney };
  } catch (err) {
    await changeTags(graphql, ADD_TAGS, "tagsAdd", order.id, [FAILED_TAG]).catch(
      () => {},
    );
    throw new Error(`${order.name}: ${(err as Error).message}`);
  }
}

// Reads "Bank Deposit\nEasyPaisa, JazzCash" into a clean list.
export function parseGateways(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((g) => g.trim())
    .filter(Boolean);
}

function assertNoUserErrors(
  step: string,
  payload: { userErrors?: { message: string }[] } | null | undefined,
) {
  const errors = payload?.userErrors ?? [];
  if (errors.length) throw new Error(`${step}: ${errors.map((e) => e.message).join("; ")}`);
  if (!payload) throw new Error(`${step}: no response`);
}

async function changeTags(
  graphql: GraphQL,
  mutation: string,
  field: "tagsAdd" | "tagsRemove",
  id: string,
  tags: string[],
) {
  const payload = (await graphql(mutation, { id, tags }))[field];
  assertNoUserErrors(field, payload);
}

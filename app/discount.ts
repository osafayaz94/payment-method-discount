// Core logic: give an order a percentage discount when it was placed with one
// of the chosen payment methods. Kept free of framework imports so it can be
// tested with a fake Admin API (see test/discount.test.ts).

export type DiscountSettings = {
  enabled: boolean;
  percent: number;
  gateways: string[];
  label: string;
  notifyCustomer: boolean;
};

export type OrderForDiscount = {
  id: string;
  name: string;
  tags: string[];
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  paymentGatewayNames: string[];
};

export type GraphQL = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type DiscountResult =
  | { applied: true; total: { amount: string; currencyCode: string } }
  | { applied: false; reason: string };

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
  const wanted = settings.gateways.map((g) => g.trim().toLowerCase());
  const used = order.paymentGatewayNames ?? [];
  if (!used.some((g) => wanted.includes(g.trim().toLowerCase()))) {
    return `paid with ${used.join(", ") || "no payment method"}`;
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
// the merchant to retry from the app.
export async function applyDiscount(
  graphql: GraphQL,
  orderId: string,
  settings: DiscountSettings,
): Promise<DiscountResult> {
  const { order } = (await graphql(ORDER_QUERY, { id: orderId })) as {
    order: OrderForDiscount | null;
  };
  const reason = skipReason(order, settings);
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

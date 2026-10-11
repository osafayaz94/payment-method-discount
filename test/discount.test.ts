import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPLIED_TAG,
  CHOICE_ATTRIBUTE,
  FAILED_TAG,
  applyDiscount,
  parseGateways,
  skipReason,
  type DiscountSettings,
  type OrderForDiscount,
} from "../app/discount.ts";

const settings: DiscountSettings = {
  enabled: true,
  percent: 5,
  gateways: ["Bank Deposit"],
  label: "Bank Deposit discount",
  notifyCustomer: true,
  cardDiscount: false,
  cardLabel: "Card payment discount",
  codGateways: ["Cash on Delivery (COD)"],
};

const unpaidBankOrder: OrderForDiscount = {
  id: "gid://shopify/Order/1",
  name: "#1001",
  tags: [],
  cancelledAt: null,
  displayFinancialStatus: "PENDING",
  paymentGatewayNames: ["Bank Deposit"],
};

test("unpaid order with a chosen payment method qualifies", () => {
  assert.equal(skipReason(unpaidBankOrder, settings), null);
});

test("payment method names match without regard to case or spaces", () => {
  const order = { ...unpaidBankOrder, paymentGatewayNames: [" bank deposit "] };
  assert.equal(skipReason(order, settings), null);
});

test("any of several chosen payment methods qualifies", () => {
  const order = { ...unpaidBankOrder, paymentGatewayNames: ["JazzCash"] };
  assert.equal(skipReason(order, { ...settings, gateways: ["Bank Deposit", "JazzCash"] }), null);
});

test("cash on delivery is skipped", () => {
  const order = { ...unpaidBankOrder, paymentGatewayNames: ["Cash on Delivery (COD)"] };
  assert.equal(skipReason(order, settings), "paid with Cash on Delivery (COD)");
});

test("nothing qualifies while the discount is turned off", () => {
  assert.equal(skipReason(unpaidBankOrder, { ...settings, enabled: false }), "discount is turned off");
});

test("an order already discounted is skipped", () => {
  assert.equal(skipReason({ ...unpaidBankOrder, tags: [APPLIED_TAG] }, settings), "discount already applied");
});

test("paid and cancelled orders are skipped", () => {
  assert.match(skipReason({ ...unpaidBankOrder, displayFinancialStatus: "PAID" }, settings)!, /PAID/);
  assert.equal(skipReason({ ...unpaidBankOrder, cancelledAt: "2026-10-10T00:00:00Z" }, settings), "order is cancelled");
});

test("orders whose payment method was chosen before checkout are skipped", () => {
  const order = { ...unpaidBankOrder, customAttributes: [{ key: CHOICE_ATTRIBUTE, value: "bank" }] };
  assert.equal(skipReason(order, settings), "payment method chosen before checkout, discount given there");
});

test("payment methods are read one per line or comma separated", () => {
  assert.deepEqual(parseGateways("Bank Deposit\n\n JazzCash , EasyPaisa\n"), ["Bank Deposit", "JazzCash", "EasyPaisa"]);
});

type Call = { op: string; variables: Record<string, unknown> };

// Fake Admin API: answers each operation by name and records the calls.
function fakeShopify(order: OrderForDiscount, { failDiscount = false } = {}) {
  const calls: Call[] = [];
  const graphql = async (query: string, variables: Record<string, unknown> = {}) => {
    const op = query.match(/(?:query|mutation) (\w+)/)![1];
    calls.push({ op, variables });
    switch (op) {
      case "OrderForDiscount":
        return { order };
      case "BeginEdit":
        return {
          orderEditBegin: {
            calculatedOrder: {
              id: "gid://shopify/CalculatedOrder/9",
              lineItems: {
                nodes: [
                  { id: "gid://shopify/CalculatedLineItem/1", title: "Ring", editableQuantity: 2 },
                  { id: "gid://shopify/CalculatedLineItem/2", title: "Fulfilled", editableQuantity: 0 },
                  { id: "gid://shopify/CalculatedLineItem/3", title: "Bracelet", editableQuantity: 1 },
                ],
              },
            },
            userErrors: [],
          },
        };
      case "AddDiscount":
        return {
          orderEditAddLineItemDiscount: failDiscount
            ? { addedDiscountStagedChange: null, userErrors: [{ field: null, message: "not allowed" }] }
            : { addedDiscountStagedChange: { id: "x" }, userErrors: [] },
        };
      case "CommitEdit":
        return {
          orderEditCommit: {
            order: { id: order.id, currentTotalPriceSet: { shopMoney: { amount: "95.0", currencyCode: "USD" } } },
            userErrors: [],
          },
        };
      case "AddTags":
        return { tagsAdd: { userErrors: [] } };
      case "RemoveTags":
        return { tagsRemove: { userErrors: [] } };
      default:
        throw new Error(`unexpected ${op}`);
    }
  };
  return { graphql, calls };
}

test("discounts every unfulfilled item in one edit, then tags the order", async () => {
  const { graphql, calls } = fakeShopify(unpaidBankOrder);
  const result = await applyDiscount(graphql, unpaidBankOrder.id, settings);

  assert.deepEqual(result, { applied: true, total: { amount: "95.0", currencyCode: "USD" } });
  const discounts = calls.filter((c) => c.op === "AddDiscount");
  assert.deepEqual(
    discounts.map((c) => c.variables.lineItemId),
    ["gid://shopify/CalculatedLineItem/1", "gid://shopify/CalculatedLineItem/3"],
  );
  assert.deepEqual(discounts[0].variables.discount, { percentValue: 5, description: "Bank Deposit discount" });
  assert.equal(calls.find((c) => c.op === "CommitEdit")!.variables.notifyCustomer, true);
  assert.deepEqual(calls.at(-1), { op: "AddTags", variables: { id: unpaidBankOrder.id, tags: [APPLIED_TAG] } });
});

test("a retried order loses its failed tag once discounted", async () => {
  const { graphql, calls } = fakeShopify({ ...unpaidBankOrder, tags: [FAILED_TAG] });
  await applyDiscount(graphql, unpaidBankOrder.id, settings);

  assert.deepEqual(calls.at(-1), { op: "RemoveTags", variables: { id: unpaidBankOrder.id, tags: [FAILED_TAG] } });
});

test("cash on delivery orders are only read, never edited", async () => {
  const order = { ...unpaidBankOrder, paymentGatewayNames: ["Cash on Delivery (COD)"] };
  const { graphql, calls } = fakeShopify(order);
  const result = await applyDiscount(graphql, order.id, settings);

  assert.equal(result.applied, false);
  assert.deepEqual(calls.map((c) => c.op), ["OrderForDiscount"]);
});

test("if one item cannot be discounted, nothing is committed and the order is tagged", async () => {
  const { graphql, calls } = fakeShopify(unpaidBankOrder, { failDiscount: true });
  await assert.rejects(
    applyDiscount(graphql, unpaidBankOrder.id, settings),
    /#1001: discount on "Ring": not allowed/,
  );

  assert.equal(calls.some((c) => c.op === "CommitEdit"), false);
  assert.deepEqual(calls.at(-1), { op: "AddTags", variables: { id: unpaidBankOrder.id, tags: [FAILED_TAG] } });
});

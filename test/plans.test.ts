import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANS, limitReason, monthIn, planFromSubscription } from "../app/plans.ts";

test("no subscription is the Free plan", () => {
  assert.equal(planFromSubscription(null).key, "free");
});

test("a free subscription is the Free plan", () => {
  assert.equal(planFromSubscription({ items: [{ handle: "free", price: { amount: "0.0" } }] }).key, "free");
});

test("plans are told apart by handle, monthly or yearly", () => {
  assert.equal(planFromSubscription({ items: [{ handle: "pro", price: { amount: "4.99" } }] }).key, "pro");
  assert.equal(planFromSubscription({ items: [{ handle: "Pro-Yearly", price: { amount: "45.0" } }] }).key, "pro");
  assert.equal(planFromSubscription({ items: [{ handle: "advanced", price: { amount: "9.99" } }] }).key, "advanced");
  assert.equal(planFromSubscription({ items: [{ handle: "advanced_yearly", price: { amount: "90.0" } }] }).key, "advanced");
});

test("a paid plan with another handle is never limited", () => {
  assert.equal(planFromSubscription({ items: [{ handle: "products", price: { amount: "9.99" } }] }).key, "advanced");
});

test("limits: Free 10, Pro 30, Advanced none", () => {
  assert.equal(limitReason(PLANS.free, 9), null);
  assert.equal(limitReason(PLANS.free, 10), "Free plan limit of 10 discounted orders this month reached");
  assert.equal(limitReason(PLANS.pro, 29), null);
  assert.match(limitReason(PLANS.pro, 30)!, /Pro plan limit of 30/);
  assert.equal(limitReason(PLANS.advanced, 100000), null);
});

test("card discounts and own wording are for paid plans", () => {
  assert.deepEqual([PLANS.free.cardDiscount, PLANS.pro.cardDiscount, PLANS.advanced.cardDiscount], [false, true, true]);
  assert.deepEqual([PLANS.free.customize, PLANS.pro.customize, PLANS.advanced.customize], [false, true, true]);
});

test("the month is the store's own", () => {
  const at = new Date("2026-10-31T22:00:00Z");
  assert.equal(monthIn("UTC", at), "2026-10");
  assert.equal(monthIn("Asia/Karachi", at), "2026-11");
  assert.equal(monthIn("America/Los_Angeles", at), "2026-10");
  assert.equal(monthIn("Not/AZone", at), "2026-10");
  assert.equal(monthIn(null, at), "2026-10");
});

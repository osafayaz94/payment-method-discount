import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANS, limitReason, monthIn, planByKey, planFromSubscription } from "../app/plans.ts";

test("no subscription is the Free plan", () => {
  assert.equal(planFromSubscription(null).key, "free");
});

test("a free subscription is the Free plan", () => {
  assert.equal(planFromSubscription({ items: [{ handle: "free", price: { amount: "0.0" } }] }).key, "free");
});

test("any paid plan is Unlimited, monthly or yearly, whatever its name", () => {
  assert.equal(planFromSubscription({ items: [{ handle: "unlimited", price: { amount: "6.99" } }] }).key, "unlimited");
  assert.equal(planFromSubscription({ items: [{ handle: "unlimited-yearly", price: { amount: "69.0" } }] }).key, "unlimited");
  assert.equal(planFromSubscription({ items: [{ handle: "renamed", price: { amount: "6.99" } }] }).key, "unlimited");
});

test("plans saved by the earlier version are read as Unlimited", () => {
  assert.equal(planByKey("pro").key, "unlimited");
  assert.equal(planByKey("advanced").key, "unlimited");
  assert.equal(planByKey("unlimited").key, "unlimited");
  assert.equal(planByKey("free").key, "free");
  assert.equal(planByKey(undefined).key, "free");
});

test("limits: Free 10, Unlimited none", () => {
  assert.equal(limitReason(PLANS.free, 9), null);
  assert.equal(limitReason(PLANS.free, 10), "Free plan limit of 10 discounted orders this month reached");
  assert.equal(limitReason(PLANS.unlimited, 100000), null);
});

test("card discounts are on every plan; own wording is on Unlimited only", () => {
  assert.deepEqual([PLANS.free.cardDiscount, PLANS.unlimited.cardDiscount], [true, true]);
  assert.deepEqual([PLANS.free.customize, PLANS.unlimited.customize], [false, true]);
});

test("the month is the store's own", () => {
  const at = new Date("2026-10-31T22:00:00Z");
  assert.equal(monthIn("UTC", at), "2026-10");
  assert.equal(monthIn("Asia/Karachi", at), "2026-11");
  assert.equal(monthIn("America/Los_Angeles", at), "2026-10");
  assert.equal(monthIn("Not/AZone", at), "2026-10");
  assert.equal(monthIn(null, at), "2026-10");
});

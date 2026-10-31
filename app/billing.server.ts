import db from "./db.server";
import { PLANS, planFromSubscription, type ActiveSubscription, type Plan, type PlanKey } from "./plans";

// Subscriptions come from Shopify App Pricing through the Partner API's
// Active Subscription API. It needs a Partner API client with the "Manage
// apps" permission; these are set on the server (see README, Billing).
const PARTNER_API_VERSION = "2026-07";
const CACHE_MS = 10 * 60 * 1000;

export function billingConfigured() {
  return Boolean(
    process.env.SHOPIFY_PARTNER_ORG_ID &&
      process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN &&
      process.env.SHOPIFY_APP_GID,
  );
}

// The app's handle, for the plan selection page Shopify hosts at
// admin/charges/<handle>/pricing_plans.
export const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "payment-method-discount";

async function fetchActiveSubscription(shopGid: string): Promise<ActiveSubscription> {
  const res = await fetch(
    `https://partners.shopify.com/${process.env.SHOPIFY_PARTNER_ORG_ID}/api/${PARTNER_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN ?? "",
      },
      body: JSON.stringify({
        query: `query ActiveSubscription($appId: ID!, $shopId: ID!) {
          activeSubscription(appId: $appId, shopId: $shopId) {
            items {
              handle
              price { ... on FlatRatePrice { amount } }
            }
          }
        }`,
        variables: { appId: process.env.SHOPIFY_APP_GID, shopId: shopGid },
      }),
    },
  );
  const body = await res.json().catch(() => ({}));
  // Throw on throttling or other failures so a paying merchant is never
  // treated as having no subscription.
  if (!res.ok || body.errors) {
    throw new Error(`Partner API request failed: ${JSON.stringify(body.errors ?? res.status)}`);
  }
  // null when the shop has no active subscription: the Free plan.
  return body.data?.activeSubscription ?? null;
}

export type PlanCheck = Plan & {
  // False when the Partner API isn't set up: every feature is unlocked.
  billing: boolean;
  // The plan differs from the one last seen, so the store needs the new limits.
  changed: boolean;
};

// The shop's plan, checked at most every 10 minutes (the Partner API allows
// four requests a second). `fresh` skips the cache, for right after the
// merchant picks a plan. If the check fails, the last known plan is used.
export async function getPlan(
  shop: string,
  shopGid: string,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<PlanCheck> {
  if (!billingConfigured()) return { ...PLANS.advanced, billing: false, changed: false };

  const row = await db.settings.findUnique({
    where: { shop },
    select: { plan: true, planCheckedAt: true },
  });
  const known = PLANS[(row?.plan as PlanKey) ?? "free"] ?? PLANS.free;
  const recent = row?.planCheckedAt && Date.now() - row.planCheckedAt.getTime() < CACHE_MS;
  if (recent && !fresh) return { ...known, billing: true, changed: false };

  try {
    const plan = planFromSubscription(await fetchActiveSubscription(shopGid));
    await db.settings.upsert({
      where: { shop },
      create: { shop, plan: plan.key, planCheckedAt: new Date() },
      update: { plan: plan.key, planCheckedAt: new Date() },
    });
    return { ...plan, billing: true, changed: plan.key !== known.key };
  } catch (err) {
    console.error(`${shop}: could not check the plan: ${(err as Error).message}`);
    return { ...known, billing: true, changed: false };
  }
}

// Discounted orders so far in the given month ("2026-10").
export async function getUsage(shop: string, month: string): Promise<number> {
  const row = await db.usage.findUnique({ where: { shop_month: { shop, month } } });
  return row?.count ?? 0;
}

// Counts one more discounted order and returns the new total for the month.
export async function countDiscountedOrder(shop: string, month: string): Promise<number> {
  const row = await db.usage.upsert({
    where: { shop_month: { shop, month } },
    create: { shop, month, count: 1 },
    update: { count: { increment: 1 } },
  });
  return row.count;
}

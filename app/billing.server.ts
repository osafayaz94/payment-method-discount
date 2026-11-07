import { getDb } from "./db.server";
import {
  getSettingsRow,
  getUsage as readUsage,
  incrementUsage,
  upsertSettings,
} from "./store";
import {
  PLANS,
  planByKey,
  planFromSubscription,
  type ActiveSubscription,
  type Plan,
} from "./plans";

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
export const APP_HANDLE =
  process.env.SHOPIFY_APP_HANDLE || "payment-method-discount-12";

async function fetchActiveSubscription(
  shopGid: string,
): Promise<ActiveSubscription> {
  const res = await fetch(
    `https://partners.shopify.com/${process.env.SHOPIFY_PARTNER_ORG_ID}/api/${PARTNER_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token":
          process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN ?? "",
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
  const body = (await res.json().catch(() => ({}))) as {
    data?: { activeSubscription?: ActiveSubscription };
    errors?: unknown;
  };
  // Throw on throttling or other failures so a paying merchant is never
  // treated as having no subscription.
  if (!res.ok || body.errors) {
    throw new Error(
      `Partner API request failed: ${JSON.stringify(body.errors ?? res.status)}`,
    );
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
  if (!billingConfigured())
    return { ...PLANS.unlimited, billing: false, changed: false };

  const row = await getSettingsRow(getDb(), shop);
  const known = planByKey(row?.plan);
  const recent =
    row?.planCheckedAt && Date.now() - row.planCheckedAt.getTime() < CACHE_MS;
  if (recent && !fresh) return { ...known, billing: true, changed: false };

  try {
    const plan = planFromSubscription(await fetchActiveSubscription(shopGid));
    await upsertSettings(getDb(), shop, {
      plan: plan.key,
      planCheckedAt: new Date(),
    });
    return { ...plan, billing: true, changed: plan.key !== known.key };
  } catch (err) {
    console.error(
      `${shop}: could not check the plan: ${(err as Error).message}`,
    );
    return { ...known, billing: true, changed: false };
  }
}

export type Renewal = {
  // Shopify renews the plan at the end of each billing period, unless the
  // merchant has chosen to stop it (cancel at the end of the period).
  autoRenews: boolean;
  // When the current billing period ends: the renewal date, or the end of
  // the plan if it won't renew.
  periodEnds: string | null;
  // "MONTHLY" or "ANNUAL", as Shopify reports it.
  billingPeriod: string | null;
};

// Renewal of the shop's paid plan, read from the Partner API each time (it
// changes in Shopify, not in the app). Null on the Free plan, when billing
// isn't set up, or if the Partner API can't be reached.
export async function getRenewal(shopGid: string): Promise<Renewal | null> {
  if (!billingConfigured()) return null;
  try {
    const res = await fetch(
      `https://partners.shopify.com/${process.env.SHOPIFY_PARTNER_ORG_ID}/api/${PARTNER_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token":
            process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN ?? "",
        },
        body: JSON.stringify({
          query: `query Renewal($appId: ID!, $shopId: ID!) {
            activeSubscription(appId: $appId, shopId: $shopId) {
              billingPeriod
              cancelAtEndOfCycle
              currentBillingCycle { endTime }
              items { price { ... on FlatRatePrice { amount } } }
            }
          }`,
          variables: { appId: process.env.SHOPIFY_APP_GID, shopId: shopGid },
        }),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      data?: {
        activeSubscription?: {
          billingPeriod?: string | null;
          cancelAtEndOfCycle?: boolean | null;
          currentBillingCycle?: { endTime?: string | null } | null;
          items?:
            { price?: { amount?: string | number | null } | null }[] | null;
        } | null;
      };
      errors?: unknown;
    };
    const subscription = body.data?.activeSubscription;
    if (!res.ok || body.errors || !subscription) return null;
    const paid = (subscription.items ?? []).some(
      (item) => Number(item.price?.amount ?? 0) > 0,
    );
    if (!paid) return null;
    return {
      autoRenews: !subscription.cancelAtEndOfCycle,
      periodEnds: subscription.currentBillingCycle?.endTime ?? null,
      billingPeriod: subscription.billingPeriod ?? null,
    };
  } catch (err) {
    console.error(
      `Could not read the plan's renewal: ${(err as Error).message}`,
    );
    return null;
  }
}

// Discounted orders so far in the given month ("2026-10").
export async function getUsage(shop: string, month: string): Promise<number> {
  return readUsage(getDb(), shop, month);
}

// Counts one more discounted order and returns the new total for the month.
export async function countDiscountedOrder(
  shop: string,
  month: string,
): Promise<number> {
  return incrementUsage(getDb(), shop, month);
}

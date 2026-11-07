// The app's plans and monthly limits. Prices and trials are set in the
// Partner Dashboard (Shopify App Pricing); this file only decides what each
// plan allows. Kept free of framework imports so it can be tested.

export type PlanKey = "free" | "unlimited";

export type Plan = {
  key: PlanKey;
  name: string;
  // Discounted orders per calendar month (store time zone); null = no limit.
  limit: number | null;
  // Whether card payments chosen in the pop-up can get the discount.
  cardDiscount: boolean;
  // Whether the pop-up and banner use the merchant's own wording and colours
  // from the theme editor; otherwise the standard ones.
  customize: boolean;
};

export const PLANS: Record<PlanKey, Plan> = {
  free: {
    key: "free",
    name: "Free",
    limit: 10,
    cardDiscount: false,
    customize: false,
  },
  unlimited: {
    key: "unlimited",
    name: "Unlimited",
    limit: null,
    cardDiscount: true,
    customize: true,
  },
};

// A plan saved by an earlier version of the app (when there were Pro and
// Advanced plans), or any unknown name, read as today's plan.
export function planByKey(key: string | null | undefined): Plan {
  if (key === "unlimited" || key === "pro" || key === "advanced")
    return PLANS.unlimited;
  return PLANS.free;
}

// The Partner API's activeSubscription, only the parts used here.
export type ActiveSubscription = {
  items?:
    | {
        handle?: string | null;
        price?: { amount?: string | number | null } | null;
      }[]
    | null;
} | null;

// Works out the plan from the shop's subscription: any paid plan is
// Unlimited, whatever its name, so a paying merchant is never limited by a
// renamed plan. No subscription, or a free one, is Free.
export function planFromSubscription(subscription: ActiveSubscription): Plan {
  const items = subscription?.items ?? [];
  const handles = items
    .map((item) => (item.handle ?? "").toLowerCase())
    .join(" ");
  const paid = items.some((item) => Number(item.price?.amount ?? 0) > 0);
  return paid || handles.includes("unlimited") ? PLANS.unlimited : PLANS.free;
}

// "2026-10" for the given moment in the store's time zone, the same month the
// functions (shop.localTime) and the theme ('now' | date) see.
export function monthIn(
  timeZone: string | null | undefined,
  at = new Date(),
): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(at);
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    if (year && month) return `${year}-${month}`;
  } catch {
    // Unknown time zone: fall back to UTC below.
  }
  return at.toISOString().slice(0, 7);
}

// Why the shop can't give more discounts this month, or null if it can.
export function limitReason(plan: Plan, used: number): string | null {
  if (plan.limit === null || used < plan.limit) return null;
  return `${plan.name} plan limit of ${plan.limit} discounted orders this month reached`;
}

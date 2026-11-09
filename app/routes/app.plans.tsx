import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { loadBase } from "../admin.server";
import { PLANS, type PlanKey } from "../plans";
import { BRAND, UsageCard } from "../components/ui";

// Shown on this page only. The prices merchants are charged are set in the
// Partner Dashboard (Shopify App Pricing): keep the two the same.
const PRICES: Record<PlanKey, { monthly: string; yearly?: string }> = {
  free: { monthly: "$0" },
  unlimited: { monthly: "$4.99", yearly: "$49" },
};
const FEATURES: Record<PlanKey, string[]> = {
  free: [
    "Up to 10 discounted orders a month",
    "Bank transfer and card discounts",
    "Payment pop-up and savings banner",
  ],
  unlimited: [
    "Unlimited discounted orders",
    "Bank transfer and card discounts",
    "Your own wording and colours",
    "Priority email support",
  ],
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const base = await loadBase(request);
  return {
    plan: base.plan,
    used: base.used,
    paused: base.paused,
    nextMonth: base.nextMonth,
    plansUrl: base.plansUrl,
  };
};

export default function Plans() {
  const { plan, used, paused, nextMonth, plansUrl } =
    useLoaderData<typeof loader>();
  const keys: PlanKey[] = ["free", "unlimited"];

  return (
    <s-page heading="Plans & pricing">
      <UsageCard
        plan={plan}
        used={used}
        paused={paused}
        nextMonth={nextMonth}
        plansUrl={plansUrl}
      />

      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">
            Plans are billed by Shopify on your store&apos;s normal invoice.
            Yearly billing costs less than paying monthly. You can change or
            cancel your plan at any time.
          </s-paragraph>
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            {keys.map((key) => {
              const current = plan.billing && plan.key === key;
              return (
                <div
                  key={key}
                  style={{
                    border: `${current ? 2 : 1}px solid ${current ? BRAND.accent : BRAND.border}`,
                    borderRadius: 12,
                    padding: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    background: key === "unlimited" ? BRAND.softer : "#fff",
                  }}
                >
                  <s-stack
                    direction="inline"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <s-heading>{PLANS[key].name}</s-heading>
                    {current && <s-badge tone="success">Your plan</s-badge>}
                    {!current && key === "unlimited" && (
                      <s-badge tone="info">Recommended</s-badge>
                    )}
                  </s-stack>
                  <div
                    style={{ fontSize: 26, fontWeight: 700, color: BRAND.ink }}
                  >
                    {PRICES[key].monthly}
                    <span style={{ fontSize: 14, fontWeight: 500 }}>
                      {" "}
                      / month
                    </span>
                  </div>
                  <s-text color="subdued">
                    {PRICES[key].yearly
                      ? `or ${PRICES[key].yearly} / year`
                      : "Free forever"}
                  </s-text>
                  <s-unordered-list>
                    {FEATURES[key].map((feature) => (
                      <s-list-item key={feature}>{feature}</s-list-item>
                    ))}
                  </s-unordered-list>
                  <div style={{ marginTop: "auto" }}>
                    {plan.billing && !current && (
                      <s-button
                        href={plansUrl}
                        target="_top"
                        variant={key === "unlimited" ? "primary" : "secondary"}
                      >
                        {`Choose ${PLANS[key].name}`}
                      </s-button>
                    )}
                  </div>
                </div>
              );
            })}
          </s-grid>
          {!plan.billing && (
            <s-banner tone="info" heading="Plans aren't on sale yet">
              Billing isn&apos;t connected on the server, so every feature is
              unlocked for now.
            </s-banner>
          )}
        </s-stack>
      </s-section>

      <s-section heading="What counts as a discounted order?">
        <s-paragraph>
          Each order that gets the discount, from the pop-up at checkout or
          after ordering, counts once. Counts start again on the 1st of each
          month. When a plan&apos;s limit is reached, customers pay full price
          until the next month or until you upgrade.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

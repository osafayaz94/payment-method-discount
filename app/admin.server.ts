// Server side shared by the app's admin pages (app/routes/app.*.tsx).
import { authenticate } from "./shopify.server";
import {
  APPLIED_TAG,
  FAILED_TAG,
  type DiscountSettings,
  type GraphQL,
} from "./discount";
import { APP_HANDLE } from "./billing.server";
import {
  discountOrder,
  ensureCheckoutSetup,
  getPlanState,
  getSettings,
  getShopInfo,
  publishSettings,
  saveSettings,
  toGraphQL,
  type PlanState,
} from "./settings.server";
import type { ActionResult, OrderRow } from "./components/ui";

// What every page needs: the shop, its settings and its plan this month.
// `publish` also writes the settings to the store, which puts a plan change
// into effect right away (Home does it on every visit).
export async function loadBase(
  request: Request,
  { publish = false }: { publish?: boolean } = {},
) {
  const { admin, session } = await authenticate.admin(request);
  const graphql = toGraphQL(admin);
  const settings = await getSettings(session.shop);
  // After picking a plan, Shopify sends the merchant back with plan_handle:
  // check the plan again rather than read it from cache.
  const freshPlan = new URL(request.url).searchParams.has("plan_handle");

  let state: PlanState;
  try {
    state = publish
      ? await publishSettings(graphql, session.shop, { freshPlan })
      : await getPlanState(session.shop, await getShopInfo(graphql), {
          freshPlan,
        });
  } catch (err) {
    console.error(
      `${session.shop}: could not publish settings: ${(err as Error).message}`,
    );
    state = await getPlanState(session.shop, await getShopInfo(graphql));
  }
  const [year, month] = state.month.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toLocaleDateString(
    "en-US",
    {
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    },
  );

  return {
    graphql,
    shop: session.shop,
    // Used to build theme editor links for the app's blocks.
    apiKey: process.env.SHOPIFY_API_KEY || "",
    settings,
    plan: state.plan,
    used: state.used,
    paused: Boolean(state.limitReason),
    nextMonth,
    // Plan selection page hosted by Shopify (Shopify App Pricing).
    plansUrl: `shopify://admin/charges/${APP_HANDLE}/pricing_plans`,
  };
}

const ORDERS_QUERY = `#graphql
  query DiscountOrders($applied: String!, $failed: String!, $first: Int!) {
    applied: orders(first: $first, reverse: true, sortKey: CREATED_AT, query: $applied) {
      nodes { ...Row }
    }
    failed: orders(first: 25, reverse: true, sortKey: CREATED_AT, query: $failed) {
      nodes { ...Row }
    }
    recent: orders(first: 100, reverse: true, sortKey: CREATED_AT) {
      nodes { paymentGatewayNames }
    }
  }
  fragment Row on Order {
    id
    name
    createdAt
    paymentGatewayNames
    displayFinancialStatus
    currentTotalPriceSet { shopMoney { amount currencyCode } }
  }`;

// Discounted orders, failed ones, and the payment method names seen on the
// last 100 orders (spelled exactly as Shopify records them).
export async function loadOrders(
  graphql: GraphQL,
  { first = 25 }: { first?: number } = {},
) {
  const data = await graphql(ORDERS_QUERY, {
    applied: `tag:'${APPLIED_TAG}'`,
    failed: `tag:'${FAILED_TAG}'`,
    first,
  });
  const seenGateways = [
    ...new Set<string>(
      data.recent.nodes.flatMap(
        (o: { paymentGatewayNames: string[] }) => o.paymentGatewayNames,
      ),
    ),
  ].sort();
  return {
    applied: data.applied.nodes as OrderRow[],
    failed: data.failed.nodes as OrderRow[],
    seenGateways,
  };
}

// Saves the settings and puts them into effect in the store.
export async function saveAndPublish(
  graphql: GraphQL,
  shop: string,
  settings: DiscountSettings,
): Promise<{ discountId: string }> {
  await saveSettings(shop, settings);
  await publishSettings(graphql, shop);
  return ensureCheckoutSetup(graphql, shop);
}

// "Apply discount" by order number, and Retry on a failed order.
export async function applyToOrder(
  graphql: GraphQL,
  shop: string,
  form: FormData,
): Promise<ActionResult> {
  let orderId = String(form.get("orderId") ?? "");
  if (form.get("intent") === "apply") {
    // Merchants type the order number they see in the admin, such as #1001.
    const name = String(form.get("orderName") ?? "")
      .trim()
      .replace(/^#?/, "#");
    if (name === "#")
      return { ok: false, message: "Enter an order number, such as #1001" };
    const data = await graphql(
      `
        #graphql
        query OrderByName($query: String!) {
          orders(first: 1, query: $query) {
            nodes {
              id
              name
            }
          }
        }
      `,
      { query: `name:${name}` },
    );
    const match = data.orders.nodes.find(
      (o: { name: string }) => o.name === name,
    );
    if (!match) return { ok: false, message: `No order ${name} found` };
    orderId = match.id;
  }
  try {
    const { result } = await discountOrder(graphql, shop, orderId);
    return result.applied
      ? {
          ok: true,
          message: `Discount applied, new total ${result.total.amount} ${result.total.currencyCode}`,
        }
      : { ok: false, message: `Not applied: ${result.reason}` };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

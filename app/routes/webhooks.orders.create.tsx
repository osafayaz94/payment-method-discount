import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { discountOrder, toGraphQL } from "../settings.server";

// Shopify can deliver the same webhook more than once. The order tag stops a
// second discount; this set also stops two edits running on one order at once.
const inProgress = new Set<string>();

export const action = async ({ request, context }: ActionFunctionArgs) => {
  let webhook;
  try {
    webhook = await authenticate.webhook(request);
  } catch (err) {
    // A bad signature or an unknown app is answered with an error status.
    console.error(
      `orders/create: webhook rejected (${err instanceof Response ? err.status : err})`,
    );
    throw err;
  }
  const { shop, admin, payload } = webhook;
  const orderId = payload?.admin_graphql_api_id as string | undefined;
  console.log(
    `${shop} orders/create received for ${orderId ?? "unknown order"}`,
  );

  if (!admin) {
    console.log(
      `${shop} ${orderId}: skipped (no session for this shop; open the app once to create it)`,
    );
    return new Response();
  }
  if (!orderId || inProgress.has(orderId)) return new Response();

  // Shopify waits only 5 seconds for an answer, and editing a large order can
  // take longer, so answer now and do the edit in the background; waitUntil
  // keeps the worker running until it's done.
  inProgress.add(orderId);
  const work = (async () => {
    try {
      const { result, settings } = await discountOrder(
        toGraphQL(admin),
        shop,
        orderId,
      );
      console.log(
        result.applied
          ? `${shop} ${orderId}: ${settings.percent}% off, new total ${result.total.amount} ${result.total.currencyCode}`
          : `${shop} ${orderId}: skipped (${result.reason})`,
      );
    } catch (err) {
      console.error(`${shop} ${(err as Error).message}`);
    } finally {
      inProgress.delete(orderId);
    }
  })();
  context.cloudflare.ctx.waitUntil(work);

  return new Response();
};

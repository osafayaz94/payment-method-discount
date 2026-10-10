import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { applyDiscount } from "../discount";
import { getSettings, toGraphQL } from "../settings.server";

// Shopify can deliver the same webhook more than once. The order tag stops a
// second discount; this set also stops two edits running on one order at once.
const inProgress = new Set<string>();

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin, payload } = await authenticate.webhook(request);

  // No admin context means the app was uninstalled.
  const orderId = payload?.admin_graphql_api_id as string | undefined;
  if (!admin || !orderId || inProgress.has(orderId)) return new Response();

  // Shopify waits only 5 seconds for an answer, and editing a large order can
  // take longer, so answer now and do the edit in the background.
  inProgress.add(orderId);
  (async () => {
    try {
      const settings = await getSettings(shop);
      const result = await applyDiscount(toGraphQL(admin), orderId, settings);
      if (result.applied) {
        console.log(
          `${shop} ${orderId}: ${settings.percent}% off, new total ${result.total.amount} ${result.total.currencyCode}`,
        );
      }
    } catch (err) {
      console.error(`${shop} ${(err as Error).message}`);
    } finally {
      inProgress.delete(orderId);
    }
  })();

  return new Response();
};

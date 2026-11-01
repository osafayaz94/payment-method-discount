import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getDb } from "../db.server";
import { deleteShopData } from "../store";

// Mandatory privacy webhooks. The app stores no customer data, only each
// shop's settings, monthly order counts and sessions, which are deleted on
// shop/redact.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  if (topic === "SHOP_REDACT") {
    await deleteShopData(getDb(), shop);
  }

  return new Response();
};

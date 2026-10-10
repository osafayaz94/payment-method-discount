import db from "./db.server";
import { parseGateways, type DiscountSettings, type GraphQL } from "./discount";

export async function getSettings(shop: string): Promise<DiscountSettings> {
  const row = await db.settings.findUnique({ where: { shop } });
  // A shop that never saved the form gets the schema defaults.
  const fallback = {
    enabled: true,
    percent: 5,
    gateways: "Bank Deposit",
    label: "Bank Deposit discount",
    notifyCustomer: true,
  };
  const s = row ?? fallback;
  return {
    enabled: s.enabled,
    percent: s.percent,
    gateways: parseGateways(s.gateways),
    label: s.label,
    notifyCustomer: s.notifyCustomer,
  };
}

export async function saveSettings(shop: string, settings: DiscountSettings) {
  const data = { ...settings, gateways: settings.gateways.join("\n") };
  await db.settings.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
}

// The storefront banner (theme app extension) and the Thank-you page block
// (checkout UI extension) can't reach the database, so the settings they need
// are copied into metafields: the theme reads the app installation's, checkout
// reads the shop's app-owned one.
export const SETTINGS_NAMESPACE = "payment_discount";

export async function publishSettings(
  graphql: GraphQL,
  settings: DiscountSettings,
) {
  const { shop, currentAppInstallation } = await graphql(`#graphql
    query DiscountOwners {
      shop { id }
      currentAppInstallation { id }
    }`);
  const value = JSON.stringify({
    enabled: settings.enabled,
    percent: settings.percent,
    gateways: settings.gateways,
    label: settings.label,
  });
  const { metafieldsSet } = await graphql(
    `#graphql
    mutation PublishSettings($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    {
      metafields: [
        { ownerId: currentAppInstallation.id, namespace: SETTINGS_NAMESPACE, key: "settings", type: "json", value },
        { ownerId: shop.id, namespace: `$app:${SETTINGS_NAMESPACE}`, key: "settings", type: "json", value },
      ],
    },
  );
  if (metafieldsSet.userErrors.length) {
    throw new Error(metafieldsSet.userErrors.map((e: { message: string }) => e.message).join("; "));
  }
}

// Turns the template's admin client into the plain `graphql(query, variables)`
// function the discount logic expects.
export function toGraphQL(admin: {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}): GraphQL {
  return async (query, variables) => {
    const res = await admin.graphql(query, { variables });
    const body = await res.json();
    if (body.errors?.length) throw new Error(JSON.stringify(body.errors));
    return body.data;
  };
}

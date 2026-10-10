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

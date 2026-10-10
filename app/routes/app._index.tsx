import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useFetcher, useLoaderData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  APPLIED_TAG,
  FAILED_TAG,
  applyDiscount,
  parseGateways,
} from "../discount";
import { getSettings, publishSettings, saveSettings, toGraphQL } from "../settings.server";

type OrderRow = {
  id: string;
  name: string;
  createdAt: string;
  paymentGatewayNames: string[];
  displayFinancialStatus: string | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
};

const ORDERS_QUERY = `#graphql
  query DiscountOrders($applied: String!, $failed: String!) {
    applied: orders(first: 10, reverse: true, sortKey: CREATED_AT, query: $applied) {
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);
  const data = await toGraphQL(admin)(ORDERS_QUERY, {
    applied: `tag:'${APPLIED_TAG}'`,
    failed: `tag:'${FAILED_TAG}'`,
  });

  // Payment method names exactly as Shopify records them, so the merchant
  // can copy the right spelling.
  const seenGateways = [
    ...new Set<string>(
      data.recent.nodes.flatMap((o: { paymentGatewayNames: string[] }) => o.paymentGatewayNames),
    ),
  ].sort();

  return {
    // Used to build theme editor links that add the storefront banner.
    apiKey: process.env.SHOPIFY_API_KEY || "",
    settings,
    seenGateways,
    applied: data.applied.nodes as OrderRow[],
    failed: data.failed.nodes as OrderRow[],
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();

  if (form.get("intent") === "retry") {
    const orderId = String(form.get("orderId"));
    try {
      const result = await applyDiscount(
        toGraphQL(admin),
        orderId,
        await getSettings(session.shop),
      );
      return result.applied
        ? { ok: true, message: "Discount applied" }
        : { ok: false, message: `Not applied: ${result.reason}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  const percent = Number(form.get("percent"));
  const gateways = parseGateways(String(form.get("gateways") ?? ""));
  const label = String(form.get("label") ?? "").trim();
  const errors: Record<string, string> = {};
  if (!(percent > 0 && percent <= 100)) errors.percent = "Enter a number above 0 and up to 100";
  if (!gateways.length) errors.gateways = "Enter at least one payment method";
  if (!label) errors.label = "Enter a label";
  if (Object.keys(errors).length) return { ok: false, errors };

  const settings = {
    enabled: form.get("enabled") !== null,
    percent,
    gateways,
    label,
    notifyCustomer: form.get("notifyCustomer") !== null,
  };
  await saveSettings(session.shop, settings);
  try {
    await publishSettings(toGraphQL(admin), settings);
  } catch (err) {
    return {
      ok: false,
      message: `Settings saved, but the store banners were not updated: ${(err as Error).message}`,
    };
  }
  return { ok: true, message: "Settings saved" };
};

export default function Index() {
  const { apiKey, settings, seenGateways, applied, failed } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const errors = result && "errors" in result ? result.errors : undefined;
  const saving = useNavigation().state === "submitting";
  const shopify = useAppBridge();

  useEffect(() => {
    if (result && "message" in result && result.message) {
      shopify.toast.show(result.message, { isError: !result.ok });
    }
  }, [result, shopify]);

  const checkoutText = `Get ${settings.percent}% off when you pay by ${settings.gateways[0] ?? "bank transfer"}. The discount is applied automatically after you place your order, and we'll email you the final amount to pay.`;

  return (
    <s-page heading="Payment method discount">
      <Form method="post" data-save-bar>
        <s-section heading="Discount">
          <s-stack direction="block" gap="base">
            <s-switch
              name="enabled"
              label="Give the discount"
              defaultChecked={settings.enabled}
            />
            <s-number-field
              name="percent"
              label="Discount"
              suffix="%"
              min={0.01}
              max={100}
              step={0.5}
              defaultValue={String(settings.percent)}
              error={errors?.percent}
            />
            <s-text-area
              name="gateways"
              label="Payment methods that get the discount"
              rows={3}
              defaultValue={settings.gateways.join("\n")}
              details={
                seenGateways.length
                  ? `One per line, spelled as on your orders. Seen on your recent orders: ${seenGateways.join(", ")}`
                  : "One per line, spelled as on your orders, for example Bank Deposit"
              }
              error={errors?.gateways}
            />
            <s-text-field
              name="label"
              label="Discount label"
              defaultValue={settings.label}
              details="Shown to the customer on the order and in the email"
              error={errors?.label}
            />
            <s-checkbox
              name="notifyCustomer"
              label="Email the customer the new total"
              defaultChecked={settings.notifyCustomer}
            />
            <s-button type="submit" variant="primary" {...(saving ? { loading: true } : {})}>
              Save
            </s-button>
          </s-stack>
        </s-section>
      </Form>

      {failed.length > 0 && (
        <s-section heading="Needs attention">
          <s-paragraph>
            These orders qualified, but the discount could not be applied. The
            orders were not changed. Retry, or edit the order by hand.
          </s-paragraph>
          <OrderTable orders={failed} retry />
        </s-section>
      )}

      <s-section heading="Recently discounted orders">
        {applied.length ? (
          <OrderTable orders={applied} />
        ) : (
          <s-paragraph>
            No orders yet. Orders placed with{" "}
            {settings.gateways.join(" or ")} will show up here.
          </s-paragraph>
        )}
      </s-section>

      <s-section slot="aside" heading="How it works">
        <s-paragraph>
          When an order is placed with one of your chosen payment methods and
          is still unpaid, the app edits the order to take{" "}
          {settings.percent}% off every item, then tags it{" "}
          <s-text type="strong">{APPLIED_TAG}</s-text>. Other orders, such as
          cash on delivery, are not changed.
        </s-paragraph>
        <s-paragraph>
          Shipping is not discounted, and orders that are already paid are
          skipped.
        </s-paragraph>
      </s-section>

      <s-section heading="Show customers what they save">
        <s-paragraph>
          On the Basic, Shopify and Advanced plans, Shopify doesn&apos;t let
          apps add banners to the checkout steps. These show the discount just
          before and just after checkout instead, and update when you save
          the settings above.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <s-text type="strong">Cart and product pages:</s-text> a banner such
            as &quot;Pay by {settings.gateways[0] ?? "Bank Deposit"} at checkout
            and save {settings.percent}%&quot;, with the amount saved worked out
            from the cart or product price. Each button opens the theme editor
            with the banner added; click Save there.
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button
              href={`shopify://admin/themes/current/editor?template=cart&addAppBlockId=${apiKey}/savings-banner&target=newAppsSection`}
              target="_top"
            >
              Add banner to cart page
            </s-button>
            <s-button
              href={`shopify://admin/themes/current/editor?template=product&addAppBlockId=${apiKey}/savings-banner&target=mainSection`}
              target="_top"
            >
              Add banner to product pages
            </s-button>
          </s-stack>
          <s-paragraph>
            <s-text type="strong">Thank-you page:</s-text> after ordering with a
            manual payment method such as Bank Deposit, the customer sees the
            discount and the amount to pay. To add it, open Settings, then
            Checkout, click Customize, switch to the Thank you page, and add the
            &quot;Payment discount amount&quot; app block.
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button href="shopify://admin/settings/checkout" target="_top">
              Open checkout settings
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Tell customers at checkout">
        <s-paragraph>
          In Settings, then Payments, open your manual payment method and paste
          this into Additional details:
        </s-paragraph>
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-text>{checkoutText}</s-text>
        </s-box>
      </s-section>
    </s-page>
  );
}

function OrderTable({ orders, retry = false }: { orders: OrderRow[]; retry?: boolean }) {
  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">Order</s-table-header>
        <s-table-header>Date</s-table-header>
        <s-table-header>Payment</s-table-header>
        <s-table-header format="currency">Total</s-table-header>
        {retry && <s-table-header>Action</s-table-header>}
      </s-table-header-row>
      <s-table-body>
        {orders.map((order) => (
          <s-table-row key={order.id}>
            <s-table-cell>
              <s-link href={`shopify://admin/orders/${order.id.split("/").pop()}`}>
                {order.name}
              </s-link>
            </s-table-cell>
            <s-table-cell>{new Date(order.createdAt).toLocaleDateString()}</s-table-cell>
            <s-table-cell>{order.paymentGatewayNames.join(", ")}</s-table-cell>
            <s-table-cell>
              {order.currentTotalPriceSet.shopMoney.amount}{" "}
              {order.currentTotalPriceSet.shopMoney.currencyCode}
            </s-table-cell>
            {retry && (
              <s-table-cell>
                <RetryButton orderId={order.id} />
              </s-table-cell>
            )}
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}

function RetryButton({ orderId }: { orderId: string }) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data && "message" in fetcher.data && fetcher.data.message) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.data, shopify]);

  return (
    <s-button
      {...(busy ? { loading: true } : {})}
      onClick={() => fetcher.submit({ intent: "retry", orderId }, { method: "post" })}
    >
      Retry
    </s-button>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

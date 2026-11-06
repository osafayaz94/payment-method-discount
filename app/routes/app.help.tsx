import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { loadBase } from "../admin.server";
import { HelpCard } from "../components/ui";

const SUPPORT_EMAIL = "osafayaz94@gmail.com";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const base = await loadBase(request);
  return {
    percent: base.settings.percent,
    method: base.settings.gateways[0] ?? "Bank Deposit",
    privacyUrl: `${process.env.SHOPIFY_APP_URL ?? ""}/privacy`,
  };
};

export default function Help() {
  const { percent, method, privacyUrl } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const checkoutText = `Get ${percent}% off when you pay by ${method}. The discount is applied automatically after you place your order, and we'll email you the final amount to pay.`;

  return (
    <s-page heading="Help">
      <HelpCard percent={percent} method={method} />

      <s-section heading="Tell customers at checkout">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Optional: in Settings, Payments, open your bank transfer method and
            paste this into Additional details. Customers then see the offer
            next to the payment method at checkout.
          </s-paragraph>
          <s-box
            padding="base"
            borderWidth="base"
            borderRadius="base"
            background="subdued"
          >
            <s-text>{checkoutText}</s-text>
          </s-box>
          <s-stack direction="inline" gap="base">
            <s-button
              onClick={() =>
                navigator.clipboard
                  ?.writeText(checkoutText)
                  .then(() => shopify.toast.show("Copied"))
              }
            >
              Copy text
            </s-button>
            <s-button
              href="shopify://admin/settings/payments"
              target="_top"
              variant="tertiary"
            >
              Open payment settings
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Contact us">
        <s-stack direction="block" gap="small-200">
          <s-paragraph>
            Questions or problems? Email{" "}
            <s-link href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</s-link>{" "}
            with your store&apos;s name. We usually reply within one working
            day.
          </s-paragraph>
          <s-link href={privacyUrl} target="_blank">
            Privacy policy
          </s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

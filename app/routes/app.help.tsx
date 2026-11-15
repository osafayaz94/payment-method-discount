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
    // Every method that gets the discount, as in the pop-up and banner.
    methods: base.settings.gateways.length
      ? base.settings.gateways
      : ["Bank Deposit"],
    privacyUrl: `${process.env.SHOPIFY_APP_URL ?? ""}/privacy`,
  };
};

export default function Help() {
  const { percent, methods, privacyUrl } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  // The discount is already in the checkout total; this note says what to do
  // next (merchants add their account details after it).
  const listed =
    methods.length > 1
      ? `${methods.slice(0, -1).join(", ")} or ${methods.at(-1)}`
      : methods[0];
  const checkoutText = `You get ${percent}% off for paying by ${listed}: it's already taken off your total. After placing the order, send the amount to the account below and keep the receipt.`;

  return (
    <s-page heading="Help">
      <s-section>
        <s-paragraph>
          Setting up for the first time? Follow the{" "}
          <s-link href="/app/guide">step-by-step guide</s-link>, with a picture
          for each step.
        </s-paragraph>
      </s-section>

      <HelpCard percent={percent} method={listed} />

      <s-section heading="Tell customers at checkout">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Optional: in Settings, Payments, open each bank transfer method
            (such as Bank Deposit, Jazz Cash or EasyPaisa), paste this into
            Additional details and add your account details below it. Customers
            see it when they choose that method at checkout.
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

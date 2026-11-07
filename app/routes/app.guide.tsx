import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { loadBase } from "../admin.server";
import { StepMark } from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const base = await loadBase(request);
  return {
    apiKey: base.apiKey,
    shop: base.shop,
    percent: base.settings.percent,
  };
};

type GuideStep = {
  title: string;
  optional?: boolean;
  text: React.ReactNode;
  image: string;
  alt: string;
  links?: { label: string; href: string; newTab?: boolean }[];
};

// A walkthrough of the whole setup with a picture per step. The pictures
// are in public/guide: screenshots of the app, and simple illustrations of
// Shopify's own screens.
export default function Guide() {
  const { apiKey, shop, percent } = useLoaderData<typeof loader>();
  const theme = "shopify://admin/themes/current/editor";

  const steps: GuideStep[] = [
    {
      title: "Turn on your payment methods in Shopify",
      text: (
        <>
          In Shopify, open Settings, then Payments. <b>A</b>: for bank transfer,
          click + Method under Manual payment methods and add Bank Deposit (with
          your bank details). <b>B</b>: for credit and debit cards, set up a
          payment provider. You need at least one of the two.
        </>
      ),
      image: "payments",
      alt: "Shopify's Payments settings: a payment provider for cards, and manual methods Bank Deposit and Cash on Delivery",
      links: [
        {
          label: "Open payment settings",
          href: "shopify://admin/settings/payments",
        },
      ],
    },
    {
      title: "Choose your discount",
      text: (
        <>
          In this app, open Settings. In step 1, enter the percentage and turn
          on who gets it: bank transfer, card, or both. Cash on delivery always
          pays full price.
        </>
      ),
      image: "discount",
      alt: "Step 1 of the app's settings: discount percentage and switches for bank transfer and card",
      links: [{ label: "Open Settings", href: "/app/settings" }],
    },
    {
      title: "List your payment methods",
      text: (
        <>
          In step 2, say what each payment method is: Bank transfer, Card or
          Cash on delivery. Methods used on your orders are listed already; add
          any others with Add a payment method, spelled exactly as at checkout.
        </>
      ),
      image: "methods",
      alt: "Step 2 of the app's settings: each payment method with a dropdown, and a row to add one",
    },
    {
      title: "Check the preview and save",
      text: (
        <>
          Step 3 shows what customers will see with your settings. When it looks
          right, click Save settings.
        </>
      ),
      image: "preview",
      alt: "Step 3 of the app's settings: a preview of the pop-up and checkout, and the Save settings button",
    },
    {
      title: "Turn on the payment pop-up",
      text: (
        <>
          Click the button below: your theme editor opens on App embeds.{" "}
          <b>1</b> App embeds is selected, <b>2</b> make sure Payment choice
          pop-up is switched on, <b>3</b> click Save. The pop-up is required:
          it&apos;s how customers choose bank transfer or card, so without it
          there&apos;s no discount. Home shows whether it&apos;s on.
        </>
      ),
      image: "theme",
      alt: "The theme editor's App embeds with Payment choice pop-up switched on, and the Save button",
      links: [
        {
          label: "Turn on pop-up",
          href: `${theme}?context=apps&activateAppId=${apiKey}/payment-choice`,
        },
      ],
    },
    {
      title: "What your customers see",
      text: (
        <>
          When a customer clicks Check out or Buy it now, the pop-up asks how
          they&apos;ll pay and shows the amount for each choice. Picking a
          discounted method takes {percent}% off at checkout, and checkout then
          only offers that method.
        </>
      ),
      image: "popup",
      alt: "The pop-up on a product page: bank transfer saves 5%, card and cash on delivery are full price",
    },
    {
      title: "Show the saving on product and cart pages",
      optional: true,
      text: (
        <>
          A banner such as &quot;Pay by Bank Deposit at checkout and save{" "}
          {percent}%&quot;, with the amount worked out from the price. Click a
          button below, then Save in the theme editor. You can move the banner
          where you like.
        </>
      ),
      image: "banner",
      alt: "A product page with the savings banner under the price",
      links: [
        {
          label: "Add to product pages",
          href: `${theme}?template=product&addAppBlockId=${apiKey}/savings-banner&target=mainSection`,
        },
        {
          label: "Add to cart page",
          href: `${theme}?template=cart&addAppBlockId=${apiKey}/savings-banner&target=newAppsSection`,
        },
      ],
    },
    {
      title: "Show the amount to pay after ordering",
      optional: true,
      text: (
        <>
          For bank transfer orders, the Thank-you page can show the discount and
          the amount to transfer. In the checkout editor: <b>1</b> switch to the
          Thank you page, <b>2</b> click Add app block and choose Payment
          discount amount, <b>3</b> click Save.
        </>
      ),
      image: "checkout",
      alt: "The checkout editor's Thank you page with Add app block and the Save button",
      links: [
        {
          label: "Open checkout editor",
          href: "shopify://admin/settings/checkout/editor",
        },
      ],
    },
    {
      title: "Turn things on and off",
      text: (
        <>
          On Home, each switch saves straight away. Discount is the main switch;
          under it, choose who gets it: bank transfer, card or both. Under On
          your store, the pop-up is required, and the savings banner and
          Thank-you amount can be switched on and off. A switch that can&apos;t
          be used yet says why.
        </>
      ),
      image: "switches",
      alt: "Home: the Discount switch with bank transfer and card under it, and On your store with the required pop-up, the savings banner and the Thank-you amount",
      links: [{ label: "Open Home", href: "/app" }],
    },
    {
      title: "Place a test order",
      text: (
        <>
          Open your store, click Buy it now on a product, choose bank transfer
          (or card) in the pop-up and place the order. It then shows under
          Orders. If an order was missed, enter its number under Apply to an
          order.
        </>
      ),
      image: "orders",
      alt: "The Orders page listing discounted orders",
      links: [
        { label: "Open your store", href: `https://${shop}`, newTab: true },
        { label: "Open Orders", href: "/app/orders" },
      ],
    },
  ];

  return (
    <s-page heading="Step-by-step guide">
      <s-section>
        <s-paragraph>
          Ten steps from start to your first discounted order: about 10 minutes.
          Steps marked Optional can be skipped.
        </s-paragraph>
      </s-section>
      {steps.map((step, index) => (
        <s-section key={step.title}>
          <s-stack direction="block" gap="base">
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <StepMark done={false} number={index + 1} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <s-stack direction="block" gap="small-200">
                  <s-stack
                    direction="inline"
                    gap="small-200"
                    alignItems="center"
                  >
                    <s-heading>{step.title}</s-heading>
                    {step.optional && <s-badge>Optional</s-badge>}
                  </s-stack>
                  <s-paragraph>{step.text}</s-paragraph>
                  {step.links && (
                    <s-stack direction="inline" gap="small-200">
                      {step.links.map((link, linkIndex) => (
                        <s-button
                          key={link.label}
                          href={link.href}
                          target={
                            link.newTab
                              ? "_blank"
                              : link.href.startsWith("/")
                                ? "auto"
                                : "_top"
                          }
                          variant={linkIndex === 0 ? "secondary" : "tertiary"}
                        >
                          {link.label}
                        </s-button>
                      ))}
                    </s-stack>
                  )}
                </s-stack>
              </div>
            </div>
            <img
              src={`/guide/${step.image}.png`}
              alt={step.alt}
              loading="lazy"
              style={{
                maxWidth: "100%",
                display: "block",
                borderRadius: 8,
                border: "1px solid #e3e3e3",
              }}
            />
          </s-stack>
        </s-section>
      ))}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

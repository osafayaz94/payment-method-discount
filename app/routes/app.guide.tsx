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
  // A picture of the step, from public/guide (not every step has one).
  image?: string;
  alt?: string;
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
          In Shopify, open Settings, then Payments. Under Manual payment
          methods, click + Method: add Bank Deposit, and with Create custom
          payment method add any others you take, such as Jazz Cash or
          EasyPaisa. In each one&apos;s Additional details, write your account
          details. Keep Cash on Delivery if you offer it.
        </>
      ),
      image: "payments",
      alt: "Shopify's Payments settings with manual methods Bank Deposit and Cash on Delivery",
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
          In this app, open Settings. In step 1, turn on Give the discount and
          type the percentage, such as {percent}. Cash on delivery always pays
          full price.
        </>
      ),
      links: [{ label: "Open Settings", href: "/app/settings" }],
    },
    {
      title: "Add your payment methods and switch on their discount",
      text: (
        <>
          Step 2 lists your payment methods with a Discount switch each: on
          gives that method {percent}% off, off means full price, like cash on
          delivery. Methods used on your orders are listed already. For any
          other, type its name exactly as at checkout (such as PayPal, Stripe,
          JazzCash or EasyPaisa) and click Add, then switch its Discount on.
          Methods you added yourself can be removed. Card payments share one
          Discount switch, on their row once your store has a card method.
        </>
      ),
    },
    {
      title: "Check what customers get, then save",
      text: (
        <>
          Step 3 is a small table: for each choice in the pop-up, what customers
          pay and which methods checkout then shows. When it looks right, click
          Save in the bar at the top of the page.
        </>
      ),
    },
    {
      title: "Turn on the payment pop-up",
      text: (
        <>
          Click the button below: your theme editor opens on App embeds.{" "}
          <b>1</b> App embeds is selected, <b>2</b> make sure Payment choice
          pop-up is switched on, <b>3</b> click Save. The pop-up is required:
          it&apos;s how customers choose bank transfer, so without it
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
          they&apos;ll pay. Bank transfer lists your discounted methods and
          shows the saving; cash on delivery is full price. After choosing bank
          transfer, checkout only offers those methods, with the discount shown
          as &quot;Bank Deposit {percent}% off&quot;.
        </>
      ),
      image: "popup",
      alt: "The pop-up: bank transfer (Bank Deposit, Jazz Cash, EasyPaisa) saves 5%, cash on delivery is full price",
    },
    {
      title: "Show the saving on product and cart pages",
      optional: true,
      text: (
        <>
          A banner such as &quot;Pay by Bank Deposit, Jazz Cash, EasyPaisa,
          PayPal or Stripe at checkout and save {percent}%&quot;, with the
          amount worked out from the price. Click a button below, then Save in
          the theme editor. You can move the banner where you like, and switch
          it off on Home.
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
      title: "Pause or resume from Home",
      text: (
        <>
          Home shows the discount in one line, such as &quot;{percent}% off for
          Bank Deposit, Jazz Cash, EasyPaisa&quot;, with the main switch to
          pause or resume it straight away. It also shows whether the pop-up and
          banner are on your store, and this month&apos;s discounted orders.
        </>
      ),
      links: [{ label: "Open Home", href: "/app" }],
    },
    {
      title: "Place a test order",
      text: (
        <>
          Open your store, click Buy it now on a product, choose Bank transfer
          in the pop-up and place the order with one of your bank methods. It
          shows under Orders, and in Shopify the order is tagged with how it was
          paid, such as Bank Deposit, Jazz Cash or EasyPaisa.
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
          Nine steps from start to your first discounted order: about 10
          minutes. Steps marked Optional can be skipped.
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
            {step.image && (
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
            )}
          </s-stack>
        </s-section>
      ))}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

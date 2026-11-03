import { useCallback, useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  APPLIED_TAG,
  FAILED_TAG,
  parseGateways,
  type DiscountSettings,
} from "../discount";
import { APP_HANDLE } from "../billing.server";
import {
  discountOrder,
  ensureCheckoutSetup,
  getCheckoutStatus,
  getPlanState,
  getSettings,
  getShopInfo,
  publishSettings,
  saveSettings,
  setCombinations,
  toGraphQL,
  type Combinations,
  type PlanState,
} from "../settings.server";

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

const DEFAULT_COMBINATIONS: Combinations = {
  productDiscounts: true,
  orderDiscounts: false,
  shippingDiscounts: true,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const graphql = toGraphQL(admin);
  const settings = await getSettings(session.shop);

  // Publishing on every visit puts a plan change into effect right away:
  // after picking a plan, Shopify sends the merchant back here with
  // plan_handle, so the plan is checked again rather than read from cache.
  let state: PlanState;
  try {
    const freshPlan = new URL(request.url).searchParams.has("plan_handle");
    state = await publishSettings(graphql, session.shop, { freshPlan });
  } catch (err) {
    console.error(
      `${session.shop}: could not publish settings: ${(err as Error).message}`,
    );
    state = await getPlanState(session.shop, await getShopInfo(graphql));
  }
  const [year, month] = state.month.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toLocaleDateString(
    "en-US",
    {
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    },
  );

  const [data, checkout] = await Promise.all([
    graphql(ORDERS_QUERY, {
      applied: `tag:'${APPLIED_TAG}'`,
      failed: `tag:'${FAILED_TAG}'`,
    }),
    getCheckoutStatus(graphql, session.shop),
  ]);

  // Payment method names exactly as Shopify records them, so the merchant
  // can pick them rather than type them.
  const seenGateways = [
    ...new Set<string>(
      data.recent.nodes.flatMap(
        (o: { paymentGatewayNames: string[] }) => o.paymentGatewayNames,
      ),
    ),
  ].sort();

  return {
    // Used to build theme editor links that add the storefront banner.
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
    settings,
    plan: state.plan,
    used: state.used,
    paused: Boolean(state.limitReason),
    nextMonth,
    // Plan selection page hosted by Shopify (Shopify App Pricing).
    plansUrl: `shopify://admin/charges/${APP_HANDLE}/pricing_plans`,
    checkout,
    seenGateways,
    applied: data.applied.nodes as OrderRow[],
    failed: data.failed.nodes as OrderRow[],
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();

  const intent = form.get("intent");
  if (intent === "retry" || intent === "apply") {
    let orderId = String(form.get("orderId") ?? "");
    if (intent === "apply") {
      // Merchants type the order number they see in the admin, such as #1001.
      const name = String(form.get("orderName") ?? "")
        .trim()
        .replace(/^#?/, "#");
      if (name === "#")
        return { ok: false, message: "Enter an order number, such as #1001" };
      const data = await toGraphQL(admin)(
        `#graphql
        query OrderByName($query: String!) {
          orders(first: 1, query: $query) {
            nodes { id name }
          }
        }`,
        { query: `name:${name}` },
      );
      const match = data.orders.nodes.find(
        (o: { name: string }) => o.name === name,
      );
      if (!match) return { ok: false, message: `No order ${name} found` };
      orderId = match.id;
    }
    try {
      const { result } = await discountOrder(
        toGraphQL(admin),
        session.shop,
        orderId,
      );
      return result.applied
        ? {
            ok: true,
            message: `Discount applied, new total ${result.total.amount} ${result.total.currencyCode}`,
          }
        : { ok: false, message: `Not applied: ${result.reason}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  // The method lists arrive as the ticked names, comma separated, plus any
  // names typed in.
  const percent = Number(form.get("percent"));
  const gateways = [
    ...new Set([
      ...parseGateways(String(form.get("gateways") ?? "")),
      ...parseGateways(String(form.get("otherGateways") ?? "")),
    ]),
  ];
  const codGateways = parseGateways(String(form.get("codGateways") ?? ""));
  const label = String(form.get("label") ?? "").trim();
  const cardLabel = String(form.get("cardLabel") ?? "").trim();
  const errors: Record<string, string> = {};
  if (!(percent > 0 && percent <= 100))
    errors.percent = "Enter a number above 0 and up to 100";
  if (!gateways.length) errors.gateways = "Pick at least one payment method";
  const both = gateways.filter((g) =>
    codGateways.some((c) => c.toLowerCase() === g.toLowerCase()),
  );
  if (both.length)
    errors.codGateways = `${both.join(", ")} can't be both discounted and cash on delivery`;
  if (!label) errors.label = "Enter a label";
  if (!cardLabel) errors.cardLabel = "Enter a label";
  if (Object.keys(errors).length) return { ok: false, errors };

  const settings: DiscountSettings = {
    enabled: form.get("enabled") !== null,
    percent,
    gateways,
    label,
    notifyCustomer: form.get("notifyCustomer") !== null,
    cardDiscount: form.get("cardDiscount") !== null,
    cardLabel,
    codGateways,
  };
  await saveSettings(session.shop, settings);
  const graphql = toGraphQL(admin);
  try {
    await publishSettings(graphql, session.shop);
    const { discountId } = await ensureCheckoutSetup(graphql, session.shop);
    await setCombinations(graphql, discountId, {
      productDiscounts: form.get("combineProduct") !== null,
      orderDiscounts: form.get("combineOrder") !== null,
      shippingDiscounts: form.get("combineShipping") !== null,
    });
  } catch (err) {
    return {
      ok: false,
      message: `Settings saved, but the store was not fully updated: ${(err as Error).message}`,
    };
  }
  return { ok: true, message: "Settings saved" };
};

export default function Index() {
  const {
    apiKey,
    shop,
    settings,
    plan,
    used,
    paused,
    nextMonth,
    plansUrl,
    checkout,
    seenGateways,
    applied,
    failed,
  } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const errors = result && "errors" in result ? result.errors : undefined;
  const saving = useNavigation().state === "submitting";
  const shopify = useAppBridge();

  useEffect(() => {
    if (result && "message" in result && result.message) {
      shopify.toast.show(result.message, { isError: !result.ok });
    }
  }, [result, shopify]);

  // The preview follows the form as the merchant types, before saving.
  const [percent, setPercent] = useState(settings.percent);
  const [cardOn, setCardOn] = useState(
    settings.cardDiscount && plan.cardDiscount,
  );
  const [showMore, setShowMore] = useState(
    Boolean(errors?.label || errors?.cardLabel),
  );
  const method = settings.gateways[0] ?? "Bank Deposit";
  const setupMissing =
    !checkout.discount || checkout.paymentRuleEnabled === null;
  const status = !settings.enabled
    ? { color: BRAND.muted, text: "Off" }
    : paused
      ? { color: BRAND.coral, text: "Paused: limit reached" }
      : setupMissing || !checkout.discount?.active
        ? { color: BRAND.amber, text: "Needs setup" }
        : { color: BRAND.green, text: "Active" };
  const combinesWith = checkout.discount?.combinesWith ?? DEFAULT_COMBINATIONS;
  // Every name the merchant might pick: the ones in the settings and the
  // ones seen on recent orders.
  const methodChoices = [
    ...new Set([
      ...settings.gateways,
      ...settings.codGateways,
      ...seenGateways,
    ]),
  ];
  const checkoutText = `Get ${settings.percent}% off when you pay by ${method}. The discount is applied automatically after you place your order, and we'll email you the final amount to pay.`;
  const shownPercent = percent > 0 ? percent : settings.percent;

  return (
    <s-page heading="Payment method discount">
      <Hero
        percent={settings.percent}
        methods={`${settings.gateways.join(", ")}${settings.cardDiscount && plan.cardDiscount ? " and cards" : ""}`}
        status={status}
      />

      <SetupGuide
        apiKey={apiKey}
        shop={shop}
        discountReady={
          settings.enabled &&
          Boolean(checkout.discount?.active) &&
          Boolean(checkout.paymentRuleEnabled)
        }
        tested={used > 0 || applied.length > 0}
      />

      <UsageCard
        plan={plan}
        used={used}
        paused={paused}
        nextMonth={nextMonth}
        plansUrl={plansUrl}
      />

      <Form method="post" data-save-bar style={{ marginBottom: 16 }}>
        <s-stack direction="block" gap="base">
          <s-section heading="Your discount">
            <s-stack direction="block" gap="base">
              <s-switch
                name="enabled"
                label="Give the discount"
                details="Turn off to stop all discounts straight away. Customers then pay full price with every method."
                defaultChecked={settings.enabled}
              />
              <s-grid
                gridTemplateColumns="1fr 2fr"
                gap="base"
                alignItems="start"
              >
                <s-number-field
                  name="percent"
                  label="Discount"
                  suffix="%"
                  min={0.01}
                  max={100}
                  step={0.5}
                  defaultValue={String(settings.percent)}
                  error={errors?.percent}
                  onInput={(event) =>
                    setPercent(Number(event.currentTarget.value))
                  }
                />
                <s-stack direction="block" gap="small-200">
                  <s-text type="strong">Who gets it</s-text>
                  <s-text>✓ Customers who pay by bank transfer</s-text>
                  <s-checkbox
                    name="cardDiscount"
                    label="Customers who pay by credit or debit card"
                    details={
                      plan.cardDiscount
                        ? "The card is charged the lower amount."
                        : "Available on the Pro and Advanced plans."
                    }
                    defaultChecked={settings.cardDiscount && plan.cardDiscount}
                    disabled={!plan.cardDiscount}
                    onChange={(event) => setCardOn(event.currentTarget.checked)}
                  />
                  <s-text color="subdued">
                    Cash on delivery always pays full price.
                  </s-text>
                </s-stack>
              </s-grid>
              <s-divider />
              <CheckoutPreview
                percent={shownPercent}
                method={method}
                cardOn={cardOn}
                codName={settings.codGateways[0] ?? "Cash on Delivery"}
              />
            </s-stack>
          </s-section>

          <s-section heading="Payment methods">
            <s-stack direction="block" gap="base">
              <s-paragraph color="subdued">
                Tick your store&apos;s payment methods as they&apos;re named at
                checkout. Any method not ticked here counts as card.
              </s-paragraph>
              <s-grid
                gridTemplateColumns="1fr 1fr"
                gap="base"
                alignItems="start"
              >
                <s-choice-list
                  name="gateways"
                  label="Bank transfer (discounted)"
                  multiple
                  error={errors?.gateways}
                >
                  {methodChoices.map((name) => (
                    <s-choice
                      key={name}
                      value={name}
                      defaultSelected={settings.gateways.includes(name)}
                    >
                      {name}
                    </s-choice>
                  ))}
                </s-choice-list>
                <s-choice-list
                  name="codGateways"
                  label="Cash on delivery (full price)"
                  multiple
                  error={errors?.codGateways}
                >
                  {methodChoices.map((name) => (
                    <s-choice
                      key={name}
                      value={name}
                      defaultSelected={settings.codGateways.includes(name)}
                    >
                      {name}
                    </s-choice>
                  ))}
                </s-choice-list>
              </s-grid>
              <s-text-field
                name="otherGateways"
                label="Bank method not listed?"
                placeholder="For example JazzCash"
                details="Type its name as shown at checkout. Separate several with commas."
              />
            </s-stack>
          </s-section>

          <s-section>
            <s-stack direction="block" gap="base">
              <s-stack
                direction="inline"
                justifyContent="space-between"
                alignItems="center"
              >
                <s-stack direction="block" gap="none">
                  <s-heading>More options</s-heading>
                  <s-text color="subdued">
                    Discount names, customer emails and combining with other
                    discounts
                  </s-text>
                </s-stack>
                <s-button
                  variant="tertiary"
                  icon={showMore ? "chevron-up" : "chevron-down"}
                  onClick={() => setShowMore(!showMore)}
                >
                  {showMore ? "Hide" : "Show"}
                </s-button>
              </s-stack>
              {/* Hidden rather than removed, so the fields are still saved. */}
              <div style={{ display: showMore ? "block" : "none" }}>
                <s-stack direction="block" gap="base">
                  <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                    <s-text-field
                      name="label"
                      label="Name for the bank transfer discount"
                      defaultValue={settings.label}
                      details="Shown at checkout, on the order and in emails"
                      error={errors?.label}
                    />
                    <s-text-field
                      name="cardLabel"
                      label="Name for the card discount"
                      defaultValue={settings.cardLabel}
                      error={errors?.cardLabel}
                    />
                  </s-grid>
                  <s-checkbox
                    name="notifyCustomer"
                    label="Email the customer the new total when an order is discounted after it's placed"
                    defaultChecked={settings.notifyCustomer}
                  />
                  <s-divider />
                  <s-text type="strong">Can be used together with</s-text>
                  <s-checkbox
                    name="combineProduct"
                    label="Product discounts and sale prices"
                    defaultChecked={combinesWith.productDiscounts}
                  />
                  <s-checkbox
                    name="combineOrder"
                    label="Other order discounts"
                    details="Only those that also allow combining."
                    defaultChecked={combinesWith.orderDiscounts}
                  />
                  <s-checkbox
                    name="combineShipping"
                    label="Free or reduced shipping"
                    defaultChecked={combinesWith.shippingDiscounts}
                  />
                </s-stack>
              </div>
              <s-stack direction="inline" gap="base">
                <s-button
                  type="submit"
                  variant="primary"
                  {...(saving ? { loading: true } : {})}
                >
                  Save
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>
        </s-stack>
      </Form>

      {failed.length > 0 && (
        <s-section heading="Needs attention">
          <s-paragraph>
            These orders qualified, but the discount couldn&apos;t be applied.
            They weren&apos;t changed. Click Retry, or edit the order by hand.
          </s-paragraph>
          <OrderTable orders={failed} retry />
        </s-section>
      )}

      <s-section heading="Discounted orders">
        <s-stack direction="block" gap="base">
          {applied.length ? (
            <OrderTable orders={applied} />
          ) : (
            <s-paragraph>
              None yet. Orders paid by {settings.gateways.join(" or ")}
              {settings.cardDiscount && plan.cardDiscount
                ? " or card"
                : ""}{" "}
              show up here.
            </s-paragraph>
          )}
          <s-divider />
          <ApplyToOrder />
        </s-stack>
      </s-section>

      <HelpCard percent={settings.percent} method={method} />

      <s-section slot="aside" heading="Tell customers at checkout">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Optional: in Settings, Payments, open your bank transfer method and
            paste this into Additional details.
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
    </s-page>
  );
}

type Activations = {
  popUp: boolean;
  banner: boolean;
  thankYou: boolean;
} | null;

// Step-by-step setup, ticked off by itself: the discount from the server,
// the theme and checkout blocks from Shopify (App Bridge's app.extensions(),
// which reports what's switched on in the live theme and checkout).
function SetupGuide({
  apiKey,
  shop,
  discountReady,
  tested,
}: {
  apiKey: string;
  shop: string;
  discountReady: boolean;
  tested: boolean;
}) {
  const shopify = useAppBridge();
  const [active, setActive] = useState<Activations>(null);
  const [open, setOpen] = useState(true);

  const check = useCallback(() => {
    shopify.app.extensions().then(
      (extensions) => {
        const blocks = extensions.flatMap((extension) =>
          extension.type === "theme_app_extension"
            ? (extension.activations as { handle: string; status: string }[])
            : [],
        );
        const isOn = (handle: string) =>
          blocks.some(
            (block) => block.handle === handle && block.status === "active",
          );
        const thankYou = extensions.some(
          (extension) =>
            extension.handle === "thank-you-amount" &&
            extension.activations.length > 0,
        );
        setActive({
          popUp: isOn("payment-choice"),
          banner: isOn("savings-banner"),
          thankYou,
        });
      },
      () => setActive(null),
    );
  }, [shopify]);

  // Check on load, and again when the merchant comes back from the theme
  // editor in another tab.
  useEffect(() => {
    check();
    const again = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
    };
  }, [check]);

  const steps = [
    {
      title: "Set up the discount",
      detail:
        "Choose the percentage and your bank transfer methods below, then click Save.",
      done: discountReady,
    },
    {
      title: "Turn on the payment pop-up",
      detail:
        "Asks customers how they'll pay when they click Check out or Buy it now, so the discount shows at checkout. Click the button, then Save in the theme editor.",
      done: active?.popUp,
      action: {
        label: "Turn on pop-up",
        href: `shopify://admin/themes/current/editor?context=apps&activateAppId=${apiKey}/payment-choice`,
      },
    },
    {
      title: "Place a test order",
      detail:
        "Buy something in your store and pick bank transfer in the pop-up. It shows under Discounted orders.",
      done: tested,
      action: {
        label: "Open your store",
        href: `https://${shop}`,
        newTab: true,
      },
    },
    {
      title: "Show the saving on cart and product pages",
      optional: true,
      detail:
        'A banner such as "Pay by bank transfer and save 5%". Add it, then click Save in the theme editor.',
      done: active?.banner,
      action: {
        label: "Add to cart page",
        href: `shopify://admin/themes/current/editor?template=cart&addAppBlockId=${apiKey}/savings-banner&target=newAppsSection`,
      },
      second: {
        label: "Add to product pages",
        href: `shopify://admin/themes/current/editor?template=product&addAppBlockId=${apiKey}/savings-banner&target=mainSection`,
      },
    },
    {
      title: "Show the amount to pay after ordering",
      optional: true,
      detail:
        'A Thank-you page block for bank transfer orders. In the checkout editor, switch to the Thank you page and add "Payment discount amount".',
      done: active?.thankYou,
      action: {
        label: "Open checkout editor",
        href: "shopify://admin/settings/checkout/editor",
      },
    },
  ];
  const required = steps.filter((step) => !step.optional);
  const doneCount = required.filter((step) => step.done).length;
  const allDone = doneCount === required.length;

  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <s-stack
          direction="inline"
          justifyContent="space-between"
          alignItems="center"
        >
          <s-stack direction="block" gap="none">
            <s-heading>{allDone ? "You're all set" : "Get started"}</s-heading>
            <s-text color="subdued">
              {doneCount} of {required.length} steps done
              {allDone ? ". The extras below are optional." : ""}
            </s-text>
          </s-stack>
          <s-stack direction="inline" gap="small-200">
            <s-button
              variant="tertiary"
              icon="refresh"
              onClick={check}
              accessibilityLabel="Check again"
            />
            <s-button
              variant="tertiary"
              icon={open ? "chevron-up" : "chevron-down"}
              onClick={() => setOpen(!open)}
              accessibilityLabel={open ? "Hide steps" : "Show steps"}
            />
          </s-stack>
        </s-stack>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={required.length}
          aria-valuenow={doneCount}
          style={{
            height: 6,
            borderRadius: 3,
            background: BRAND.track,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${(doneCount / required.length) * 100}%`,
              height: "100%",
              background: BRAND.accent,
              transition: "width 0.3s",
            }}
          />
        </div>
        {open &&
          steps.map((step, index) => (
            <s-box
              key={step.title}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background={step.done ? "subdued" : "base"}
            >
              <div
                style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
              >
                <StepMark done={Boolean(step.done)} number={index + 1} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <s-stack direction="block" gap="small-200">
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                    >
                      <s-text type="strong">{step.title}</s-text>
                      {step.optional && <s-badge>Optional</s-badge>}
                      {step.done === undefined &&
                        step.action &&
                        active === null && (
                          <s-badge tone="neutral">Couldn&apos;t check</s-badge>
                        )}
                    </s-stack>
                    {!step.done && (
                      <s-text color="subdued">{step.detail}</s-text>
                    )}
                    {!step.done && step.action && (
                      <s-stack direction="inline" gap="small-200">
                        <s-button
                          href={step.action.href}
                          target={"newTab" in step.action ? "_blank" : "_top"}
                        >
                          {step.action.label}
                        </s-button>
                        {step.second && (
                          <s-button
                            href={step.second.href}
                            target="_top"
                            variant="tertiary"
                          >
                            {step.second.label}
                          </s-button>
                        )}
                      </s-stack>
                    )}
                  </s-stack>
                </div>
              </div>
            </s-box>
          ))}
      </s-stack>
    </s-section>
  );
}

function StepMark({ done, number }: { done: boolean; number: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 24,
        height: 24,
        borderRadius: "50%",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 700,
        background: done ? BRAND.green : "transparent",
        border: done ? "none" : `2px dashed ${BRAND.muted}`,
        color: done ? "#fff" : BRAND.ink,
      }}
    >
      {done ? "✓" : number}
    </div>
  );
}

// Short answers to what merchants usually ask.
function HelpCard({ percent, method }: { percent: number; method: string }) {
  const questions = [
    {
      q: "Why don't I see the discount at checkout?",
      a: "The customer has to pick bank transfer (or card, if turned on) in the pop-up before checkout. Check that the pop-up is turned on in Get started.",
    },
    {
      q: "Can customers still choose cash on delivery?",
      a: "Yes, at full price. Checkout then only offers cash on delivery, so a discount can't be paid that way.",
    },
    {
      q: "What about Shop Pay, PayPal and other express buttons?",
      a: "They skip the pop-up, so the pop-up hides them by default. You can show them again in the pop-up's settings in the theme editor.",
    },
    {
      q: "A bank transfer order didn't get the discount",
      a: `Orders paid by ${method} that skipped the pop-up get ${percent}% off after ordering, if they're still unpaid. For anything missed, use Apply to an order.`,
    },
  ];
  return (
    <s-section slot="aside" heading="Questions">
      <s-stack direction="block" gap="base">
        {questions.map(({ q, a }) => (
          <details key={q}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
              {q}
            </summary>
            <div style={{ marginTop: 6 }}>
              <s-text color="subdued">{a}</s-text>
            </div>
          </details>
        ))}
      </s-stack>
    </s-section>
  );
}

// The app's own colours (navy and gold), used for its custom cards;
// everything else is standard Polaris.
const BRAND = {
  // Banner gradient and buttons.
  primary: "#0f172a",
  secondary: "#334155",
  // The meter and the "5%" circle.
  accent: "#ca8a04",
  ink: "#0f172a",
  soft: "#f8fafc",
  softer: "#fefce8",
  border: "#e2e8f0",
  track: "#f1f5f9",
  coral: "#e5484d",
  coralSoft: "#fff1f2",
  coralBorder: "#fecdd3",
  amber: "#ea580c",
  green: "#22c55e",
  muted: "#9ca3af",
};

// Top card: the discount on offer and whether it's running.
function Hero({
  percent,
  methods,
  status,
}: {
  percent: number;
  methods: string;
  status: { color: string; text: string };
}) {
  return (
    <div
      style={{
        background: `linear-gradient(120deg, ${BRAND.primary} 0%, ${BRAND.secondary} 100%)`,
        color: "#fff",
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "#fff",
          color: BRAND.accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "1.3rem",
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {percent}%
      </div>
      <div style={{ flex: "1 1 220px" }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 650 }}>
          {percent}% off for paying by {methods}
        </div>
        <div style={{ opacity: 0.85, marginTop: 4, fontSize: 14 }}>
          Customers pick how they pay before checkout, and see the saving
          straight away.
        </div>
      </div>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          background: "#fff",
          color: BRAND.ink,
          borderRadius: 999,
          padding: "6px 12px",
          fontWeight: 600,
          fontSize: "0.9rem",
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: status.color,
          }}
        />
        {status.text}
      </div>
    </div>
  );
}

// Round meter for the month's discounted orders.
function Ring({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  const radius = 30;
  const length = 2 * Math.PI * radius;
  const share = Math.min(1, value / max);
  return (
    <svg
      width="76"
      height="76"
      viewBox="0 0 76 76"
      role="img"
      aria-label={`${value} of ${max} discounted orders used`}
      style={{ flexShrink: 0 }}
    >
      <circle
        cx="38"
        cy="38"
        r={radius}
        fill="none"
        stroke={BRAND.track}
        strokeWidth="8"
      />
      {share > 0 && (
        <circle
          cx="38"
          cy="38"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${length * share} ${length}`}
          transform="rotate(-90 38 38)"
        />
      )}
      <text
        x="38"
        y="43"
        textAnchor="middle"
        fontSize="15"
        fontWeight="700"
        fill={BRAND.ink}
      >
        {value}/{max}
      </text>
    </svg>
  );
}

// The monthly allowance, with an upgrade offer on the Free and Pro plans.
function UsageCard({
  plan,
  used,
  paused,
  nextMonth,
  plansUrl,
}: {
  plan: { key: string; name: string; limit: number | null; billing: boolean };
  used: number;
  paused: boolean;
  nextMonth: string;
  plansUrl: string;
}) {
  if (!plan.billing || plan.limit === null) {
    return (
      <s-section>
        <s-stack direction="block" gap="small-200">
          {!plan.billing && (
            <s-banner tone="info" heading="Billing is not set up">
              The Partner API details are missing on the server, so every
              feature is unlocked.
            </s-banner>
          )}
          <s-stack
            direction="inline"
            justifyContent="space-between"
            alignItems="center"
            gap="base"
          >
            <s-text>
              <s-text type="strong">{plan.name} plan</s-text> · {used}{" "}
              discounted orders this month, no limit
            </s-text>
            {plan.billing && (
              <s-button href={plansUrl} target="_top">
                Change plan
              </s-button>
            )}
          </s-stack>
        </s-stack>
      </s-section>
    );
  }

  const next = plan.key === "free" ? "Pro" : "Advanced";
  const near = !paused && used >= plan.limit * 0.8;
  const color = paused ? BRAND.coral : near ? BRAND.amber : BRAND.accent;
  const message = paused
    ? `All ${plan.limit} used. Customers pay full price until ${nextMonth}.`
    : near
      ? `Nearly used up. The discount pauses at ${plan.limit}, until ${nextMonth}.`
      : `${plan.limit - used} left this month. Counts start again on ${nextMonth}.`;

  return (
    <div
      style={{
        background: paused
          ? BRAND.coralSoft
          : `linear-gradient(135deg, ${BRAND.soft} 0%, ${BRAND.softer} 100%)`,
        border: `1px solid ${paused ? BRAND.coralBorder : BRAND.border}`,
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        display: "flex",
        alignItems: "center",
        gap: 20,
        flexWrap: "wrap",
        color: BRAND.ink,
        fontSize: 14,
      }}
    >
      <Ring value={used} max={plan.limit} color={color} />
      <div style={{ flex: "1 1 240px" }}>
        <div style={{ fontWeight: 650 }}>
          This month on the {plan.name} plan
        </div>
        <div style={{ marginTop: 4, color: paused ? BRAND.coral : undefined }}>
          {message}
        </div>
        <div style={{ marginTop: 4, opacity: 0.75, fontSize: 13 }}>
          {next === "Pro"
            ? "Pro: 30 discounted orders a month, card discounts, your own wording and colours."
            : "Advanced: no monthly limit."}
        </div>
      </div>
      <s-button variant="primary" href={plansUrl} target="_top">
        {`Get ${next}`}
      </s-button>
    </div>
  );
}

// What the customer sees: the pop-up's options, then checkout offering only
// the method they picked, with the discount already taken off.
function CheckoutPreview({
  percent,
  method,
  cardOn,
  codName,
}: {
  percent: number;
  method: string;
  cardOn: boolean;
  codName: string;
}) {
  const off = <s-badge tone="success">{percent}% off</s-badge>;
  const full = <s-badge>Full price</s-badge>;
  const mockButton = (label: string) => (
    <div
      style={{
        background: BRAND.primary,
        color: "#fff",
        borderRadius: 999,
        padding: "10px 12px",
        textAlign: "center",
        fontWeight: 600,
      }}
    >
      {label}
    </div>
  );
  const option = (name: string, badge: React.ReactNode, selected = false) => (
    <s-stack
      direction="inline"
      justifyContent="space-between"
      alignItems="center"
      gap="small-200"
    >
      <s-text>
        {selected ? "◉" : "○"} {name}
      </s-text>
      {badge}
    </s-stack>
  );

  return (
    <s-stack direction="block" gap="base">
      <s-text type="strong">What customers see</s-text>
      <s-box border="base" borderRadius="base" padding="base">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            Check out or Buy it now opens the pop-up
          </s-text>
          <s-grid
            gridTemplateColumns="1fr auto 2fr"
            gap="base"
            alignItems="center"
          >
            {mockButton("Check out")}
            <s-icon type="arrow-right" />
            <s-box border="base" borderRadius="base" padding="small">
              <s-stack direction="block" gap="small-200">
                <s-text type="strong">How would you like to pay?</s-text>
                {option("Bank transfer", off, true)}
                {option("Credit / debit card", cardOn ? off : full)}
                {option("Cash on Delivery", full)}
              </s-stack>
            </s-box>
          </s-grid>
          <s-text color="subdued">
            Checkout then only offers the chosen method
          </s-text>
          <s-grid
            gridTemplateColumns="1fr auto 2fr"
            gap="base"
            alignItems="center"
          >
            {mockButton("Bank transfer")}
            <s-icon type="arrow-right" />
            <s-box border="base" borderRadius="base" padding="small">
              {option(method, off, true)}
            </s-box>
          </s-grid>
          <s-grid
            gridTemplateColumns="1fr auto 2fr"
            gap="base"
            alignItems="center"
          >
            {mockButton("Cash on Delivery")}
            <s-icon type="arrow-right" />
            <s-box border="base" borderRadius="base" padding="small">
              {option(codName, full, true)}
            </s-box>
          </s-grid>
        </s-stack>
      </s-box>
    </s-stack>
  );
}

function OrderTable({
  orders,
  retry = false,
}: {
  orders: OrderRow[];
  retry?: boolean;
}) {
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
              <s-link
                href={`shopify://admin/orders/${order.id.split("/").pop()}`}
              >
                {order.name}
              </s-link>
            </s-table-cell>
            <s-table-cell>
              {new Date(order.createdAt).toLocaleDateString()}
            </s-table-cell>
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

// For orders placed while the app was offline, or to check why an order was
// skipped: the message says what happened.
function ApplyToOrder() {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data && "message" in fetcher.data && fetcher.data.message) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.data, shopify]);

  return (
    <s-section heading="Apply to an order">
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="apply" />
        <s-stack direction="block" gap="base">
          <s-text-field
            name="orderName"
            label="Order number"
            placeholder="#1001"
            details="Applies the discount to an order that was missed, or tells you why it doesn't qualify."
          />
          <s-stack direction="inline" gap="base">
            <s-button type="submit" {...(busy ? { loading: true } : {})}>
              Apply discount
            </s-button>
          </s-stack>
          {fetcher.data &&
            "message" in fetcher.data &&
            fetcher.data.message && (
              <s-text tone={fetcher.data.ok ? "success" : "critical"}>
                {fetcher.data.message}
              </s-text>
            )}
        </s-stack>
      </fetcher.Form>
    </s-section>
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
      onClick={() =>
        fetcher.submit({ intent: "retry", orderId }, { method: "post" })
      }
    >
      Retry
    </s-button>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

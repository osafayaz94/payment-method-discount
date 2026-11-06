import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { loadBase, loadOrders } from "../admin.server";
import {
  getCheckoutStatus,
  publishSettings,
  saveSettings,
} from "../settings.server";
import type { DiscountSettings } from "../discount";
import {
  BRAND,
  EnableMethodsFirst,
  Hero,
  OrderTable,
  ProgressBar,
  StepMark,
  UsageCard,
  discountedMethods,
  useActivations,
  useToastResult,
  type ActionResult,
} from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Home publishes the settings on every visit, so a plan change (Shopify
  // sends the merchant here after picking a plan) takes effect right away.
  const base = await loadBase(request, { publish: true });
  const [{ applied }, checkout] = await Promise.all([
    loadOrders(base.graphql, { first: 3 }),
    getCheckoutStatus(base.graphql, base.shop),
  ]);
  return {
    apiKey: base.apiKey,
    shop: base.shop,
    settings: base.settings,
    plan: base.plan,
    used: base.used,
    paused: base.paused,
    nextMonth: base.nextMonth,
    plansUrl: base.plansUrl,
    discountLive:
      Boolean(checkout.discount?.active) &&
      Boolean(checkout.paymentRuleEnabled),
    applied,
  };
};

// The on/off switches below save straight away, one setting at a time.
const SWITCHES = [
  "enabled",
  "bankDiscount",
  "cardDiscount",
  "showPopUp",
  "showBanner",
  "showThankYou",
] as const satisfies readonly (keyof DiscountSettings)[];
type SwitchField = (typeof SWITCHES)[number];

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const base = await loadBase(request);
  const form = await request.formData();
  const field = String(form.get("field")) as SwitchField;
  if (form.get("intent") !== "toggle" || !SWITCHES.includes(field)) {
    return { ok: false, message: "Unknown setting" };
  }
  const on = form.get("value") === "on";
  const settings = { ...base.settings, [field]: on };
  if (field === "cardDiscount" && on && !base.plan.cardDiscount) {
    return {
      ok: false,
      message: "Card discounts are on the Pro and Advanced plans",
    };
  }
  const bankLive = settings.bankDiscount && settings.gateways.length > 0;
  const cardLive =
    settings.cardDiscount &&
    base.plan.cardDiscount &&
    settings.cardGateways.length > 0;
  if (
    !bankLive &&
    !cardLive &&
    (field === "bankDiscount" || field === "cardDiscount")
  ) {
    return {
      ok: false,
      message: "Keep bank transfer or card on, or turn off the whole discount",
    };
  }
  if (field === "bankDiscount" && on && !settings.gateways.length) {
    return {
      ok: false,
      message:
        "First enable a bank transfer method and add it in Settings, step 2",
    };
  }
  if (field === "cardDiscount" && on && !settings.cardGateways.length) {
    return {
      ok: false,
      message:
        "First enable a card payment method and add it in Settings, step 2",
    };
  }
  await saveSettings(base.shop, settings);
  try {
    await publishSettings(base.graphql, base.shop);
  } catch (err) {
    return {
      ok: false,
      message: `Saved, but the store was not updated: ${(err as Error).message}`,
    };
  }
  return { ok: true, message: `${LABELS[field]} turned ${on ? "on" : "off"}` };
};

const LABELS: Record<SwitchField, string> = {
  enabled: "Discount",
  bankDiscount: "Bank transfer discount",
  cardDiscount: "Card discount",
  showPopUp: "Payment pop-up",
  showBanner: "Savings banner",
  showThankYou: "Thank-you page amount",
};

export default function Home() {
  const {
    apiKey,
    shop,
    settings,
    plan,
    used,
    paused,
    nextMonth,
    plansUrl,
    discountLive,
    applied,
  } = useLoaderData<typeof loader>();
  const { active, check } = useActivations();

  const method = settings.gateways[0] ?? "Bank Deposit";
  const hasBank = settings.gateways.length > 0;
  const hasCard = settings.cardGateways.length > 0;
  const bankOn = settings.bankDiscount && hasBank;
  const cardOn = settings.cardDiscount && plan.cardDiscount && hasCard;
  const status = !settings.enabled
    ? { color: BRAND.muted, text: "Off" }
    : paused
      ? { color: BRAND.coral, text: "Paused: limit reached" }
      : !discountLive || active?.popUp === false || !settings.showPopUp
        ? { color: BRAND.amber, text: "Needs setup" }
        : { color: BRAND.green, text: "Active" };

  const themeEditor = `shopify://admin/themes/current/editor`;
  const steps = [
    {
      title: "Choose your discount and payment methods",
      done:
        settings.enabled &&
        discountLive &&
        (!settings.bankDiscount || settings.gateways.length > 0),
      action: <s-link href="/app/settings">Open settings</s-link>,
    },
    {
      title: "Turn on the payment pop-up in your theme",
      done: Boolean(active?.popUp),
      action: (
        <s-link
          href={`${themeEditor}?context=apps&activateAppId=${apiKey}/payment-choice`}
          target="_top"
        >
          Turn on in theme
        </s-link>
      ),
    },
    {
      title: "Place a test order",
      done: used > 0 || applied.length > 0,
      action: (
        <s-link href={`https://${shop}`} target="_blank">
          Open your store
        </s-link>
      ),
    },
  ];
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <s-page heading="Nexora: Payment Discounts">
      <Hero
        percent={settings.percent}
        methods={discountedMethods(settings, plan.cardDiscount)}
        status={status}
      />

      {doneCount < steps.length && (
        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack
              direction="inline"
              justifyContent="space-between"
              alignItems="center"
            >
              <s-heading>{`Get started · ${doneCount} of ${steps.length} done`}</s-heading>
              <s-button
                variant="tertiary"
                icon="refresh"
                onClick={check}
                accessibilityLabel="Check again"
              />
            </s-stack>
            <ProgressBar value={doneCount} max={steps.length} />
            <s-text color="subdued">
              New here? The{" "}
              <s-link href="/app/guide">step-by-step guide</s-link> walks
              through everything with pictures.
            </s-text>

            {steps.map((step, index) => (
              <div
                key={step.title}
                style={{ display: "flex", gap: 12, alignItems: "center" }}
              >
                <StepMark done={step.done} number={index + 1} />
                <div style={{ flex: 1 }}>
                  <s-text type={step.done ? "generic" : "strong"}>
                    {step.title}
                  </s-text>
                </div>
                {!step.done && step.action}
              </div>
            ))}
          </s-stack>
        </s-section>
      )}

      {!hasBank && !hasCard && <EnableMethodsFirst />}

      <s-section heading="On / off">
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">
            Each switch saves straight away. How it works: a pop-up asks
            customers how they&apos;ll pay before checkout; discounted methods
            get {settings.percent}% off, cash on delivery pays full price.
          </s-paragraph>
          <QuickSwitch
            field="enabled"
            label="Discount"
            details="Turns every discount on or off."
            checked={settings.enabled}
          />
          <QuickSwitch
            field="bankDiscount"
            label="Bank transfer discount"
            details={
              hasBank
                ? `${settings.percent}% off for ${settings.gateways.join(", ")}.`
                : "First enable a bank transfer method, such as Bank Deposit, in Shopify and add it in Settings, step 2."
            }
            checked={bankOn}
            locked={
              !hasBank
                ? "No bank transfer method yet."
                : bankOn && !cardOn
                  ? "Card is off, so this one stays on."
                  : undefined
            }
          />
          <QuickSwitch
            field="cardDiscount"
            label="Card discount"
            details={
              !plan.cardDiscount
                ? "Available on the Pro and Advanced plans."
                : hasCard
                  ? `${settings.percent}% off for ${settings.cardGateways.join(", ")}, when chosen in the pop-up.`
                  : "First enable a card payment method in Shopify and add it in Settings, step 2."
            }
            checked={cardOn}
            locked={
              !plan.cardDiscount
                ? "Upgrade to use it."
                : !hasCard
                  ? "No card payment method yet."
                  : cardOn && !bankOn
                    ? "Bank transfer is off, so this one stays on."
                    : undefined
            }
          />
          <QuickSwitch
            field="showPopUp"
            label="Payment pop-up"
            details="Asks how the customer will pay when they click Check out or Buy it now. Without it, checkout has no discount."
            checked={settings.showPopUp}
            added={active?.popUp}
            addHref={`${themeEditor}?context=apps&activateAppId=${apiKey}/payment-choice`}
            addLabel="Turn on in theme"
          />
          <QuickSwitch
            field="showBanner"
            label="Savings banner"
            details={`"Pay by ${method} at checkout and save ${settings.percent}%" on product and cart pages.`}
            checked={settings.showBanner}
            added={active?.banner}
            addHref={`${themeEditor}?template=product&addAppBlockId=${apiKey}/savings-banner&target=mainSection`}
            addLabel="Add to product pages"
          />
          <QuickSwitch
            field="showThankYou"
            label="Thank-you page amount"
            details="After a bank transfer order, shows the discount and the amount to pay."
            checked={settings.showThankYou}
            added={active?.thankYou}
            addHref="shopify://admin/settings/checkout/editor"
            addLabel="Add in checkout editor"
          />
        </s-stack>
      </s-section>

      <UsageCard
        plan={plan}
        used={used}
        paused={paused}
        nextMonth={nextMonth}
        plansUrl={plansUrl}
      />

      <s-section heading="Latest discounted orders">
        <s-stack direction="block" gap="base">
          {applied.length ? (
            <OrderTable orders={applied} />
          ) : (
            <s-paragraph>None yet.</s-paragraph>
          )}
          <s-stack direction="inline" gap="base">
            <s-link href="/app/orders">All orders</s-link>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

// An on/off switch that saves on its own. Theme and checkout blocks have to
// be added once in their editor first (Shopify doesn't let apps do that);
// until then the switch is off and a button opens the editor.
function QuickSwitch({
  field,
  label,
  details,
  checked,
  locked,
  added,
  addHref,
  addLabel,
}: {
  field: SwitchField;
  label: string;
  details: string;
  checked: boolean;
  locked?: string;
  added?: boolean;
  addHref?: string;
  addLabel?: string;
}) {
  const fetcher = useFetcher<ActionResult>();
  useToastResult(fetcher.data);
  const pending = fetcher.formData?.get("value");
  const on = pending ? pending === "on" : checked;
  const needsAdding = addHref !== undefined && added === false;

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <s-stack direction="block" gap="small-100">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text type="strong">{label}</s-text>
              {needsAdding ? (
                <s-badge tone="warning">Not added yet</s-badge>
              ) : (
                <s-badge tone={on ? "success" : "neutral"}>
                  {on ? "On" : "Off"}
                </s-badge>
              )}
            </s-stack>
            <s-text color="subdued">{details}</s-text>
            {locked && <s-text color="subdued">{locked}</s-text>}
            {needsAdding && (
              <s-stack direction="inline" gap="small-200">
                <s-button href={addHref} target="_top">
                  {addLabel}
                </s-button>
              </s-stack>
            )}
          </s-stack>
        </div>
        <s-switch
          // Remount when the saved value changes, so a refused change snaps back.
          key={`${field}-${checked}`}
          label={label}
          labelAccessibilityVisibility="exclusive"
          defaultChecked={on}
          disabled={Boolean(locked) || needsAdding || fetcher.state !== "idle"}
          onChange={(event) =>
            fetcher.submit(
              {
                intent: "toggle",
                field,
                value: event.currentTarget.checked ? "on" : "off",
              },
              { method: "post" },
            )
          }
        />
      </div>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

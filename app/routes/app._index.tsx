import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useEffect, useRef } from "react";
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
  GUIDE_IMAGES_VERSION,
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
  "showBanner",
  "showThankYou",
] as const satisfies readonly (keyof DiscountSettings)[];
type SwitchField = (typeof SWITCHES)[number];

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const base = await loadBase(request);
  const form = await request.formData();

  // The percentage, typed in on Home.
  if (form.get("intent") === "percent") {
    const percent = Number(String(form.get("percent") ?? "").replace(",", "."));
    if (!(percent > 0 && percent <= 100)) {
      return { ok: false, message: "Enter a percentage above 0 and up to 100" };
    }
    await saveSettings(base.shop, { ...base.settings, percent });
    try {
      await publishSettings(base.graphql, base.shop);
    } catch (err) {
      return {
        ok: false,
        message: `Saved, but the store was not updated: ${(err as Error).message}`,
      };
    }
    return { ok: true, message: `Discount set to ${percent}%` };
  }

  const field = String(form.get("field")) as SwitchField;
  if (form.get("intent") !== "toggle" || !SWITCHES.includes(field)) {
    return { ok: false, message: "Unknown setting" };
  }
  const on = form.get("value") === "on";
  const settings = { ...base.settings, [field]: on };
  if (field === "cardDiscount" && on && !base.plan.cardDiscount) {
    return {
      ok: false,
      message: "Card discounts are on the Unlimited plan",
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
  const status = !settings.enabled
    ? { color: BRAND.muted, text: "Off" }
    : paused
      ? { color: BRAND.coral, text: "Paused: limit reached" }
      : !discountLive || active?.popUp === false
        ? { color: BRAND.amber, text: "Needs setup" }
        : { color: BRAND.green, text: "Active" };

  // Every method that gets the discount, as the banner itself names them:
  // "Bank Deposit, Jazz Cash or EasyPaisa".
  const bannerNames = settings.bankDiscount ? settings.gateways : [];
  const bannerMethods =
    bannerNames.length > 1
      ? `${bannerNames.slice(0, -1).join(", ")} or ${bannerNames.at(-1)}`
      : (bannerNames[0] ?? method);
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
    <s-page heading="Nexora: Bank Transfer Discount">
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

      {/* A summary with the main switch; the percentage and who gets it
          are set in Settings. */}
      <s-section heading="Discount">
        <s-stack direction="block" gap="base">
          <QuickSwitch
            field="enabled"
            label="Discount"
            details={
              settings.enabled
                ? `${settings.percent}% off for ${discountedMethods(settings, plan.cardDiscount)}. Cash on delivery pays full price.`
                : "Off: every customer pays full price."
            }
            checked={settings.enabled}
          />
          <s-link href="/app/settings">
            Change the percentage or payment methods in Settings
          </s-link>
        </s-stack>
      </s-section>

      <s-section heading="On your store">
        <s-stack direction="block" gap="base">
          <PopUpRow
            on={active?.popUp}
            href={`${themeEditor}?context=apps&activateAppId=${apiKey}/payment-choice`}
          />
          <QuickSwitch
            field="showBanner"
            label="Savings banner"
            optional
            details={`Tells shoppers about the saving before they check out: "Pay by ${bannerMethods} at checkout and save ${settings.percent}%", on product and cart pages.`}
            image={{
              src: "/guide/banner.png",
              alt: "A product page with the savings banner under the price",
            }}
            checked={settings.showBanner}
            added={active?.banner}
            addHref={`${themeEditor}?template=product&addAppBlockId=${apiKey}/savings-banner&target=mainSection`}
            addLabel="Add to product pages"
            openWhenOn={`${themeEditor}?template=product`}
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
  optional = false,
  image,
  openWhenOn,
}: {
  field: SwitchField;
  label: string;
  details: string;
  checked: boolean;
  optional?: boolean;
  image?: { src: string; alt: string };
  locked?: string;
  added?: boolean;
  addHref?: string;
  addLabel?: string;
  // Where to take the merchant once the switch is turned on and saved.
  openWhenOn?: string;
}) {
  const fetcher = useFetcher<ActionResult>();
  useToastResult(fetcher.data);
  const turnedOn = useRef(false);
  useEffect(() => {
    if (openWhenOn && turnedOn.current && fetcher.data?.ok) {
      turnedOn.current = false;
      open(openWhenOn, "_top");
    }
  }, [fetcher.data, openWhenOn]);
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
              {optional && <s-badge>Optional</s-badge>}
              {needsAdding ? (
                <s-badge tone="warning">Not added yet</s-badge>
              ) : (
                <s-badge tone={on ? "success" : "neutral"}>
                  {on ? "On" : "Off"}
                </s-badge>
              )}
              {/* The switch sits next to its On/Off badge. */}
              <s-switch
                // Remount when the saved value changes, so a refused change snaps back.
                key={`${field}-${checked}`}
                label={label}
                labelAccessibilityVisibility="exclusive"
                defaultChecked={on}
                disabled={
                  Boolean(locked) || needsAdding || fetcher.state !== "idle"
                }
                onChange={(event) => {
                  turnedOn.current = event.currentTarget.checked;
                  fetcher.submit(
                    {
                      intent: "toggle",
                      field,
                      value: event.currentTarget.checked ? "on" : "off",
                    },
                    { method: "post" },
                  );
                }}
              />
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
        {image && <Thumbnail {...image} />}
      </div>
    </s-box>
  );
}

// The discount percentage, typed in and saved on its own.

// The pop-up is how customers choose bank transfer or card before
// checkout, so it's required: no off switch, only whether it's switched on
// in the theme (which Shopify lets only the merchant do, in the editor).
function PopUpRow({ on, href }: { on: boolean | undefined; href: string }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <s-stack direction="block" gap="small-100">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text type="strong">Payment pop-up</s-text>
              <s-badge tone="info">Required</s-badge>
              {on === true && (
                <s-badge tone="success">On in your theme</s-badge>
              )}
              {on === false && (
                <s-badge tone="critical">Not on in your theme</s-badge>
              )}
            </s-stack>
            <s-text color="subdued">
              When a customer clicks Check out or Buy it now, it asks how
              they&apos;ll pay. This is how they choose bank transfer (or card)
              and get the discount at checkout; without it there&apos;s no
              discount.
            </s-text>
            {on !== true && (
              <s-stack direction="inline" gap="small-200">
                <s-button href={href} target="_top" variant="primary">
                  Turn on in theme
                </s-button>
              </s-stack>
            )}
          </s-stack>
        </div>
        <Thumbnail
          src="/guide/popup.png"
          alt="The pop-up: bank transfer saves 5%, cash on delivery is full price"
        />
      </div>
    </s-box>
  );
}

// A small picture of what a block looks like, opening full size.
function Thumbnail({ src, alt }: { src: string; alt: string }) {
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      title="Open full size"
      style={{ flexShrink: 0 }}
    >
      <img
        src={`${src}?v=${GUIDE_IMAGES_VERSION}`}
        alt={alt}
        style={{
          width: 180,
          height: 110,
          objectFit: "contain",
          background: "#fafafa",
          borderRadius: 8,
          border: "1px solid #e3e3e3",
          display: "block",
        }}
      />
    </a>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

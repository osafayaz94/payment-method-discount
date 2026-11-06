// Shared parts of the app's admin pages (app/routes/app.*.tsx).
import { useCallback, useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";

export type OrderRow = {
  id: string;
  name: string;
  createdAt: string;
  paymentGatewayNames: string[];
  displayFinancialStatus: string | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
};

// What the pages' actions answer: a toast message, or form errors.
export type ActionResult = {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
};

// Shows an action's message as a toast when it arrives.
export function useToastResult(result: ActionResult | undefined) {
  const shopify = useAppBridge();
  useEffect(() => {
    if (result?.message)
      shopify.toast.show(result.message, { isError: !result.ok });
  }, [result, shopify]);
}

export type Activations = {
  popUp: boolean;
  banner: boolean;
  thankYou: boolean;
} | null;

// What's switched on in the live theme and checkout, from App Bridge's
// app.extensions(). Checked on load and again when the merchant comes back
// to the tab from the theme or checkout editor.
export function useActivations() {
  const shopify = useAppBridge();
  const [active, setActive] = useState<Activations>(null);

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
        setActive({
          popUp: isOn("payment-choice"),
          banner: isOn("savings-banner"),
          thankYou: extensions.some(
            (extension) =>
              extension.handle === "thank-you-amount" &&
              extension.activations.length > 0,
          ),
        });
      },
      () => setActive(null),
    );
  }, [shopify]);

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

  return { active, check };
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      style={{
        height: 6,
        borderRadius: 3,
        background: BRAND.track,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${(value / max) * 100}%`,
          height: "100%",
          background: BRAND.accent,
          transition: "width 0.3s",
        }}
      />
    </div>
  );
}

// One numbered step: what to do, why, and whether it's done.
export function StepCard({
  number,
  title,
  why,
  done,
  doneText,
  children,
}: {
  number: number;
  title: string;
  why: string;
  done?: boolean;
  doneText?: string;
  children: React.ReactNode;
}) {
  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <StepMark done={Boolean(done)} number={number} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <s-stack direction="block" gap="small-100">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-heading>{`Step ${number}: ${title}`}</s-heading>
                {done && doneText && (
                  <s-badge tone="success">{doneText}</s-badge>
                )}
              </s-stack>
              <s-text color="subdued">{why}</s-text>
            </s-stack>
          </div>
        </div>
        {children}
      </s-stack>
    </s-section>
  );
}

// A theme or checkout block in step 4, with its live status.
export function BlockRow({
  title,
  detail,
  on,
  optional = false,
  action,
  second,
}: {
  title: string;
  detail: string;
  on: boolean | undefined;
  optional?: boolean;
  action: { label: string; href: string };
  second?: { label: string; href: string };
}) {
  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background={on ? "subdued" : "base"}
    >
      <s-stack direction="block" gap="small-200">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-text type="strong">{title}</s-text>
          {optional && <s-badge>Optional</s-badge>}
          {on === true && <s-badge tone="success">On</s-badge>}
          {on === false && (
            <s-badge tone={optional ? "neutral" : "warning"}>Off</s-badge>
          )}
          {on === undefined && (
            <s-badge tone="neutral">Couldn&apos;t check</s-badge>
          )}
        </s-stack>
        <s-text color="subdued">{detail}</s-text>
        <s-stack direction="inline" gap="small-200">
          <s-button href={action.href} target="_top">
            {action.label}
          </s-button>
          {second && (
            <s-button href={second.href} target="_top" variant="tertiary">
              {second.label}
            </s-button>
          )}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

export function StepMark({ done, number }: { done: boolean; number: number }) {
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
export function HelpCard({
  percent,
  method,
  slot,
}: {
  percent: number;
  method: string;
  slot?: Lowercase<string>;
}) {
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
    <s-section slot={slot} heading="Questions">
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

// "Bank Deposit and cards", "Bank Deposit" or "cards": who gets the discount.
export function discountedMethods(
  settings: {
    gateways: string[];
    cardGateways: string[];
    bankDiscount: boolean;
    cardDiscount: boolean;
  },
  planAllowsCard: boolean,
) {
  const names = [
    ...(settings.bankDiscount && settings.gateways.length
      ? [settings.gateways.join(", ")]
      : []),
    ...(settings.cardDiscount && planAllowsCard && settings.cardGateways.length
      ? ["cards"]
      : []),
  ];
  return names.join(" and ") || "no payment method yet";
}

// The app's own colours (navy and gold), used for its custom cards;
// everything else is standard Polaris.
export const BRAND = {
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
export function Hero({
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
export function Ring({
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
export function UsageCard({
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
export function CheckoutPreview({
  percent,
  method,
  bankOn,
  cardOn,
  codName,
}: {
  percent: number;
  method: string;
  bankOn: boolean;
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
                {option("Bank transfer", bankOn ? off : full, true)}
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
              {option(method, bankOn ? off : full, true)}
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

export function OrderTable({
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
export function ApplyToOrder() {
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data && "message" in fetcher.data && fetcher.data.message) {
      shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
    }
  }, [fetcher.data, shopify]);

  return (
    <s-section heading="Apply to an order">
      <fetcher.Form method="post" action="/app/orders">
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

export function RetryButton({ orderId }: { orderId: string }) {
  const fetcher = useFetcher<ActionResult>();
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
        fetcher.submit(
          { intent: "retry", orderId },
          { method: "post", action: "/app/orders" },
        )
      }
    >
      Retry
    </s-button>
  );
}

// Shown when the store has no bank transfer or card method listed yet:
// there's nothing to discount.
export function EnableMethodsFirst() {
  return (
    <s-banner
      tone="warning"
      heading="First enable Bank Deposit, a credit card method, or both"
    >
      <s-stack direction="block" gap="small-200">
        <s-text>
          The discount is for customers who pay by bank transfer or card. Turn
          on at least one of them in Shopify (Settings, Payments), then add it
          under Settings, step 2, and save.
        </s-text>
        <s-stack direction="inline" gap="base">
          <s-button href="shopify://admin/settings/payments" target="_top">
            Open payment settings
          </s-button>
          <s-button href="/app/settings" variant="tertiary">
            Go to step 2
          </s-button>
        </s-stack>
      </s-stack>
    </s-banner>
  );
}

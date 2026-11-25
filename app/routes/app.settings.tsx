import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Modal, TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  isCashOnDelivery,
  parseGateways,
  type DiscountSettings,
} from "../discount";
import { loadBase, loadOrders, saveAndPublish } from "../admin.server";
import {
  getCheckoutStatus,
  getShopInfo,
  setCombinations,
  type Combinations,
} from "../settings.server";
import { getRenewal } from "../billing.server";
import {
  CheckoutPreview,
  EnableMethodsFirst,
  StepCard,
  useToastResult,
  type ActionResult,
} from "../components/ui";

const DEFAULT_COMBINATIONS: Combinations = {
  productDiscounts: true,
  orderDiscounts: false,
  shippingDiscounts: true,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const base = await loadBase(request);
  const [{ seenGateways }, checkout, info] = await Promise.all([
    loadOrders(base.graphql, { first: 1 }),
    getCheckoutStatus(base.graphql, base.shop),
    getShopInfo(base.graphql),
  ]);
  const renewal =
    base.plan.key === "unlimited" ? await getRenewal(info.id) : null;
  return {
    settings: base.settings,
    plan: base.plan,
    plansUrl: base.plansUrl,
    renewal: renewal && {
      ...renewal,
      periodEndsText: renewal.periodEnds
        ? new Date(renewal.periodEnds).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })
        : null,
    },
    seenGateways,
    discountLive:
      Boolean(checkout.discount?.active) &&
      Boolean(checkout.paymentRuleEnabled),
    combinesWith: checkout.discount?.combinesWith ?? DEFAULT_COMBINATIONS,
  };
};

const CONFIRM_MODAL = "confirm-payment-method";

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const base = await loadBase(request);
  const form = await request.formData();

  // Step 2 sends each method's name with what it is (bank, cod, card or
  // other), in the same order. A method typed into "Add a payment method"
  // joins the list as the kind chosen next to it.
  const names = form.getAll("methodName").map(String);
  const kinds = form
    .getAll("methodKind")
    .map(String)
    .map((kind, index) =>
      kind === "bank" && isCashOnDelivery(names[index] ?? "") ? "cod" : kind,
    );
  const added = parseGateways(String(form.get("newMethodName") ?? ""));
  const addedKind = String(form.get("newMethodKind") ?? "bank");
  const ofKind = (kind: string) => [
    ...new Set([
      ...names.filter((_, index) => kinds[index] === kind),
      ...(addedKind === kind ? added : []),
    ]),
  ];
  const gateways = ofKind("bank");
  const codGateways = ofKind("cod");
  const cardGateways = ofKind("card");

  const percent = Number(form.get("percent"));
  // The discount names aren't edited here any more: they stay as saved.
  const label = base.settings.label || "Bank Deposit discount";
  const cardLabel = base.settings.cardLabel || "Card payment discount";
  const bankDiscount = form.get("bankDiscount") !== null;
  const cardDiscount = form.get("cardDiscount") !== null;

  const errors: Record<string, string> = {};
  if (!(percent > 0 && percent <= 100))
    errors.percent = "Enter a number above 0 and up to 100";
  if (Object.keys(errors).length) return { ok: false, errors };

  const settings: DiscountSettings = {
    // The pop-up, banner and Thank-you switches on Home stay as they are.
    ...base.settings,
    enabled: form.get("enabled") !== null,
    percent,
    gateways,
    codGateways,
    cardGateways,
    label,
    cardLabel,
    // Not on the page any more: kept as saved (on for new stores).
    notifyCustomer: base.settings.notifyCustomer,
    bankDiscount,
    cardDiscount,
  };
  try {
    const { discountId } = await saveAndPublish(
      base.graphql,
      base.shop,
      settings,
    );
    await setCombinations(base.graphql, discountId, {
      productDiscounts: form.get("combineProduct") !== null,
      orderDiscounts: form.get("combineOrder") !== null,
      // Always combines with free or reduced shipping.
      shippingDiscounts: true,
    });
  } catch (err) {
    return {
      ok: false,
      message: `Settings saved, but the store was not fully updated: ${(err as Error).message}`,
    };
  }
  return {
    ok: true,
    message: !added.length
      ? "Settings saved"
      : addedKind === "card"
        ? `${added.join(", ")} added`
        : `${added.join(", ")} added. Turn on its Discount switch to give it the discount.`,
  };
};

export default function Settings() {
  const {
    settings,
    plan,
    plansUrl,
    renewal,
    seenGateways,
    discountLive,
    combinesWith,
  } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const errors = result?.errors;
  const saving = useNavigation().state === "submitting";
  useToastResult(result);

  const hasBank = settings.gateways.length > 0;
  const hasCard = settings.cardGateways.length > 0;

  // The preview follows the form as the merchant types, before saving.
  const [percent, setPercent] = useState(settings.percent);
  const [enabled, setEnabled] = useState(settings.enabled);
  // Bank transfer methods always get the discount when their own Discount
  // switch is on; cards share one switch, on their rows in step 2.
  const bankOn = true;
  const [cardOn, setCardOn] = useState(
    settings.cardDiscount && plan.cardDiscount && hasCard,
  );
  // Empties "Add a payment method" after each save, ready for the next one.
  const [addRound, setAddRound] = useState(0);
  const [lastResult, setLastResult] = useState(result);
  if (result !== lastResult) {
    setLastResult(result);
    if (result?.ok) {
      setAddRound(addRound + 1);
    }
  }

  // Every method the merchant might sort: the ones in the settings and the
  // ones seen on recent orders.
  // Shopify's Bank Deposit and Cash on Delivery come first, then the rest in
  // the order they were added (new ones are saved at the end of the list).
  const builtIn = (name: string) =>
    /^bank deposit$/i.test(name) ? 0 : /^cash on delivery/i.test(name) ? 1 : 2;
  const methods = [
    ...new Set([
      ...settings.gateways,
      ...settings.codGateways,
      ...settings.cardGateways,
      ...seenGateways,
    ]),
  ].sort((a, b) => builtIn(a) - builtIn(b));
  // Names seen on orders but not sorted yet are guessed from the name.
  const kindOf = (name: string) =>
    settings.gateways.includes(name)
      ? "bank"
      : settings.codGateways.includes(name)
        ? "cod"
        : settings.cardGateways.includes(name)
          ? "card"
          : /card|stripe|paypal|shopify_payments|bogus|payfast|safepay|visa|master/i.test(
                name,
              )
            ? "card"
            : /\bcod\b|on delivery|cash on|delivery/i.test(name)
              ? "cod"
              : "bank";
  // What each method is right now, so its badge follows the dropdown.
  const [kinds, setKinds] = useState<Record<string, string>>({});
  const kindNow = (name: string) =>
    isCashOnDelivery(name) ? "cod" : (kinds[name] ?? kindOf(name));
  const formRef = useRef<HTMLFormElement>(null);
  // Only methods the merchant typed in can be removed: not ones seen on
  // orders, not cash on delivery, and not Shopify's built-in methods.
  const removable = (name: string) =>
    !seenGateways.includes(name) &&
    !/^(bank deposit|cash on delivery \(cod\)|money order)$/i.test(name);
  // Methods typed in by hand (not seen on orders) can be taken off the list:
  // saving them as "Not used" drops them, as they don't come back from orders.
  const remove = (name: string) => {
    flushSync(() => setKinds((now) => ({ ...now, [name]: "other" })));
    formRef.current?.requestSubmit();
  };
  // Adding and removing a method are confirmed in a Shopify admin pop-up.
  const shopify = useAppBridge();
  type ConfirmAction =
    "add" | "remove" | "discountOn" | "discountOff" | "percent" | "enableMain";
  // Set once a change of percentage is confirmed, so that submit goes through.
  const percentConfirmed = useRef(false);
  const [confirm, setConfirm] = useState<{
    action: ConfirmAction;
    name: string;
  } | null>(null);
  // Bumped when the pop-up closes, so a switch flipped and then cancelled
  // snaps back to its saved position.
  const [switchRound, setSwitchRound] = useState(0);
  const ask = (action: ConfirmAction, name: string) => {
    setConfirm({ action, name });
    shopify.modal.show(CONFIRM_MODAL);
  };
  const askToAdd = () => {
    const name = String(
      new FormData(formRef.current ?? undefined).get("newMethodName") ?? "",
    ).trim();
    if (!name) {
      shopify.toast.show("Type the payment method's name first", {
        isError: true,
      });
      return;
    }
    ask("add", name);
  };
  const confirmed = () => {
    shopify.modal.hide(CONFIRM_MODAL);
    if (confirm?.action === "remove") remove(confirm.name);
    else if (
      confirm?.action === "discountOn" ||
      confirm?.action === "discountOff"
    ) {
      const kind = confirm.action === "discountOn" ? "bank" : "cod";
      flushSync(() => setKinds((now) => ({ ...now, [confirm.name]: kind })));
      formRef.current?.requestSubmit();
    } else if (confirm?.action === "enableMain") {
      // Turns on Give the discount and this method's discount, and saves.
      const name = confirm.name;
      flushSync(() => {
        setEnabled(true);
        setKinds((now) => ({ ...now, [name]: "bank" }));
      });
      formRef.current?.requestSubmit();
    } else {
      if (confirm?.action === "percent") percentConfirmed.current = true;
      formRef.current?.requestSubmit();
    }
    setConfirm(null);
  };
  const percentText = `${percent > 0 ? percent : 0}%`;
  const modalText = !confirm
    ? null
    : confirm.action === "remove"
      ? {
          title: `Remove ${confirm.name}?`,
          body: `${confirm.name} will be taken off this list, so the pop-up and checkout won't use it for the discount. It stays in Shopify's payment settings.`,
          button: "Remove",
          critical: true,
        }
      : confirm.action === "percent"
        ? {
            title: `Change the discount to ${percentText} off?`,
            body: `Customers who pay by a discounted method will get ${percentText} off instead of ${settings.percent}%.`,
            button: "Save",
            critical: false,
          }
        : confirm.action === "enableMain"
          ? {
              title: "Turn on the discount first?",
              body: `Give the discount is off, so no payment method gets a discount right now. Turn it on, with ${percentText} off for ${confirm.name}?`,
              button: "Turn on",
              critical: false,
            }
          : confirm.action === "discountOn"
            ? {
                title: `Turn on ${percentText} off for ${confirm.name}?`,
                body: `Customers who pay with ${confirm.name} will get ${percentText} off.`,
                button: "Turn on",
                critical: false,
              }
            : confirm.action === "discountOff"
              ? {
                  title: `Turn off the discount for ${confirm.name}?`,
                  body: `Customers who pay with ${confirm.name} will pay full price.`,
                  button: "Turn off",
                  critical: true,
                }
              : {
                  title: `Add ${confirm.name}?`,
                  body: null,
                  button: "Add",
                  critical: false,
                };
  // What a customer paying this way gets, with step 1 as it stands.
  const outcome = (name: string) => {
    const kind = kindNow(name);
    const on =
      enabled &&
      percent > 0 &&
      ((kind === "bank" && bankOn) || (kind === "card" && cardOn));
    if (kind === "other") return { tone: "neutral", text: "Not used" };
    // Green with the % when customers get it; 0% while it's switched off,
    // here or in step 1.
    return on
      ? { tone: "success", text: `${percent}% off` }
      : { tone: "neutral", text: "0% off" };
  };

  // Cards are one row: the pop-up has one card choice for all of them. Its
  // switch unlocks once the app knows a card method, which it learns from
  // orders (apps can't read Shopify's payment settings).
  const cardNames = methods.filter((name) => kindNow(name) === "card");
  const cardRow = (
    <s-grid gridTemplateColumns="2fr 1fr 2fr" gap="base" alignItems="start">
      {cardNames.map((name) => (
        <span key={name} style={{ display: "none" }}>
          <input type="hidden" name="methodName" value={name} />
          <input type="hidden" name="methodKind" value="card" />
        </span>
      ))}
      <s-stack direction="block" gap="small-100">
        <s-text type="strong">Credit / debit card</s-text>
        {cardNames.length ? (
          <s-text color="subdued">{cardNames.join(", ")}</s-text>
        ) : (
          <s-badge tone="warning">Needs a card provider</s-badge>
        )}
      </s-stack>
      <s-badge
        tone={enabled && cardOn && cardNames.length ? "success" : "neutral"}
      >
        {enabled && cardOn && cardNames.length && percent > 0
          ? `${percent}% off`
          : "0% off"}
      </s-badge>
      <s-stack direction="block" gap="small-100">
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <div style={{ width: 110 }}>
            <s-text>
              Discount{" "}
              <b>{enabled && cardOn && cardNames.length > 0 ? "ON" : "OFF"}</b>
            </s-text>
          </div>
          <s-switch
            key={`card-${enabled}-${cardOn}-${cardNames.length}`}
            label="Discount"
            labelAccessibilityVisibility="exclusive"
            defaultChecked={enabled && cardOn && cardNames.length > 0}
            disabled={!enabled || !plan.cardDiscount || !cardNames.length}
            onChange={(event) => setCardOn(event.currentTarget.checked)}
          />
        </s-stack>
        <s-text color="subdued">
          {!cardNames.length
            ? "Turn on a card provider in Shopify Settings, Payments. This unlocks after your first card order."
            : !plan.cardDiscount
              ? "Available on the Unlimited plan."
              : enabled && cardOn
                ? "Card payments get the discount."
                : "Full price."}
        </s-text>
      </s-stack>
    </s-grid>
  );

  return (
    <s-page heading="Settings">
      <Modal
        id={CONFIRM_MODAL}
        onHide={() => setSwitchRound((round) => round + 1)}
      >
        <p style={{ margin: 0, padding: 16 }}>
          {modalText?.body ?? (
            <>
              {confirm?.name} will be added as a payment method. Make sure
              it&apos;s also turned <strong>ON</strong> in Shopify Payment
              settings with exactly the same name.
            </>
          )}
        </p>
        <TitleBar title={modalText?.title ?? ""}>
          <button
            variant="primary"
            {...(modalText?.critical ? { tone: "critical" } : {})}
            onClick={confirmed}
          >
            {modalText?.button ?? "OK"}
          </button>
          <button onClick={() => shopify.modal.hide(CONFIRM_MODAL)}>
            Cancel
          </button>
        </TitleBar>
      </Modal>
      {!hasBank && !hasCard && <EnableMethodsFirst />}
      <Form
        method="post"
        data-save-bar
        ref={formRef}
        onSubmit={(event) => {
          // A new percentage is confirmed first (the save bar
          // or Enter in the field all come here).
          if (percent !== settings.percent && !percentConfirmed.current) {
            event.preventDefault();
            ask("percent", "");
            return;
          }
          percentConfirmed.current = false;
        }}
      >
        <s-stack direction="block" gap="base">
          <StepCard
            number={1}
            title="Choose your discount"
            why="How much customers save when they pay upfront. Cash on delivery always pays full price."
            done={settings.enabled && discountLive}
            doneText="Active at checkout"
          >
            <s-switch
              // Remounts when turned on from a payment method's pop-up.
              key={`enabled-${enabled}`}
              name="enabled"
              label="Give the discount"
              details="Turn off to stop every discount straight away."
              defaultChecked={enabled}
              onChange={(event) => setEnabled(event.currentTarget.checked)}
            />
            <input type="hidden" name="bankDiscount" value="on" />
            {cardOn && <input type="hidden" name="cardDiscount" value="on" />}
            <s-grid gridTemplateColumns="1fr 2fr" gap="base">
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
            </s-grid>
          </StepCard>

          <StepCard
            number={2}
            title="List your payment methods"
            why="The payment methods turned on in your store (Shopify Settings, Payments). Switch on Discount for the ones that should get it; checkout then only shows the methods that match the customer's choice in the pop-up."
            done={hasBank || hasCard}
            doneText={`${settings.gateways.length + (cardOn ? settings.cardGateways.length : 0)} with discount · ${settings.codGateways.length + (cardOn ? 0 : settings.cardGateways.length)} full price`}
          >
            <s-stack direction="block" gap="small-200">
              {methods
                // Cards have their own row; cash on delivery isn't listed (it
                // always pays full price) but is still saved, below.
                .filter(
                  (name) => kindNow(name) !== "card" && !isCashOnDelivery(name),
                )
                .map((name) => (
                  <s-grid
                    key={name}
                    gridTemplateColumns="2fr 1fr 2fr"
                    gap="base"
                    alignItems="start"
                  >
                    <input type="hidden" name="methodName" value={name} />
                    <input
                      type="hidden"
                      name="methodKind"
                      value={kindNow(name)}
                    />
                    <s-stack
                      direction="inline"
                      gap="small-200"
                      alignItems="center"
                    >
                      <s-text type="strong">{name}</s-text>
                      {removable(name) && (
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          onClick={() => ask("remove", name)}
                        >
                          Remove
                        </s-button>
                      )}
                    </s-stack>
                    <s-badge tone={outcome(name).tone as "success" | "neutral"}>
                      {outcome(name).text}
                    </s-badge>
                    {kindOf(name) === "card" ? (
                      // One switch for all cards: the pop-up's card choice
                      // covers them all, so every card row shows the same.
                      <s-stack direction="block" gap="small-100">
                        <s-stack
                          direction="inline"
                          gap="small-200"
                          alignItems="center"
                        >
                          <div style={{ width: 110 }}>
                            <s-text>
                              Discount <b>{enabled && cardOn ? "ON" : "OFF"}</b>
                            </s-text>
                          </div>
                          <s-switch
                            key={`card-${name}-${enabled}-${cardOn}`}
                            label="Discount"
                            labelAccessibilityVisibility="exclusive"
                            defaultChecked={enabled && cardOn}
                            disabled={!enabled || !plan.cardDiscount}
                            onChange={(event) =>
                              setCardOn(event.currentTarget.checked)
                            }
                          />
                        </s-stack>
                        <s-text color="subdued">
                          {!plan.cardDiscount
                            ? "Available on the Unlimited plan."
                            : enabled && cardOn
                              ? "Card payments get the discount."
                              : "Full price."}
                        </s-text>
                      </s-stack>
                    ) : (
                      // On: a pay-upfront method that gets the discount (the
                      // pop-up's bank transfer choice). Off: full price, offered
                      // with cash on delivery.
                      <s-stack direction="block" gap="small-100">
                        <s-stack
                          direction="inline"
                          gap="small-200"
                          alignItems="center"
                        >
                          <div style={{ width: 110 }}>
                            <s-text>
                              Discount{" "}
                              <b>
                                {enabled && bankOn && kindNow(name) === "bank"
                                  ? "ON"
                                  : "OFF"}
                              </b>
                            </s-text>
                          </div>
                          <s-switch
                            // Remount on each change: this React version can't
                            // switch a web component's checked state off itself.
                            key={`${name}-${kindNow(name)}-${enabled}-${bankOn}-${switchRound}`}
                            label="Discount"
                            labelAccessibilityVisibility="exclusive"
                            // Locked, and shown off, while step 1 has the discount
                            // or bank transfer off; the choice is kept for later.
                            defaultChecked={
                              enabled && bankOn && kindNow(name) === "bank"
                            }
                            // Cash on delivery always pays full price.
                            disabled={isCashOnDelivery(name)}
                            // While Give the discount is off, a click asks to
                            // turn it on first.
                            onChange={(event) =>
                              ask(
                                !enabled
                                  ? "enableMain"
                                  : event.currentTarget.checked
                                    ? "discountOn"
                                    : "discountOff",
                                name,
                              )
                            }
                          />
                        </s-stack>
                        <s-text color="subdued">
                          {isCashOnDelivery(name)
                            ? "Cash on delivery always pays full price."
                            : enabled && bankOn && kindNow(name) === "bank"
                              ? "Paying this way gets the discount."
                              : "Full price."}
                        </s-text>
                      </s-stack>
                    )}
                  </s-grid>
                ))}
              {methods.filter(isCashOnDelivery).map((name) => (
                <span key={name} style={{ display: "none" }}>
                  <input type="hidden" name="methodName" value={name} />
                  <input type="hidden" name="methodKind" value="cod" />
                </span>
              ))}
              {cardRow}
              {!methods.length && (
                <s-text color="subdued">
                  No payment methods listed yet. Add yours below.
                </s-text>
              )}
            </s-stack>
            {/* Add saves the page: the new method joins the list above at
                0% off, with its Discount switch off, and the field empties
                for the next one. */}
            <s-stack key={addRound} direction="block" gap="small-200">
              <input type="hidden" name="newMethodKind" value="cod" />
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-text-field
                  name="newMethodName"
                  label="Add a payment method"
                  placeholder="For example JazzCash or PayTm"
                />
              </s-grid>
              <s-text color="subdued">
                Type its name exactly as shown at checkout.
              </s-text>
              <s-stack direction="inline">
                <s-button
                  onClick={askToAdd}
                  {...(saving ? { loading: true } : {})}
                >
                  Add
                </s-button>
              </s-stack>
            </s-stack>
            <s-stack direction="inline" gap="base">
              <s-button
                href="shopify://admin/settings/payments"
                target="_top"
                variant="tertiary"
              >
                Open Shopify payment settings
              </s-button>
            </s-stack>
          </StepCard>

          <StepCard
            number={3}
            title="Check what customers see"
            why="What customers get with the settings above. It updates as you change them."
          >
            <CheckoutPreview
              percent={percent > 0 ? percent : settings.percent}
              bankOn={enabled && bankOn}
              cardOn={enabled && cardOn}
              bankMethods={methods.filter((name) => kindNow(name) === "bank")}
              cardMethods={methods.filter((name) => kindNow(name) === "card")}
              codMethods={methods.filter((name) => kindNow(name) === "cod")}
            />
          </StepCard>

          <StepCard
            number={4}
            title="Combine with other discounts"
            why="Whether this discount can be used together with your other discounts. Save any changes with the bar at the top of the page."
          >
            <s-switch
              name="combineProduct"
              label="Product discounts and sale prices"
              defaultChecked={combinesWith.productDiscounts}
            />
            <s-switch
              name="combineOrder"
              label="Other order discounts"
              details="Only those that also allow combining."
              defaultChecked={combinesWith.orderDiscounts}
            />
          </StepCard>
        </s-stack>
      </Form>

      <AutoRenewal plan={plan} renewal={renewal} plansUrl={plansUrl} />
    </s-page>
  );
}

// Shopify renews paid plans itself; apps can't cancel or restart a
// merchant's subscription. So this shows whether the plan renews (on by
// default) and sends the merchant to Shopify's plan page to change it.
function AutoRenewal({
  plan,
  renewal,
  plansUrl,
}: {
  plan: { key: string; name: string; billing: boolean };
  renewal: {
    autoRenews: boolean;
    periodEndsText: string | null;
    billingPeriod: string | null;
  } | null;
  plansUrl: string;
}) {
  const period = renewal?.billingPeriod === "ANNUAL" ? "year" : "month";
  const date = renewal?.periodEndsText;
  const paid = plan.billing && plan.key === "unlimited";
  return (
    <s-section heading="Subscription">
      <s-box padding="base" borderWidth="base" borderRadius="base">
        <s-stack direction="block" gap="small-200">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text type="strong">Auto-renewal</s-text>
            {paid && (
              <s-badge
                tone={renewal?.autoRenews === false ? "warning" : "success"}
              >
                {renewal?.autoRenews === false ? "Off" : "On"}
              </s-badge>
            )}
          </s-stack>
          {!plan.billing ? (
            <s-text color="subdued">
              Billing isn&apos;t connected yet, so there&apos;s nothing to
              renew.
            </s-text>
          ) : !paid ? (
            <>
              <s-text color="subdued">
                You&apos;re on the Free plan, so there&apos;s nothing to renew:
                your 10 discounted orders start again on the 1st of each month.
                The Unlimited plan renews automatically, so discounts never
                stop.
              </s-text>
              <s-stack direction="inline" gap="base">
                <s-button href={plansUrl} target="_top">
                  See plans
                </s-button>
              </s-stack>
            </>
          ) : renewal?.autoRenews === false ? (
            <>
              <s-text color="subdued">
                Your Unlimited plan won&apos;t renew
                {date ? ` and ends on ${date}` : ""}. After that you&apos;re on
                the Free plan: 10 discounted orders a month, bank transfer only.
              </s-text>
              <s-stack direction="inline" gap="base">
                <s-button href={plansUrl} target="_top" variant="primary">
                  Turn auto-renewal back on
                </s-button>
              </s-stack>
            </>
          ) : (
            <>
              <s-text color="subdued">
                Your Unlimited plan renews automatically every {period}
                {date ? `, next on ${date}` : ""}, so discounts never stop.
                Shopify bills it on your store&apos;s invoice.
              </s-text>
              <s-text color="subdued">
                To turn it off, choose Free on Shopify&apos;s plan page. Shopify
                shows when the change takes effect.
              </s-text>
              <s-stack direction="inline" gap="base">
                <s-button href={plansUrl} target="_top">
                  Turn off auto-renewal
                </s-button>
              </s-stack>
            </>
          )}
        </s-stack>
      </s-box>
    </s-section>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

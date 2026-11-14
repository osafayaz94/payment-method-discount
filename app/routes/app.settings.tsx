import { useState } from "react";
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
import { parseGateways, type DiscountSettings } from "../discount";
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

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const base = await loadBase(request);
  const form = await request.formData();

  // Step 2 sends each method's name with what it is (bank, cod, card or
  // other), in the same order. A method typed into "Add a payment method"
  // joins the list as the kind chosen next to it.
  const names = form.getAll("methodName").map(String);
  const kinds = form.getAll("methodKind").map(String);
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
  const label = String(form.get("label") ?? "").trim();
  const cardLabel = String(form.get("cardLabel") ?? "").trim();
  const bankDiscount = form.get("bankDiscount") !== null;
  const cardDiscount = form.get("cardDiscount") !== null;

  const errors: Record<string, string> = {};
  if (!(percent > 0 && percent <= 100))
    errors.percent = "Enter a number above 0 and up to 100";
  if (!bankDiscount && !cardDiscount)
    errors.who = "Turn on bank transfer, card, or both";
  if (bankDiscount && !gateways.length)
    errors.who =
      "Bank transfer needs a bank transfer method: set one in step 2, or turn bank transfer off";
  if (cardDiscount && !cardGateways.length)
    errors.who =
      "Card needs a card payment method: set one in step 2, or turn card off";
  if (!label) errors.label = "Enter a name";
  if (!cardLabel) errors.cardLabel = "Enter a name";
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
    notifyCustomer: form.get("notifyCustomer") !== null,
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
      shippingDiscounts: form.get("combineShipping") !== null,
    });
  } catch (err) {
    return {
      ok: false,
      message: `Settings saved, but the store was not fully updated: ${(err as Error).message}`,
    };
  }
  return {
    ok: true,
    message: added.length ? `${added.join(", ")} added` : "Settings saved",
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
  const [bankOn, setBankOn] = useState(settings.bankDiscount && hasBank);
  const [cardOn, setCardOn] = useState(
    settings.cardDiscount && plan.cardDiscount && hasCard,
  );
  const [showMore, setShowMore] = useState(
    Boolean(errors?.label || errors?.cardLabel),
  );
  // Empties "Add a payment method" after each save, ready for the next one.
  const [addRound, setAddRound] = useState(0);
  const [lastResult, setLastResult] = useState(result);
  if (result !== lastResult) {
    setLastResult(result);
    if (result?.ok) setAddRound(addRound + 1);
  }

  const method = settings.gateways[0] ?? "Bank Deposit";
  // Every method the merchant might sort: the ones in the settings and the
  // ones seen on recent orders.
  const methods = [
    ...new Set([
      ...settings.gateways,
      ...settings.codGateways,
      ...settings.cardGateways,
      ...seenGateways,
    ]),
  ];
  // Names seen on orders but not sorted yet are guessed from the name.
  const kindOf = (name: string) =>
    settings.gateways.includes(name)
      ? "bank"
      : settings.codGateways.includes(name)
        ? "cod"
        : settings.cardGateways.includes(name)
          ? "card"
          : /cash|\bcod\b|delivery/i.test(name)
            ? "cod"
            : /bank|deposit|transfer|easypaisa|jazzcash/i.test(name)
              ? "bank"
              : "card";

  return (
    <s-page heading="Settings">
      {!hasBank && !hasCard && <EnableMethodsFirst />}
      <Form method="post" data-save-bar>
        <s-stack direction="block" gap="base">
          <StepCard
            number={1}
            title="Choose your discount"
            why="How much customers save, and which payment choices get it."
            done={settings.enabled && discountLive}
            doneText="Active at checkout"
          >
            <s-switch
              name="enabled"
              label="Give the discount"
              details="Turn off to stop every discount straight away."
              defaultChecked={settings.enabled}
            />
            <s-grid gridTemplateColumns="1fr 2fr" gap="base" alignItems="start">
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
              <s-stack direction="block" gap="small-300">
                <s-text type="strong">Who gets it</s-text>
                <s-switch
                  name="bankDiscount"
                  label="Bank transfer"
                  details={
                    hasBank
                      ? `For ${settings.gateways.join(", ")}.`
                      : "First enable a bank transfer method, such as Bank Deposit, in Shopify and add it in step 2."
                  }
                  defaultChecked={settings.bankDiscount && hasBank}
                  disabled={!hasBank}
                  onChange={(event) => setBankOn(event.currentTarget.checked)}
                />
                <s-switch
                  name="cardDiscount"
                  label="Credit or debit card"
                  details={
                    !plan.cardDiscount
                      ? "Available on the Unlimited plan."
                      : hasCard
                        ? `For ${settings.cardGateways.join(", ")}. The card is charged the lower amount.`
                        : "First enable a card payment method in Shopify and add it in step 2."
                  }
                  defaultChecked={
                    settings.cardDiscount && plan.cardDiscount && hasCard
                  }
                  disabled={!plan.cardDiscount || !hasCard}
                  onChange={(event) => setCardOn(event.currentTarget.checked)}
                />
                {errors?.who && <s-text tone="critical">{errors.who}</s-text>}
                <s-text color="subdued">
                  Cash on delivery always pays full price.
                </s-text>
              </s-stack>
            </s-grid>
          </StepCard>

          <StepCard
            number={2}
            title="List your payment methods"
            why="Add the payment methods turned on in your store (Shopify Settings, Payments) and say what each one is. Checkout then only shows the methods that match the customer's choice, and step 1 can only discount a kind of method you have."
            done={hasBank || hasCard}
            doneText={`${settings.gateways.length} bank · ${settings.cardGateways.length} card · ${settings.codGateways.length} cash on delivery`}
          >
            <s-stack direction="block" gap="small-200">
              {methods.map((name) => (
                <s-grid
                  key={name}
                  gridTemplateColumns="1fr 1fr"
                  gap="base"
                  alignItems="center"
                >
                  <input type="hidden" name="methodName" value={name} />
                  <s-text type="strong">{name}</s-text>
                  <s-select
                    name="methodKind"
                    label={`What is ${name}?`}
                    labelAccessibilityVisibility="exclusive"
                  >
                    <s-option
                      value="bank"
                      defaultSelected={kindOf(name) === "bank"}
                    >
                      Bank transfer
                    </s-option>
                    <s-option
                      value="card"
                      defaultSelected={kindOf(name) === "card"}
                    >
                      Card
                    </s-option>
                    <s-option
                      value="cod"
                      defaultSelected={kindOf(name) === "cod"}
                    >
                      Cash on delivery
                    </s-option>
                    <s-option value="other">Not used / remove</s-option>
                  </s-select>
                </s-grid>
              ))}
              {!methods.length && (
                <s-text color="subdued">
                  No payment methods listed yet. Add yours below.
                </s-text>
              )}
            </s-stack>
            <s-grid
              key={addRound}
              gridTemplateColumns="1fr 1fr auto"
              gap="base"
              alignItems="end"
            >
              <s-text-field
                name="newMethodName"
                label="Add a payment method"
                placeholder="For example JazzCash, or Stripe"
                details="Its name exactly as shown at checkout."
              />
              <s-select name="newMethodKind" label="What is it?">
                <s-option value="bank" defaultSelected>
                  Bank transfer
                </s-option>
                <s-option value="card">Card</s-option>
                <s-option value="cod">Cash on delivery</s-option>
              </s-select>
              {/* Saves the page with the new method, which then joins the
                  list above; the fields empty for the next one. */}
              <s-button type="submit" {...(saving ? { loading: true } : {})}>
                Add
              </s-button>
            </s-grid>
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
            title="Check what customers see, then save"
            why="A preview of the pop-up and checkout with the settings above. It updates as you change them; nothing in it can be clicked."
          >
            <CheckoutPreview
              percent={percent > 0 ? percent : settings.percent}
              method={method}
              bankOn={bankOn}
              cardOn={cardOn}
              codName={settings.codGateways[0] ?? "Cash on Delivery"}
            />
            <s-stack
              direction="inline"
              justifyContent="space-between"
              alignItems="center"
            >
              <s-text color="subdued">
                Extra settings: discount names, customer emails, combining with
                other discounts
              </s-text>
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
                <s-switch
                  name="notifyCustomer"
                  label="Email the customer the new total when an order is discounted after it's placed"
                  defaultChecked={settings.notifyCustomer}
                />
                <s-text type="strong">Can be used together with</s-text>
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
                <s-switch
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
                Save settings
              </s-button>
            </s-stack>
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

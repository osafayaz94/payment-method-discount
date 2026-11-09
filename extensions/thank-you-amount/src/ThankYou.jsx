import '@shopify/ui-extensions/preact';
import {render} from 'preact';

// Shows a bank transfer customer the discount and the amount to transfer
// right after they order. Orders that went through the payment pop-up got the
// discount at checkout, so the order total is the amount to transfer. Orders
// that skipped it get the discount from the app a few seconds later
// (app/discount.ts), so this works out the same numbers from the checkout.
export default function extension() {
  render(<Extension />, document.body);
}

function Extension() {
  const settings = readSettings();
  // The checkout editor previews a card payment, so show a sample there to
  // let the merchant see where the block sits, and whether settings load.
  const inEditor = Boolean(shopify.extension.editor);

  if (!settings) {
    return inEditor ? (
      <s-banner tone="warning" heading="Payment discount amount">
        <s-text>Settings not found. Open the Nexora app and click Save in Settings.</s-text>
      </s-banner>
    ) : null;
  }
  if (!settings.enabled || !(settings.percent > 0)) return null;
  // Switched off in the app.
  if (settings.showThankYou === false && !inEditor) return null;
  // This block is for bank transfer orders; off when only cards are discounted.
  if (settings.bankDiscount === false && !inEditor) return null;
  // This month's discounted orders on the shop's plan are used up, so the
  // app won't discount this order either.
  if (settings.pausedMonth && settings.pausedMonth === currentMonth(settings.timeZone) && !inEditor) {
    return null;
  }
  const money = (amount) => shopify.i18n.formatCurrency(amount);
  const method = settings.gateways?.[0] ?? 'Bank Deposit';
  const total = Number(shopify.cost.totalAmount.value.amount);
  // Like Shopify and the app's order edit, discount each line and round down
  // to the cent, so the amounts match.
  const worked = shopify.lines.value.reduce((sum, line) => {
    const lineTotal = Number(line.cost.totalAmount.amount);
    return sum + Math.floor(lineTotal * settings.percent + 1e-6) / 100;
  }, 0);

  // Chosen in the pop-up before checkout: the discount is already in the
  // total. Only bank transfer needs the amount to transfer (cards are already
  // charged, cash on delivery has no discount).
  const choice = (shopify.attributes?.value ?? []).find(
    (attribute) => attribute.key === '_payment_choice',
  )?.value;
  if (choice && !inEditor) {
    if (choice !== 'bank') return null;
    // The discount Shopify applied, by its name; worked out if not found.
    const applied = (shopify.discountAllocations?.value ?? []).find(
      (allocation) =>
        allocation.type === 'automatic' &&
        [settings.label, 'Payment method discount'].includes(allocation.title),
    );
    const saved = applied ? Number(applied.discountedAmount.amount) : worked;
    if (!(saved > 0)) return null;
    return (
      <s-banner tone="success" heading={`${settings.label}: ${settings.percent}% off`}>
        <s-stack gap="small-200">
          <s-text>
            You saved {money(saved)} by paying with {method}.
          </s-text>
          <s-text type="strong">Amount to transfer: {money(total)}</s-text>
        </s-stack>
      </s-banner>
    );
  }

  // Checkout only says what type of method was used, not its name. Bank
  // Deposit and other manual methods are 'manualPayment' ('other' is allowed
  // in case a store's manual method is reported that way); cash on delivery
  // is 'paymentOnDelivery', so COD orders never show this.
  const selected = shopify.selectedPaymentOptions?.value ?? [];
  const paidManually = selected.some((option) => ['manualPayment', 'other'].includes(option.type));
  if (!paidManually && !inEditor) return null;

  // Skipped the pop-up: the app takes the discount off after ordering.
  const discount = worked;
  if (!(discount > 0)) return null;

  return (
    <s-banner tone="success" heading={`${settings.label}: ${settings.percent}% off`}>
      <s-stack gap="small-200">
        <s-text>
          You save {money(discount)} by paying with {method}.
        </s-text>
        <s-text type="strong">Amount to pay: {money(total - discount)}</s-text>
        <s-text>We&apos;ll email you the updated order total.</s-text>
        {!paidManually && (
          <s-text type="small">
            Preview: customers only see this after paying with {method}.
          </s-text>
        )}
      </s-stack>
    </s-banner>
  );
}

// The app writes its settings to an app-owned shop metafield
// ($app:payment_discount / settings, see app/settings.server.ts). Match the
// namespace on its ending in case it is reported in its full
// "app--<id>--payment_discount" form rather than the "$app:" one.
function readSettings() {
  const entries = shopify.appMetafields?.value ?? [];
  const entry = entries.find(
    ({metafield}) =>
      metafield?.key === 'settings' &&
      String(metafield?.namespace ?? '').endsWith('payment_discount'),
  );
  const value = entry?.metafield?.value;
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// "2026-10" in the store's time zone, as the app works it out (app/plans.ts).
function currentMonth(timeZone) {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(now);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    if (year && month) return `${year}-${month}`;
  } catch {
    // Unknown time zone: fall back to UTC.
  }
  return now.toISOString().slice(0, 7);
}

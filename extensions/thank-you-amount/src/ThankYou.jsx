import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useAppMetafields} from '@shopify/ui-extensions/checkout/preact';

// Shows the customer the discount and the amount to transfer right after they
// order. The app applies the discount to the order a few seconds later
// (app/discount.ts), so this works out the same numbers from the checkout.
export default function extension() {
  render(<Extension />, document.body);
}

function Extension() {
  const [entry] = useAppMetafields({namespace: '$app:payment_discount', key: 'settings'});
  const settings = parseSettings(entry?.metafield?.value);
  if (!settings?.enabled || !(settings.percent > 0)) return null;

  // Checkout only says what type of method was used, not its name. Bank
  // Deposit and other manual methods are 'manualPayment'; cash on delivery is
  // 'paymentOnDelivery', so COD orders never show this.
  const selected = shopify.selectedPaymentOptions?.value ?? [];
  if (!selected.some((option) => option.type === 'manualPayment')) return null;

  // Like the app, discount each line separately so the rounding matches.
  const discount = shopify.lines.value.reduce((sum, line) => {
    const lineTotal = Number(line.cost.totalAmount.amount);
    return sum + Math.round(lineTotal * settings.percent) / 100;
  }, 0);
  if (!(discount > 0)) return null;

  const total = Number(shopify.cost.totalAmount.value.amount);
  const money = (amount) => shopify.i18n.formatCurrency(amount);
  const method = settings.gateways?.[0] ?? 'Bank Deposit';

  return (
    <s-banner tone="success" heading={`${settings.label}: ${settings.percent}% off`}>
      <s-stack gap="small-200">
        <s-text>
          You save {money(discount)} by paying with {method}.
        </s-text>
        <s-text type="strong">Amount to pay: {money(total - discount)}</s-text>
        <s-text>We&apos;ll email you the updated order total.</s-text>
      </s-stack>
    </s-banner>
  );
}

function parseSettings(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

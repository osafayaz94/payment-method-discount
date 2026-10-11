// @ts-check

/**
 * @typedef {import("../generated/api").CartPaymentMethodsTransformRunInput} CartPaymentMethodsTransformRunInput
 * @typedef {import("../generated/api").CartPaymentMethodsTransformRunResult} CartPaymentMethodsTransformRunResult
 */

/** @type {CartPaymentMethodsTransformRunResult} */
const NO_CHANGES = {operations: []};

const normalize = (/** @type {string} */ name) => name.trim().toLowerCase();

/**
 * Only offers the payment method the customer picked in the pop-up before
 * checkout, so a discount given for bank transfer or card can't be paid by
 * cash on delivery (and the other way round). Methods are told apart by the
 * names in the app's settings: bank transfer names, cash on delivery names,
 * and everything else counts as card (cards, wallets).
 *
 * @param {CartPaymentMethodsTransformRunInput} input
 * @returns {CartPaymentMethodsTransformRunResult}
 */
export function cartPaymentMethodsTransformRun(input) {
  const settings = /** @type {any} */ (input.shop.settings?.jsonValue);
  const choice = input.cart?.choice?.value;
  if (!settings?.enabled || !['bank', 'card', 'cod'].includes(choice ?? '')) return NO_CHANGES;

  const bank = (settings.gateways ?? []).map(normalize);
  const cod = (settings.codGateways ?? []).map(normalize);
  const kind = (/** @type {string} */ name) => {
    const n = normalize(name);
    if (bank.includes(n)) return 'bank';
    if (cod.includes(n)) return 'cod';
    return 'card';
  };

  const hide = input.paymentMethods.filter((method) => kind(method.name) !== choice);
  // Never hide every method: that would leave the customer unable to pay.
  if (hide.length === input.paymentMethods.length) return NO_CHANGES;

  return {
    operations: hide.map((method) => ({paymentMethodHide: {paymentMethodId: method.id}})),
  };
}

import {DiscountClass, OrderDiscountSelectionStrategy} from '../generated/api';

/**
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

const NO_DISCOUNT = {operations: []};

/**
 * Takes the app's percentage off the order when the customer chose bank
 * transfer before checkout, or card if the merchant turned that on. Shopify's
 * discounts can't see the payment method picked at checkout, so the choice is
 * made in the pop-up before checkout and sent along as a cart attribute; the
 * payment customization function then only offers that method.
 *
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const settings = input.shop.settings?.jsonValue;
  const choice = input.cart.choice?.value;
  if (!settings?.enabled || !(settings.percent > 0) || !input.cart.lines.length) {
    return NO_DISCOUNT;
  }
  if (!input.discount.discountClasses.includes(DiscountClass.Order)) return NO_DISCOUNT;

  let message;
  if (choice === 'bank') message = settings.label;
  else if (choice === 'card' && settings.cardDiscount) message = settings.cardLabel;
  else return NO_DISCOUNT;

  return {
    operations: [
      {
        orderDiscountsAdd: {
          candidates: [
            {
              message: message || `${settings.percent}% off`,
              targets: [{orderSubtotal: {excludedCartLineIds: []}}],
              value: {percentage: {value: settings.percent}},
            },
          ],
          selectionStrategy: OrderDiscountSelectionStrategy.First,
        },
      },
    ],
  };
}

# Nexora: Payment Discounts

A Shopify app that gives customers a discount for choosing a payment method you want to encourage. Example: **5% off when they pick Bank Deposit instead of Cash on Delivery (COD)**.

Any store can install it. Each store sets its own:
- discount percentage
- payment methods that qualify
- discount label

## How it works

There are two ways the discount is given. Most orders go through the first; the second catches the rest.

### 1. The customer chooses before checkout (shown at checkout)

When a customer clicks **Check out** (cart page or cart drawer) or **Buy it now**, a pop-up asks:

> **How would you like to pay?**
> ● Bank transfer: Save 5% ($37.49 off)
> ○ Credit / debit card: Full price, or Save 5% if card discounts are turned on
> ○ Cash on Delivery: Full price

Their choice goes to checkout as the `_payment_choice` cart attribute (`bank`, `card` or `cod`). There:
- the **discount function** (`extensions/payment-choice-discount`) takes the percentage off the order, so the discount line and the lower total show **before they pay**, and cards are charged the lower amount
- the **payment customization function** (`extensions/payment-choice-methods`) only offers the chosen method: bank transfer names, cash on delivery names, or everything else (cards, wallets). It never hides every method.

The pop-up is a theme app embed (`extensions/payment-discount-banner/blocks/payment-choice.liquid`). It replaces the theme's own Buy it now button and hides express buttons such as Shop Pay, which would skip it; both can be changed in the embed's settings. Buy it now goes straight to checkout with only that product, through a cart permalink.

The app creates the automatic discount and the payment customization the first time the settings are saved.

**Plans:** Shopify Functions run on every plan only in apps distributed through the Shopify App Store (listed or unlisted); in custom apps they need Shopify Plus. Development stores can test them either way.

### 2. After the order is placed (Bank Deposit orders that skipped the pop-up)

1. A customer places an order and picks a qualifying payment method, such as Bank Deposit.
2. Shopify sends the app an `orders/create` webhook.
3. The app re-reads the order. It goes ahead only if the order:
   - used a qualifying payment method
   - is still unpaid (Payment pending)
   - is not cancelled
   - has not been discounted already
   - did not go through the pop-up (those got the discount at checkout)
4. In one order edit, it takes the discount off every unfulfilled item. It then saves the edit and, if turned on, emails the customer the new total.
5. It tags the order `payment-discount`, so the order is never discounted twice.

Every order paid by bank transfer or card is also tagged with how the customer paid, **Bank transfer** or **Credit/Debit card**, discounted or not: from their choice in the pop-up, or else from the payment method's name (anything that isn't a listed bank transfer or cash on delivery method counts as card). Cash on delivery orders get no payment tag.

Orders paid any other way, such as COD, are not changed.

If an edit fails, nothing is saved, so the order keeps its full price. The order is tagged `payment-discount-failed`. It then shows under **Needs attention** on the app's page, with a **Retry** button.

### Why the choice is made before checkout

Shopify does not let an app change prices based on the payment method picked **inside** checkout:
- **Discount Functions** cannot see which payment method is selected.
- **Checkout UI extensions** on the payment step need **Shopify Plus**.

So the customer picks the method just before checkout, and checkout then only offers that method. Orders that skip the pop-up still get the discount after ordering if they were paid by a qualifying manual method.

The app's page has a ready-made sentence that merchants can paste into their payment method's **Additional details**, so customers see the offer at checkout.

### Showing customers what they save (every plan)

Shopify only lets Plus stores add banners to the checkout steps. On every plan, the app shows the saving just before and just after checkout:
- **Cart and product page banner** (theme app extension): for example "Pay by Bank Deposit at checkout and save 5% ($1.25 off)", worked out from the cart subtotal or the product price. Merchants add it from the app's page, which opens the theme editor with the block added. The wording and colours are editable in the theme editor.
- **Thank-you page block** (checkout UI extension): shown after ordering with a manual payment method such as Bank Deposit, when the order didn't go through the pop-up. It gives the discount and the amount to pay. Merchants add it in **Settings → Checkout → Customize → Thank you page**. Checkout only reports the payment method's type, so it shows for any manual payment method, never for cash on delivery.

Both read the app's settings from metafields that the app writes on install and whenever the settings are saved.

## Plans

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | Up to 10 discounted orders a month, bank transfer discount, pop-up and banner |
| Unlimited | $6.99/month or $69/year | Unlimited discounted orders, bank transfer and card discounts, own wording and colours for the pop-up and banner, priority email support |

Prices, yearly options and trials are set in the Partner Dashboard with [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing); Shopify hosts the plan selection page and charges the merchant. The app only decides what each plan allows (`app/plans.ts`):
- **Monthly limit**: every discounted order (pop-up or after-order) counts, per calendar month in the store's time zone. When the limit is reached, the app publishes `pausedMonth` to the settings metafield. The discount function, the payment customization function, the pop-up, the banner and the Thank-you block then stop for the rest of that month, and come back on the 1st by themselves. The after-order fallback skips orders too.
- **Card discounts** and **own wording and colours** need Unlimited. On Free, the pop-up and banner use the standard wording and colours, whatever is set in the theme editor.

The plan is read from the Partner API's [Active Subscription API](https://shopify.dev/docs/api/partner/latest/active-subscription), at most every 10 minutes per shop, and right away when Shopify sends the merchant back to the app after picking a plan. Any paid plan counts as Unlimited, whatever its name; no subscription, or a free one, is Free. Plans saved by an earlier version (Pro, Advanced) are read as Unlimited. Paid plans renew automatically (Shopify does it); Settings shows whether the plan renews and when, read from the Active Subscription API, with a button to Shopify's plan page to stop or restart it, since apps can't change a merchant's subscription themselves. If the Partner API can't be reached, the last known plan is used.

Without the Partner API settings below, billing is off and every feature is unlocked (for development). The app's page then says so.

## The app's pages

Merchants open the app from **Apps** in the Shopify admin. Its menu has:
- **Home** (`app/routes/app._index.tsx`): the status banner, a short Get started list until setup is done, and switches that save straight away. **Discount** is the main switch, with **who gets it** (bank transfer, card) under it. **On your store** shows the payment pop-up as **required** (it's how customers choose a discounted method, so it has no off switch; the app always publishes it as on) with whether it's on in the theme, and switches for the optional savings banner and Thank-you amount, each with a picture. Blocks not added yet in the theme or checkout editor (Shopify doesn't let apps add them) show a button that opens the editor. Theme and checkout blocks are checked with App Bridge's `app.extensions()`.
- **Settings** (`app.settings.tsx`), in three steps: 1. the percentage and who gets it (bank transfer, card or both); 2. the store's payment methods and what each one is (bank transfer, card, cash on delivery), which checkout uses to show only the methods that match the customer's choice; 3. a live preview of the pop-up and checkout, extra settings, and Save.
  Bank transfer and card discounts can only be turned on once a method of that kind is listed in step 2: Shopify's API doesn't list a store's payment methods, so the app goes by what the merchant lists (and the names seen on recent orders). With neither, the app asks the merchant to enable Bank Deposit, a card method or both first.
- **Guide** (`app.guide.tsx`): a ten-step walkthrough with a picture per step (`public/guide`: screenshots of the app, and illustrations of Shopify's Payments, theme editor and checkout editor screens), with buttons to each place
- **Orders** (`app.orders.tsx`): discounted orders, Needs attention (with Retry), and Apply to an order
- **Plans & pricing** (`app.plans.tsx`): the plans with prices and features, the current plan and the month's usage
- **Help** (`app.help.tsx`): common questions, suggested wording for the payment method's description, contact and privacy policy

Shared pieces are in `app/components/ui.tsx` and `app/admin.server.ts`.

## Project layout

| Path | What it is |
|---|---|
| `app/discount.ts` | Core logic: who qualifies, and the order edit. It has no framework imports, so it is easy to test. |
| `app/settings.server.ts` | Saves and loads each shop's settings, publishes them to metafields for the extensions as the plan allows, and runs the discount on an order within the plan |
| `app/plans.ts` | What each plan allows, and the store's month |
| `app/billing.server.ts` | Reads the plan from the Partner API, and counts discounted orders per month |
| `app/routes/app.*.tsx` | The app's pages in the Shopify admin (see above) |
| `app/routes/webhooks.orders.create.tsx` | Runs the discount on new orders |
| `app/routes/webhooks.compliance.tsx` | Required privacy webhooks |
| `extensions/payment-discount-banner/` | Theme app extension: the cart and product page banner, and the payment choice pop-up (`blocks/payment-choice.liquid`, `assets/payment-choice.js`) |
| `extensions/payment-choice-discount/` | Discount function: the percentage off for the chosen method |
| `extensions/payment-choice-methods/` | Payment customization function: only the chosen method at checkout |
| `extensions/thank-you-amount/` | Thank-you page block (checkout UI extension) |
| `app/store.ts` | The database (Cloudflare D1): `Session`, `Settings` and `Usage` (discounted orders per month) tables, created by the app on first use |
| `workers/app.ts`, `wrangler.jsonc` | Cloudflare Workers entry point and settings |
| `shopify.app.toml` | Scopes and webhook subscriptions |
| `test/discount.test.ts` | Tests against a fake Admin API |
| `test/plans.test.ts` | Plan limits and months |
| `test/store.test.ts` | Database queries, against a local SQLite database |

Access scopes: `read_orders`, `write_orders`, `write_order_edits`, `write_discounts`, `write_payment_customizations`.

The project is built on Shopify's [React Router app template](https://github.com/Shopify/shopify-app-template-react-router).

## Development

You need Node.js 22.18 or newer and the [Shopify CLI](https://shopify.dev/docs/apps/tools/cli).

```bash
npm install
npm run dev        # links the app to your Partner/Dev Dashboard account and opens a tunnel
npm test           # unit tests
(cd extensions/payment-choice-discount && npx vitest run)   # function tests
(cd extensions/payment-choice-methods && npx vitest run)
npm run typecheck
npm run lint
```

`npm run dev` asks you to create or pick an app the first time. It fills in `client_id` in `shopify.app.toml`.

The app runs in Cloudflare's runtime even in development, with a local copy of the database in `.wrangler/`. The Shopify CLI's settings (API key, secret, app URL) are handed to it by `vite.config.ts`.

To try it, open the app on a development store. Place an order with the **Bank Deposit** manual payment method and check that the order gets the discount. Then place a COD order and check that it is unchanged.

The app subscribes to an order webhook and reads orders. Before installing it on a real store, request **protected customer data** access (order data) in the app's settings in the Dev Dashboard.

## Deployment

The app runs on [Cloudflare Workers](https://developers.cloudflare.com/workers/), with its data in Cloudflare D1. The free plan is enough for most stores; the $5 Workers Paid plan lifts the free plan's 10 ms CPU limit per request if it's ever reached.

1. In the Cloudflare dashboard, create a **D1** database named `payment-method-discount` and put its ID in `wrangler.jsonc` (`database_id`). The app creates its tables itself.
2. Create a **Worker** from this GitHub repository (Workers & Pages, Create, Import a repository). Build command `npm run build`, deploy command `npx wrangler deploy`. Every push to `main` then deploys.
3. In the Worker's Settings, Variables and Secrets, add:
   - `SHOPIFY_API_SECRET` (type **Secret**): the app's client secret from the Dev Dashboard
   - For billing (see Plans), as secrets: `SHOPIFY_PARTNER_ORG_ID` (the number in your Partner Dashboard URL), `SHOPIFY_PARTNER_API_ACCESS_TOKEN` (a Partner API client with the **Manage apps** permission), `SHOPIFY_APP_GID` (`gid://shopify/App/<number in the app's Partner Dashboard URL>`), and `SHOPIFY_APP_HANDLE` if the app's handle isn't `payment-method-discount-12` (it is in the app's admin URL: admin.shopify.com/store/<store>/apps/<handle>)

   `SHOPIFY_API_KEY`, `SCOPES` and `SHOPIFY_APP_URL` (the Worker's workers.dev address) are set in `wrangler.jsonc`. Variables added in the dashboard are kept on each deploy (`keep_vars`).
4. Set `application_url` and `redirect_urls` in `shopify.app.toml` to the Worker's address, then run `npm run deploy` to push the app's settings (URLs, scopes and webhooks) and extensions to Shopify.

To try a production build locally: put `SHOPIFY_API_SECRET` and `SHOPIFY_APP_URL=http://localhost:8787` in `.dev.vars` (ignored by git), then `npm run preview`.

To publish on the Shopify App Store, follow [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements). The privacy webhooks are already handled.

## Notes

- Only products are discounted. Shipping is not.
- After-order discounts skip orders that are already paid. Discounting them would leave the store owing a refund. Card discounts therefore only come from the pop-up, where the card is charged the lower amount.
- If the app is down, Shopify retries the webhook for a few hours. Orders missed for longer than that need a manual edit.

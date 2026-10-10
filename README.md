# Payment Method Discount

A Shopify app that gives customers a discount for choosing a payment method you want to encourage. Example: **5% off when they pick Bank Deposit instead of Cash on Delivery (COD)**.

Any store can install it. Each store sets its own:
- discount percentage
- payment methods that qualify
- discount label

## How it works

1. A customer places an order and picks a qualifying payment method, such as Bank Deposit.
2. Shopify sends the app an `orders/create` webhook.
3. The app re-reads the order. It goes ahead only if the order:
   - used a qualifying payment method
   - is still unpaid (Payment pending)
   - is not cancelled
   - has not been discounted already
4. In one order edit, it takes the discount off every unfulfilled item. It then saves the edit and, if turned on, emails the customer the new total.
5. It tags the order `payment-discount`, so the order is never discounted twice.

Orders paid any other way, such as COD, are not changed.

If an edit fails, nothing is saved, so the order keeps its full price. The order is tagged `payment-discount-failed`. It then shows under **Needs attention** on the app's page, with a **Retry** button.

### Why the discount is applied after checkout, not during it

On most plans, Shopify does not let an app change prices based on the payment method while the customer is still in checkout:
- **Discount Functions** cannot see which payment method is selected.
- **Checkout UI extensions** on the payment step need **Shopify Plus**.

Applying the discount right after the order is placed works on every plan. It also fits manual payment methods: the customer pays after ordering, so they pay the discounted amount.

The app's page has a ready-made sentence that merchants can paste into their payment method's **Additional details**, so customers see the offer at checkout.

### Showing customers what they save (every plan)

Shopify only lets Plus stores add banners to the checkout steps. On every plan, the app shows the saving just before and just after checkout:
- **Cart and product page banner** (theme app extension): for example "Pay by Bank Deposit at checkout and save 5% ($1.25 off)", worked out from the cart subtotal or the product price. Merchants add it from the app's page, which opens the theme editor with the block added. The wording and colours are editable in the theme editor.
- **Thank-you page block** (checkout UI extension): shown after ordering with a manual payment method such as Bank Deposit. It gives the discount and the amount to pay. Merchants add it in **Settings → Checkout → Customize → Thank you page**. Checkout only reports the payment method's type, so it shows for any manual payment method, never for cash on delivery.

Both read the app's settings from metafields that the app writes on install and whenever the settings are saved.

## The app's page

Merchants open the app from **Apps** in the Shopify admin. The page has:
- **Discount**: on/off switch, percentage, payment methods (with the names seen on recent orders, for exact spelling), label, and whether to email the customer
- **Needs attention**: orders whose discount failed, each with a Retry button
- **Recently discounted orders**
- **Show customers what they save**: buttons that add the storefront banner and open the checkout editor for the Thank-you page block
- **Tell customers at checkout**: suggested wording for the payment method's description

## Project layout

| Path | What it is |
|---|---|
| `app/discount.ts` | Core logic: who qualifies, and the order edit. It has no framework imports, so it is easy to test. |
| `app/settings.server.ts` | Saves and loads each shop's settings (Prisma), and publishes them to metafields for the extensions |
| `app/routes/app._index.tsx` | Settings page shown in the Shopify admin |
| `app/routes/webhooks.orders.create.tsx` | Runs the discount on new orders |
| `app/routes/webhooks.compliance.tsx` | Required privacy webhooks |
| `extensions/payment-discount-banner/` | Cart and product page banner (theme app extension) |
| `extensions/thank-you-amount/` | Thank-you page block (checkout UI extension) |
| `prisma/schema.prisma` | `Session` (from the template) and `Settings` tables |
| `shopify.app.toml` | Scopes and webhook subscriptions |
| `test/discount.test.ts` | Tests against a fake Admin API |

Access scopes: `read_orders`, `write_orders`, `write_order_edits`.

The project is built on Shopify's [React Router app template](https://github.com/Shopify/shopify-app-template-react-router).

## Development

You need Node.js 22.18 or newer and the [Shopify CLI](https://shopify.dev/docs/apps/tools/cli).

```bash
cp .env.example .env
npm install
npm run dev        # links the app to your Partner/Dev Dashboard account and opens a tunnel
npm test           # unit tests
npm run typecheck
npm run lint
```

`npm run dev` asks you to create or pick an app the first time. It fills in `client_id` in `shopify.app.toml`.

To try it, open the app on a development store. Place an order with the **Bank Deposit** manual payment method and check that the order gets the discount. Then place a COD order and check that it is unchanged.

The app subscribes to an order webhook and reads orders. Before installing it on a real store, request **protected customer data** access (order data) in the app's settings in the Dev Dashboard.

## Deployment

1. Host the app on any Node.js host, such as Fly.io, Render, Railway or Google Cloud Run. A `Dockerfile` is included.
2. Set these environment variables:
   - `SHOPIFY_API_KEY`
   - `SHOPIFY_API_SECRET`
   - `SHOPIFY_APP_URL`
   - `SCOPES=read_orders,write_orders,write_order_edits`
3. The `Dockerfile` keeps the database at `/data/app.sqlite` (`DATABASE_URL`). Mount a persistent volume at `/data`, or the shops' sessions and settings are lost on every redeploy. Without Docker, set `DATABASE_URL` yourself and run `npm run setup` once, then `npm run start`.
4. Run `npm run deploy` to push `shopify.app.toml` (scopes and webhooks) to Shopify.

SQLite is fine for a single server. For more than one instance, switch the Prisma datasource to Postgres or MySQL.

To publish on the Shopify App Store, follow [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements). The privacy webhooks are already handled.

## Notes

- Only products are discounted. Shipping is not.
- Orders that are already paid are skipped. Discounting them would leave the store owing a refund.
- If the app is down, Shopify retries the webhook for a few hours. Orders missed for longer than that need a manual edit.

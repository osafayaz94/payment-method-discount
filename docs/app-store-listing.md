# App Store submission: Nexora: Payment Discounts

Everything to paste into the Partner Dashboard app submission form, in the
order the form asks for it. Lengths are checked against Shopify's limits.

Images (in the session's scratchpad, to upload):

- `app-icon-1200.png`: app icon, 1200 x 1200
- `screenshot-1-popup.png` … `screenshot-5-guide.png`: screenshots, 1600 x 900

## 1. App settings

| Field | Value |
|---|---|
| App name | Nexora: Payment Discounts |
| App URL | https://payment-method-discount.osafayaz94.workers.dev |
| Privacy policy URL | https://payment-method-discount.osafayaz94.workers.dev/privacy |
| Support email | osafayaz94@gmail.com |
| API contact email | osafayaz94@gmail.com |
| Emergency contact | your email and phone number |

## 2. Listing

**App card subtitle** (56 / 62)

> Reward customers who pay by bank transfer instead of COD

**App introduction** (96 / 100)

> Discount bank transfer and card payments over cash on delivery, so more orders are paid upfront.

**App details** (483 / 500)

> Cash on delivery orders cost you when they're refused or never paid. Nexora: Payment Discounts gives customers a reason to pay upfront instead. When they click Check out or Buy it now, a pop-up asks how they'd like to pay and shows the saving for each method. Bank transfer, and card if you turn it on, get your percentage off at checkout; cash on delivery pays full price. Checkout then only offers the method they chose. A guided checklist gets you set up in minutes, with no code.

**Feature list** (each at most 80 characters)

1. Pop-up before checkout shows what each payment method costs
2. Percentage off for bank transfer, and optionally for cards
3. Checkout only offers the payment method the customer chose
4. Savings banner for cart and product pages, in your own wording
5. Guided setup that checks your theme for you, no code needed

**Search terms** (5)

1. payment discount
2. cash on delivery
3. bank transfer
4. payment method
5. COD

**Category**: Selling products → Pricing → Discounts (or the closest
"Discounts" category the form offers).

**Screenshot alt text**

1. Pop-up asking the customer to choose bank transfer, card or cash on delivery, with the amount to pay for each
2. The app's Home page: discount percentage, main switch and who gets the discount
3. What shows in the store: payment pop-up, savings banner and Thank-you page amount, each with a picture
4. Settings in three steps: choose the discount and sort the store's payment methods
5. Step-by-step setup guide with pictures of each Shopify screen

Don't put prices in images, the icon or the text above: Shopify only allows
them in the pricing section.

## 3. Pricing (Shopify App Pricing)

Create two plans. Any paid plan counts as Unlimited in the app, whatever its
name.

| Plan | Monthly | Yearly | Top features to list |
|---|---|---|---|
| Free | $0 | — | Up to 10 discounted orders a month · Bank transfer discount · Payment pop-up and savings banner |
| Unlimited | $6.99 | $69 | Unlimited discounted orders · Bank transfer and card discounts · Your own wording and colours · Priority email support |

Suggested free trial on Unlimited: 7 days. Paid plans renew automatically.

Welcome link (where Shopify sends merchants after choosing a plan): `/app`

## 4. Billing connection (after the plans exist)

The app reads each store's plan from the Partner API.

1. Partner Dashboard → **Settings** → **Partner API clients** → **Manage
   Partner API clients** → **Create API client**. Name it `billing`, tick
   **Manage apps**, save, and copy the access token.
2. In Cloudflare → Workers & Pages → payment-method-discount → **Settings** →
   **Variables and secrets**, add as **Secret**:
   - `SHOPIFY_PARTNER_API_ACCESS_TOKEN`: the token from step 1
   - `SHOPIFY_PARTNER_ORG_ID`: the number in your Partner Dashboard address,
     probably `239524426` (as in dev.shopify.com/dashboard/239524426/…)
   - `SHOPIFY_APP_GID`: `gid://shopify/App/` followed by the number in the
     app's dashboard address, probably `gid://shopify/App/433890066433`
3. Open the app: the "Billing is not set up" note should be gone.

## 5. Protected customer data

The app reads orders (to check the payment method and apply the discount),
which counts as protected customer data, **level 1 only**: it doesn't need
customer names, emails, phone numbers or addresses. In the form, request
access to order data with this reason:

> The app reads new orders to check which payment method was used and
> whether the customer chose a discounted method before checkout. If so, it
> applies the merchant's discount to the order through order editing and
> tags it. No customer personal data is stored: the app keeps only the
> store's settings and a count of discounted orders per month.

Suggested answers to the data protection questions:

| Question | Answer |
|---|---|
| Do you process only the minimum data needed? | Yes: order ID, payment method names, payment status, tags, cart attributes, line items |
| Do you tell merchants what data you collect? | Yes, in the privacy policy |
| Do you limit how long you keep data? | Yes: order data isn't stored; store data is deleted on shop/redact |
| Is data encrypted at rest and in transit? | Yes (Cloudflare D1 and HTTPS) |
| Do you have staff access controls? | Only the developer has access to the Cloudflare and Shopify accounts |
| Do you keep test and production data separate? | Yes, development stores only for testing |
| Do you have a security incident policy? | Yes: notify affected merchants and Shopify, rotate credentials |

## 6. Testing instructions for the reviewers

> 1. Install the app on your test store and open it from Apps.
> 2. The "Get started" checklist shows the setup. In Settings → Payments, add
>    a manual payment method named **Bank Deposit** and one named **Cash on
>    Delivery (COD)** (or tick your own method names under Payment methods),
>    then click Save in the app.
> 3. Click **Turn on pop-up**: the theme editor opens with the app embed
>    "Payment choice pop-up" switched on. Click Save in the theme editor.
> 4. In the online store, open a product and click **Buy it now**. A pop-up
>    asks "How would you like to pay?" and shows the amount for each method.
>    Choose **Bank transfer** and continue: checkout shows the 5% discount
>    and only offers Bank Deposit. Place the order.
> 5. Repeat with **Cash on Delivery**: checkout shows the full price and only
>    offers cash on delivery.
> 6. Back in the app, the order appears under Discounted orders, and the
>    checklist shows the test order step as done.
>
> The pop-up hides express buttons (Shop Pay, PayPal) by default, because
> they skip the payment choice; merchants can show them again in the
> embed's settings. Nothing else on the storefront or checkout is changed.

## 7. Demo screencast (2–3 minutes, English)

1. **0:00** The app page in the Shopify admin: the status banner and the
   Get started checklist.
2. **0:20** Set the discount to 5%, tick card payments, show the live
   preview changing, click Save.
3. **0:45** Click Turn on pop-up, show the app embed on in the theme editor,
   click Save.
4. **1:05** On the store: product page with the savings banner; click Buy it
   now, show the pop-up, choose Bank transfer.
5. **1:30** Checkout: the discount line, and only Bank Deposit offered.
   Place the order.
6. **1:55** Repeat quickly with Cash on Delivery: full price, only COD.
7. **2:20** Back in the app: the order under Discounted orders, the
   checklist complete.

Record with the Windows Snipping Tool (Win + Shift + R) or Xbox Game Bar
(Win + G), and upload it to YouTube as **unlisted**, then paste the link.

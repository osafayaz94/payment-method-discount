# App Store AI self-review

Checked against Shopify's [AI self-review requirements](https://shopify.dev/docs/apps/launch/app-store-review/app-store-ai-self-review-requirements),
fetched with `shopify doc fetch` on 9 November 2026.

## Summary

- ✅ Likely passing: 39
- ❌ Likely failing: 0 (one found and fixed, see below)
- ⚠️ Needs review: 1
- ⏭️ Groups skipped: 8

These are the requirements Shopify selected as checkable from the code. Shopify
reviews these and more when the app is submitted.

## ⚠️ Needs review

**5.1.1 Use theme app extensions**

Why this needs attention: the app changes the storefront only through its theme
app extension (the payment pop-up embed and the savings banner block), with no
Theme or Asset API calls and no ScriptTags. By default the pop-up embed hides
express checkout buttons (Shop Pay, PayPal), because they skip the payment
choice. Merchants can show them again in the embed's settings.

What to do: this is explained in the reviewer testing instructions
(docs/app-store-listing.md). No code change needed.

## Fixed during this review

**2.3.1 Initiate installation from a Shopify-owned surface** (was likely failing)

The app's front page (`/`) and `/auth/login` had the template's "Shop domain"
form. Both now explain that the app is installed from the Shopify App Store and
opened from Apps in the Shopify admin, with no field to type a shop address.

## Notes on passing requirements

- 1.1.1 / 2.2.3: App Bridge through `@shopify/shopify-app-react-router`
  (`AppProvider`), session tokens, no cookie or localStorage auth.
- 1.1.9 / 5.6.5: the app never adds charges. The discount applies only after the
  buyer chooses a discounted payment method in the pop-up, and it lowers the total.
- 1.2.x: Shopify App Pricing (Free and Unlimited); the plan is read from the
  Partner API and merchants change plans on Shopify's plan page.
- 2.2.4: GraphQL Admin API only.
- 2.3.4: sessions are upserted, so reinstalling works.
- 3.2.1: no `read_all_orders`.
- 5.1.3: Home has a "Turn on in theme" deep link and the Guide page explains setup.
- 5.6.2 / 5.6.3 / 5.6.6 / 5.6.9: the Thank-you block shows only the discount and
  the amount to transfer: no branding, links, timers or payment fields.

## Skipped groups

- 5.2 Payment: not a payments app.
- 5.3 Payment facilitator: opt-in only.
- 5.4 Purchase option: no subscription or payment mandate scopes.
- 5.5 Product sourcing: opt-in only.
- 5.7 Sales channel: no channel_config extension.
- 5.8 Post purchase: no checkout_post_purchase extension.
- 5.9 Mobile app builders: opt-in only.
- 5.10 Donation: opt-in only.

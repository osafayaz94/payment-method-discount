import type { MetaFunction } from "react-router";

// Public privacy policy, linked from the Shopify App Store listing.
const APP_NAME = "Nexora: Bank Transfer Discount";
const CONTACT_EMAIL = "osafayaz94@gmail.com";
const UPDATED = "November 5, 2026";

export const meta: MetaFunction = () => [
  { title: `Privacy policy · ${APP_NAME}` },
  {
    name: "description",
    content: `How ${APP_NAME} handles store and customer data.`,
  },
];

const sections: { heading: string; body: React.ReactNode }[] = [
  {
    heading: "Who we are",
    body: (
      <p>
        {APP_NAME} (&quot;the app&quot;) is a Shopify app made by Nexora. It
        gives a store&apos;s customers a discount for paying with the payment
        methods the merchant chooses, such as bank transfer. This policy
        explains what data the app uses when a merchant installs it, and why.
      </p>
    ),
  },
  {
    heading: "What the app stores",
    body: (
      <>
        <p>For each store that installs the app, we store:</p>
        <ul>
          <li>
            the store&apos;s Shopify domain and the access token Shopify issues
            to the app;
          </li>
          <li>
            the merchant&apos;s settings: the discount percentage, the payment
            method names, discount labels and similar options;
          </li>
          <li>
            the number of discounted orders in each calendar month, to apply the
            limits of the store&apos;s plan;
          </li>
          <li>the store&apos;s plan, as reported by Shopify&apos;s billing.</li>
        </ul>
        <p>
          The app does <strong>not</strong> store any personal information about
          the store&apos;s customers: no names, email addresses, phone numbers,
          addresses or payment details.
        </p>
      </>
    ),
  },
  {
    heading: "Order data the app reads",
    body: (
      <>
        <p>
          When an order is placed, Shopify notifies the app with the
          order&apos;s ID. The app then reads the order&apos;s payment method
          names, payment status, tags, cart attributes and line items, only to
          decide whether the order gets the discount and, if it does, to apply
          it to the order. This information is used at that moment and is not
          kept.
        </p>
        <p>
          The app may add the tags <code>payment-discount</code> or{" "}
          <code>payment-discount-failed</code> to orders, and, if the merchant
          turns it on, Shopify emails the customer the order&apos;s new total.
        </p>
      </>
    ),
  },
  {
    heading: "On the storefront and at checkout",
    body: (
      <p>
        The pop-up that asks customers how they&apos;d like to pay stores their
        choice in the store&apos;s cart, as a cart attribute, so checkout can
        apply the discount. The app doesn&apos;t use cookies of its own,
        doesn&apos;t track customers and doesn&apos;t send their data to the
        app&apos;s servers.
      </p>
    ),
  },
  {
    heading: "Who processes the data",
    body: (
      <p>
        The app runs on Cloudflare (Cloudflare Workers and Cloudflare D1), which
        hosts the app and its database. The data is not sold, rented or shared
        with anyone else.
      </p>
    ),
  },
  {
    heading: "How long it's kept",
    body: (
      <p>
        When a store uninstalls the app, its access token is deleted straight
        away. Its settings and monthly counts are deleted when Shopify asks the
        app to erase the store&apos;s data, 48 hours after uninstalling. A
        merchant can also ask us to delete them sooner by email.
      </p>
    ),
  },
  {
    heading: "Your rights",
    body: (
      <p>
        Merchants can ask what data we hold about their store, or ask for it to
        be corrected or deleted. Requests that Shopify passes on for a
        store&apos;s customers are answered automatically: the app holds no
        personal data about them.
      </p>
    ),
  },
  {
    heading: "Contact",
    body: (
      <p>
        Questions about this policy or your data:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    ),
  },
];

export default function Privacy() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "40px 16px 64px",
        fontFamily: "Inter, system-ui, sans-serif",
        lineHeight: 1.6,
        color: "#0f172a",
        background: "#fff",
      }}
    >
      <h1 style={{ fontSize: "1.8rem", marginBottom: 4 }}>Privacy policy</h1>
      <p style={{ color: "#64748b", marginTop: 0 }}>
        {APP_NAME} · Last updated {UPDATED}
      </p>
      {sections.map(({ heading, body }) => (
        <section key={heading}>
          <h2 style={{ fontSize: "1.15rem", marginTop: 28 }}>{heading}</h2>
          {body}
        </section>
      ))}
    </main>
  );
}

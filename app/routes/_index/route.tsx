import type { LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";
import { redirect, useNavigate } from "react-router";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Opened from inside the Shopify admin: go straight to the app. A first
  // load carries the shop (or plan_handle from Shopify's plan page); a
  // navigation inside the app, such as clicking the app's name in the admin
  // title bar, carries App Bridge's session token instead.
  const fromAdmin = [
    "shop",
    "host",
    "embedded",
    "id_token",
    "plan_handle",
  ].some((key) => url.searchParams.has(key));
  if (
    fromAdmin ||
    request.headers.get("authorization")?.startsWith("Bearer ")
  ) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  const navigate = useNavigate();

  // Shown inside the Shopify admin's frame: this page is for logging in from
  // outside Shopify, so open the app's Home instead.
  useEffect(() => {
    if (window.top !== window.self) navigate("/app", { replace: true });
  }, [navigate]);

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Nexora: Bank Transfer Discount</h1>
        <p className={styles.text}>
          Give customers a discount for paying upfront by bank transfer or card,
          instead of cash on delivery.
        </p>
        <p className={styles.text}>
          To use the app, install it from the Shopify App Store, or open it from
          Apps in your Shopify admin.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>A choice before checkout</strong>. A pop-up shows customers
            what they pay with each payment method.
          </li>
          <li>
            <strong>Discount at checkout</strong>. Bank transfer and card get
            your discount; cash on delivery pays full price.
          </li>
          <li>
            <strong>Works on every plan</strong>. No Shopify Plus needed.
          </li>
        </ul>
      </div>
    </div>
  );
}

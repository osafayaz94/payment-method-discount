import type { LoaderFunctionArgs } from "react-router";
import { useEffect } from "react";
import { redirect, Form, useLoaderData, useNavigate } from "react-router";

import { login } from "../../shopify.server";

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

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();
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
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Automatic</strong>. Orders paid with the payment methods you
            choose get your discount as soon as they are placed.
          </li>
          <li>
            <strong>Safe</strong>. Cash on delivery, paid and cancelled orders
            are never changed, and no order is discounted twice.
          </li>
          <li>
            <strong>Works on every plan</strong>. No Shopify Plus needed.
          </li>
        </ul>
      </div>
    </div>
  );
}

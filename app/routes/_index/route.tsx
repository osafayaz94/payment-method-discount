import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Payment Method Discount</h1>
        <p className={styles.text}>
          Reward customers who pay by bank deposit instead of cash on delivery.
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
            <strong>Automatic</strong>. Orders paid with the payment methods
            you choose get your discount as soon as they are placed.
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

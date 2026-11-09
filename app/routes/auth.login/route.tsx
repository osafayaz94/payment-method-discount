import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

// Installs and logins start from Shopify (the App Store or the admin), so
// there is no form to type a shop address into.
export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { errors } = actionData || loaderData;

  return (
    <>
      <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
      <s-page>
        <s-section heading="Nexora: Bank Transfer Discount">
          <s-stack direction="block" gap="base">
            {errors.shop && <s-banner tone="critical">{errors.shop}</s-banner>}
            <s-paragraph>
              To use the app, install it from the Shopify App Store, or open it
              from Apps in your Shopify admin.
            </s-paragraph>
          </s-stack>
        </s-section>
      </s-page>
    </>
  );
}

import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { APPLIED_TAG } from "../discount";
import { applyToOrder, loadBase, loadOrders } from "../admin.server";
import {
  ApplyToOrder,
  OrderTable,
  discountedMethods,
  type ActionResult,
} from "../components/ui";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const base = await loadBase(request);
  const { applied, failed } = await loadOrders(base.graphql, { first: 25 });
  return {
    settings: base.settings,
    plan: base.plan,
    used: base.used,
    applied,
    failed,
  };
};

// Apply discount (by order number) and Retry, from this page or Home.
export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const base = await loadBase(request);
  return applyToOrder(base.graphql, base.shop, await request.formData());
};

export default function Orders() {
  const { settings, plan, used, applied, failed } =
    useLoaderData<typeof loader>();
  return (
    <s-page heading="Orders">
      {failed.length > 0 && (
        <s-section heading="Needs attention">
          <s-paragraph>
            These orders qualified, but the discount couldn&apos;t be applied.
            They weren&apos;t changed. Click Retry, or edit the order by hand.
          </s-paragraph>
          <OrderTable orders={failed} retry />
        </s-section>
      )}

      <s-section heading="Discounted orders">
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">
            {used} discounted this month. Orders the app discounts are tagged{" "}
            <s-text type="strong">{APPLIED_TAG}</s-text>, so you can also filter
            for them in Orders.
          </s-paragraph>
          {applied.length ? (
            <OrderTable orders={applied} />
          ) : (
            <s-paragraph>
              None yet. Orders paid by{" "}
              {discountedMethods(settings, plan.cardDiscount).replace(
                " and ",
                " or ",
              )}{" "}
              show up here.
            </s-paragraph>
          )}
        </s-stack>
      </s-section>

      <s-section>
        <ApplyToOrder />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

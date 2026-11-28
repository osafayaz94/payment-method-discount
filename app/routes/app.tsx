import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/guide">Guide</s-link>
        <s-link href="/app/orders">Orders</s-link>
        <s-link href="/app/plans">Plans &amp; pricing</s-link>
        <s-link href="/app/help">Help</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their
// headers are included in the response. Anything else (a page that failed to
// load, often a dropped connection) gets a plain message with a Reload button
// instead of React Router's raw error page.
export function ErrorBoundary() {
  const error = useRouteError();
  try {
    return boundary.error(error);
  } catch {
    return <PageError error={error} />;
  }
}

function PageError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  const offline = /failed to fetch|network|load failed/i.test(message);
  return (
    <div
      style={{
        maxWidth: 560,
        margin: "48px auto",
        padding: 24,
        background: "#fff",
        border: "1px solid #e3e3e3",
        borderRadius: 12,
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
        color: "#303030",
      }}
    >
      <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>
        {offline ? "This page didn't load" : "Something went wrong"}
      </h1>
      <p style={{ margin: "0 0 16px", lineHeight: 1.5 }}>
        {offline
          ? "The connection to the app dropped. Check your internet connection, then reload."
          : "Please reload the page. If it keeps happening, email nexoraapps.support@gmail.com."}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          background: "#303030",
          color: "#fff",
          border: 0,
          borderRadius: 8,
          padding: "8px 16px",
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        Reload
      </button>
      <p style={{ margin: "16px 0 0", fontSize: 12, color: "#8a8a8a" }}>
        Details: {message}
      </p>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

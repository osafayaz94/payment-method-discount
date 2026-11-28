import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

// A page's data request can fail before it reaches the server (a dropped
// connection shows up as "Failed to fetch"). Retry reads once, after a short
// wait, instead of showing an error. Saves (POST) are never retried.
if (typeof window !== "undefined") {
  const original = window.fetch;
  window.fetch = async (input, init) => {
    try {
      return await original(input, init);
    } catch (error) {
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const aborted =
        init?.signal?.aborted ||
        (input instanceof Request && input.signal.aborted);
      if (!(error instanceof TypeError) || method !== "GET" || aborted) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
      return original(input, init);
    }
  };
}

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

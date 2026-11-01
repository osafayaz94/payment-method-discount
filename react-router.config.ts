import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // Runs the server build in Cloudflare's runtime (@cloudflare/vite-plugin).
  future: { v8_viteEnvironmentApi: true },
} satisfies Config;

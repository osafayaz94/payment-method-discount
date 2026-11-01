import { env } from "cloudflare:workers";
import type { Db } from "./store";

// The D1 database bound as DB in wrangler.jsonc.
export function getDb(): Db {
  return env.DB as unknown as Db;
}

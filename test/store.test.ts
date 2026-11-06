import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Session } from "@shopify/shopify-api";
import {
  D1SessionStorage,
  deleteShopData,
  getSettingsRow,
  getUsage,
  incrementUsage,
  upsertSettings,
  type Db,
  type Statement,
} from "../app/store.ts";

// D1's API over Node's built-in SQLite, enough for app/store.ts.
function localDb(): Db {
  const sqlite = new DatabaseSync(":memory:");
  const statement = (sql: string, values: unknown[] = []): Statement => ({
    bind: (...next) => statement(sql, next),
    first: async () => (sqlite.prepare(sql).get(...(values as never[])) ?? null) as never,
    all: async () => ({ results: sqlite.prepare(sql).all(...(values as never[])) as never[] }),
    run: async () => sqlite.prepare(sql).run(...(values as never[])),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        for (const s of statements) await s.run();
        sqlite.exec("COMMIT");
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

test("a shop without settings has no row", async () => {
  assert.equal(await getSettingsRow(localDb(), "a.myshopify.com"), null);
});

test("settings are created with defaults, then updated column by column", async () => {
  const db = localDb();
  await upsertSettings(db, "a.myshopify.com", { discountId: "gid://1" });
  let row = await getSettingsRow(db, "a.myshopify.com");
  assert.equal(row?.enabled, true);
  assert.equal(row?.percent, 5);
  assert.equal(row?.gateways, "Bank Deposit");
  assert.equal(row?.cardDiscount, false);
  assert.equal(row?.bankDiscount, true);
  assert.equal(row?.discountId, "gid://1");
  assert.equal(row?.plan, "free");

  const checked = new Date("2026-11-01T10:00:00Z");
  await upsertSettings(db, "a.myshopify.com", {
    enabled: false,
    percent: 7.5,
    cardDiscount: true,
    bankDiscount: false,
    plan: "pro",
    planCheckedAt: checked,
  });
  row = await getSettingsRow(db, "a.myshopify.com");
  assert.equal(row?.enabled, false);
  assert.equal(row?.percent, 7.5);
  assert.equal(row?.cardDiscount, true);
  assert.equal(row?.bankDiscount, false);
  assert.equal(row?.discountId, "gid://1");
  assert.equal(row?.plan, "pro");
  assert.equal(row?.planCheckedAt?.getTime(), checked.getTime());
});

test("usage counts up per shop and month", async () => {
  const db = localDb();
  assert.equal(await getUsage(db, "a.myshopify.com", "2026-11"), 0);
  assert.equal(await incrementUsage(db, "a.myshopify.com", "2026-11"), 1);
  assert.equal(await incrementUsage(db, "a.myshopify.com", "2026-11"), 2);
  assert.equal(await incrementUsage(db, "a.myshopify.com", "2026-12"), 1);
  assert.equal(await incrementUsage(db, "b.myshopify.com", "2026-11"), 1);
  assert.equal(await getUsage(db, "a.myshopify.com", "2026-11"), 2);
});

test("sessions are stored, found and deleted", async () => {
  const db = localDb();
  const storage = new D1SessionStorage(() => db);
  const session = new Session({
    id: "offline_a.myshopify.com",
    shop: "a.myshopify.com",
    state: "state",
    isOnline: false,
    scope: "read_orders,write_orders",
    accessToken: "token",
  });
  await storage.storeSession(session);
  session.scope = "read_orders";
  await storage.storeSession(session);

  const loaded = await storage.loadSession(session.id);
  assert.equal(loaded?.shop, "a.myshopify.com");
  assert.equal(loaded?.accessToken, "token");
  assert.equal(loaded?.scope, "read_orders");
  assert.equal(loaded?.isOnline, false);
  assert.equal((await storage.findSessionsByShop("a.myshopify.com")).length, 1);
  assert.equal(await storage.loadSession("missing"), undefined);

  await storage.deleteSessions([session.id]);
  assert.equal(await storage.loadSession(session.id), undefined);
});

test("shop/redact deletes everything for the shop only", async () => {
  const db = localDb();
  const storage = new D1SessionStorage(() => db);
  for (const shop of ["a.myshopify.com", "b.myshopify.com"]) {
    await upsertSettings(db, shop, { plan: "pro" });
    await incrementUsage(db, shop, "2026-11");
    await storage.storeSession(
      new Session({ id: `offline_${shop}`, shop, state: "", isOnline: false, accessToken: "t" }),
    );
  }
  await deleteShopData(db, "a.myshopify.com");
  assert.equal(await getSettingsRow(db, "a.myshopify.com"), null);
  assert.equal(await getUsage(db, "a.myshopify.com", "2026-11"), 0);
  assert.equal(await storage.loadSession("offline_a.myshopify.com"), undefined);
  assert.equal((await getSettingsRow(db, "b.myshopify.com"))?.plan, "pro");
  assert.equal(await getUsage(db, "b.myshopify.com", "2026-11"), 1);
  assert.ok(await storage.loadSession("offline_b.myshopify.com"));
});

test("a migration already applied by another worker is not an error", async () => {
  const db = localDb();
  await getSettingsRow(db, "a.myshopify.com");
  // A second worker that read the migration list before the first one
  // recorded its migrations: it tries them again, and the ALTER TABLE fails.
  const stale: Db = {
    batch: (statements) => db.batch(statements),
    prepare: (sql) =>
      sql === "SELECT id FROM _migrations"
        ? { ...db.prepare(sql), all: async () => ({ results: [] }) } as Statement
        : db.prepare(sql),
  };
  await assert.doesNotReject(getSettingsRow(stale, "a.myshopify.com"));
});

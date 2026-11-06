// The app's data in Cloudflare D1: Shopify sessions, each shop's settings,
// and discounted orders per month. Plain SQL against the D1 API, kept free
// of Cloudflare imports so it can be tested with a local SQLite database
// (test/store.test.ts).

import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";

// The parts of D1's API used here.
export type Db = {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
};
export type Statement = {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};

// Schema changes, applied in order the first time the app touches the
// database after a deploy. Add new ones at the end; never edit old ones.
const MIGRATIONS: { id: number; sql: string[] }[] = [
  {
    id: 1,
    sql: [
      `CREATE TABLE IF NOT EXISTS Session (
        id TEXT PRIMARY KEY,
        shop TEXT NOT NULL,
        expires INTEGER,
        data TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS Session_shop ON Session (shop)`,
      `CREATE TABLE IF NOT EXISTS Settings (
        shop TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        percent REAL NOT NULL DEFAULT 5,
        gateways TEXT NOT NULL DEFAULT 'Bank Deposit',
        label TEXT NOT NULL DEFAULT 'Bank Deposit discount',
        notifyCustomer INTEGER NOT NULL DEFAULT 1,
        cardDiscount INTEGER NOT NULL DEFAULT 0,
        cardLabel TEXT NOT NULL DEFAULT 'Card payment discount',
        codGateways TEXT NOT NULL DEFAULT 'Cash on Delivery (COD)',
        discountId TEXT,
        paymentCustomizationId TEXT,
        plan TEXT NOT NULL DEFAULT 'free',
        planCheckedAt TEXT,
        updatedAt TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS Usage (
        shop TEXT NOT NULL,
        month TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (shop, month)
      )`,
    ],
  },
  {
    // Bank transfer discount can be turned off, for card-only discounts.
    id: 2,
    sql: [`ALTER TABLE Settings ADD COLUMN bankDiscount INTEGER NOT NULL DEFAULT 1`],
  },
];

const ready = new WeakMap<Db, Promise<void>>();

// Creates or updates the tables once per database per worker.
export function ensureSchema(db: Db): Promise<void> {
  let promise = ready.get(db);
  if (!promise) {
    promise = migrate(db).catch((err) => {
      ready.delete(db);
      throw err;
    });
    ready.set(db, promise);
  }
  return promise;
}

async function migrate(db: Db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, appliedAt TEXT NOT NULL)",
    )
    .run();
  const { results } = await db.prepare("SELECT id FROM _migrations").all<{ id: number }>();
  const done = new Set(results.map((row) => row.id));
  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;
    try {
      await db.batch([
        ...migration.sql.map((sql) => db.prepare(sql)),
        db
          .prepare("INSERT OR IGNORE INTO _migrations (id, appliedAt) VALUES (?, ?)")
          .bind(migration.id, new Date().toISOString()),
      ]);
    } catch (err) {
      // Another worker may have applied it at the same moment (an ALTER
      // TABLE can't run twice): fine if it's now recorded.
      const row = await db
        .prepare("SELECT id FROM _migrations WHERE id = ?")
        .bind(migration.id)
        .first();
      if (!row) throw err;
    }
  }
}

// ---- settings ---------------------------------------------------------------

export type SettingsRow = {
  shop: string;
  enabled: boolean;
  percent: number;
  gateways: string;
  label: string;
  notifyCustomer: boolean;
  bankDiscount: boolean;
  cardDiscount: boolean;
  cardLabel: string;
  codGateways: string;
  discountId: string | null;
  paymentCustomizationId: string | null;
  plan: string;
  planCheckedAt: Date | null;
};

const BOOLEAN_COLUMNS = ["enabled", "notifyCustomer", "bankDiscount", "cardDiscount"] as const;
const SETTINGS_COLUMNS = [
  "enabled",
  "percent",
  "gateways",
  "label",
  "notifyCustomer",
  "bankDiscount",
  "cardDiscount",
  "cardLabel",
  "codGateways",
  "discountId",
  "paymentCustomizationId",
  "plan",
  "planCheckedAt",
] as const;

export async function getSettingsRow(db: Db, shop: string): Promise<SettingsRow | null> {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT * FROM Settings WHERE shop = ?")
    .bind(shop)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    ...(row as unknown as SettingsRow),
    enabled: Boolean(row.enabled),
    notifyCustomer: Boolean(row.notifyCustomer),
    bankDiscount: row.bankDiscount === undefined ? true : Boolean(row.bankDiscount),
    cardDiscount: Boolean(row.cardDiscount),
    planCheckedAt: row.planCheckedAt ? new Date(String(row.planCheckedAt)) : null,
  };
}

// Writes the given columns, creating the shop's row with the defaults for
// the rest if it doesn't exist yet.
export async function upsertSettings(
  db: Db,
  shop: string,
  data: Partial<Omit<SettingsRow, "shop">>,
) {
  await ensureSchema(db);
  const columns = SETTINGS_COLUMNS.filter((column) => data[column] !== undefined);
  const values = columns.map((column) => {
    const value = data[column];
    if ((BOOLEAN_COLUMNS as readonly string[]).includes(column)) return value ? 1 : 0;
    if (value instanceof Date) return value.toISOString();
    return value;
  });
  const now = new Date().toISOString();
  const names = ["shop", ...columns, "updatedAt"];
  const updates = [...columns, "updatedAt"].map((column) => `${column} = excluded.${column}`);
  await db
    .prepare(
      `INSERT INTO Settings (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})
       ON CONFLICT(shop) DO UPDATE SET ${updates.join(", ")}`,
    )
    .bind(shop, ...values, now)
    .run();
}

// ---- monthly usage ----------------------------------------------------------

export async function getUsage(db: Db, shop: string, month: string): Promise<number> {
  await ensureSchema(db);
  const row = await db
    .prepare("SELECT count FROM Usage WHERE shop = ? AND month = ?")
    .bind(shop, month)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

// Counts one more discounted order and returns the month's new total.
export async function incrementUsage(db: Db, shop: string, month: string): Promise<number> {
  await ensureSchema(db);
  const row = await db
    .prepare(
      `INSERT INTO Usage (shop, month, count) VALUES (?, ?, 1)
       ON CONFLICT(shop, month) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(shop, month)
    .first<{ count: number }>();
  return row?.count ?? 1;
}

// Everything stored for a shop (shop/redact).
export async function deleteShopData(db: Db, shop: string) {
  await ensureSchema(db);
  await db.batch([
    db.prepare("DELETE FROM Settings WHERE shop = ?").bind(shop),
    db.prepare("DELETE FROM Usage WHERE shop = ?").bind(shop),
    db.prepare("DELETE FROM Session WHERE shop = ?").bind(shop),
  ]);
}

// ---- Shopify sessions -------------------------------------------------------

// Sessions are stored whole, as Shopify's own property list, so new session
// fields need no schema change.
export class D1SessionStorage implements SessionStorage {
  private readonly getDb: () => Db;

  constructor(getDb: () => Db) {
    this.getDb = getDb;
  }

  private async db() {
    const db = this.getDb();
    await ensureSchema(db);
    return db;
  }

  async storeSession(session: Session): Promise<boolean> {
    const db = await this.db();
    await db
      .prepare(
        `INSERT INTO Session (id, shop, expires, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET shop = excluded.shop, expires = excluded.expires, data = excluded.data`,
      )
      .bind(
        session.id,
        session.shop,
        session.expires ? session.expires.getTime() : null,
        JSON.stringify(session.toPropertyArray(true)),
      )
      .run();
    return true;
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const db = await this.db();
    const row = await db
      .prepare("SELECT data FROM Session WHERE id = ?")
      .bind(id)
      .first<{ data: string }>();
    return row ? Session.fromPropertyArray(JSON.parse(row.data), true) : undefined;
  }

  async deleteSession(id: string): Promise<boolean> {
    const db = await this.db();
    await db.prepare("DELETE FROM Session WHERE id = ?").bind(id).run();
    return true;
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    if (!ids.length) return true;
    const db = await this.db();
    await db.batch(ids.map((id) => db.prepare("DELETE FROM Session WHERE id = ?").bind(id)));
    return true;
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const db = await this.db();
    const { results } = await db
      .prepare("SELECT data FROM Session WHERE shop = ? ORDER BY expires DESC LIMIT 25")
      .bind(shop)
      .all<{ data: string }>();
    return results.map((row) => Session.fromPropertyArray(JSON.parse(row.data), true));
  }

  async deleteSessionsByShop(shop: string): Promise<void> {
    const db = await this.db();
    await db.prepare("DELETE FROM Session WHERE shop = ?").bind(shop).run();
  }
}

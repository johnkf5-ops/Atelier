import { createClient, type Client } from '@libsql/client';

let _db: Client | null = null;
let _bootstrapPromise: Promise<void> | null = null;
// True once a bootstrap has completed AND a subsequent sentinel check
// confirmed the schema is intact. Reset whenever the sentinel check fails
// (e.g. the DB was wiped externally by `pnpm db:reset` against a running
// server — without this, _bootstrapPromise's memoization leaves the server
// permanently stuck believing it's ready when the tables are gone).
let _schemaVerified = false;

export function getDb(): Client {
  if (!_db) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url) throw new Error('TURSO_DATABASE_URL is not set');
    _db = createClient({ url, authToken });
  }
  return _db;
}

/**
 * Lazy, self-healing bootstrap: runs migrations + seeds the default user row
 * on first access AND re-runs both if a sentinel check reveals the DB has
 * been wiped since.
 *
 * The sentinel is a cheap `SELECT 1 FROM sqlite_master WHERE name='users'`
 * (~1ms). It fires on every call after first boot to catch the "dev ran
 * pnpm db:reset without restarting the server" case. Migrations + the
 * INSERT OR IGNORE seed are both idempotent so re-running is free on a
 * healthy DB — the sentinel just skips straight to verified=true.
 *
 * Dynamic imports avoid a cycle (migrations.ts imports client.ts).
 */
export async function ensureDbReady(): Promise<void> {
  if (_schemaVerified && (await schemaExists())) return;
  _schemaVerified = false;
  if (_bootstrapPromise) return _bootstrapPromise;
  _bootstrapPromise = (async () => {
    const { runMigrations, resetMigrationsMemo } = await import('./migrations');
    // Migrations memoize "done" internally; reset that too so a wiped DB
    // gets a full re-apply.
    resetMigrationsMemo();
    await runMigrations();
    await seedDefaultUser();
    _schemaVerified = true;
  })().catch((err) => {
    _bootstrapPromise = null;
    _schemaVerified = false;
    throw err;
  }).finally(() => {
    _bootstrapPromise = null;
  });
  return _bootstrapPromise;
}

async function schemaExists(): Promise<boolean> {
  try {
    const r = await getDb().execute(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='users' LIMIT 1`,
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

async function seedDefaultUser(): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)`,
    args: [1, 'Default User'],
  });
}

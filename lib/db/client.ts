import { createClient, type Client } from '@libsql/client';

let _db: Client | null = null;
let _bootstrapPromise: Promise<void> | null = null;

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
 * Lazy first-access bootstrap: runs migrations + seeds the default user row.
 * Every API route that hits the DB should `await ensureDbReady()` before its
 * first query so a freshly-reset DB rebuilds its schema + single-tenant user
 * on the next request instead of 500ing with "no such table".
 *
 * Memoized via _bootstrapPromise so concurrent requests cooperate on one run.
 * Dynamic imports avoid a cycle (migrations.ts imports client.ts).
 */
export async function ensureDbReady(): Promise<void> {
  if (_bootstrapPromise) return _bootstrapPromise;
  _bootstrapPromise = (async () => {
    const { runMigrations } = await import('./migrations');
    await runMigrations();
    await seedDefaultUser();
  })().catch((err) => {
    // Reset so a later request retries; otherwise a one-shot failure sticks.
    _bootstrapPromise = null;
    throw err;
  });
  return _bootstrapPromise;
}

async function seedDefaultUser(): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)`,
    args: [1, 'Default User'],
  });
}

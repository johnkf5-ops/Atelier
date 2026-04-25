import { describe, it, expect, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression test for the bug where `pnpm db:reset` left the schema empty
 * and the next request to any DB route 500'd with "no such table" — the
 * frontend then crashed parsing an empty 500 body.
 *
 * The fix is `ensureDbReady()` in `lib/db/client.ts`: first DB touch runs
 * migrations and seeds the default user. It also does a cheap per-call
 * sentinel check so a wiped DB (external `pnpm db:reset` against a running
 * server) triggers a re-bootstrap instead of leaving the server stuck
 * believing the schema exists.
 *
 * These tests run against a local file:// SQLite DB that we wipe between
 * assertions to simulate the reset path.
 */

// EVERY table the app expects to exist after a clean boot. Extend this
// list when a new migration creates a new table — if you don't, the app
// will still start but routes that touch the new table will 500 until
// someone adds the schema/migration, and this test will catch it.
const EXPECTED_TABLES = [
  'users',
  'portfolio_images',
  'style_fingerprints',
  'akb_versions',
  'extractor_turns',
  'opportunities',
  'past_recipients',
  'opportunity_logos',
  'runs',
  'run_events',
  'run_matches',
  'run_event_cursors',
  'drafted_packages',
  'dossiers',
  'run_opportunities',
  'untrusted_sources',
  '_migrations',
] as const;

describe('db bootstrap on a fresh empty DB', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'atelier-bootstrap-'));
  const dbPath = join(tmpDir, 'bootstrap-test.db');

  // Point ALL DB access at the temp file before loading any lib module.
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
  delete process.env.TURSO_AUTH_TOKEN;

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ensureDbReady creates every expected table after first access', async () => {
    const { ensureDbReady, getDb } = await import('@/lib/db/client');

    await ensureDbReady();

    const rows = await getDb().execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    const actual = new Set(rows.rows.map((r) => String((r as unknown as { name: string }).name)));

    for (const expected of EXPECTED_TABLES) {
      expect(actual.has(expected), `missing table: ${expected}`).toBe(true);
    }
  });

  it('seeds users(id=1) with a default name on first boot', async () => {
    const { ensureDbReady, getDb } = await import('@/lib/db/client');

    await ensureDbReady();

    const users = await getDb().execute('SELECT id, name FROM users WHERE id = 1');
    expect(users.rows).toHaveLength(1);
    expect((users.rows[0] as unknown as { id: number }).id).toBe(1);
  });

  it('lets getPortfolioCount run on a freshly-bootstrapped DB (the exact call the upload handler makes)', async () => {
    const { ensureDbReady } = await import('@/lib/db/client');
    const { getPortfolioCount } = await import('@/lib/portfolio/ingest');

    await ensureDbReady();

    const count = await getPortfolioCount(1);
    expect(count).toBe(0);
  });

  it('is idempotent — calling ensureDbReady twice does not duplicate the default user', async () => {
    const { ensureDbReady, getDb } = await import('@/lib/db/client');

    await ensureDbReady();
    await ensureDbReady();

    const users = await getDb().execute('SELECT COUNT(*) as n FROM users WHERE id = 1');
    expect(Number((users.rows[0] as unknown as { n: number }).n)).toBe(1);
  });

  it('self-heals after an external DB wipe (the pnpm db:reset against a running server case)', async () => {
    const { ensureDbReady, getDb } = await import('@/lib/db/client');

    // First boot — full bootstrap.
    await ensureDbReady();
    expect(
      (
        await getDb().execute(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_images'`,
        )
      ).rows,
    ).toHaveLength(1);

    // Simulate external reset: drop all tables exactly like scripts/reset-db.ts does.
    const tables = (
      await getDb().execute(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
      )
    ).rows.map((r) => String((r as unknown as { name: string }).name));
    await getDb().execute('PRAGMA foreign_keys = OFF');
    for (const t of tables) {
      await getDb().execute(`DROP TABLE IF EXISTS ${t}`);
    }
    await getDb().execute('PRAGMA foreign_keys = ON');

    // The sentinel check inside ensureDbReady must detect the wipe and re-run.
    await ensureDbReady();

    // Every table is back.
    const rows = await getDb().execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    );
    const actual = new Set(rows.rows.map((r) => String((r as unknown as { name: string }).name)));
    for (const expected of EXPECTED_TABLES) {
      expect(actual.has(expected), `missing table after re-bootstrap: ${expected}`).toBe(true);
    }

    // Default user re-seeded.
    const users = await getDb().execute('SELECT id FROM users WHERE id = 1');
    expect(users.rows).toHaveLength(1);
  });
});

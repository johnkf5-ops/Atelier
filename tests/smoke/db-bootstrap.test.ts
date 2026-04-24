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
 * migrations and seeds the default user. This test exercises the full
 * boot path against an empty local-file Turso DB and asserts the upload
 * handler's essential preconditions hold.
 */

describe('db bootstrap on a fresh empty DB', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'atelier-bootstrap-'));
  const dbPath = join(tmpDir, 'bootstrap-test.db');

  // Point ALL DB access at the temp file before loading any lib module.
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
  delete process.env.TURSO_AUTH_TOKEN;
  // Reset db client module state between imports — safe because we only
  // import lazily below.

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ensureDbReady creates schema + seeds user(id=1) + lets getPortfolioCount run on a freshly-empty DB', async () => {
    // Dynamic import so the module reads the env var we just set.
    const { ensureDbReady, getDb } = await import('@/lib/db/client');
    const { getPortfolioCount } = await import('@/lib/portfolio/ingest');

    await ensureDbReady();

    // Schema present: portfolio_images table exists (the one whose absence
    // caused the original 500).
    const tables = await getDb().execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_images'`,
    );
    expect(tables.rows).toHaveLength(1);

    // Default user seeded.
    const users = await getDb().execute('SELECT id, name FROM users WHERE id = 1');
    expect(users.rows).toHaveLength(1);
    expect((users.rows[0] as unknown as { id: number }).id).toBe(1);

    // The exact call the upload handler makes no longer throws.
    const count = await getPortfolioCount(1);
    expect(count).toBe(0);
  });

  it('is idempotent — calling ensureDbReady twice does not duplicate the default user or error', async () => {
    const { ensureDbReady, getDb } = await import('@/lib/db/client');

    await ensureDbReady();
    await ensureDbReady();

    const users = await getDb().execute('SELECT COUNT(*) as n FROM users WHERE id = 1');
    expect(Number((users.rows[0] as unknown as { n: number }).n)).toBe(1);
  });
});

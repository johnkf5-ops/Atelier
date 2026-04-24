import { describe, it, expect, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression test for WALKTHROUGH_NOTES Note 7 — `/runs/new` reported
 * "Portfolio: 0 images" while `/upload` showed 21 against the same DB.
 * Root cause was an inline `Number(rowObj) || 0` in runs/new vs the
 * correct `Number(rowObj.n)` inside `getPortfolioCount`. Two different
 * places, two different impls, drift.
 *
 * Fix: every caller goes through `lib/db/queries/portfolio.ts`. This
 * test asserts the canonical function returns the right count and that
 * the back-compat alias from `lib/portfolio/ingest.ts` is the same
 * function (so future callers can't accidentally fork the impl again).
 */

describe('portfolio count canonical query', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'atelier-portfolio-count-'));
  const dbPath = join(tmpDir, 'portfolio-count-test.db');
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
  delete process.env.TURSO_AUTH_TOKEN;

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 on a freshly-bootstrapped DB', async () => {
    const { ensureDbReady } = await import('@/lib/db/client');
    const { getPortfolioCount } = await import('@/lib/db/queries/portfolio');
    await ensureDbReady();
    expect(await getPortfolioCount(1)).toBe(0);
  });

  it('returns N after N rows are inserted', async () => {
    const { ensureDbReady, getDb } = await import('@/lib/db/client');
    const { getPortfolioCount } = await import('@/lib/db/queries/portfolio');
    await ensureDbReady();

    for (let i = 0; i < 21; i++) {
      const padded = String(i).padStart(64, 'a');
      await getDb().execute({
        sql: `INSERT INTO portfolio_images
              (user_id, filename, blob_pathname, thumb_pathname, blob_url, thumb_url,
               width, height, ordinal)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          1,
          `test-${i}.jpg`,
          `originals/${padded}.jpg`,
          `thumbs/${padded}.jpg`,
          `https://example.com/o-${i}.jpg`,
          `https://example.com/t-${i}.jpg`,
          1024,
          1024,
          i,
        ],
      });
    }

    expect(await getPortfolioCount(1)).toBe(21);
  });

  it('back-compat alias from lib/portfolio/ingest.ts is the same function', async () => {
    const canonical = await import('@/lib/db/queries/portfolio');
    const legacy = await import('@/lib/portfolio/ingest');
    expect(legacy.getPortfolioCount).toBe(canonical.getPortfolioCount);
    expect(legacy.getNextOrdinal).toBe(canonical.getNextPortfolioOrdinal);
    expect(legacy.existingHashes).toBe(canonical.existingPortfolioHashes);
  });

  it('NEVER returns 0 when rows exist (the exact /runs/new bug)', async () => {
    // The bug was `Number(rowObj) || 0` returning 0 even with 21 rows.
    // After the fix, count > 0 must be reported correctly to every caller.
    const { ensureDbReady } = await import('@/lib/db/client');
    const { getPortfolioCount } = await import('@/lib/db/queries/portfolio');
    await ensureDbReady();
    const count = await getPortfolioCount(1);
    expect(count).toBeGreaterThan(0);
  });
});

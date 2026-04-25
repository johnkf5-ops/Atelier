import { describe, it, expect, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression test for WALKTHROUGH Note 8 — past_recipients.file_ids was
 * empty on every recipient in prod, blinding the Rubric. Root cause was a
 * SELECT filter that skipped already-blob-mirrored recipients regardless
 * of whether file_ids was actually populated.
 *
 * This test asserts the structural contract:
 *   - The "needs processing" query must include rows where file_ids
 *     is empty/null/'[]', regardless of mirror status.
 *   - That way a partial failure (Blob succeeded, Files API failed) gets
 *     re-attempted on the next finalize-scout invocation instead of
 *     being permanently skipped.
 */

describe('finalize-scout re-processing contract', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'atelier-finalize-scout-'));
  const dbPath = join(tmpDir, 'finalize-scout-test.db');
  process.env.TURSO_DATABASE_URL = `file:${dbPath}`;
  delete process.env.TURSO_AUTH_TOKEN;

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('SELECT filter picks up rows that mirrored to Blob but never got file_ids', async () => {
    const { ensureDbReady, getDb } = await import('@/lib/db/client');
    await ensureDbReady();
    const db = getDb();

    // Seed minimum schema state: user, akb_version, fingerprint, run, opp, past_recipient, run_opp.
    await db.execute({
      sql: `INSERT INTO akb_versions (user_id, version, json, source) VALUES (1, 1, '{}', 'merge')`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO style_fingerprints (user_id, version, json) VALUES (1, 1, '{}')`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO runs (id, user_id, akb_version_id, style_fingerprint_id, status, config_json)
            VALUES (777, 1, 1, 1, 'finalizing_scout', '{}')`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO opportunities (id, source, source_id, name, url, raw_json)
            VALUES (888, 'test', 'foo', 'Foo Award', 'https://example.com', '{}')`,
      args: [],
    });
    await db.execute({
      sql: `INSERT INTO run_opportunities (run_id, opportunity_id) VALUES (777, 888)`,
      args: [],
    });

    // Three recipients in distinct states the route must distinguish:
    //   A) raw URLs, no file_ids — must be picked up (fresh path)
    //   B) blob-mirrored, file_ids = '[]' — must be picked up (recovery path)
    //   C) blob-mirrored, file_ids populated — must be SKIPPED (already done)
    await db.execute({
      sql: `INSERT INTO past_recipients (id, opportunity_id, year, name, portfolio_urls, file_ids)
            VALUES
              (1001, 888, 2024, 'Recipient A', '["https://example.com/a.jpg"]', NULL),
              (1002, 888, 2024, 'Recipient B', '["https://blob.vercel-storage.com/b.jpg"]', '[]'),
              (1003, 888, 2024, 'Recipient C', '["https://blob.vercel-storage.com/c.jpg"]', '["file_abc123"]')`,
      args: [],
    });

    // The exact filter the finalize-scout route uses.
    const rows = (
      await db.execute({
        sql: `SELECT pr.id FROM past_recipients pr
              JOIN run_opportunities ro ON ro.opportunity_id = pr.opportunity_id
              WHERE ro.run_id = ?
                AND pr.portfolio_urls LIKE '[%'
                AND (
                  pr.portfolio_urls NOT LIKE '%blob.vercel-storage%'
                  OR pr.file_ids IS NULL
                  OR pr.file_ids = '[]'
                  OR pr.file_ids = ''
                )`,
        args: [777],
      })
    ).rows.map((r) => Number((r as unknown as { id: number }).id));

    expect(rows).toContain(1001); // raw URLs, must process
    expect(rows).toContain(1002); // recovery path: blob-mirrored but file_ids empty
    expect(rows).not.toContain(1003); // already done — must skip
  });

  it('post-pass audit query identifies recipients still blind', async () => {
    const { getDb } = await import('@/lib/db/client');
    const db = getDb();

    // Same recipients as previous test still in DB — Recipient A and B should
    // still report blind (we haven't actually run the upload here, so they're
    // both still without file_ids), Recipient C should not.
    const blind = (
      await db.execute({
        sql: `SELECT pr.id FROM past_recipients pr
              JOIN run_opportunities ro ON ro.opportunity_id = pr.opportunity_id
              WHERE ro.run_id = 777
                AND pr.portfolio_urls LIKE '[%'
                AND (pr.file_ids IS NULL OR pr.file_ids = '[]' OR pr.file_ids = '')`,
        args: [],
      })
    ).rows.map((r) => Number((r as unknown as { id: number }).id));

    expect(blind).toEqual(expect.arrayContaining([1001, 1002]));
    expect(blind).not.toContain(1003);
  });
});

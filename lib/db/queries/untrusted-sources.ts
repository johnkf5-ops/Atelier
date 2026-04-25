import { getDb } from '@/lib/db/client';

/**
 * Per-user list of source URLs the user has flagged as having ingested
 * wrong/hallucinated facts. Auto-discover and the URL ingest path skip
 * any URL in this list — prevents the "delete this fact forever" treadmill
 * where every re-ingest re-introduces the same hallucination.
 *
 * WALKTHROUGH Note 10.
 */

export async function listUntrustedSources(userId: number): Promise<string[]> {
  const r = await getDb().execute({
    sql: `SELECT url FROM untrusted_sources WHERE user_id = ? ORDER BY rejected_at DESC`,
    args: [userId],
  });
  return r.rows.map((row) => String((row as unknown as { url: string }).url));
}

export async function addUntrustedSource(
  userId: number,
  url: string,
  reason?: string,
): Promise<void> {
  await getDb().execute({
    sql: `INSERT OR IGNORE INTO untrusted_sources (user_id, url, reason) VALUES (?, ?, ?)`,
    args: [userId, url, reason ?? null],
  });
}

export async function removeUntrustedSource(userId: number, url: string): Promise<void> {
  await getDb().execute({
    sql: `DELETE FROM untrusted_sources WHERE user_id = ? AND url = ?`,
    args: [userId, url],
  });
}

export async function isUntrusted(userId: number, url: string): Promise<boolean> {
  const r = await getDb().execute({
    sql: `SELECT 1 FROM untrusted_sources WHERE user_id = ? AND url = ? LIMIT 1`,
    args: [userId, url],
  });
  return r.rows.length > 0;
}

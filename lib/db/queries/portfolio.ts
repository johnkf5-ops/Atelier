import { getDb } from '@/lib/db/client';

/**
 * Canonical portfolio queries. EVERY caller that needs a portfolio image
 * count or list must go through this module — inline `SELECT COUNT(*) FROM
 * portfolio_images` in three different files lets the implementations drift
 * (the /runs/new page silently returned 0 because of a `Number(rowObj)` bug
 * vs the upload page's correct `Number(rowObj.n)` — see WALKTHROUGH_NOTES
 * Note 7). Single source = no drift.
 */

export type PortfolioImageRow = {
  id: number;
  filename: string;
  thumb_url: string;
  blob_url: string;
  width: number | null;
  height: number | null;
  ordinal: number;
};

export async function getPortfolioCount(userId: number): Promise<number> {
  const r = await getDb().execute({
    sql: 'SELECT COUNT(*) AS n FROM portfolio_images WHERE user_id = ?',
    args: [userId],
  });
  const row = r.rows[0] as unknown as { n: number | bigint } | undefined;
  if (!row) return 0;
  return Number(row.n ?? 0);
}

export async function getNextPortfolioOrdinal(userId: number): Promise<number> {
  const r = await getDb().execute({
    sql: 'SELECT COALESCE(MAX(ordinal), -1) AS max_ord FROM portfolio_images WHERE user_id = ?',
    args: [userId],
  });
  const row = r.rows[0] as unknown as { max_ord: number | bigint } | undefined;
  if (!row) return 0;
  return Number(row.max_ord ?? -1) + 1;
}

export async function listPortfolio(userId: number): Promise<PortfolioImageRow[]> {
  const r = await getDb().execute({
    sql: `SELECT id, filename, thumb_url, blob_url, width, height, ordinal
          FROM portfolio_images
          WHERE user_id = ?
          ORDER BY ordinal ASC`,
    args: [userId],
  });
  return r.rows as unknown as PortfolioImageRow[];
}

export async function existingPortfolioHashes(userId: number): Promise<Set<string>> {
  const r = await getDb().execute({
    sql: `SELECT blob_pathname FROM portfolio_images WHERE user_id = ?`,
    args: [userId],
  });
  const out = new Set<string>();
  for (const row of r.rows) {
    const m = String(row.blob_pathname).match(/originals\/([0-9a-f]{64})\.jpg/);
    if (m) out.add(m[1]);
  }
  return out;
}

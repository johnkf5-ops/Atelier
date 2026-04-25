import { getDb } from '@/lib/db/client';

/**
 * Per-IP successful-run gate. WALKTHROUGH Note 16. Single-tenant demo
 * runs on the builder's API key — a judge clicking Start Run twice
 * shouldn't drop $5–10 of Anthropic spend.
 *
 * Limit: 1 successful run per IP per 24h. Counted as `successful` only
 * AFTER /api/runs/start has actually inserted a runs row, so a 4xx body-
 * parse failure doesn't count against the user. The recorder writes a
 * (ip, run_id) row after the insert; the gate counts those rows for the
 * IP within the last 86_400 seconds.
 */

const WINDOW_SECONDS = 86_400;
const MAX_RUNS_PER_WINDOW = 1;

export async function countRecentRunsForIp(ip: string): Promise<number> {
  const r = await getDb().execute({
    sql: `SELECT COUNT(*) AS n FROM rate_limits_run_start
          WHERE ip = ? AND started_at >= unixepoch() - ?`,
    args: [ip, WINDOW_SECONDS],
  });
  const row = r.rows[0] as unknown as { n: number | bigint } | undefined;
  return Number(row?.n ?? 0);
}

export async function recordRunStart(ip: string, runId: number): Promise<void> {
  await getDb().execute({
    sql: `INSERT OR IGNORE INTO rate_limits_run_start (ip, run_id) VALUES (?, ?)`,
    args: [ip, runId],
  });
}

export function isRateLimited(count: number): boolean {
  return count >= MAX_RUNS_PER_WINDOW;
}

export const RATE_LIMIT_WINDOW_SECONDS = WINDOW_SECONDS;
export const RATE_LIMIT_MAX = MAX_RUNS_PER_WINDOW;

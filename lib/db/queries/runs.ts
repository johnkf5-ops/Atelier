import { getDb } from '@/lib/db/client';

export type RunSummary = {
  id: number;
  status: string;
  started_at: number;
  finished_at: number | null;
  error: string | null;
  discovered_count: number;
  scored_count: number;
  included_count: number;
};

export async function listRunsForUser(userId: number): Promise<RunSummary[]> {
  const rows = (
    await getDb().execute({
      sql: `SELECT
              r.id, r.status, r.started_at, r.finished_at, r.error,
              (SELECT COUNT(*) FROM run_opportunities ro WHERE ro.run_id = r.id)           AS discovered_count,
              (SELECT COUNT(*) FROM run_matches rm WHERE rm.run_id = r.id)                 AS scored_count,
              (SELECT COUNT(*) FROM run_matches rm WHERE rm.run_id = r.id AND rm.included = 1) AS included_count
            FROM runs r
            WHERE r.user_id = ?
            ORDER BY r.id DESC`,
      args: [userId],
    })
  ).rows as unknown as Array<{
    id: number;
    status: string;
    started_at: number;
    finished_at: number | null;
    error: string | null;
    discovered_count: number;
    scored_count: number;
    included_count: number;
  }>;
  return rows;
}

export function formatRelative(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86_400)}d ago`;
}

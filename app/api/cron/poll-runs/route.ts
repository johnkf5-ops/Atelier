import { ensureDbReady, getDb } from '@/lib/db/client';
import { pollRun } from '@/lib/agents/run-poll';
import { withApiErrorHandling } from '@/lib/api/response';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * WALKTHROUGH Note 34 — server-side polling cron for in-flight runs.
 *
 * Prior architecture: the browser tab on /runs/[id] is the ONLY thing
 * that polls /api/runs/[id]/events every 3 seconds. If the user closes
 * their laptop / closes the tab / backgrounds the tab heavily, polling
 * stops. The Managed Agent on Anthropic's infrastructure keeps working
 * but our orchestration goes silent — no terminal detection, no phase
 * advance, no per-opp dispatch in the Rubric phase. The run looks
 * "stuck" when in fact the agent is alive and waiting for us to act.
 *
 * Real fix: a Vercel cron route that ticks every minute, finds every
 * in-flight run, and calls pollRun() on each. Browser polling still
 * works for live dashboard updates when the user is watching, but the
 * cron guarantees forward progress regardless of browser presence.
 *
 * "In-flight" = runs.status IN ('scout_running', 'rubric_running').
 * Other statuses (queued / *_complete / finalizing / complete / error /
 * cancelled) either have no managed session to poll or are terminal.
 */
export const GET = withApiErrorHandling(async (req: Request) => {
  // Vercel cron headers verification — when called by Vercel cron the
  // request carries an Authorization header signed with CRON_SECRET.
  // Reject unauthenticated calls in prod to prevent random web traffic
  // from triggering the polling loop.
  if (process.env.NODE_ENV === 'production') {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  await ensureDbReady();
  const db = getDb();

  const inflight = (
    await db.execute({
      sql: `SELECT id FROM runs WHERE status IN ('scout_running', 'rubric_running') ORDER BY id ASC`,
      args: [],
    })
  ).rows as unknown as Array<{ id: number }>;

  if (inflight.length === 0) {
    return Response.json({ polled: 0, runs: [] });
  }

  const results: Array<{ runId: number; ok: boolean; error?: string }> = [];
  for (const row of inflight) {
    try {
      // pollRun internally handles event ingest, requires_action handling,
      // terminal detection + CAS phase advance + waitUntil(next-phase POST).
      // Idempotent — same as the browser polling path. Discard the response;
      // we only care that the side effects fire.
      await pollRun(req, row.id);
      results.push({ runId: row.id, ok: true });
    } catch (e) {
      const error = (e as Error).message ?? String(e);
      results.push({ runId: row.id, ok: false, error });
      console.warn(`[cron poll-runs] runId=${row.id} failed: ${error}`);
    }
  }

  return Response.json({ polled: results.length, runs: results });
});

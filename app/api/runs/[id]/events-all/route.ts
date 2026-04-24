import { getDb } from '@/lib/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Playback endpoint: returns ALL run_events rows for a run, ordered by id ASC,
 * with the original Anthropic payload flattened in plus _kind and _created_at
 * for client-side pacing. Used ONLY by /runs/[id]?playback=<run_id>&speed=N
 * — does NOT hit Anthropic.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = (
    await getDb().execute({
      sql: `SELECT event_id, agent, kind, payload_json, created_at
            FROM run_events
            WHERE run_id = ?
            ORDER BY id ASC`,
      args: [Number(id)],
    })
  ).rows as unknown as Array<{
    event_id: string | null;
    agent: string;
    kind: string;
    payload_json: string;
    created_at: number;
  }>;
  const events = rows.map((r) => {
    let payload: unknown = {};
    try {
      payload = JSON.parse(r.payload_json);
    } catch {
      /* noop */
    }
    return {
      ...(payload as Record<string, unknown>),
      _agent: r.agent,
      _kind: r.kind,
      _created_at: r.created_at,
    };
  });
  return Response.json(events);
}

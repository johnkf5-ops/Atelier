import { getDb } from '@/lib/db/client';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Phase 4 synthesis lives here in full. For §3.x we only flip runs.status
 * to 'complete' so the polling UI can redirect. Phase 4 will expand this
 * to: Package Drafter → Orchestrator ranking → Dossier persistence.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  const db = getDb();
  await db.execute({ sql: `UPDATE runs SET status = 'complete', finished_at = unixepoch() WHERE id = ?`, args: [runId] });
  return Response.json({ finalized: true });
}

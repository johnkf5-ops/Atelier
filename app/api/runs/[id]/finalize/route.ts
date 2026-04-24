import { ensureDbReady, getDb } from '@/lib/db/client';
import { orchestrateDossier } from '@/lib/agents/orchestrator';
import { draftPackages } from '@/lib/agents/package-drafter';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import { withApiErrorHandling } from '@/lib/api/response';

export const runtime = 'nodejs';
export const maxDuration = 300; // Vercel Pro 5-min cap

export const POST = withApiErrorHandling(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    await ensureDbReady();
    const { id } = await params;
    const runId = Number(id);
    const db = getDb();

    // CAS guard: only advance if currently rubric_complete (or queued/finalizing on retry).
    const cas = await db.execute({
      sql: `UPDATE runs SET status = 'finalizing'
            WHERE id = ? AND status IN ('rubric_complete', 'queued', 'finalizing')`,
      args: [runId],
    });
    if (cas.rowsAffected === 0) {
      return Response.json({ ok: true, skipped: 'already-past-finalize' });
    }

    const runRow = (
      await db.execute({
        sql: `SELECT user_id, akb_version_id FROM runs WHERE id = ?`,
        args: [runId],
      })
    ).rows[0] as unknown as { user_id: number; akb_version_id: number };
    const akbJson = ((
      await db.execute({
        sql: `SELECT json FROM akb_versions WHERE id = ?`,
        args: [runRow.akb_version_id],
      })
    ).rows[0] as unknown as { json: string }).json;
    const akb: ArtistKnowledgeBase = JSON.parse(akbJson);

    try {
      // 1. Orchestrator — composite scores + cover/ranking narratives + filtered-out blurbs + logos
      await orchestrateDossier(runId);
      // 2. Package Drafter — statement, proposal, CV, cover letter, work samples per top match.
      //    draftPackages flips runs.status to 'complete' on success.
      await draftPackages(runId, akb, runRow.user_id);
    } catch (e) {
      const err = e as Error;
      await db.execute({
        sql: `UPDATE runs SET status = 'error', error = ?, finished_at = unixepoch() WHERE id = ?`,
        args: [err.message ?? String(e), runId],
      });
      console.error('[finalize]', err);
    }

    return Response.json({ ok: true });
  },
);

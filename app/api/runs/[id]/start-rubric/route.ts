import { waitUntil } from '@vercel/functions';
import { getDb } from '@/lib/db/client';
import {
  startRubricSession,
  selectTopPortfolioImages,
  type OpportunityForRubric,
} from '@/lib/agents/rubric-matcher';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import type { StyleFingerprint } from '@/lib/schemas/style-fingerprint';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  const db = getDb();

  await db.execute({ sql: `UPDATE runs SET status = 'rubric_running' WHERE id = ?`, args: [runId] });

  const runRow = (
    await db.execute({
      sql: `SELECT user_id, akb_version_id, style_fingerprint_id FROM runs WHERE id = ?`,
      args: [runId],
    })
  ).rows[0] as unknown as {
    user_id: number;
    akb_version_id: number;
    style_fingerprint_id: number;
  };
  if (!runRow) return Response.json({ error: 'run not found' }, { status: 404 });

  const akbRow = (
    await db.execute({ sql: `SELECT json FROM akb_versions WHERE id = ?`, args: [runRow.akb_version_id] })
  ).rows[0] as unknown as { json: string };
  const akb = JSON.parse(akbRow.json) as ArtistKnowledgeBase;

  const fpRow = (
    await db.execute({
      sql: `SELECT json FROM style_fingerprints WHERE id = ?`,
      args: [runRow.style_fingerprint_id],
    })
  ).rows[0] as unknown as { json: string };
  const fingerprint = JSON.parse(fpRow.json) as StyleFingerprint;

  const top12 = await selectTopPortfolioImages(runRow.user_id);

  const oppRows = (
    await db.execute({
      sql: `SELECT o.id, o.name, o.url, o.raw_json
            FROM opportunities o
            JOIN run_opportunities ro ON ro.opportunity_id = o.id
            WHERE ro.run_id = ?`,
      args: [runId],
    })
  ).rows as unknown as Array<{ id: number; name: string; url: string; raw_json: string }>;

  const opportunities: OpportunityForRubric[] = await Promise.all(
    oppRows.map(async (r) => {
      const raw = JSON.parse(r.raw_json) as { award?: { prestige_tier?: string } };
      const recRows = (
        await db.execute({
          sql: `SELECT name, year, portfolio_urls FROM past_recipients
                WHERE opportunity_id = ? AND portfolio_urls LIKE '%blob.vercel-storage%'`,
          args: [r.id],
        })
      ).rows as unknown as Array<{ name: string; year: number | null; portfolio_urls: string }>;
      return {
        id: r.id,
        name: r.name,
        url: r.url,
        prestige_tier: raw.award?.prestige_tier ?? 'open-call',
        past_recipients: recRows.map((rr) => ({
          name: rr.name,
          year: rr.year,
          image_urls: JSON.parse(rr.portfolio_urls) as string[],
        })),
      };
    }),
  );

  if (opportunities.length === 0) {
    await db.execute({ sql: `UPDATE runs SET status = 'rubric_complete' WHERE id = ?`, args: [runId] });
    waitUntil(fetch(new URL(`/api/runs/${runId}/finalize`, req.url), { method: 'POST' }).catch(() => {}));
    return Response.json({ skipped: true, reason: 'no opportunities' });
  }

  await startRubricSession(runId, akb, fingerprint, top12, opportunities);
  return Response.json({ session_started: true, opportunity_count: opportunities.length });
}

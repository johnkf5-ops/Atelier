import { waitUntil } from '@vercel/functions';
import { ensureDbReady, getDb } from '@/lib/db/client';
import {
  startRubricSession,
  selectTopPortfolioImages,
  type OpportunityForRubric,
  type PortfolioRef,
} from '@/lib/agents/rubric-matcher';
import { uploadVisionReadyImage } from '@/lib/anthropic-files';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import type { StyleFingerprint } from '@/lib/schemas/style-fingerprint';
import { withApiErrorHandling } from '@/lib/api/response';

export const runtime = 'nodejs';
export const maxDuration = 60;

export const POST = withApiErrorHandling(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    await ensureDbReady();
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

    const top12Raw = await selectTopPortfolioImages(runRow.user_id);

    // Upload each portfolio thumb to Anthropic Files API so the Rubric session
    // can mount them at /workspace/portfolio/<id>.jpg and `read` directly.
    const top12: PortfolioRef[] = await Promise.all(
      top12Raw.map(async (p) => {
        try {
          const res = await fetch(p.thumb_url);
          if (!res.ok) {
            console.warn(`[start-rubric] portfolio thumb fetch failed ${p.id} → ${res.status}`);
            return p;
          }
          // WALKTHROUGH Note 28: portfolio bytes from Vercel Blob carry
          // color profiles / progressive encoding / metadata that Anthropic's
          // vision pipeline cannot decode. uploadVisionReadyImage normalizes
          // through Sharp (rotate + resize + baseline JPEG) so the Rubric
          // agent's read tool returns multimodal content instead of "Output
          // could not be decoded as text".
          const rawBuf = Buffer.from(await res.arrayBuffer());
          const fileId = await uploadVisionReadyImage(rawBuf, `portfolio_${p.id}.jpg`);
          return { ...p, file_id: fileId };
        } catch (err) {
          console.warn(`[start-rubric] portfolio Files API upload failed ${p.id}: ${(err as Error).message}`);
          return p;
        }
      }),
    );
    console.log(
      `[start-rubric] portfolio uploaded ${top12.filter((p) => p.file_id).length}/${top12.length} to Files API`,
    );

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
        // One row per (opportunity_id, name) — duplicates arise when Scout
        // has run more than once on the same opp. Keep the most recent (MAX id).
        const recRows = (
          await db.execute({
            sql: `SELECT name, year, portfolio_urls, file_ids FROM past_recipients
                  WHERE opportunity_id = ? AND portfolio_urls LIKE '%blob.vercel-storage%'
                    AND id IN (
                      SELECT MAX(id) FROM past_recipients p2
                      WHERE p2.opportunity_id = ?
                        AND p2.portfolio_urls LIKE '%blob.vercel-storage%'
                      GROUP BY p2.name
                    )`,
            args: [r.id, r.id],
          })
        ).rows as unknown as Array<{
          name: string;
          year: number | null;
          portfolio_urls: string;
          file_ids: string | null;
        }>;
        return {
          id: r.id,
          name: r.name,
          url: r.url,
          prestige_tier: raw.award?.prestige_tier ?? 'open-call',
          past_recipients: recRows.map((rr) => ({
            name: rr.name,
            year: rr.year,
            image_urls: JSON.parse(rr.portfolio_urls) as string[],
            file_ids: rr.file_ids ? (JSON.parse(rr.file_ids) as string[]) : [],
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
  },
);

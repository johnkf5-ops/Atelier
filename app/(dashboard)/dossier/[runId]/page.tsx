import { redirect } from 'next/navigation';
import { ensureDbReady, getDb } from '@/lib/db/client';
import { getLogoUrl } from '@/lib/logos';
import DossierView, { type DossierMatch, type DossierFilteredOut } from './dossier-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function DossierPage({ params }: { params: Promise<{ runId: string }> }) {
  await ensureDbReady();
  const { runId } = await params;
  const runIdNum = Number(runId);
  if (!Number.isInteger(runIdNum)) redirect('/runs');
  const db = getDb();

  const dossierRow = (
    await db.execute({
      sql: `SELECT cover_narrative, ranking_narrative FROM dossiers WHERE run_id = ?`,
      args: [runIdNum],
    })
  ).rows[0] as unknown as { cover_narrative: string; ranking_narrative: string } | undefined;

  // If dossier hasn't been persisted yet, send user back to the run page
  // (which handles in-progress + error states via the polling UI).
  if (!dossierRow) redirect(`/runs/${runIdNum}`);

  const includedRows = (
    await db.execute({
      sql: `SELECT rm.id, rm.opportunity_id, rm.fit_score, rm.composite_score, rm.reasoning,
                   rm.supporting_image_ids, rm.hurting_image_ids,
                   o.name, o.url, o.deadline, o.award_summary, o.raw_json,
                   dp.artist_statement, dp.project_proposal, dp.cv_formatted,
                   dp.cover_letter, dp.work_sample_selection_json
            FROM run_matches rm
            JOIN opportunities o ON o.id = rm.opportunity_id
            LEFT JOIN drafted_packages dp ON dp.run_match_id = rm.id
            WHERE rm.run_id = ? AND rm.included = 1
            ORDER BY rm.composite_score DESC NULLS LAST, rm.fit_score DESC
            LIMIT 15`,
      args: [runIdNum],
    })
  ).rows as unknown as Array<{
    id: number;
    opportunity_id: number;
    fit_score: number;
    composite_score: number | null;
    reasoning: string;
    supporting_image_ids: string | null;
    hurting_image_ids: string | null;
    name: string;
    url: string;
    deadline: string | null;
    award_summary: string | null;
    raw_json: string;
    artist_statement: string | null;
    project_proposal: string | null;
    cv_formatted: string | null;
    cover_letter: string | null;
    work_sample_selection_json: string | null;
  }>;

  const filteredRows = (
    await db.execute({
      sql: `SELECT o.name, rm.filtered_out_blurb, rm.fit_score
            FROM run_matches rm
            JOIN opportunities o ON o.id = rm.opportunity_id
            WHERE rm.run_id = ? AND rm.included = 0 AND rm.filtered_out_blurb IS NOT NULL
            ORDER BY rm.fit_score DESC`,
      args: [runIdNum],
    })
  ).rows as unknown as Array<{ name: string; filtered_out_blurb: string; fit_score: number }>;

  // Logos (cached) — resolve in parallel
  const logoMap: Record<number, string | null> = {};
  await Promise.all(
    includedRows.map(async (m) => {
      logoMap[m.opportunity_id] = await getLogoUrl(m.opportunity_id, m.url);
    }),
  );

  const matches: DossierMatch[] = includedRows.map((m) => {
    const raw = JSON.parse(m.raw_json) as {
      award: { type: string; prestige_tier: string; amount_usd?: number; in_kind?: string };
      entry_fee_usd?: number;
    };
    return {
      id: m.id,
      opportunity_id: m.opportunity_id,
      name: m.name,
      url: m.url,
      deadline: m.deadline,
      award_summary: m.award_summary,
      award_type: raw.award.type,
      prestige_tier: raw.award.prestige_tier,
      amount_usd: raw.award.amount_usd ?? null,
      in_kind: raw.award.in_kind ?? null,
      entry_fee_usd: raw.entry_fee_usd ?? null,
      fit_score: m.fit_score,
      composite_score: m.composite_score,
      reasoning: m.reasoning,
      supporting_image_ids: m.supporting_image_ids ? (JSON.parse(m.supporting_image_ids) as number[]) : [],
      hurting_image_ids: m.hurting_image_ids ? (JSON.parse(m.hurting_image_ids) as number[]) : [],
      artist_statement: m.artist_statement,
      project_proposal: m.project_proposal,
      cv_formatted: m.cv_formatted,
      cover_letter: m.cover_letter,
      work_samples: m.work_sample_selection_json
        ? (JSON.parse(m.work_sample_selection_json) as Array<{
            portfolio_image_id: number;
            thumb_url: string;
            filename: string;
            rationale: string;
          }>)
        : [],
      logo_url: logoMap[m.opportunity_id] ?? null,
    };
  });

  const filtered: DossierFilteredOut[] = filteredRows.map((f) => ({
    name: f.name,
    blurb: f.filtered_out_blurb,
    fit_score: f.fit_score,
  }));

  return (
    <DossierView
      runId={runIdNum}
      cover={dossierRow.cover_narrative}
      ranking={dossierRow.ranking_narrative}
      matches={matches}
      filteredOut={filtered}
    />
  );
}

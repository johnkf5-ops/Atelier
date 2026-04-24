import { renderToBuffer } from '@react-pdf/renderer';
import { getDb } from '@/lib/db/client';
import { DossierDocument, type PdfMatch, type PdfFiltered } from '@/lib/pdf/dossier';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const runIdNum = Number(runId);
  const db = getDb();

  const dossierRow = (
    await db.execute({
      sql: `SELECT cover_narrative, ranking_narrative FROM dossiers WHERE run_id = ?`,
      args: [runIdNum],
    })
  ).rows[0] as unknown as { cover_narrative: string; ranking_narrative: string } | undefined;
  if (!dossierRow) {
    return Response.json({ error: 'dossier not yet finalized' }, { status: 404 });
  }

  const run = (
    await db.execute({ sql: `SELECT akb_version_id FROM runs WHERE id = ?`, args: [runIdNum] })
  ).rows[0] as unknown as { akb_version_id: number };
  const akbJson = ((
    await db.execute({ sql: `SELECT json FROM akb_versions WHERE id = ?`, args: [run.akb_version_id] })
  ).rows[0] as unknown as { json: string }).json;
  const akb: ArtistKnowledgeBase = JSON.parse(akbJson);

  const includedRows = (
    await db.execute({
      sql: `SELECT rm.fit_score, rm.composite_score, rm.reasoning,
                   o.name, o.url, o.deadline, o.award_summary, o.raw_json,
                   dp.artist_statement, dp.project_proposal, dp.cv_formatted, dp.cover_letter
            FROM run_matches rm
            JOIN opportunities o ON o.id = rm.opportunity_id
            LEFT JOIN drafted_packages dp ON dp.run_match_id = rm.id
            WHERE rm.run_id = ? AND rm.included = 1
            ORDER BY rm.composite_score DESC NULLS LAST, rm.fit_score DESC
            LIMIT 15`,
      args: [runIdNum],
    })
  ).rows as unknown as Array<{
    fit_score: number;
    composite_score: number | null;
    reasoning: string;
    name: string;
    url: string;
    deadline: string | null;
    award_summary: string | null;
    raw_json: string;
    artist_statement: string | null;
    project_proposal: string | null;
    cv_formatted: string | null;
    cover_letter: string | null;
  }>;

  const matches: PdfMatch[] = includedRows.map((m) => {
    const raw = JSON.parse(m.raw_json) as { award: { prestige_tier: string } };
    return {
      name: m.name,
      url: m.url,
      deadline: m.deadline,
      award_summary: m.award_summary,
      prestige_tier: raw.award.prestige_tier,
      fit_score: m.fit_score,
      composite_score: m.composite_score,
      reasoning: m.reasoning,
      artist_statement: m.artist_statement,
      project_proposal: m.project_proposal,
      cv_formatted: m.cv_formatted,
      cover_letter: m.cover_letter,
    };
  });

  const filteredRows = (
    await db.execute({
      sql: `SELECT o.name, rm.filtered_out_blurb
            FROM run_matches rm
            JOIN opportunities o ON o.id = rm.opportunity_id
            WHERE rm.run_id = ? AND rm.included = 0 AND rm.filtered_out_blurb IS NOT NULL
            ORDER BY rm.fit_score DESC`,
      args: [runIdNum],
    })
  ).rows as unknown as Array<{ name: string; filtered_out_blurb: string }>;
  const filteredOut: PdfFiltered[] = filteredRows.map((f) => ({ name: f.name, blurb: f.filtered_out_blurb }));

  const buffer = await renderToBuffer(
    <DossierDocument
      cover={dossierRow.cover_narrative}
      ranking={dossierRow.ranking_narrative}
      matches={matches}
      filteredOut={filteredOut}
      legalName={akb.identity.legal_name || 'Artist'}
    />,
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="atelier-dossier-${runIdNum}.pdf"`,
    },
  });
}

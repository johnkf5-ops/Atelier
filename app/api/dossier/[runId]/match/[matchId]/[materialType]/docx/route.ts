import { Document, Packer, Paragraph, HeadingLevel } from 'docx';
import { ensureDbReady, getDb } from '@/lib/db/client';
import { withApiErrorHandling } from '@/lib/api/response';

export const runtime = 'nodejs';

// WALKTHROUGH Note 22-fix.3: cv_formatted removed — CV is downloaded from
// the dossier-level /api/dossier/[runId]/cv/docx endpoint (one master CV
// per run). Per-opp cv_formatted is now a 1-sentence trim note, not a
// downloadable document.
const MATERIAL_COLS: Record<string, string> = {
  artist_statement: 'artist_statement',
  project_proposal: 'project_proposal',
  cover_letter: 'cover_letter',
};

const MATERIAL_TITLES: Record<string, string> = {
  artist_statement: 'Artist Statement',
  project_proposal: 'Project Proposal',
  cover_letter: 'Cover Letter',
};

export const GET = withApiErrorHandling(
  async (
    _req: Request,
    { params }: { params: Promise<{ runId: string; matchId: string; materialType: string }> },
  ) => {
    await ensureDbReady();
    const { runId, matchId, materialType } = await params;
    const col = MATERIAL_COLS[materialType];
    if (!col) {
      return Response.json({ error: 'unknown material type' }, { status: 400 });
    }
    const db = getDb();
    const row = (
      await db.execute({
        sql: `SELECT dp.${col} as text, o.name
              FROM drafted_packages dp
              JOIN run_matches rm ON rm.id = dp.run_match_id
              JOIN opportunities o ON o.id = rm.opportunity_id
              WHERE dp.run_match_id = ? AND rm.run_id = ?`,
        args: [Number(matchId), Number(runId)],
      })
    ).rows[0] as unknown as { text: string | null; name: string } | undefined;
    if (!row || !row.text) {
      return Response.json({ error: 'material not drafted' }, { status: 404 });
    }

    const paragraphs: Paragraph[] = [
      new Paragraph({ text: MATERIAL_TITLES[materialType], heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: row.name, heading: HeadingLevel.HEADING_2 }),
      new Paragraph({ text: '' }),
      ...row.text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .map((p) => new Paragraph({ text: p })),
    ];

    const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
    const buffer = await Packer.toBuffer(doc);

    const safeName = row.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${safeName}-${materialType}.docx"`,
      },
    });
  },
);

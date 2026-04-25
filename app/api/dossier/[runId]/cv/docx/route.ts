import { Document, Packer, Paragraph, HeadingLevel } from 'docx';
import { ensureDbReady, getDb } from '@/lib/db/client';
import { withApiErrorHandling } from '@/lib/api/response';

export const runtime = 'nodejs';

/**
 * WALKTHROUGH Note 22-fix.3: download endpoint for the master CV (one per
 * run, stored on dossiers.master_cv). Replaces the per-opp cv_formatted
 * docx route — there is no longer a per-opp CV to download.
 */
export const GET = withApiErrorHandling(
  async (_req: Request, { params }: { params: Promise<{ runId: string }> }) => {
    await ensureDbReady();
    const { runId } = await params;
    const runIdNum = Number(runId);
    if (!Number.isInteger(runIdNum)) {
      return Response.json({ error: 'invalid runId' }, { status: 400 });
    }
    const db = getDb();

    const row = (
      await db.execute({
        sql: `SELECT d.master_cv, COALESCE(av.json, '{}') AS akb_json
              FROM dossiers d
              JOIN runs r ON r.id = d.run_id
              LEFT JOIN akb_versions av ON av.id = r.akb_version_id
              WHERE d.run_id = ?`,
        args: [runIdNum],
      })
    ).rows[0] as unknown as { master_cv: string | null; akb_json: string } | undefined;

    if (!row || !row.master_cv) {
      return Response.json({ error: 'master CV not yet generated' }, { status: 404 });
    }

    let artistName = 'Artist';
    try {
      const akb = JSON.parse(row.akb_json) as {
        identity?: { artist_name?: string; legal_name?: string };
      };
      artistName = akb.identity?.artist_name || akb.identity?.legal_name || 'Artist';
    } catch {
      /* default */
    }

    const paragraphs: Paragraph[] = [
      new Paragraph({ text: 'Curriculum Vitae', heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: artistName, heading: HeadingLevel.HEADING_2 }),
      new Paragraph({ text: '' }),
      ...row.master_cv
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .map((p) => new Paragraph({ text: p })),
    ];

    const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
    const buffer = await Packer.toBuffer(doc);

    const safeName = artistName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${safeName || 'cv'}-cv.docx"`,
      },
    });
  },
);

import pLimit from 'p-limit';
import { put } from '@vercel/blob';
import { waitUntil } from '@vercel/functions';
import sharp from 'sharp';
import { ensureDbReady, getDb } from '@/lib/db/client';
import { uploadToFilesApi } from '@/lib/anthropic-files';
import { withApiErrorHandling } from '@/lib/api/response';

export const runtime = 'nodejs';
export const maxDuration = 300; // Vercel Pro 5-min cap

export const POST = withApiErrorHandling(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    await ensureDbReady();
    const { id } = await params;
    const runId = Number(id);
    const db = getDb();

    await db.execute({ sql: `UPDATE runs SET status = 'finalizing_scout' WHERE id = ?`, args: [runId] });

    // Recipients tied to this run's opportunities that haven't yet been mirrored to Blob.
    const rows = (
      await db.execute({
        sql: `SELECT pr.id, pr.opportunity_id, pr.name, pr.year, pr.portfolio_urls
              FROM past_recipients pr
              JOIN run_opportunities ro ON ro.opportunity_id = pr.opportunity_id
              WHERE ro.run_id = ?
                AND pr.portfolio_urls LIKE '[%'
                AND pr.portfolio_urls NOT LIKE '%blob.vercel-storage%'`,
        args: [runId],
      })
    ).rows as unknown as Array<{
      id: number;
      opportunity_id: number;
      name: string;
      year: number | null;
      portfolio_urls: string;
    }>;

    const limit = pLimit(10);
    await Promise.all(rows.map((row) => limit(() => downloadRow(row))));

    waitUntil(
      fetch(new URL(`/api/runs/${runId}/start-rubric`, req.url), { method: 'POST' }).catch(() => {}),
    );

    return Response.json({ downloaded_recipients: rows.length });
  },
);

async function downloadRow(row: {
  id: number;
  opportunity_id: number;
  name: string;
  year: number | null;
  portfolio_urls: string;
}): Promise<void> {
  let urls: string[];
  try {
    urls = JSON.parse(row.portfolio_urls);
  } catch {
    urls = [];
  }
  const blobUrls: string[] = [];
  const fileIds: string[] = [];
  const failures: { url: string; reason: string }[] = [];

  for (const url of urls) {
    try {
      const referer = new URL(url).origin + '/';
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          Referer: referer,
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Atelier/0.1',
        },
      });
      if (!res.ok) {
        failures.push({ url, reason: `HTTP ${res.status}` });
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const thumb = await sharp(buf)
        .rotate()
        .resize(1024, 1024, { fit: 'inside' })
        .jpeg({ quality: 85 })
        .toBuffer();
      const safeName = row.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const idx = blobUrls.length;
      const pathname = `recipients/${row.opportunity_id}/${safeName}_pr${row.id}/${idx}.jpg`;

      // Mirror to Vercel Blob (for dossier display + caching across runs).
      const { url: blobUrl } = await put(pathname, thumb, {
        access: 'public',
        contentType: 'image/jpeg',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      blobUrls.push(blobUrl);

      // Upload to Anthropic Files API (so the Rubric Matcher can read via
      // mount_path without bash+curl+/tmp — avoids the malware-ack derail).
      try {
        const fileId = await uploadToFilesApi(thumb, `opp${row.opportunity_id}_${safeName}_${idx}.jpg`, 'image/jpeg');
        fileIds.push(fileId);
      } catch (fileErr) {
        // Non-fatal: if Files API upload fails, Rubric falls back to URL-based bash+curl path.
        // Leave fileIds slot empty (padded to null) so positional alignment with blobUrls holds.
        console.warn(`[finalize-scout] files.upload failed for ${pathname}: ${(fileErr as Error).message}`);
        fileIds.push('');
      }
    } catch (e) {
      failures.push({ url, reason: (e as Error).message });
    }
  }

  if (failures.length > 0) {
    await getDb().execute({
      sql: `INSERT INTO run_events (run_id, agent, kind, payload_json) VALUES (NULL, 'finalize-scout', 'error', ?)`,
      args: [
        JSON.stringify({
          recipient_id: row.id,
          recipient_name: row.name,
          opportunity_id: row.opportunity_id,
          failures,
        }),
      ],
    });
    console.warn(
      `[finalize-scout] recipient ${row.name} (id=${row.id}, opp=${row.opportunity_id}): ${failures.length}/${urls.length} downloads failed`,
    );
  }

  await getDb().execute({
    sql: `UPDATE past_recipients SET portfolio_urls = ?, file_ids = ?, fetched_at = unixepoch() WHERE id = ?`,
    args: [JSON.stringify(blobUrls), JSON.stringify(fileIds), row.id],
  });
}

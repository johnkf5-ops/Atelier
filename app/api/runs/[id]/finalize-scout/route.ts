import pLimit from 'p-limit';
import { put } from '@vercel/blob';
import { waitUntil } from '@vercel/functions';
// WALKTHROUGH Note 28: sharp call moved into lib/anthropic-files.ts
// normalizeForVision helper. finalize-scout no longer imports sharp directly.
import { ensureDbReady, getDb } from '@/lib/db/client';
import { uploadToFilesApi, normalizeForVision } from '@/lib/anthropic-files';
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

    // Recipients tied to this run's opportunities that need processing.
    // Process when EITHER (a) portfolio_urls are still raw source URLs (not
    // mirrored), OR (b) blob-mirrored already but file_ids stayed empty —
    // the latter happens when a prior finalize-scout uploaded to Blob but
    // the Files-API call failed (network blip, 429, transient throw) and
    // got swallowed. Without this re-process trigger, recipients stay
    // permanently file_ids=[] and Rubric scores blind for the rest of time.
    const rows = (
      await db.execute({
        sql: `SELECT pr.id, pr.opportunity_id, pr.name, pr.year,
                     pr.portfolio_urls, pr.file_ids
              FROM past_recipients pr
              JOIN run_opportunities ro ON ro.opportunity_id = pr.opportunity_id
              WHERE ro.run_id = ?
                AND pr.portfolio_urls LIKE '[%'
                AND (
                  pr.portfolio_urls NOT LIKE '%blob.vercel-storage%'
                  OR pr.file_ids IS NULL
                  OR pr.file_ids = '[]'
                  OR pr.file_ids = ''
                )`,
        args: [runId],
      })
    ).rows as unknown as Array<{
      id: number;
      opportunity_id: number;
      name: string;
      year: number | null;
      portfolio_urls: string;
      file_ids: string | null;
    }>;

    console.log(`[finalize-scout] processing ${rows.length} recipient row(s) for run ${runId}`);

    const limit = pLimit(10);
    await Promise.all(rows.map((row) => limit(() => downloadRow(row, runId))));

    // Post-pass audit: surface a CRITICAL event if any recipient on this run
    // still has empty file_ids despite having had source URLs. This makes the
    // "Rubric will be blind" failure mode VISIBLE in the run timeline instead
    // of silently shipping a 1-of-12 dossier.
    const blindRows = (
      await db.execute({
        sql: `SELECT pr.id, pr.name, pr.opportunity_id
              FROM past_recipients pr
              JOIN run_opportunities ro ON ro.opportunity_id = pr.opportunity_id
              WHERE ro.run_id = ?
                AND pr.portfolio_urls LIKE '[%'
                AND (pr.file_ids IS NULL OR pr.file_ids = '[]' OR pr.file_ids = '')`,
        args: [runId],
      })
    ).rows;
    if (blindRows.length > 0) {
      const totalRecipients = (
        await db.execute({
          sql: `SELECT COUNT(*) as n FROM past_recipients pr
                JOIN run_opportunities ro ON ro.opportunity_id = pr.opportunity_id
                WHERE ro.run_id = ?`,
          args: [runId],
        })
      ).rows[0] as unknown as { n: number };
      console.error(
        `[finalize-scout] CRITICAL: ${blindRows.length} of ${Number(totalRecipients.n)} recipients have no file_ids — Rubric will be blind`,
      );
      await db.execute({
        sql: `INSERT INTO run_events (run_id, agent, kind, payload_json) VALUES (?, ?, ?, ?)`,
        args: [
          runId,
          'finalize-scout',
          'rubric_will_be_blind',
          JSON.stringify({
            reason: 'no recipient images uploaded to Anthropic Files API',
            blind_recipient_count: blindRows.length,
            total_recipient_count: Number(totalRecipients.n),
            blind_recipient_ids: blindRows.map(
              (r) => (r as unknown as { id: number }).id,
            ),
          }),
        ],
      });
    }

    waitUntil(
      fetch(new URL(`/api/runs/${runId}/start-rubric`, req.url), { method: 'POST' }).catch(() => {}),
    );

    return Response.json({
      downloaded_recipients: rows.length,
      blind_recipients: blindRows.length,
    });
  },
);

async function downloadRow(
  row: {
    id: number;
    opportunity_id: number;
    name: string;
    year: number | null;
    portfolio_urls: string;
    file_ids: string | null;
  },
  runId: number,
): Promise<void> {
  let urls: string[];
  try {
    urls = JSON.parse(row.portfolio_urls);
  } catch {
    urls = [];
  }
  const alreadyMirrored = urls.some((u) => u.includes('blob.vercel-storage'));

  const blobUrls: string[] = [];
  const fileIds: string[] = [];
  const failures: { url: string; reason: string }[] = [];

  for (const url of urls) {
    try {
      // Fetch bytes — for already-mirrored URLs, this is the Blob CDN
      // (always 200, no Referer dance). For raw source URLs, it's the
      // original site (may need anti-hotlink headers).
      const referer = new URL(url).origin + '/';
      const headers: Record<string, string> = alreadyMirrored
        ? {}
        : {
            Referer: referer,
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Atelier/0.1',
          };
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers,
      });
      if (!res.ok) {
        failures.push({ url, reason: `HTTP ${res.status}` });
        console.warn(
          `[finalize-scout] HTTP ${res.status} url=${url} (recipient=${row.name}, opp=${row.opportunity_id})`,
        );
        continue;
      }
      // Detect non-image responses (sites that return 200 + an HTML login page
      // for hotlink-protected URLs) before they hit Sharp + waste an upload.
      const ct = (res.headers.get('content-type') ?? '').toLowerCase();
      if (ct && !ct.startsWith('image/')) {
        failures.push({ url, reason: `non-image content-type: ${ct}` });
        console.warn(
          `[finalize-scout] non-image url=${url} ct=${ct} (recipient=${row.name}, opp=${row.opportunity_id})`,
        );
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());

      // WALKTHROUGH Note 28: route through the shared normalizeForVision
      // helper in lib/anthropic-files.ts. Single source of truth for the
      // Sharp normalize step that makes the bytes vision-ready. The same
      // bytes are then mirrored to Vercel Blob below and uploaded to the
      // Files API — both must use the normalized buffer.
      const norm = await normalizeForVision(buf, ct);
      if (norm.usedFallback) {
        console.warn(
          `[finalize-scout] sharp fallback url=${url} (recipient=${row.name}, opp=${row.opportunity_id}) — vision may fail`,
        );
      }
      const uploadBuf = norm.buf;
      const uploadCt = norm.contentType;
      const uploadExt = norm.extension;

      const safeName = row.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const idx = blobUrls.length;
      const pathname = `recipients/${row.opportunity_id}/${safeName}_pr${row.id}/${idx}.${uploadExt}`;

      // Mirror to Vercel Blob — only when not already mirrored. If
      // already mirrored, keep the existing URL as-is (re-uploading to
      // overwrite costs money and risks a transient hiccup).
      let blobUrl: string;
      if (alreadyMirrored) {
        blobUrl = url;
      } else {
        const r = await put(pathname, uploadBuf, {
          access: 'public',
          contentType: uploadCt,
          addRandomSuffix: false,
          allowOverwrite: true,
        });
        blobUrl = r.url;
      }
      blobUrls.push(blobUrl);

      // Upload to Anthropic Files API. THROW LOUDLY on failure — the
      // prior swallow-and-continue pattern is what produced the
      // file_ids=[] silent failure on prod.
      const fileId = await uploadToFilesApi(
        uploadBuf,
        `opp${row.opportunity_id}_${safeName}_${idx}.${uploadExt}`,
        uploadCt,
      );
      fileIds.push(fileId);
      console.log(
        `[finalize-scout] files.upload ok: opp=${row.opportunity_id} recipient=${row.name} idx=${idx} → ${fileId}`,
      );
    } catch (e) {
      const reason = (e as Error).message;
      failures.push({ url, reason });
      console.warn(
        `[finalize-scout] failed url=${url} reason=${reason} (recipient=${row.name}, opp=${row.opportunity_id})`,
      );
    }
  }

  if (failures.length > 0) {
    await getDb().execute({
      sql: `INSERT INTO run_events (run_id, agent, kind, payload_json) VALUES (?, 'finalize-scout', 'error', ?)`,
      args: [
        runId,
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

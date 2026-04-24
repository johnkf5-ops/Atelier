import { NextRequest } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';
import pLimit from 'p-limit';
import { createHash } from 'node:crypto';
import { ensureDbReady } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';
import {
  ingestImage,
  getPortfolioCount,
  getNextOrdinal,
  existingHashes,
  PORTFOLIO_CAP,
} from '@/lib/portfolio/ingest';
import { fetchHtml, fetchImageBytes, extractImages } from '@/lib/portfolio/scraper';

export const runtime = 'nodejs';
export const maxDuration = 300;

const Body = z.object({
  urls: z.array(z.string().url()).min(1).max(20),
});

const MIN_DIMENSION = 500;
const DOWNLOAD_CONCURRENCY = 4;

type Event =
  | { type: 'page'; url: string; found: number }
  | { type: 'page_error'; url: string; error: string }
  | { type: 'skipped'; src: string; reason: string }
  | { type: 'image'; image: { id: number; filename: string; thumb_url: string; width: number; height: number; src: string; duplicate: boolean } }
  | { type: 'image_error'; src: string; error: string }
  | { type: 'done'; total: number; new_count: number; new_ids: number[] };

function sse(event: Event): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: NextRequest) {
  await ensureDbReady();
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const userId = getCurrentUserId();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (e: Event) => controller.enqueue(enc.encode(sse(e)));

      try {
        // 1. Pre-flight: capacity + existing hash set for dedupe
        let count = await getPortfolioCount(userId);
        let nextOrd = await getNextOrdinal(userId);
        const seenHashes = await existingHashes(userId);
        const newIds: number[] = [];

        // 2. Walk pages, build deduped image candidate list
        const candidates: { src: string; context_url: string }[] = [];
        const seenSrc = new Set<string>();
        for (const pageUrl of parsed.data.urls) {
          try {
            const html = await fetchHtml(pageUrl);
            const found = extractImages(html, pageUrl);
            for (const f of found) {
              if (seenSrc.has(f.src)) continue;
              seenSrc.add(f.src);
              candidates.push(f);
            }
            send({ type: 'page', url: pageUrl, found: found.length });
          } catch (err) {
            send({ type: 'page_error', url: pageUrl, error: (err as Error).message });
          }
        }

        // 3. Download + filter + ingest, capped at portfolio capacity.
        // Reserve count + ordinal atomically (synchronous slice) before any
        // awaits, then release on any skip/error path. This prevents
        // concurrent workers from blowing past PORTFOLIO_CAP.
        const limit = pLimit(DOWNLOAD_CONCURRENCY);
        await Promise.all(
          candidates.map((c) =>
            limit(async () => {
              // Reserve atomically
              if (count >= PORTFOLIO_CAP) {
                send({ type: 'skipped', src: c.src, reason: `portfolio cap (${PORTFOLIO_CAP}) reached` });
                return;
              }
              const myOrd = nextOrd++;
              count++;
              let released = false;
              const release = () => {
                if (released) return;
                released = true;
                count--;
                // We don't reclaim ordinal — leaving a small gap is fine and avoids
                // concurrent reordering races.
              };

              try {
                let buf: Buffer;
                try {
                  buf = await fetchImageBytes(c.src);
                } catch (err) {
                  release();
                  send({ type: 'image_error', src: c.src, error: `download: ${(err as Error).message}` });
                  return;
                }

                // SHA-256 dedupe BEFORE expensive sharp work
                const hash = createHash('sha256').update(buf).digest('hex');
                if (seenHashes.has(hash)) {
                  release();
                  send({ type: 'skipped', src: c.src, reason: 'duplicate of existing image' });
                  return;
                }
                // Optimistically reserve the hash so a concurrent worker with the
                // same bytes (different URL) doesn't double-ingest.
                seenHashes.add(hash);

                try {
                  const meta = await sharp(buf).metadata();
                  const w = meta.width ?? 0;
                  const h = meta.height ?? 0;
                  if (w < MIN_DIMENSION && h < MIN_DIMENSION) {
                    seenHashes.delete(hash);
                    release();
                    send({
                      type: 'skipped',
                      src: c.src,
                      reason: `too small (${w}×${h}, need ≥${MIN_DIMENSION} on either dimension)`,
                    });
                    return;
                  }
                } catch (err) {
                  seenHashes.delete(hash);
                  release();
                  send({ type: 'image_error', src: c.src, error: `not a valid image: ${(err as Error).message}` });
                  return;
                }

                try {
                  const filename = inferFilename(c.src);
                  const r = await ingestImage(userId, { buffer: buf, filename }, myOrd);
                  if (!r.duplicate) newIds.push(r.id);
                  send({
                    type: 'image',
                    image: {
                      id: r.id,
                      filename: r.filename,
                      thumb_url: r.thumb_url,
                      width: r.width,
                      height: r.height,
                      src: c.src,
                      duplicate: r.duplicate,
                    },
                  });
                } catch (err) {
                  seenHashes.delete(hash);
                  release();
                  send({ type: 'image_error', src: c.src, error: `ingest: ${(err as Error).message}` });
                }
              } catch (err) {
                release();
                send({ type: 'image_error', src: c.src, error: `unexpected: ${(err as Error).message}` });
              }
            }),
          ),
        );

        send({ type: 'done', total: count, new_count: newIds.length, new_ids: newIds });
      } catch (err) {
        const enc2 = new TextEncoder();
        controller.enqueue(enc2.encode(sse({ type: 'page_error', url: '(internal)', error: (err as Error).message })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}

function inferFilename(src: string): string {
  try {
    const u = new URL(src);
    const last = u.pathname.split('/').filter(Boolean).pop() || 'image.jpg';
    // Decode and trim ?query
    const decoded = decodeURIComponent(last);
    return decoded.length > 80 ? decoded.slice(0, 80) : decoded;
  } catch {
    return 'image.jpg';
  }
}

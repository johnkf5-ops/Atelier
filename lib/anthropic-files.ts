import sharp from 'sharp';
import { getAnthropic } from '@/lib/anthropic';
import { withAnthropicRetry } from '@/lib/anthropic-retry';

/**
 * Upload a Buffer to the Anthropic Files API (Managed Agents beta).
 * Returns the file_id usable as a sessions.create resource:
 *   resources: [{ type: 'file', file_id, mount_path: '/workspace/...' }]
 *
 * Pre-mounting recipient + portfolio images via Files API bypasses the
 * bash+curl+/tmp+read workflow that trips Anthropic's malware-analysis
 * safety layer. Read via mount_path directly instead.
 *
 * Wrapped in withAnthropicRetry so transient 429/5xx/network failures
 * don't permanently leave a recipient with empty file_ids. Throws on
 * non-transient failure — callers MUST surface the error rather than
 * swallow it (the prior swallow pattern was the WALKTHROUGH Note 8 root
 * cause: prod recipients silently shipped with file_ids=[] for every
 * row, blinding the Rubric).
 */
export async function uploadToFilesApi(
  buf: Buffer,
  filename: string,
  contentType: string,
): Promise<string> {
  const client = getAnthropic();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = new File([new Uint8Array(buf)], filename, { type: contentType }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (await withAnthropicRetry(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.beta as any).files.upload({ file: blob }),
    { label: `files.upload(${filename})` },
  )) as { id: string };
  return String(meta.id);
}

/**
 * Slugify a string for mount_path safety — [a-z0-9-] only.
 */
export function slugForMount(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/**
 * WALKTHROUGH Note 28 (CRITICAL — vision unlock): normalize raw image bytes
 * through Sharp into a vanilla baseline JPEG that Anthropic's multimodal
 * vision pipeline reliably decodes. Single source of truth for the
 * normalize step; both finalize-scout (recipients, with a Vercel Blob mirror
 * in between) and start-rubric (portfolio, direct upload) call this.
 *
 * WHY THIS EXISTS: raw bytes served from Vercel Blob include color profiles,
 * progressive encoding, embedded metadata, or other JPEG variants that
 * Anthropic's multimodal vision pipeline cannot decode — the file is
 * recognized as JPEG but the read tool returns "Output could not be decoded
 * as text" instead of multimodal content. Diagnosed via probe scripts:
 *   - PORTFOLIO files (raw from Vercel Blob, no Sharp) → vision FAILS
 *   - RECIPIENT files (Sharp-normalized via finalize-scout) → vision SUCCEEDS
 * `sharp(buf).rotate().resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 85 })`
 * normalizes EXIF orientation, caps to 1024px on the long edge, strips
 * profiles/metadata, and re-encodes as a vanilla baseline JPEG.
 *
 * Soft-fallback on Sharp failure: rare WebP/AVIF/HEIC variants Sharp can't
 * read are passed through raw rather than blocking the upload. The fallback
 * may not be vision-ready, but it preserves the prior behavior (better
 * partial output than no upload at all). `usedFallback` is reported so
 * callers can log the degradation.
 */
export type NormalizedImage = {
  buf: Buffer;
  contentType: string;
  extension: string;
  usedFallback: boolean;
};

export async function normalizeForVision(
  rawBuf: Buffer,
  fallbackContentType = 'image/jpeg',
): Promise<NormalizedImage> {
  try {
    const buf = await sharp(rawBuf)
      .rotate()
      .resize(1024, 1024, { fit: 'inside' })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { buf, contentType: 'image/jpeg', extension: 'jpg', usedFallback: false };
  } catch {
    const ct = fallbackContentType.startsWith('image/') ? fallbackContentType : 'image/jpeg';
    const rawExt = ct.split('/')[1]?.split(';')[0] || 'jpg';
    // Normalize jpeg → jpg for filesystem-style extensions (consistent with
    // the success path's 'jpg').
    const extension = rawExt === 'jpeg' ? 'jpg' : rawExt;
    return { buf: rawBuf, contentType: ct, extension, usedFallback: true };
  }
}

/**
 * Convenience wrapper: normalize + upload in one call. Used by start-rubric
 * for portfolio uploads where there is no intermediate Vercel Blob mirror
 * step. finalize-scout calls normalizeForVision directly so it can mirror
 * the SAME normalized bytes to Vercel Blob before uploading to Files API.
 */
export async function uploadVisionReadyImage(
  rawBuf: Buffer,
  filename: string,
): Promise<string> {
  const norm = await normalizeForVision(rawBuf);
  if (norm.usedFallback) {
    console.warn(
      `[uploadVisionReadyImage] sharp fallback for ${filename} — vision may fail`,
    );
  }
  return uploadToFilesApi(norm.buf, filename, norm.contentType);
}

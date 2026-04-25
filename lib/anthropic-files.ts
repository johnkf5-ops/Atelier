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

import { getAnthropic } from '@/lib/anthropic';

/**
 * Upload a Buffer to the Anthropic Files API (Managed Agents beta).
 * Returns the file_id usable as a sessions.create resource:
 *   resources: [{ type: 'file', file_id, mount_path: '/workspace/...' }]
 *
 * Pre-mounting recipient + portfolio images via Files API bypasses the
 * bash+curl+/tmp+read workflow that trips Anthropic's malware-analysis
 * safety layer (~18/19 agent messages burned on ack reminders in our
 * §3.4 runs). Read via mount_path directly instead — no binary fetches,
 * no reminder trigger.
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
  const meta = await (client.beta as any).files.upload({ file: blob });
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

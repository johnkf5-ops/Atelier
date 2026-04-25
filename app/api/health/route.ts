import { ensureDbReady, getDb } from '@/lib/db/client';
import { hasAnthropicKey } from '@/lib/auth/api-key';
import { withApiErrorHandling } from '@/lib/api/response';
import { uploadToFilesApi } from '@/lib/anthropic-files';
import { getAnthropic } from '@/lib/anthropic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Smallest valid JPEG (1×1 white pixel). Used as the Files-API probe so we
// don't burn meaningful bytes on every health check.
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////' +
  '////////////////////////////////2wBDAf//////////////////////////////////////////////////////////' +
  '/////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAA' +
  'AAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpwH//Z';

export const GET = withApiErrorHandling(async () => {
  await ensureDbReady();
  const status: Record<string, unknown> = {
    db: false,
    env: hasAnthropicKey(),
    blob_token: !!process.env.BLOB_READ_WRITE_TOKEN,
    turso_url: !!process.env.TURSO_DATABASE_URL,
    anthropic_files_api: 'unknown',
  };
  try {
    const db = getDb();
    const r = await db.execute('SELECT 1 as ok');
    status.db = r.rows[0]?.ok === 1;
  } catch (err) {
    status.db_error = (err as Error).message;
  }

  // Files-API probe: upload a 1-byte JPEG and immediately delete it. This
  // proves the prod ANTHROPIC_API_KEY has Files-API access — the exact
  // capability that WALKTHROUGH Note 8 depends on for the Rubric to score.
  // If this returns "denied" or an error, every run will ship Rubric-blind.
  if (hasAnthropicKey()) {
    try {
      const buf = Buffer.from(TINY_JPEG_BASE64, 'base64');
      const fileId = await uploadToFilesApi(buf, 'health-probe.jpg', 'image/jpeg');
      status.anthropic_files_api = `ok (uploaded ${fileId})`;
      // Best-effort cleanup so we don't leak probe files.
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (getAnthropic().beta as any).files.delete(fileId);
      } catch {
        /* not fatal — Anthropic may garbage-collect tiny files */
      }
    } catch (err) {
      const e = err as { status?: number; message?: string };
      status.anthropic_files_api = `FAILED${e.status ? ` (HTTP ${e.status})` : ''}: ${e.message ?? String(err)}`;
    }
  } else {
    status.anthropic_files_api = 'skipped (no api key)';
  }

  return Response.json(status);
});

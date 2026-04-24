import { ensureDbReady, getDb } from '@/lib/db/client';
import { hasAnthropicKey } from '@/lib/auth/api-key';
import { withApiErrorHandling } from '@/lib/api/response';

export const dynamic = 'force-dynamic';

export const GET = withApiErrorHandling(async () => {
  await ensureDbReady();
  const status: Record<string, unknown> = {
    db: false,
    env: hasAnthropicKey(),
    blob_token: !!process.env.BLOB_READ_WRITE_TOKEN,
    turso_url: !!process.env.TURSO_DATABASE_URL,
  };
  try {
    const db = getDb();
    const r = await db.execute('SELECT 1 as ok');
    status.db = r.rows[0]?.ok === 1;
  } catch (err) {
    status.db_error = (err as Error).message;
  }
  return Response.json(status);
});

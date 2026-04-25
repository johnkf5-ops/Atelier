import { NextRequest } from 'next/server';
import { ensureDbReady, getDb } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';
import { RunConfig, defaultWindow } from '@/lib/schemas/run';
import { startScoutSession } from '@/lib/agents/opportunity-scout';
import { loadLatestAkb } from '@/lib/akb/persistence';
import type { StyleFingerprint } from '@/lib/schemas/style-fingerprint';
import { withApiErrorHandling } from '@/lib/api/response';
import {
  countRecentRunsForIp,
  isRateLimited,
  recordRunStart,
} from '@/lib/db/queries/rate-limits';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Pull the requesting IP. On Vercel the trustworthy header is
 * x-forwarded-for (left-most entry). Falls back to x-real-ip and finally
 * "unknown" so a misconfigured deploy still rate-limits per device.
 */
function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim() || 'unknown';
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim() || 'unknown';
  return 'unknown';
}

export const POST = withApiErrorHandling(async (req: NextRequest) => {
  await ensureDbReady();
  const bodyRaw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const body: Record<string, unknown> = {
    ...defaultWindow(),
    ...bodyRaw,
  };
  const parsed = RunConfig.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const config = parsed.data;
  const userId = getCurrentUserId();
  const db = getDb();

  // WALKTHROUGH Note 16: per-IP rate limit on the public demo. Skip locally
  // when the dev override flag is set so John can iterate without bumping
  // his own gate.
  const ip = getClientIp(req);
  if (process.env.ATELIER_BYPASS_RATE_LIMIT !== 'true') {
    const recent = await countRecentRunsForIp(ip);
    if (isRateLimited(recent)) {
      return Response.json(
        {
          error:
            'Rate limited — please try again tomorrow, or fork the repo to run on your own API key.',
        },
        { status: 429 },
      );
    }
  }

  // Require a valid AKB version + style_fingerprint version to anchor the run
  const { id: akbId, version: akbVersion } = await loadLatestAkb(userId);
  if (akbVersion === 0 || akbId === null) {
    return Response.json({ error: 'no Knowledge Base yet — complete onboarding first' }, { status: 400 });
  }
  const fpRow = await db.execute({
    sql: `SELECT id, json FROM style_fingerprints WHERE user_id = ? ORDER BY version DESC LIMIT 1`,
    args: [userId],
  });
  if (fpRow.rows.length === 0) {
    return Response.json({ error: 'no style fingerprint yet — analyse your portfolio first' }, { status: 400 });
  }
  const styleFpRow = fpRow.rows[0] as unknown as { id: number; json: string };
  const styleFpId = Number(styleFpRow.id);
  const fingerprint = JSON.parse(styleFpRow.json) as StyleFingerprint;

  const runInsert = await db.execute({
    sql: `INSERT INTO runs (user_id, akb_version_id, style_fingerprint_id, status, config_json)
          VALUES (?, ?, ?, 'queued', ?) RETURNING id`,
    args: [userId, akbId, styleFpId, JSON.stringify(config)],
  });
  const runId = Number((runInsert.rows[0] as unknown as { id: number }).id);

  // Record the rate-limit row only AFTER the runs row exists, so a
  // request that fails earlier (validation, missing fingerprint) doesn't
  // count against the IP.
  await recordRunStart(ip, runId);

  const { akb } = await loadLatestAkb(userId);
  const sessionId = await startScoutSession(runId, akb, fingerprint, config);
  return Response.json({ run_id: runId, session_id: sessionId, phase: 'scout' });
});

/**
 * Recovery for WALKTHROUGH Note 8: re-run finalize-scout against an existing
 * run's recipients to populate `past_recipients.file_ids` when prior runs
 * shipped them empty. After the fix, this re-pass downloads bytes from the
 * already-mirrored Vercel Blob URLs (cheap, always 200), uploads to
 * Anthropic Files API (now retry-wrapped + fail-loud), and writes the
 * file_ids back. Then you can re-trigger /api/runs/[id]/start-rubric and
 * the Rubric will actually have a cohort to score against.
 *
 *   pnpm tsx scripts/recover-finalize-scout.ts <run_id>
 *
 * No-op if every recipient already has populated file_ids.
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

async function main() {
  const runId = Number(process.argv[2]);
  if (!Number.isInteger(runId)) {
    console.error('Usage: pnpm tsx scripts/recover-finalize-scout.ts <run_id>');
    process.exit(1);
  }

  const baseUrl = process.env.RECOVER_BASE_URL ?? 'http://localhost:3001';
  const url = `${baseUrl}/api/runs/${runId}/finalize-scout`;
  console.log(`POST ${url}`);

  const res = await fetch(url, { method: 'POST' });
  const text = await res.text();
  console.log(`status=${res.status}`);
  console.log(text);
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

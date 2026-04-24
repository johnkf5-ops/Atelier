/**
 * Create a new run that reuses run_opportunities + past_recipients from an
 * existing run, then kick off a fresh Rubric session with the updated
 * system prompt (safety-reminder preempt). Doesn't re-run Scout.
 *
 *   pnpm tsx scripts/rerun-rubric.ts <source_run_id>
 */

import { config as dotenvConfig } from 'dotenv';
import { createClient } from '@libsql/client';

dotenvConfig({ path: '.env.local' });

async function main() {
  const sourceRunId = Number(process.argv[2] ?? '1');
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  const sourceRow = (
    await db.execute({
      sql: 'SELECT user_id, akb_version_id, style_fingerprint_id, config_json FROM runs WHERE id = ?',
      args: [sourceRunId],
    })
  ).rows[0] as unknown as {
    user_id: number;
    akb_version_id: number;
    style_fingerprint_id: number;
    config_json: string;
  };
  if (!sourceRow) throw new Error(`source run ${sourceRunId} not found`);

  // Create new run anchored at rubric_running (skipping Scout entirely)
  const runIns = await db.execute({
    sql: `INSERT INTO runs (user_id, akb_version_id, style_fingerprint_id, status, config_json)
          VALUES (?, ?, ?, 'rubric_running', ?) RETURNING id`,
    args: [sourceRow.user_id, sourceRow.akb_version_id, sourceRow.style_fingerprint_id, sourceRow.config_json],
  });
  const newRunId = Number((runIns.rows[0] as unknown as { id: number }).id);
  console.log(`new run_id=${newRunId}`);

  // Copy run_opportunities — only ones with at least one recipient that has
  // Blob-mirrored portfolio_urls. Those are the opps Rubric can actually
  // vision over. Skip the no-recipient ones (Scout didn't gather them last
  // pass — they'd force Rubric to score metadata-only, which is weak).
  await db.execute({
    sql: `INSERT INTO run_opportunities (run_id, opportunity_id)
          SELECT DISTINCT ?, ro.opportunity_id
          FROM run_opportunities ro
          JOIN past_recipients pr ON pr.opportunity_id = ro.opportunity_id
          WHERE ro.run_id = ?
            AND pr.portfolio_urls LIKE '%blob.vercel-storage%'`,
    args: [newRunId, sourceRunId],
  });
  const copied = (
    await db.execute({
      sql: `SELECT o.name FROM opportunities o
            JOIN run_opportunities ro ON ro.opportunity_id = o.id
            WHERE ro.run_id = ? ORDER BY o.name`,
      args: [newRunId],
    })
  ).rows as unknown as Array<{ name: string }>;
  console.log(`copied ${copied.length} run_opportunities (with recipients) from run ${sourceRunId}:`);
  for (const r of copied) console.log(`  - ${r.name}`);

  const base = `http://localhost:${process.env.DEV_PORT ?? '3002'}`;
  console.log(`kicking off start-rubric at ${base}/api/runs/${newRunId}/start-rubric`);
  const res = await fetch(`${base}/api/runs/${newRunId}/start-rubric`, { method: 'POST' });
  const j = await res.json();
  console.log('start-rubric response:', j);
  console.log(`\npoll: curl ${base}/api/runs/${newRunId}/events`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

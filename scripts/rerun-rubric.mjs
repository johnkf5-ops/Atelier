/**
 * Re-trigger ONLY the Rubric phase against an existing run's opportunities
 * + past_recipients. Cheaper than a full pipeline rerun. Use after Note 27
 * (Files API mount fix) ships to validate that Rubric now actually sees
 * cohort images.
 *
 * 1. Wipes run_matches for the target run (Rubric needs a clean slate).
 * 2. Wipes drafted_packages + dossier (Drafter wouldn't be valid against
 *    new matches anyway; let it regenerate later).
 * 3. POSTs /api/runs/<id>/start-rubric to fire a fresh Rubric session.
 * 4. Polls run state until Rubric phase completes.
 * 5. Reports the new scoring slate.
 */
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
const env = readFileSync('.env.local', 'utf-8');
const parsed = Object.fromEntries(
  env.split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i+1).replace(/^"(.*)"$/, '$1')];
  })
);
const db = createClient({ url: parsed.TURSO_DATABASE_URL, authToken: parsed.TURSO_AUTH_TOKEN });

const PROD = 'https://atelier-hazel.vercel.app';

async function main() {
  const runId = Number(process.argv[2]);
  if (!runId) {
    console.error('usage: node scripts/rerun-rubric.mjs <runId>');
    process.exit(1);
  }

  console.log(`Wiping run_matches + drafted_packages + dossier for run ${runId}...`);
  await db.execute({ sql: `DELETE FROM drafted_packages WHERE run_match_id IN (SELECT id FROM run_matches WHERE run_id = ?)`, args: [runId] });
  await db.execute({ sql: `DELETE FROM run_matches WHERE run_id = ?`, args: [runId] });
  await db.execute({ sql: `DELETE FROM dossiers WHERE run_id = ?`, args: [runId] });
  // Reset the run status so start-rubric will accept it
  await db.execute({ sql: `UPDATE runs SET status = 'finalizing_scout', error = NULL WHERE id = ?`, args: [runId] });

  const before = (await db.execute({ sql: `SELECT COUNT(*) as n FROM past_recipients pr JOIN run_opportunities ro ON ro.opportunity_id = pr.opportunity_id WHERE ro.run_id = ? AND pr.file_ids IS NOT NULL AND pr.file_ids != '[]'`, args: [runId] })).rows[0].n;
  console.log(`  past_recipients with file_ids for this run: ${before}`);

  console.log(`\nFiring POST /api/runs/${runId}/start-rubric...`);
  const res = await fetch(`${PROD}/api/runs/${runId}/start-rubric`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const body = await res.text();
  console.log(`  HTTP ${res.status}: ${body.slice(0, 200)}`);

  if (!res.ok) {
    console.error('Start-rubric failed; aborting.');
    process.exit(1);
  }

  console.log(`\nPolling run state (every 20s, up to 30 min)...`);
  const start = Date.now();
  while (Date.now() - start < 1800_000) {
    await new Promise(r => setTimeout(r, 20000));
    const r = (await db.execute({ sql: `SELECT status FROM runs WHERE id = ?`, args: [runId] })).rows[0];
    const matches = (await db.execute({ sql: `SELECT COUNT(*) as n, SUM(CASE WHEN included = 1 THEN 1 ELSE 0 END) as inc FROM run_matches WHERE run_id = ?`, args: [runId] })).rows[0];
    const elapsed = Math.floor((Date.now() - start) / 1000);
    console.log(`  ${elapsed}s | status=${r.status} | scored=${matches.n} | included=${matches.inc ?? 0}`);
    if (r.status === 'rubric_complete' || r.status === 'finalizing' || r.status === 'complete' || r.status === 'error') {
      console.log(`\nRubric phase done. Final status: ${r.status}`);
      break;
    }
  }

  // Report the slate
  const final = (await db.execute({ sql: `SELECT rm.fit_score, rm.composite_score, rm.included, rm.reasoning, o.name FROM run_matches rm JOIN opportunities o ON o.id = rm.opportunity_id WHERE rm.run_id = ? ORDER BY rm.fit_score DESC`, args: [runId] })).rows;
  console.log(`\n=== Final Rubric slate (${final.length} matches) ===`);
  for (const m of final) {
    console.log(`  ${m.included ? '[IN ]' : '[OUT]'} fit=${m.fit_score} ${m.name.slice(0, 55)}`);
  }
  if (final[0]) {
    console.log(`\nFIRST REASONING (${final[0].name}):`);
    console.log(final[0].reasoning?.slice(0, 600) ?? '(empty)');
  }
}

main().catch(e => { console.error(e); process.exit(1); });

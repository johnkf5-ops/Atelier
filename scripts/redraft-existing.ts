/**
 * Re-trigger draftPackages() against an existing run's data using the new
 * Drafter code (Notes 19+20+21+22+23+24+25). Cheaper than a full pipeline
 * re-run — uses the existing AKB, fingerprint, matches, recipient images,
 * and rubric reasoning. Only spends Drafter tokens.
 *
 * Wipes drafted_packages + dossiers.master_cv for the run first so we get
 * fresh outputs to audit.
 */
import { draftPackages } from '@/lib/agents/package-drafter';
import { generateMasterCv } from '@/lib/agents/package-drafter';
import { getDb } from '@/lib/db/client';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import type { StyleFingerprint } from '@/lib/schemas/style-fingerprint';

async function main() {
  const runId = Number(process.argv[2]);
  if (!runId) {
    console.error('usage: pnpm tsx scripts/redraft-existing.ts <runId>');
    process.exit(1);
  }

  const db = getDb();

  // Load AKB + fingerprint linked to this run
  const runRow = (await db.execute({
    sql: `SELECT user_id, akb_version_id, style_fingerprint_id FROM runs WHERE id = ?`,
    args: [runId],
  })).rows[0] as unknown as { user_id: number; akb_version_id: number; style_fingerprint_id: number };

  if (!runRow) {
    console.error(`run ${runId} not found`);
    process.exit(1);
  }

  const akbJson = ((await db.execute({
    sql: `SELECT json FROM akb_versions WHERE id = ?`,
    args: [runRow.akb_version_id],
  })).rows[0] as unknown as { json: string }).json;
  const akb: ArtistKnowledgeBase = JSON.parse(akbJson);

  const fpJson = ((await db.execute({
    sql: `SELECT json FROM style_fingerprints WHERE id = ?`,
    args: [runRow.style_fingerprint_id],
  })).rows[0] as unknown as { json: string }).json;
  const fingerprint: StyleFingerprint = JSON.parse(fpJson);

  // Wipe existing drafted_packages for this run
  const wiped = await db.execute({
    sql: `DELETE FROM drafted_packages
          WHERE run_match_id IN (SELECT id FROM run_matches WHERE run_id = ?)`,
    args: [runId],
  });
  console.log(`Wiped ${wiped.rowsAffected} existing drafted_packages.`);

  // Wipe existing master_cv (if column exists)
  try {
    await db.execute({
      sql: `UPDATE dossiers SET master_cv = NULL WHERE run_id = ?`,
      args: [runId],
    });
    console.log(`Cleared master_cv on dossiers row.`);
  } catch (e) {
    console.warn(`(could not clear master_cv: ${(e as Error).message})`);
  }

  // Regenerate master CV
  console.log(`\nGenerating master CV...`);
  const masterCv = await generateMasterCv(akb, fingerprint);
  await db.execute({
    sql: `UPDATE dossiers SET master_cv = ? WHERE run_id = ?`,
    args: [masterCv, runId],
  });
  console.log(`Master CV: ${masterCv.split(/\s+/).length} words. First line: "${masterCv.split('\n')[0]}".`);

  // Re-trigger draftPackages — produces statement / proposal / cover_letter
  // / sample rationales for every included match
  console.log(`\nRe-drafting per-opp packages for run ${runId}...`);
  await draftPackages(runId, akb, runRow.user_id);

  // Report what was generated
  const result = (await db.execute({
    sql: `SELECT dp.id, o.name,
                 length(dp.artist_statement) as len_statement,
                 length(dp.project_proposal) as len_proposal,
                 length(dp.cv_formatted) as len_cv_trim_note,
                 length(dp.cover_letter) as len_cover,
                 length(dp.work_sample_selection_json) as len_samples
          FROM drafted_packages dp
          JOIN run_matches rm ON rm.id = dp.run_match_id
          JOIN opportunities o ON o.id = rm.opportunity_id
          WHERE rm.run_id = ? ORDER BY dp.id`,
    args: [runId],
  })).rows;

  console.log(`\n=== Drafted ${result.length} packages ===`);
  for (const row of result) {
    console.log(
      `  ${(row.name as string).slice(0, 60)}: stmt=${row.len_statement} prop=${row.len_proposal} ` +
      `cover=${row.len_cover} cv-trim=${row.len_cv_trim_note ?? 'null'} samples=${row.len_samples}`,
    );
  }
  console.log(`\nDone. Inspect with scripts/read-statements.mjs / read-proposals.mjs / etc.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

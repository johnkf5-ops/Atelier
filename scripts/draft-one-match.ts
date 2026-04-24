/**
 * §4.1 checkpoint: draft one match end-to-end and dump the four materials.
 *   pnpm tsx scripts/draft-one-match.ts [runId] [matchId]
 * With no args, picks the highest-scored included=1 match from any run.
 */

import { config as dotenvConfig } from 'dotenv';
import { createClient } from '@libsql/client';
import {
  draftPackageForMatch,
  type MatchRow,
} from '../lib/agents/package-drafter';
import type { ArtistKnowledgeBase } from '../lib/schemas/akb';
import type { StyleFingerprint } from '../lib/schemas/style-fingerprint';

dotenvConfig({ path: '.env.local' });

async function main() {
  const runIdArg = process.argv[2];
  const matchIdArg = process.argv[3];
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  const where = matchIdArg
    ? 'rm.id = ?'
    : runIdArg
      ? 'rm.run_id = ? AND rm.included = 1'
      : 'rm.included = 1';
  const whereArgs = matchIdArg ? [Number(matchIdArg)] : runIdArg ? [Number(runIdArg)] : [];

  const matchRow = (
    await db.execute({
      sql: `SELECT rm.id, rm.run_id, rm.opportunity_id, rm.fit_score, rm.composite_score,
                   rm.reasoning, rm.supporting_image_ids, o.name as opp_name, o.raw_json,
                   r.user_id, r.akb_version_id, r.style_fingerprint_id
            FROM run_matches rm
            JOIN opportunities o ON o.id = rm.opportunity_id
            JOIN runs r ON r.id = rm.run_id
            WHERE ${where}
            ORDER BY rm.fit_score DESC
            LIMIT 1`,
      args: whereArgs,
    })
  ).rows[0] as unknown as
    | {
        id: number;
        run_id: number;
        opportunity_id: number;
        fit_score: number;
        composite_score: number | null;
        reasoning: string;
        supporting_image_ids: string | null;
        opp_name: string;
        raw_json: string;
        user_id: number;
        akb_version_id: number;
        style_fingerprint_id: number;
      }
    | undefined;
  if (!matchRow) throw new Error('no match found');
  console.log(`matched run=${matchRow.run_id} id=${matchRow.id} fit=${matchRow.fit_score} "${matchRow.opp_name}"`);

  const akbRow = (
    await db.execute({
      sql: 'SELECT json FROM akb_versions WHERE id = ?',
      args: [matchRow.akb_version_id],
    })
  ).rows[0] as unknown as { json: string };
  const akb = JSON.parse(akbRow.json) as ArtistKnowledgeBase;

  const fpRow = (
    await db.execute({
      sql: 'SELECT json FROM style_fingerprints WHERE id = ?',
      args: [matchRow.style_fingerprint_id],
    })
  ).rows[0] as unknown as { json: string };
  const fingerprint = JSON.parse(fpRow.json) as StyleFingerprint;

  const portfolio = (
    await db.execute({
      sql: `SELECT id, thumb_url, filename, exif_json FROM portfolio_images WHERE user_id = ? ORDER BY ordinal ASC`,
      args: [matchRow.user_id],
    })
  ).rows as unknown as Array<{
    id: number;
    thumb_url: string;
    filename: string;
    exif_json: string | null;
  }>;

  // Clear any prior drafted_packages for this match so we re-run clean.
  await db.execute({
    sql: 'DELETE FROM drafted_packages WHERE run_match_id = ?',
    args: [matchRow.id],
  });

  const t0 = Date.now();
  const row: MatchRow = {
    id: matchRow.id,
    opportunity_id: matchRow.opportunity_id,
    fit_score: matchRow.fit_score,
    composite_score: matchRow.composite_score,
    reasoning: matchRow.reasoning,
    supporting_image_ids: matchRow.supporting_image_ids,
    raw_json: matchRow.raw_json,
  };
  await draftPackageForMatch(row, akb, fingerprint, portfolio);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`drafted in ${elapsed}s\n`);

  const dp = (
    await db.execute({
      sql: `SELECT artist_statement, project_proposal, cv_formatted, cover_letter, work_sample_selection_json
            FROM drafted_packages WHERE run_match_id = ?`,
      args: [matchRow.id],
    })
  ).rows[0] as unknown as {
    artist_statement: string;
    project_proposal: string;
    cv_formatted: string;
    cover_letter: string;
    work_sample_selection_json: string;
  };

  const samples = JSON.parse(dp.work_sample_selection_json) as Array<{
    portfolio_image_id: number;
    rationale: string;
  }>;
  console.log(`--- WORK SAMPLES (${samples.length}) ---`);
  for (const s of samples) console.log(` #${s.portfolio_image_id}  ${s.rationale}`);

  console.log('\n=== ARTIST STATEMENT ===');
  console.log(dp.artist_statement);
  console.log('\n=== PROJECT PROPOSAL ===');
  console.log(dp.project_proposal);
  console.log('\n=== CV ===');
  console.log(dp.cv_formatted);
  console.log('\n=== COVER LETTER ===');
  console.log(dp.cover_letter);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

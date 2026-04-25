/**
 * Capture the current Turso DB state into local fixture files. Run this once
 * the local DB is in a known-good state — portfolio uploaded + Style Analyst
 * + Knowledge Base built — and the resulting fixtures let `pnpm seed:demo`
 * restore that state in ~30s instead of 15 minutes of re-onboarding.
 *
 *   pnpm seed:export
 *
 * Outputs (under `fixtures/`):
 *   - portfolio/<ordinal>__<filename>.jpg  one file per portfolio image
 *   - portfolio.manifest.json              {filename, original_blob_url, sha256, ordinal}
 *   - akb.json                             latest akb_versions row's .json
 *   - style-fingerprint.json               latest style_fingerprints row's .json
 *   - extractor-turns.jsonl                interview transcript (one JSON per line)
 *
 * Photos are gitignored under fixtures/portfolio/* — never commit copyrighted
 * work. The other fixture files are fine to commit if anonymised.
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FIXTURES_DIR = join(process.cwd(), 'fixtures');
const PORTFOLIO_DIR = join(FIXTURES_DIR, 'portfolio');

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.error('TURSO_DATABASE_URL not set.');
    process.exit(1);
  }
  const host = new URL(url.replace(/^libsql:/, 'https:')).host;
  console.log(`[seed:export] reading from ${host}`);

  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const userId = 1;

  await mkdir(PORTFOLIO_DIR, { recursive: true });

  // 1. Portfolio
  const imgs = (
    await db.execute({
      sql: `SELECT id, filename, blob_url, ordinal FROM portfolio_images
            WHERE user_id = ? ORDER BY ordinal ASC`,
      args: [userId],
    })
  ).rows as unknown as Array<{ id: number; filename: string; blob_url: string; ordinal: number }>;

  if (imgs.length === 0) {
    console.warn('[seed:export] no portfolio images found — skipping portfolio fixtures');
  }

  const manifest: Array<{
    ordinal: number;
    filename: string;
    fixture_path: string;
    original_blob_url: string;
    file_size: number;
    sha256: string;
  }> = [];

  for (const img of imgs) {
    const res = await fetch(img.blob_url);
    if (!res.ok) {
      console.warn(`[seed:export] skip ${img.filename}: HTTP ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const safeName = img.filename.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 80);
    const fixturePath = `portfolio/${String(img.ordinal).padStart(3, '0')}__${safeName}`;
    await writeFile(join(FIXTURES_DIR, fixturePath), buf);
    manifest.push({
      ordinal: img.ordinal,
      filename: img.filename,
      fixture_path: fixturePath,
      original_blob_url: img.blob_url,
      file_size: buf.length,
      sha256,
    });
    console.log(`  ${fixturePath} (${(buf.length / 1024).toFixed(0)}KB)`);
  }
  await writeFile(
    join(FIXTURES_DIR, 'portfolio.manifest.json'),
    JSON.stringify(manifest, null, 2),
  );

  // 2. AKB
  const akbRow = (
    await db.execute({
      sql: `SELECT version, json FROM akb_versions WHERE user_id = ? ORDER BY version DESC LIMIT 1`,
      args: [userId],
    })
  ).rows[0] as unknown as { version: number; json: string } | undefined;
  if (akbRow) {
    await writeFile(
      join(FIXTURES_DIR, 'akb.json'),
      JSON.stringify({ version: akbRow.version, akb: JSON.parse(akbRow.json) }, null, 2),
    );
    console.log(`  akb.json (v${akbRow.version})`);
  } else {
    console.warn('[seed:export] no AKB found — skipping');
  }

  // 3. Style fingerprint
  const fpRow = (
    await db.execute({
      sql: `SELECT version, json FROM style_fingerprints WHERE user_id = ? ORDER BY version DESC LIMIT 1`,
      args: [userId],
    })
  ).rows[0] as unknown as { version: number; json: string } | undefined;
  if (fpRow) {
    await writeFile(
      join(FIXTURES_DIR, 'style-fingerprint.json'),
      JSON.stringify({ version: fpRow.version, fingerprint: JSON.parse(fpRow.json) }, null, 2),
    );
    console.log(`  style-fingerprint.json (v${fpRow.version})`);
  } else {
    console.warn('[seed:export] no fingerprint found — skipping');
  }

  // 4. Extractor turns (optional — for completeness)
  const turns = (
    await db.execute({
      sql: `SELECT turn_index, role, content, akb_field_targeted, akb_patch_json
            FROM extractor_turns WHERE user_id = ? ORDER BY turn_index ASC`,
      args: [userId],
    })
  ).rows as unknown as Array<{
    turn_index: number;
    role: string;
    content: string;
    akb_field_targeted: string | null;
    akb_patch_json: string | null;
  }>;
  if (turns.length > 0) {
    const lines = turns.map((t) => JSON.stringify(t)).join('\n');
    await writeFile(join(FIXTURES_DIR, 'extractor-turns.jsonl'), lines + '\n');
    console.log(`  extractor-turns.jsonl (${turns.length} turns)`);
  }

  console.log(
    `\n[seed:export] DONE — exported ${manifest.length} portfolio images, AKB v${
      akbRow?.version ?? '—'
    }, fingerprint v${fpRow?.version ?? '—'}, ${turns.length} interview turns.`,
  );
  console.log('Run `pnpm seed:demo` to restore this state into a fresh DB.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

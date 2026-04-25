/**
 * Restore the fixture state captured by `pnpm seed:export` into a clean DB.
 * Drops every table, re-applies schema, seeds users(id=1), uploads each
 * fixture portfolio image to Vercel Blob, inserts portfolio_images rows,
 * inserts the AKB version + style fingerprint.
 *
 *   pnpm seed:demo               # local (uses TURSO_DATABASE_URL from .env.local)
 *   pnpm seed:demo --target prod # prod — requires ATELIER_IS_RESETTABLE_PROD=true
 *                                # AND a typed-host confirmation
 *
 * After this exits successfully, /runs/new shows the seeded portfolio +
 * fingerprint + KB and the Start Run button is enabled. Skips the 15-minute
 * onboarding tax — every debug iteration on the run/Rubric/Drafter loop
 * starts from a known good state.
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

import { createClient } from '@libsql/client';
import { put } from '@vercel/blob';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createHash } from 'node:crypto';

const FIXTURES_DIR = join(process.cwd(), 'fixtures');

interface PortfolioFixture {
  ordinal: number;
  filename: string;
  fixture_path: string;
  original_blob_url: string;
  file_size: number;
  sha256: string;
}

async function main() {
  const target = process.argv.includes('--target')
    ? process.argv[process.argv.indexOf('--target') + 1]
    : 'local';

  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.error('TURSO_DATABASE_URL not set.');
    process.exit(1);
  }
  const host = new URL(url.replace(/^libsql:/, 'https:')).host;

  if (target === 'prod') {
    if (process.env.ATELIER_IS_RESETTABLE_PROD !== 'true') {
      console.error('Refusing to seed prod: set ATELIER_IS_RESETTABLE_PROD=true in env first.');
      process.exit(1);
    }
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(
      `\nABOUT TO RESET + SEED PROD (host: ${host})\nType the host name to confirm: `,
    );
    rl.close();
    if (answer.trim() !== host) {
      console.error('Host mismatch — aborting.');
      process.exit(1);
    }
  } else if (target !== 'local') {
    console.error(`Unknown target "${target}" — must be local or prod.`);
    process.exit(1);
  }

  console.log(`[seed:demo] target=${target} host=${host}`);

  // 1. Read fixtures
  const manifestPath = join(FIXTURES_DIR, 'portfolio.manifest.json');
  let manifest: PortfolioFixture[];
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as PortfolioFixture[];
  } catch {
    console.error(`No fixtures found at ${manifestPath}.`);
    console.error('Run `pnpm seed:export` first against a known-good local state.');
    process.exit(1);
  }
  let akbFixture: { version: number; akb: Record<string, unknown> } | null = null;
  try {
    akbFixture = JSON.parse(await readFile(join(FIXTURES_DIR, 'akb.json'), 'utf-8'));
  } catch {
    console.warn('[seed:demo] no akb.json fixture — KB will be empty after seed');
  }
  let fpFixture: { version: number; fingerprint: Record<string, unknown> } | null = null;
  try {
    fpFixture = JSON.parse(await readFile(join(FIXTURES_DIR, 'style-fingerprint.json'), 'utf-8'));
  } catch {
    console.warn('[seed:demo] no style-fingerprint.json fixture — fingerprint will be missing after seed');
  }

  // 2. Reset target DB via the shared script's logic — apply schema directly here
  // so we don't need to spawn a child process.
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

  const tables = (
    await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    )
  ).rows.map((r) => String((r as unknown as { name: string }).name));
  await db.execute('PRAGMA foreign_keys = OFF');
  for (const t of tables) {
    await db.execute(`DROP TABLE IF EXISTS ${t}`);
  }
  await db.execute('PRAGMA foreign_keys = ON');

  const schemaSql = await readFile(join(process.cwd(), 'lib', 'db', 'schema.sql'), 'utf-8');
  for (const stmt of splitStatements(schemaSql)) {
    await db.execute(stmt);
  }

  // 3. Seed default user
  await db.execute({
    sql: 'INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)',
    args: [1, 'Default User'],
  });

  // 4. Upload portfolio fixtures to Vercel Blob and insert rows
  const userId = 1;
  let uploaded = 0;
  for (const item of manifest) {
    const buf = await readFile(join(FIXTURES_DIR, item.fixture_path));
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const pathname = `originals/${sha256}.jpg`;
    const thumbPath = `thumbs/${sha256}.jpg`;

    const orig = await put(pathname, buf, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    // Reuse the same buffer as the thumb — the seed pipeline doesn't need a
    // 1024px resize because we're skipping Style Analyst's input prep.
    const thumb = await put(thumbPath, buf, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    await db.execute({
      sql: `INSERT INTO portfolio_images
            (user_id, filename, blob_pathname, thumb_pathname, blob_url, thumb_url,
             width, height, ordinal)
            VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      args: [userId, item.filename, orig.pathname, thumb.pathname, orig.url, thumb.url, item.ordinal],
    });
    uploaded += 1;
  }
  console.log(`[seed:demo] uploaded ${uploaded} portfolio image${uploaded === 1 ? '' : 's'}`);

  // 5. Style fingerprint
  if (fpFixture) {
    await db.execute({
      sql: `INSERT INTO style_fingerprints (user_id, version, json) VALUES (?, ?, ?)`,
      args: [userId, fpFixture.version, JSON.stringify(fpFixture.fingerprint)],
    });
    console.log(`[seed:demo] inserted style_fingerprint v${fpFixture.version}`);
  }

  // 6. AKB
  if (akbFixture) {
    await db.execute({
      sql: `INSERT INTO akb_versions (user_id, version, json, source) VALUES (?, ?, ?, 'merge')`,
      args: [userId, akbFixture.version, JSON.stringify(akbFixture.akb)],
    });
    console.log(`[seed:demo] inserted akb_version v${akbFixture.version}`);
  }

  // 7. Optional extractor turns
  try {
    const turnsRaw = await readFile(join(FIXTURES_DIR, 'extractor-turns.jsonl'), 'utf-8');
    const turns = turnsRaw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    for (const t of turns) {
      await db.execute({
        sql: `INSERT INTO extractor_turns (user_id, turn_index, role, content, akb_field_targeted, akb_patch_json)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          userId,
          t.turn_index,
          t.role,
          t.content,
          t.akb_field_targeted ?? null,
          t.akb_patch_json ?? null,
        ],
      });
    }
    console.log(`[seed:demo] inserted ${turns.length} interview turn(s)`);
  } catch {
    /* extractor-turns.jsonl is optional */
  }

  // 8. Verify
  const checks = {
    portfolio: Number(
      ((await db.execute(`SELECT COUNT(*) as n FROM portfolio_images WHERE user_id = 1`)).rows[0] as unknown as
        | { n: number }
        | undefined)?.n ?? 0,
    ),
    fingerprint: Number(
      ((await db.execute(`SELECT COUNT(*) as n FROM style_fingerprints WHERE user_id = 1`)).rows[0] as unknown as
        | { n: number }
        | undefined)?.n ?? 0,
    ),
    akb: Number(
      ((await db.execute(`SELECT COUNT(*) as n FROM akb_versions WHERE user_id = 1`)).rows[0] as unknown as
        | { n: number }
        | undefined)?.n ?? 0,
    ),
  };
  if (checks.portfolio !== manifest.length) {
    console.error(
      `[seed:demo] FAILED — expected ${manifest.length} portfolio rows, got ${checks.portfolio}`,
    );
    process.exit(1);
  }
  console.log(
    `[seed:demo] DONE — ${checks.portfolio} portfolio images, ${checks.fingerprint} fingerprint, ${checks.akb} AKB.`,
  );
  console.log('Visit /runs/new to start a run.');
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => s.length > 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

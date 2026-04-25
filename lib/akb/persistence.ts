import { getDb } from '@/lib/db/client';
import { ArtistKnowledgeBase, emptyAkb, type ArtistKnowledgeBase as TAkb } from '@/lib/schemas/akb';

export type AkbVersionRow = {
  id: number;
  user_id: number;
  version: number;
  json: TAkb;
  source: 'ingest' | 'interview' | 'merge' | 'manual';
  created_at: number;
};

/**
 * WALKTHROUGH Note 4 migration: existing AKB versions written before
 * `identity.artist_name` existed get the field auto-filled from
 * `identity.legal_name`, with `legal_name_matches_artist_name = true`.
 *
 * Operates on the raw parsed JSON (Record-shape) BEFORE strict schema
 * validation, because after the Note 4 flip `artist_name` is required —
 * old rows without it would fail safeParse before the migration could
 * run. Pure function; does not write back to the DB.
 */
export function migrateArtistNameRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;
  const identity = (r.identity ?? {}) as Record<string, unknown>;
  const artistName = identity.artist_name;
  const legalName = identity.legal_name;
  if (typeof artistName === 'string' && artistName.length > 0) return raw;
  if (typeof legalName !== 'string' || legalName.length === 0) {
    // Nothing to copy from. Seed an empty string so strict validation passes
    // — `artist_name` is required post-Note-4. The interview gap detector
    // will surface it as the top gap on next visit.
    return {
      ...r,
      identity: { ...identity, artist_name: '' },
    };
  }
  return {
    ...r,
    identity: {
      ...identity,
      artist_name: legalName,
      legal_name_matches_artist_name:
        identity.legal_name_matches_artist_name ?? true,
    },
  };
}

/** Back-compat wrapper for callers that already have a parsed TAkb. */
export function migrateArtistName(akb: TAkb): TAkb {
  return migrateArtistNameRaw(akb) as TAkb;
}

export async function loadLatestAkb(userId: number): Promise<{ akb: TAkb; version: number; id: number | null }> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT id, version, json FROM akb_versions
          WHERE user_id = ? ORDER BY version DESC LIMIT 1`,
    args: [userId],
  });
  if (r.rows.length === 0) {
    const seed = emptyAkb();
    return { akb: seed, version: 0, id: null };
  }
  const row = r.rows[0];
  const migrated = migrateArtistNameRaw(JSON.parse(row.json as string));
  const parsed = ArtistKnowledgeBase.safeParse(migrated);
  if (!parsed.success) {
    throw new Error(`stored AKB v${row.version} failed validation: ${parsed.error.message}`);
  }
  return { akb: parsed.data, version: Number(row.version), id: Number(row.id) };
}

export async function loadAkbById(id: number): Promise<{ akb: TAkb; version: number } | null> {
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT version, json FROM akb_versions WHERE id = ?`,
    args: [id],
  });
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  const migrated = migrateArtistNameRaw(JSON.parse(row.json as string));
  const parsed = ArtistKnowledgeBase.safeParse(migrated);
  if (!parsed.success) {
    throw new Error(`AKB id=${id} failed validation: ${parsed.error.message}`);
  }
  return { akb: parsed.data, version: Number(row.version) };
}

export async function saveAkb(
  userId: number,
  akb: TAkb,
  source: 'ingest' | 'interview' | 'merge' | 'manual',
): Promise<{ id: number; version: number }> {
  const db = getDb();
  const cur = await db.execute({
    sql: 'SELECT COALESCE(MAX(version), 0) as v FROM akb_versions WHERE user_id = ?',
    args: [userId],
  });
  const version = Number(cur.rows[0]?.v ?? 0) + 1;
  const ins = await db.execute({
    sql: `INSERT INTO akb_versions (user_id, version, json, source) VALUES (?, ?, ?, ?) RETURNING id`,
    args: [userId, version, JSON.stringify(akb), source],
  });
  return { id: Number(ins.rows[0]?.id), version };
}

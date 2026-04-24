import { z } from 'zod';
import {
  ArtistKnowledgeBase,
  PartialAKB,
  type ArtistKnowledgeBase as TAkb,
  type PartialAKB as TPartialAkb,
} from '@/lib/schemas/akb';

// Per-array-item validators (derived from the ArtistKnowledgeBase shape).
// Used to filter out partially-populated items the extractor LLM produces —
// keeping the strict AKB schema but tolerating lossy ingestion.
const ARRAY_ITEM_SCHEMAS: Record<string, z.ZodTypeAny> = {
  education: ArtistKnowledgeBase.shape.education.element,
  bodies_of_work: ArtistKnowledgeBase.shape.bodies_of_work.element,
  exhibitions: ArtistKnowledgeBase.shape.exhibitions.element,
  publications: ArtistKnowledgeBase.shape.publications.element,
  awards_and_honors: ArtistKnowledgeBase.shape.awards_and_honors.element,
  collections: ArtistKnowledgeBase.shape.collections.element,
  representation: ArtistKnowledgeBase.shape.representation.element,
};

export type Provenance = `ingested:${string}` | 'interview' | 'manual';

const PROVENANCE_RANK: Record<string, number> = {
  ingested: 1,
  interview: 2,
  manual: 3,
};

function provenanceKind(p: Provenance | string | undefined): string {
  if (!p) return '';
  return p.startsWith('ingested:') ? 'ingested' : p;
}

function canOverwrite(
  leafPath: string,
  provenanceMap: Record<string, string>,
  incomingProvenance: Provenance,
): boolean {
  const existingProv = provenanceMap[leafPath];
  if (!existingProv) return true;
  if (existingProv === incomingProvenance) return true; // same-source update
  const incomingRank = PROVENANCE_RANK[provenanceKind(incomingProvenance)] ?? 0;
  const existingRank = PROVENANCE_RANK[provenanceKind(existingProv)] ?? 0;
  return incomingRank >= existingRank;
}

const ARRAY_DEDUPE_KEYS: Record<string, (item: Record<string, unknown>) => string> = {
  education: (e) => `${norm(e.institution)}|${e.year ?? ''}`,
  bodies_of_work: (b) => `${norm(b.title)}`,
  exhibitions: (x) => `${norm(x.venue)}|${x.year ?? ''}|${norm(x.title)}`,
  publications: (p) => `${norm(p.publisher)}|${p.year ?? ''}|${norm(p.title)}`,
  awards_and_honors: (a) => `${norm(a.name)}|${a.year ?? ''}`,
  collections: (c) => `${norm(c.name)}`,
  representation: (r) => `${norm(r.gallery)}`,
};

function norm(v: unknown): string {
  // Plan's normalize: lowercase + strip non-alphanum + collapse whitespace
  return typeof v === 'string'
    ? v.toLowerCase().replace(/[^a-z0-9]+/g, '').trim()
    : '';
}

export type MergeResult = { merged: TAkb | TPartialAkb; changedFields: string[] };

/**
 * Merge a partial AKB into an existing AKB with leaf-path provenance enforcement.
 *
 * Provenance rules:
 * - Scalars get leaf-path keys (`identity.legal_name`, `identity.home_base.city`, etc.)
 * - Arrays get array-path keys (`exhibitions`, `bodies_of_work` — no per-item provenance in v1)
 * - Nested objects recurse with growing dot-path; NEVER stamped at the parent
 *
 * Array merge: concat + dedupe by ARRAY_DEDUPE_KEYS. Drop items that don't
 * individually validate against the strict AKB item schema (LLMs often emit
 * partial entries missing year/venue/etc. that would break re-validation).
 *
 * The result is PartialAKB-shaped during ingestion/interview (may still have
 * empty required scalars); /finalize does the strict ArtistKnowledgeBase.parse.
 */
export function mergeAkbPartial(
  existing: TAkb | TPartialAkb,
  incoming: TPartialAkb,
  provenance: Provenance,
): MergeResult {
  const out = structuredClone(existing) as Record<string, unknown>;
  const provMap: Record<string, string> = {
    ...((existing as { source_provenance?: Record<string, string> }).source_provenance ?? {}),
  };
  const changed: string[] = [];

  mergeInto(out, incoming as Record<string, unknown>, '', provMap, provenance, changed);

  out.source_provenance = provMap;

  // Loose re-validation: PartialAKB allows incomplete fields. The strict
  // ArtistKnowledgeBase.parse happens at /api/akb/finalize, not here.
  const v = PartialAKB.safeParse(out);
  if (!v.success) {
    throw new Error(`mergeAkbPartial produced invalid PartialAKB: ${v.error.message}`);
  }
  return { merged: v.data as TAkb | TPartialAkb, changedFields: changed };
}

/**
 * Back-compat wrapper for earlier call sites. Forwards to mergeAkbPartial.
 * New code should use mergeAkbPartial directly.
 */
export function mergeAkb(
  existing: TAkb,
  incoming: TPartialAkb,
  provenance: Provenance,
): { merged: TAkb; changedFields: string[] } {
  const r = mergeAkbPartial(existing, incoming, provenance);
  return { merged: r.merged as TAkb, changedFields: r.changedFields };
}

function mergeInto(
  target: Record<string, unknown>,
  incoming: Record<string, unknown>,
  parentPath: string,
  provMap: Record<string, string>,
  provenance: Provenance,
  changed: string[],
): void {
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null) continue;
    if (key === 'source_provenance') continue;

    const path = parentPath ? `${parentPath}.${key}` : key;

    if (Array.isArray(value)) {
      mergeArrayField(target, key, path, value, provMap, provenance, changed);
      continue;
    }

    if (typeof value === 'object') {
      // Recurse — build dot-path as we descend; never stamp at this level.
      const nextTarget = (target[key] as Record<string, unknown> | undefined) ?? {};
      mergeInto(nextTarget, value as Record<string, unknown>, path, provMap, provenance, changed);
      target[key] = nextTarget;
      continue;
    }

    // Scalar at leaf — stamp provenance at full dot-path if allowed.
    if (canOverwrite(path, provMap, provenance)) {
      target[key] = value;
      provMap[path] = provenance;
      changed.push(path);
    }
  }
}

function mergeArrayField(
  target: Record<string, unknown>,
  key: string,
  path: string,
  incoming: unknown[],
  provMap: Record<string, string>,
  provenance: Provenance,
  changed: string[],
): void {
  const dedupeKey = ARRAY_DEDUPE_KEYS[key];
  if (!dedupeKey) {
    // Flat string arrays (citizenship, secondary_media, influences, aspirations, etc.)
    const existingArr = (target[key] as string[] | undefined) ?? [];
    const merged = dedupeStrings([...existingArr, ...(incoming as string[])]);
    if (merged.length !== existingArr.length) {
      target[key] = merged;
      provMap[path] = provenance;
      changed.push(path);
    }
    return;
  }

  const itemSchema = ARRAY_ITEM_SCHEMAS[key];
  const existingArr = (target[key] as Array<Record<string, unknown>>) ?? [];
  const seen = new Map<string, Record<string, unknown>>();
  for (const item of existingArr) seen.set(dedupeKey(item), item);

  let added = 0;
  for (const item of incoming as Array<Record<string, unknown>>) {
    // Drop items that don't fully validate — LLMs often emit partial entries.
    if (itemSchema && !itemSchema.safeParse(item).success) continue;
    const k = dedupeKey(item);
    if (!seen.has(k)) {
      seen.set(k, item);
      added++;
    }
  }
  if (added > 0) {
    target[key] = Array.from(seen.values());
    provMap[path] = provenance;
    changed.push(path);
  }
}

function dedupeStrings(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = x.trim().toLowerCase();
    if (!seen.has(k) && x.trim().length > 0) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}

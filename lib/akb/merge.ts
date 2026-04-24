import { z } from 'zod';
import {
  ArtistKnowledgeBase,
  type ArtistKnowledgeBase as TAkb,
  type PartialArtistKnowledgeBase,
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

export function canOverwrite(
  fieldKey: string,
  existing: TAkb,
  incomingProvenance: Provenance,
): boolean {
  const existingProv = existing.source_provenance[fieldKey];
  if (!existingProv) return true;
  const incomingRank = PROVENANCE_RANK[provenanceKind(incomingProvenance)] ?? 0;
  const existingRank = PROVENANCE_RANK[provenanceKind(existingProv)] ?? 0;
  // Same-source updates (e.g., re-ingest of same URL): allow.
  if (existingProv === incomingProvenance) return true;
  return incomingRank >= existingRank;
}

const ARRAY_DEDUPE_KEYS: Record<string, (item: Record<string, unknown>) => string> = {
  education: (e) =>
    `${norm(e.institution)}|${norm(e.degree)}|${e.year ?? ''}`,
  bodies_of_work: (b) => `${norm(b.title)}|${norm(b.years)}`,
  exhibitions: (x) =>
    `${norm(x.venue)}|${x.year ?? ''}|${norm(x.title)}`,
  publications: (p) =>
    `${norm(p.publisher)}|${p.year ?? ''}|${norm(p.title)}`,
  awards_and_honors: (a) => `${norm(a.name)}|${a.year ?? ''}`,
  collections: (c) => `${norm(c.name)}|${norm(c.type)}`,
  representation: (r) => `${norm(r.gallery)}|${norm(r.location)}`,
};

function norm(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

export type MergeResult = { merged: TAkb; changedFields: string[] };

/**
 * Merge a partial AKB into an existing AKB with provenance enforcement.
 * Scalars: last-write-wins subject to canOverwrite().
 * Arrays: concat + dedupe by ARRAY_DEDUPE_KEYS, preserving existing entries.
 * Nested objects (identity, practice, intent, palette etc.): per-leaf merge.
 */
export function mergeAkb(
  existing: TAkb,
  incoming: PartialArtistKnowledgeBase,
  provenance: Provenance,
): MergeResult {
  const out: TAkb = structuredClone(existing);
  const changed: string[] = [];

  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null) continue;
    if (key === 'source_provenance') continue;

    if (Array.isArray(value)) {
      const dedupeKey = ARRAY_DEDUPE_KEYS[key];
      if (!dedupeKey) {
        // citizenship, aspirations, etc. — flat string arrays
        const existingArr = (existing[key as keyof TAkb] as unknown as string[] | undefined) ?? [];
        const merged = dedupeStrings([...existingArr, ...(value as string[])]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (out as any)[key] = merged;
        out.source_provenance[key] = provenance;
        changed.push(key);
        continue;
      }
      const seen = new Map<string, Record<string, unknown>>();
      for (const item of existing[key as keyof TAkb] as Array<Record<string, unknown>>) {
        seen.set(dedupeKey(item), item);
      }
      const itemSchema = ARRAY_ITEM_SCHEMAS[key];
      let added = 0;
      for (const item of value as Array<Record<string, unknown>>) {
        // Drop items that don't fully validate — LLMs often produce partial
        // entries (missing year, venue, etc.) which would break final AKB validation.
        if (itemSchema && !itemSchema.safeParse(item).success) continue;
        const k = dedupeKey(item);
        if (!seen.has(k)) {
          seen.set(k, item);
          added++;
        }
      }
      if (added > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (out as any)[key] = Array.from(seen.values());
        out.source_provenance[key] = provenance;
        changed.push(key);
      }
      continue;
    }

    if (typeof value === 'object') {
      // Nested object — merge field-by-field with provenance per leaf.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingObj: Record<string, unknown> = (out as any)[key] ?? {};
      for (const [innerKey, innerValue] of Object.entries(value)) {
        if (innerValue === undefined || innerValue === null) continue;
        const fieldKey = `${key}.${innerKey}`;
        if (Array.isArray(innerValue)) {
          const merged = dedupeStrings([
            ...((existingObj[innerKey] as string[]) ?? []),
            ...(innerValue as string[]),
          ]);
          existingObj[innerKey] = merged;
          out.source_provenance[fieldKey] = provenance;
          changed.push(fieldKey);
        } else if (typeof innerValue === 'object') {
          // home_base etc.
          const cur = (existingObj[innerKey] as Record<string, unknown>) ?? {};
          existingObj[innerKey] = { ...cur, ...innerValue };
          out.source_provenance[fieldKey] = provenance;
          changed.push(fieldKey);
        } else {
          if (canOverwrite(fieldKey, out, provenance)) {
            existingObj[innerKey] = innerValue;
            out.source_provenance[fieldKey] = provenance;
            changed.push(fieldKey);
          }
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (out as any)[key] = existingObj;
      continue;
    }

    // Scalar at top level (career_stage)
    if (canOverwrite(key, out, provenance)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (out as any)[key] = value;
      out.source_provenance[key] = provenance;
      changed.push(key);
    }
  }

  // Re-validate. Re-throw on failure — merge must produce a schema-valid AKB.
  const v = ArtistKnowledgeBase.safeParse(out);
  if (!v.success) {
    throw new Error(`mergeAkb produced invalid AKB: ${v.error.message}`);
  }
  return { merged: v.data, changedFields: changed };
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

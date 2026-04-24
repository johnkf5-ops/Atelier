import type { ArtistKnowledgeBase, PartialAKB } from '@/lib/schemas/akb';

export type Gap = {
  path: string;
  priority: number;
  why: string;
};

// Back-compat alias for earlier call sites.
export type GapTarget = Gap;

/**
 * Priority tiers per §2.6 — higher number = asked first. Each key is a dot-path
 * into the AKB structure; detectGaps walks the path and records a gap if the
 * leaf is empty (undefined, null, "", or empty array).
 */
const TIERS: Record<string, number> = {
  'identity.legal_name': 100,
  'identity.citizenship': 100,
  'identity.home_base': 95,
  'practice.primary_medium': 90,
  'practice.process_description': 85,
  'intent.statement': 80,
  career_stage: 75,
  bodies_of_work: 70,
  exhibitions: 60,
  publications: 55,
  awards_and_honors: 50,
  education: 45,
  collections: 40,
  representation: 35,
  'intent.influences': 30,
  'intent.aspirations': 30,
  'practice.secondary_media': 20,
  'practice.materials_and_methods': 20,
  'identity.year_of_birth': 15,
};

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') {
    // Treat "home_base"-style objects as empty when every leaf is empty
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return true;
    return keys.every((k) => isEmpty(obj[k]));
  }
  return false;
}

function walk(obj: unknown, parts: string[]): unknown {
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function detectGaps(akb: PartialAKB | ArtistKnowledgeBase): Gap[] {
  const gaps: Gap[] = [];
  for (const [path, priority] of Object.entries(TIERS)) {
    const value = walk(akb, path.split('.'));
    if (isEmpty(value)) {
      gaps.push({ path, priority, why: `${path} is not yet populated` });
    }
  }
  return gaps.sort((a, b) => b.priority - a.priority);
}

export function topGapField(akb: PartialAKB | ArtistKnowledgeBase): string | null {
  const gaps = detectGaps(akb);
  return gaps.length > 0 ? gaps[0].path : null;
}

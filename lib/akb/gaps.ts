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
 *
 * WALKTHROUGH Note 4 + Note 5 ordering:
 * - artist_name (115) ranks ABOVE legal_name (suppressed via DEFAULT_EQUALS).
 * - home_base (95) is one structured question (city + region + country).
 * - citizenship (90) is suppressed when the user already declared it equals
 *   the home country via DEFAULT_EQUALS — see suppressDefaultEqualsGaps.
 */
const TIERS: Record<string, number> = {
  'identity.artist_name': 115,
  'identity.legal_name': 100,
  'identity.home_base': 95,
  'identity.citizenship': 90,
  'practice.primary_medium': 88,
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

/**
 * Default-equals relationships per WALKTHROUGH Notes 4 + 5. When the
 * "anchor" field is filled AND the user has signalled the dependent field
 * is the same (via the marker boolean), the dependent field is suppressed
 * from gap detection — auto-filled from the anchor and never asked.
 *
 * Without this, the interview asks "What's your legal name?" right after
 * "What's your artist name?" — feels broken to a user whose names match.
 */
const DEFAULT_EQUALS: Array<{
  /** Field that should be auto-filled from `anchor` when marker is true. */
  dependent: string;
  /** Field whose value will populate the dependent. */
  anchor: string;
  /** Marker boolean signalling the user has confirmed dependent == anchor. */
  marker: string;
}> = [
  {
    dependent: 'identity.legal_name',
    anchor: 'identity.artist_name',
    marker: 'identity.legal_name_matches_artist_name',
  },
];

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

/**
 * Suppress citizenship when home_base.country is filled — the interview
 * defaults citizenship to home country (most common case) and only re-asks
 * if the user manually declares a difference. WALKTHROUGH Note 5.
 */
function citizenshipSuppressed(akb: PartialAKB | ArtistKnowledgeBase): boolean {
  const country = walk(akb, ['identity', 'home_base', 'country']);
  if (typeof country !== 'string' || country.trim().length === 0) return false;
  // Only suppress if the user hasn't explicitly declared their citizenship
  // already. (If they HAVE declared it, isEmpty already filters the gap.)
  return true;
}

export function detectGaps(akb: PartialAKB | ArtistKnowledgeBase): Gap[] {
  const gaps: Gap[] = [];
  for (const [path, priority] of Object.entries(TIERS)) {
    // DEFAULT_EQUALS: skip dependent fields when the marker says they match anchor.
    const ruleHit = DEFAULT_EQUALS.find((r) => r.dependent === path);
    if (ruleHit) {
      const marker = walk(akb, ruleHit.marker.split('.'));
      const anchorValue = walk(akb, ruleHit.anchor.split('.'));
      if (marker === true && !isEmpty(anchorValue)) continue;
    }
    // Note 5 conditional: suppress citizenship when home_base.country is set.
    if (path === 'identity.citizenship' && citizenshipSuppressed(akb)) continue;
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

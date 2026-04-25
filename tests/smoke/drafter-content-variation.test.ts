import { describe, it, expect } from 'vitest';
import {
  checkContentVariation,
  checkCanonicalReelCaps,
  countLocationsInSentence,
  countGearInSentence,
  EMPHASIS_BY_OPP_TYPE,
  checkStatementVoice,
  type OppType,
} from '@/lib/agents/package-drafter';

/**
 * WALKTHROUGH Note 32 — drafted statements vary STRUCTURE but repeat
 * BODY CONTENT across opportunities. Audited 6 statements: same canonical
 * locations + gear list + closing line in 4-6 of 6 statements. Reads as
 * "one statement reshuffled."
 *
 * This suite locks the four-part fix structurally:
 *   - 32-fix.1: EMPHASIS_BY_OPP_TYPE table keyed for every OppType
 *   - 32-fix.2: per-sentence canonical-reel caps (≤3 locations, ≤2 gear),
 *     "planet is a beautiful place" closing-line ban
 *   - 32-fix.3: cross-dossier Jaccard similarity check (warn >0.50,
 *     redraft candidate >0.75)
 *   - 32-fix.4: same checks integrated into the proposal + cover-letter
 *     voice linters via checkCanonicalReelCaps
 */

describe('EMPHASIS_BY_OPP_TYPE — 32-fix.1', () => {
  it('has an entry for every OppType in the system', () => {
    const expectedTypes: OppType[] = [
      'state-fellowship',
      'landscape-prize',
      'photo-book',
      'museum-acquisition',
      'general-prize',
    ];
    for (const t of expectedTypes) {
      expect(EMPHASIS_BY_OPP_TYPE[t]).toBeDefined();
      expect(EMPHASIS_BY_OPP_TYPE[t].length).toBeGreaterThan(50);
    }
  });

  it('each emphasis entry tells the model what to LEAD WITH and what to SKIP', () => {
    for (const text of Object.values(EMPHASIS_BY_OPP_TYPE)) {
      expect(text).toMatch(/LEAD WITH/i);
      expect(text).toMatch(/SKIP/i);
    }
  });

  it('state-fellowship emphasis grounds in a single specific place + skips international ambition', () => {
    const t = EMPHASIS_BY_OPP_TYPE['state-fellowship'];
    expect(t).toMatch(/single (river|canyon|county)|specific commitment to one place/i);
    expect(t).toMatch(/SKIP international/i);
  });

  it('photo-book emphasis leads with monograph readiness + skips gear list', () => {
    const t = EMPHASIS_BY_OPP_TYPE['photo-book'];
    expect(t).toMatch(/monograph readiness/i);
    expect(t).toMatch(/SKIP the full gear/i);
  });
});

describe('countLocationsInSentence + countGearInSentence — 32-fix.2 building blocks', () => {
  it('counts canonical landscape-photo locations in a sentence', () => {
    const s = 'I have photographed Antelope Canyon, Delicate Arch, the Palouse, and Yosemite.';
    expect(countLocationsInSentence(s)).toBeGreaterThanOrEqual(4);
  });

  it('does NOT double-count when only one location appears', () => {
    expect(countLocationsInSentence('I have returned to Yosemite every spring for nine years.')).toBe(1);
  });

  it('counts canonical gear/technique items in a sentence', () => {
    const s = 'I shoot on Hasselblad and Phase One with graduated ND filters and Zone System exposure discipline.';
    expect(countGearInSentence(s)).toBeGreaterThanOrEqual(3);
  });

  it('does NOT false-positive on common words inside other prose', () => {
    expect(countGearInSentence('The canyon wall reflects the late light.')).toBe(0);
    expect(countLocationsInSentence('My practice has stayed grounded in one place.')).toBe(0);
  });
});

describe('checkCanonicalReelCaps — 32-fix.2', () => {
  it('flags a sentence with 4+ location names', () => {
    const text = 'My practice spans Antelope Canyon, Delicate Arch, the Palouse, Yosemite, and Lisbon.';
    const issues = checkCanonicalReelCaps(text);
    expect(issues.some((i) => /\d+ location names/.test(i))).toBe(true);
  });

  it('flags a sentence with 3+ gear items', () => {
    const text = 'I shoot on Hasselblad and Phase One with Zone System exposure and ND filter discipline.';
    const issues = checkCanonicalReelCaps(text);
    expect(issues.some((i) => /gear\/technique items/.test(i))).toBe(true);
  });

  it('passes a clean sentence with 2 locations and 1 gear ref', () => {
    const text = 'I have returned to the Palouse and Yosemite every spring with my Hasselblad.';
    const issues = checkCanonicalReelCaps(text);
    expect(issues).toEqual([]);
  });

  it('checkStatementVoice integrates the cap check + the planet-is-a-beautiful-place ban', () => {
    const bad = 'I am a landscape photographer working in Antelope Canyon, Delicate Arch, the Palouse, Yosemite, and Lisbon. The planet is a beautiful place worth photographing.';
    const r = checkStatementVoice(bad);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /location names/.test(i))).toBe(true);
    expect(r.issues.some((i) => /the planet is a beautiful place/.test(i))).toBe(true);
  });
});

describe('checkContentVariation — 32-fix.3', () => {
  it('returns ok=true with average ~0 for completely distinct drafts', () => {
    const drafts = [
      'My work returns to a single river in southern Nevada year after year.',
      'I sequence twelve photographs into a monograph about urban erasure in Lisbon.',
      'For the residency I would build a darkroom workflow specific to fog conditions.',
    ];
    const r = checkContentVariation(drafts);
    expect(r.ok).toBe(true);
    expect(r.averageSimilarity).toBeLessThan(0.2);
    expect(r.redraftCandidates).toHaveLength(0);
  });

  it('flags high cross-dossier similarity when drafts share most body content', () => {
    // Two near-identical drafts (the "one statement reshuffled" symptom) plus
    // one distinct draft. Pair (0,1) should exceed 0.75.
    const drafts = [
      'I am a landscape photographer working across Antelope Canyon Delicate Arch Palouse Yosemite Hawaiian waterfalls Amsterdam Lisbon Dubai using Hasselblad Phase One Zone System graduated ND filters Fuji Flex prints The planet is a beautiful place worth careful attention.',
      'I am a landscape photographer working across Antelope Canyon Delicate Arch Palouse Yosemite Hawaiian waterfalls Amsterdam Lisbon Dubai using Hasselblad Phase One Zone System graduated ND filters Fuji Flex prints worth careful attention to a beautiful planet.',
      'For the Maine Arts Council fellowship I propose returning to a single stretch of the Penobscot River across nine months of freeze-thaw cycles producing twelve large-format prints for a regional exhibition at the Boulder City library.',
    ];
    const r = checkContentVariation(drafts);
    expect(r.ok).toBe(false);
    expect(r.redraftCandidates.length).toBeGreaterThan(0);
    expect(r.redraftCandidates.some((p) => p.i === 0 && p.j === 1)).toBe(true);
  });

  it('flags average similarity above the warn threshold (default 0.50) even without any redraft pair', () => {
    // Three drafts with overlapping mid-similarity content but no single pair
    // hits 0.75 — should still warn on the average.
    const shared = 'photographer landscape monograph practice gallery exhibition years working';
    const drafts = [
      `${shared} Yosemite spring nine return canyon`,
      `${shared} Yosemite Palouse return spring nine`,
      `${shared} Palouse spring nine canyon return`,
    ];
    const r = checkContentVariation(drafts);
    // High overlap → average above 0.5 → warn fires.
    expect(r.averageSimilarity).toBeGreaterThan(0.5);
    expect(r.ok).toBe(false);
  });

  it('respects custom warn + redraft thresholds', () => {
    const drafts = [
      'one common token here',
      'another common token here',
    ];
    // Strict thresholds: same drafts now flag.
    const r = checkContentVariation(drafts, { warn: 0.1, redraft: 0.2 });
    expect(r.averageSimilarity).toBeGreaterThan(0.1);
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it('returns 1.0 similarity for two identical inputs', () => {
    const drafts = ['identical content here', 'identical content here'];
    const r = checkContentVariation(drafts);
    expect(r.averageSimilarity).toBe(1);
    expect(r.redraftCandidates).toHaveLength(1);
  });

  it('handles fewer than 2 inputs without crashing (no pairs to compare)', () => {
    expect(checkContentVariation([]).averageSimilarity).toBe(0);
    expect(checkContentVariation(['only one']).averageSimilarity).toBe(0);
  });
});

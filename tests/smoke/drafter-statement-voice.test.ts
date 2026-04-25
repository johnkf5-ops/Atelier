import { describe, it, expect } from 'vitest';
import { classifyOpportunityType, checkStatementVoice } from '@/lib/agents/package-drafter';
import type { Opportunity } from '@/lib/schemas/opportunity';

/**
 * WALKTHROUGH Note 20 — lock in the voice-discipline contract for the
 * artist-statement Drafter:
 *  - opportunity-type classifier maps known opportunity names to the right
 *    tailoring bucket (state-fellowship / landscape-prize / photo-book /
 *    museum-acquisition / general-prize)
 *  - checkStatementVoice flags ZERO em-dashes (hard rule), banned phrases,
 *    and banned single words; clean prose passes
 */

function opp(over: Partial<Opportunity> = {}): Opportunity {
  return {
    source: 'test',
    source_id: 'id',
    name: 'Test',
    url: 'https://example.com',
    deadline: undefined,
    award: { type: 'grant', prestige_tier: 'mid' },
    eligibility: {},
    ...over,
  };
}

describe('classifyOpportunityType', () => {
  it('routes state arts council fellowship by name', () => {
    expect(classifyOpportunityType(opp({ name: 'Nevada Arts Council Fellowship' }))).toBe('state-fellowship');
    expect(classifyOpportunityType(opp({ name: 'Maine Arts Commission Visual Arts Fellowship' }))).toBe('state-fellowship');
    expect(classifyOpportunityType(opp({ name: 'NYSCA Artist Fellowship' }))).toBe('state-fellowship');
  });

  it('routes landscape/nature photography prizes', () => {
    expect(classifyOpportunityType(opp({ name: 'International Landscape Photographer of the Year (ILPOTY)' }))).toBe('landscape-prize');
    expect(classifyOpportunityType(opp({ name: 'Outdoor Photographer of the Year' }))).toBe('landscape-prize');
    expect(classifyOpportunityType(opp({ name: 'Hamdan International Photography Award' }))).toBe('landscape-prize');
    expect(classifyOpportunityType(opp({ name: 'Critical Mass 2026' }))).toBe('landscape-prize');
  });

  it('routes photo book / monograph prizes', () => {
    expect(classifyOpportunityType(opp({ name: 'Aperture First Book Award' }))).toBe('photo-book');
    expect(classifyOpportunityType(opp({ name: 'Lucie Foundation Book Prize' }))).toBe('photo-book');
  });

  it('routes museum acquisition opportunities', () => {
    expect(classifyOpportunityType(opp({ name: 'Whitney Museum Acquisition Review' }))).toBe('museum-acquisition');
  });

  it('falls back to general-prize when nothing matches name and award is a flagship prize', () => {
    // award.type='prize' + prestige_tier='flagship' → neither name pattern
    // nor the coarse fellowship/grant fallback fires → general-prize.
    expect(
      classifyOpportunityType(
        opp({ name: 'Generic Photo Competition 2026', award: { type: 'prize', prestige_tier: 'flagship' } }),
      ),
    ).toBe('general-prize');
  });

  it('coarse fallback routes mid-tier grants/fellowships to state-fellowship even when name has no signal', () => {
    // For an unnamed regional grant the safer default is state-fellowship
    // tailoring (place-grounded) over generic-prize (greatest-hits).
    expect(
      classifyOpportunityType(
        opp({ name: 'Regional Award 2026', award: { type: 'grant', prestige_tier: 'regional' } }),
      ),
    ).toBe('state-fellowship');
  });
});

describe('checkStatementVoice', () => {
  it('passes a clean first-person statement with zero em-dashes', () => {
    const text = `My sense of home is tethered to a stretch of the lower Colorado, where I have returned every spring for nine years. I make large-format prints not because of the format itself but because the canyon teaches you that scale is the subject. My first thought is always of light. The work is one long apprenticeship to a single river.`;
    const r = checkStatementVoice(text);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('flags em-dashes (hard rule: zero allowed)', () => {
    const text = 'This is fine until — yes — em-dash.';
    const r = checkStatementVoice(text);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('em-dash'))).toBe(true);
  });

  it('flags banned curatorial phrases', () => {
    const text = 'My work sits at the intersection of the sublime and the technical. The images function as meditations on the American West.';
    const r = checkStatementVoice(text);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('sits at the intersection of'))).toBe(true);
    expect(r.issues.some((i) => i.includes('meditations on'))).toBe(true);
  });

  it('flags banned single words (LLM-tell vocabulary)', () => {
    const text = 'A visionary journey to capture the essence of the wild.';
    const r = checkStatementVoice(text);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /visionary/.test(i))).toBe(true);
    expect(r.issues.some((i) => /journey/.test(i))).toBe(true);
    expect(r.issues.some((i) => /capture/.test(i))).toBe(true);
  });

  it('does NOT flag substring matches inside legitimate words', () => {
    // "vision" inside "television" should not fire — \b word boundaries.
    const text = 'This work has nothing to do with television or pasture or recapturing anything.';
    const r = checkStatementVoice(text);
    expect(r.ok).toBe(true);
  });
});

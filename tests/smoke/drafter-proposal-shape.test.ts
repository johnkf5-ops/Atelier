import { describe, it, expect } from 'vitest';
import { classifyProposalType, checkProposalVoice } from '@/lib/agents/package-drafter';
import type { Opportunity } from '@/lib/schemas/opportunity';

/**
 * WALKTHROUGH Note 21 — lock in the proposal Drafter contract:
 *  - classifyProposalType maps real opportunity names to the right
 *    template bucket (state-fellowship / competition / residency /
 *    book-grant / foundation-grant / commission / guggenheim-major-bespoke)
 *  - checkProposalVoice flags the Note-20 banned phrases + Note-21 additions
 *    + lineage-paragraph (3 named photographers in one paragraph) + the
 *    truncation regression (no terminal punctuation)
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

describe('classifyProposalType', () => {
  it('routes residencies to residency template', () => {
    expect(classifyProposalType(opp({ name: 'MacDowell Visual Arts Residency' }))).toBe('residency');
    expect(classifyProposalType(opp({ name: 'Yaddo Artist Residency' }))).toBe('residency');
    expect(classifyProposalType(opp({ name: 'Headlands Center for the Arts AIR' }))).toBe('residency');
    expect(classifyProposalType(opp({ name: 'Light Work Artist-in-Residence Program' }))).toBe('residency');
  });

  it('routes book grants to book-grant template', () => {
    expect(classifyProposalType(opp({ name: 'Aperture First PhotoBook Award' }))).toBe('book-grant');
    expect(classifyProposalType(opp({ name: 'Lucie Foundation Photo Book Prize' }))).toBe('book-grant');
    expect(classifyProposalType(opp({ name: 'Anamorphosis Prize for Self-Published Monograph' }))).toBe('book-grant');
  });

  it('routes foundation grants to foundation-grant template', () => {
    expect(classifyProposalType(opp({ name: 'Pollock-Krasner Foundation Grant' }))).toBe('foundation-grant');
    expect(classifyProposalType(opp({ name: 'Aaron Siskind Award (VMFA)' }))).toBe('foundation-grant');
    expect(classifyProposalType(opp({ name: 'En Foco Photography Fellowship' }))).toBe('foundation-grant');
  });

  it('routes public art RFQs to commission template', () => {
    expect(classifyProposalType(opp({ name: 'Salt Lake Public Art Call for Artists' }))).toBe('commission');
    expect(classifyProposalType(opp({ name: 'Phoenix Arts Commission Public Art RFQ' }))).toBe('commission');
  });

  it('routes named bespoke majors to guggenheim-major-bespoke', () => {
    expect(classifyProposalType(opp({ name: 'Creative Capital Award' }))).toBe('guggenheim-major-bespoke');
    expect(classifyProposalType(opp({ name: 'Guggenheim Fellowship' }))).toBe('guggenheim-major-bespoke');
    expect(classifyProposalType(opp({ name: 'Joan Mitchell Foundation Painters & Sculptors Grant' }))).toBe('guggenheim-major-bespoke');
  });

  it('routes photo competitions to competition template', () => {
    expect(classifyProposalType(opp({ name: 'International Landscape Photographer of the Year (ILPOTY)' }))).toBe('competition');
    expect(classifyProposalType(opp({ name: 'Critical Mass 2026' }))).toBe('competition');
    expect(classifyProposalType(opp({ name: 'Hamdan International Photography Award' }))).toBe('competition');
    expect(classifyProposalType(opp({ name: 'IPA — International Photography Awards' }))).toBe('competition');
  });

  it('routes state arts council fellowships to state-fellowship template', () => {
    expect(classifyProposalType(opp({ name: 'NYSCA Artist Fellowship' }))).toBe('state-fellowship');
    expect(classifyProposalType(opp({ name: 'Nevada Arts Council Fellowship' }))).toBe('state-fellowship');
    expect(classifyProposalType(opp({ name: 'Maine Arts Commission Visual Arts Fellowship' }))).toBe('state-fellowship');
  });

  it('coarse fallback routes unnamed regional grants to state-fellowship', () => {
    expect(
      classifyProposalType(
        opp({ name: 'Regional Award 2026', award: { type: 'grant', prestige_tier: 'regional' } }),
      ),
    ).toBe('state-fellowship');
  });

  it('falls back to competition for unnamed flagship prizes', () => {
    expect(
      classifyProposalType(
        opp({ name: 'Generic Open Call 2026', award: { type: 'prize', prestige_tier: 'flagship' } }),
      ),
    ).toBe('competition');
  });
});

describe('checkProposalVoice', () => {
  it('passes a clean state-fellowship-shape proposal with terminal punctuation', () => {
    const text = `For the FY2026 cycle I propose to make twelve new large-format prints of the lower Colorado River, working over six months from the Black Canyon downstream to Yuma. The new work extends my long-running landscape practice into a public-engagement frame: each print will be paired with a Spanish-language wall caption developed in partnership with the Walker River Paiute Tribe.

Activities by month: months 1–2, scout and shoot upstream sites; months 3–4, shoot downstream sites and sequence; month 5, master and print at full scale; month 6, install at the Boulder City public library and host two public talks. Deliverables: 12 prints (30x40 inches), one printed catalogue (32 pages, 500 copies), two public talks attended by an estimated 80 community members.

Why now: the Boulder City library opens its new gallery in October 2026 and has confirmed the exhibition slot. Why NYSCA: the Walker River collaboration is administered through Pyramid Lake Arts as fiscal sponsor.`;
    const r = checkProposalVoice(text);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('flags em-dashes (zero allowed)', () => {
    const text = 'Project plan — twelve prints, six months. Deliverable list follows.';
    const r = checkProposalVoice(text);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('em-dash'))).toBe(true);
  });

  it('flags Note-20 banned phrases AND Note-21 additions', () => {
    const text = 'My work sits at the intersection of landscape and conservation. The medium has been preparing itself for this kind of project. The proposal carries quiet authority.';
    const r = checkProposalVoice(text);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('sits at the intersection of'))).toBe(true);
    expect(r.issues.some((i) => i.includes('the medium has been preparing itself'))).toBe(true);
    expect(r.issues.some((i) => i.includes('quiet authority'))).toBe(true);
  });

  it('flags lineage paragraphs (three named photographers in one paragraph)', () => {
    const text = `For the project I will work in the tradition of Adams, refined by Rowell and carried forward by Butcher. Specifically I propose twelve new prints over six months. End goal is exhibition.`;
    const r = checkProposalVoice(text);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('lineage paragraph'))).toBe(true);
  });

  it('does NOT flag a single lineage name (Adams alone is fine in context)', () => {
    const text = `My exposure-control practice draws on the Zone System I first learned reading Adams. I propose twelve new prints over six months along the lower Colorado River. The exhibition opens at the Boulder City library in October 2026.`;
    const r = checkProposalVoice(text);
    // Note: "Zone System tradition" / "in the tradition of" are flagged as
    // banned phrases in the proposal-specific list, but plain "Adams" alone
    // in a sentence about the Zone System is not. This text uses neither
    // banned phrase, just one name, so it should pass.
    expect(r.ok).toBe(true);
  });

  it('flags truncation (proposal does not end with terminal punctuation)', () => {
    const text = 'Project plan: twelve prints, six months along the lower Colorado. Deliverables include the printed catalogue and two public talks. The exhibition opens in October 2026 with a confirmed slot at the Boulder';
    const r = checkProposalVoice(text);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('terminal punctuation') || i.includes('truncated'))).toBe(true);
  });

  it('accepts proposals ending in a closing quote or paren', () => {
    const text = 'Project plan: twelve prints. The exhibition closes with the line "I have returned to this river every spring for nine years."';
    const r = checkProposalVoice(text);
    expect(r.ok).toBe(true);
  });
});

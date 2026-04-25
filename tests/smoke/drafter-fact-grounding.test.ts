import { describe, it, expect } from 'vitest';
import { checkFactGrounding } from '@/lib/agents/package-drafter';

/**
 * WALKTHROUGH Note 24 (CRITICAL — safety): every Drafter material that
 * goes out under the artist's name must be grounded in the AKB.
 * Hallucinated venues, dates, partnerships, and commitments are not a
 * quality issue — they constitute misrepresentation to a funding body.
 *
 * checkFactGrounding is a deterministic post-write linter that catches
 * the most common hallucination patterns:
 *  - 4-digit years not in AKB and outside the near-term reference window
 *  - "confirmed [X]", "ongoing partnership with [X]", "exhibition at [X]",
 *    "commissioned by [X]" phrases whose head noun is not in the AKB JSON
 *
 * The check is appended to the existing voice-check pipelines so the same
 * one-shot revision pass addresses voice + fact issues together.
 */

const AKB_JSON = JSON.stringify({
  identity: {
    artist_name: 'John Knopf',
    home_base: { city: 'Las Vegas', state: 'NV', country: 'USA' },
  },
  exhibitions: [
    { title: 'Long River', venue: 'Mondoir Gallery', location: 'Las Vegas, NV', year: 2025, type: 'solo' },
    { title: 'Group Show', venue: 'Center for Photography', location: 'Madrid', year: 2022, type: 'group' },
  ],
  publications: [{ publisher: 'National Geographic', year: 2023 }],
  awards_and_honors: [{ name: 'Emmy nomination', year: 2018 }],
  curatorial_and_organizational: [
    { role: 'Founder', organization: 'FOTO Magazine', year: 2016 },
  ],
  intent: {
    statement: 'Long-form landscape practice rooted in the lower Colorado River.',
    aspirations: ['third volume of long-form Colorado River project'],
  },
});

describe('checkFactGrounding — clean drafts pass', () => {
  it('passes a draft that only references AKB-grounded entities', () => {
    const text = `My current cycle continues the long-form Colorado River project, with new prints shown at Mondoir Gallery in Las Vegas. The work begun in 2025 extends into the third volume of the series.`;
    const r = checkFactGrounding(text, AKB_JSON);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('passes when years fall in the near-term reference window (current ± 2)', () => {
    const currentYear = new Date().getUTCFullYear();
    const text = `This cycle is the right one. The upcoming submission window in ${currentYear} aligns with the next phase, and I am preparing for ${currentYear + 1}.`;
    const r = checkFactGrounding(text, AKB_JSON);
    expect(r.ok).toBe(true);
  });
});

describe('checkFactGrounding — flags hallucinated facts', () => {
  it('flags a year not in the AKB and outside the reference window', () => {
    const text = `My retrospective at the Whitney in 2019 was the foundation for this body of work.`;
    const r = checkFactGrounding(text, AKB_JSON);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('"2019"'))).toBe(true);
  });

  it('flags an invented "confirmed exhibition at [venue]" claim', () => {
    const text = `The grant would directly support the confirmed exhibition at the Boulder City library.`;
    const r = checkFactGrounding(text, AKB_JSON);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /Boulder City/i.test(i))).toBe(true);
  });

  it('flags an invented "ongoing partnership with [Org]" claim', () => {
    const text = `I am writing in advance of my ongoing partnership with the Walker River Paiute Tribe entering its second year.`;
    const r = checkFactGrounding(text, AKB_JSON);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /ongoing partnership with.*Walker River Paiute Tribe/i.test(i))).toBe(true);
  });

  it('flags an invented "exhibition at [Venue] in [year]" claim', () => {
    const text = `My exhibition at the Boulder City Library in 2027 will mark the publication.`;
    const r = checkFactGrounding(text, AKB_JSON);
    expect(r.ok).toBe(false);
    // Should flag at least the venue (and possibly the year — both are absent).
    expect(r.issues.some((i) => /Boulder City/i.test(i))).toBe(true);
  });

  it('does NOT flag commitments whose head matches an AKB entity (Mondoir Gallery)', () => {
    const text = `The work continues at Mondoir Gallery in Las Vegas. The exhibition at Mondoir Gallery anchors the cycle.`;
    const r = checkFactGrounding(text, AKB_JSON);
    expect(r.ok).toBe(true);
  });

  it('does NOT flag year references that appear in the AKB (2025 = Mondoir Long River)', () => {
    const text = `My most recent solo show at Mondoir Gallery in 2025 set the visual register for this proposal.`;
    const r = checkFactGrounding(text, AKB_JSON);
    expect(r.ok).toBe(true);
  });

  it('skips season-prefix captures when checking specific commitments (no false positive on "Spring [year]")', () => {
    // "confirmed Spring exhibition" should not be flagged as a confirmed
    // entity claim if the captured phrase head is a season word — these
    // are common-language references, not entity claims.
    const text = `I am preparing for the confirmed Spring 2026 publication cycle.`;
    const r = checkFactGrounding(text, AKB_JSON);
    // Year 2026 is in the near-term reference window so it doesn't fire;
    // the "confirmed Spring..." capture is filtered out by the season-prefix
    // skip. Should pass.
    expect(r.ok).toBe(true);
  });

  it('flags the exact Note-24 trigger example (Boulder City library + Walker River + 2026 monograph)', () => {
    const text = `The Nevada Arts Council Fellowship would directly support my third monograph in 2026, with a confirmed exhibition at the Boulder City library in October. My founding role at FOTO has kept me close to the Nevada arts ecosystem, and my ongoing partnership with the Walker River Paiute Tribe is the most relevant credential for this fellowship.`;
    const r = checkFactGrounding(text, AKB_JSON);
    expect(r.ok).toBe(false);
    // At least the partnership + the exhibition venue should be flagged.
    expect(r.issues.some((i) => /Boulder City/i.test(i))).toBe(true);
    expect(r.issues.some((i) => /Walker River/i.test(i))).toBe(true);
  });
});

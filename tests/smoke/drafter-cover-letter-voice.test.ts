import { describe, it, expect } from 'vitest';
import { checkCoverLetterVoice } from '@/lib/agents/package-drafter';

/**
 * WALKTHROUGH Note 23 — lock in the cover-letter voice contract:
 *  - salutation must include "Dear" + comma
 *  - body must be first-person; surname only in signature line
 *  - no lineage paragraph (3+ named photographers in one paragraph)
 *  - opportunity name must appear at least once (specificity)
 *  - length 200-350 words
 *  - inherited Note 20/21 banned-phrase + em-dash + banned-word lints
 */

const opp = { name: 'Nevada Arts Council Fellowship' };
const ARTIST = 'John Knopf';

describe('checkCoverLetterVoice — clean letter passes', () => {
  it('accepts a first-person letter with Dear salutation, opp name present, length in range', () => {
    const text = `Dear Selection Committee,

I am writing to submit my work for the Nevada Arts Council Fellowship cycle. I am a Las Vegas-based landscape photographer with twenty years of practice, focused on the lower Colorado River and the public lands of southern Nevada. My work returns to a small set of canyons and desert washes I have walked since 2005, and the resulting bodies of work have been shown locally at Mondoir Gallery in Las Vegas and circulated through the regional arts community.

This cycle is the right one for my current trajectory. I am preparing the third volume of my long-form Colorado River project for publication in 2026, and the Nevada Arts Council Fellowship would directly support its production phase. My founding role at FOTO has kept me close to the Nevada arts ecosystem over the last decade, and the new volume is rooted in a place this council exists to fund.

Most relevant to this fellowship is my ongoing partnership with the Walker River Paiute Tribe on the lower Colorado, which the proposed cycle would advance into a public exhibition at the Boulder City library in October.

Thank you for your consideration.

John Knopf`;
    const r = checkCoverLetterVoice(text, opp, ARTIST);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });
});

describe('checkCoverLetterVoice — flags voice failures', () => {
  it('flags missing "Dear" salutation', () => {
    const text = `Selection Committee,

I am writing to submit my work for the Nevada Arts Council Fellowship. I am a Las Vegas-based landscape photographer with twenty years of practice. The Nevada Arts Council Fellowship would directly support my third monograph in 2026.

Thank you for your consideration.

John Knopf`;
    const r = checkCoverLetterVoice(text, opp, ARTIST);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /salutation must open with "Dear"/.test(i))).toBe(true);
  });

  it('flags third-person body ("Knopf submits / is / was / has")', () => {
    const text = `Dear Selection Committee,

Knopf submits his work for the Nevada Arts Council Fellowship. Knopf is a Las Vegas-based landscape photographer who was included in National Geographic's first-cohort NFT drop. The Nevada Arts Council Fellowship would directly support his upcoming third monograph.

Knopf has photographed the Colorado River for fifteen years. He returns to the canyon every spring.

Thank you for your consideration.

John Knopf`;
    const r = checkCoverLetterVoice(text, opp, ARTIST);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /third-person voice detected/.test(i))).toBe(true);
  });

  it('does NOT flag the surname when it appears only in the signature line', () => {
    const text = `Dear Selection Committee,

I am writing to submit my work for the Nevada Arts Council Fellowship cycle. I am a Las Vegas-based landscape photographer with twenty years on the lower Colorado, and my practice has stayed grounded in the canyons and desert washes I first walked in 2005. My work circulates through Mondoir Gallery in Las Vegas, and the broader Nevada arts community has been an ongoing home for the project.

The Nevada Arts Council Fellowship would directly support my third monograph in 2026, with a confirmed exhibition at the Boulder City library in October. The book sequences nine years of return visits to a single stretch of the lower river, and the fellowship would underwrite the production phase of the publication and the regional traveling exhibition that follows it through southern Nevada and into the Mojave river drainage.

My founding role at FOTO has kept me close to the Nevada arts ecosystem for over a decade, and my ongoing partnership with the Walker River Paiute Tribe is the most relevant credential for this specific fellowship cycle. The collaboration covers a stretch of river the council has historically funded other artists to document, and the third monograph is the public outcome of that long-form working relationship.

Thank you for your consideration.

John Knopf`;
    const r = checkCoverLetterVoice(text, opp, ARTIST);
    expect(r.ok).toBe(true);
  });

  it('flags lineage paragraph (3+ named photographers in one paragraph)', () => {
    const text = `Dear Selection Committee,

I work in the tradition of Adams, Rowell, and Butcher — the long American landscape lineage that has shaped my work for twenty years. The Nevada Arts Council Fellowship would directly support the next phase.

Thank you for your consideration.

John Knopf`;
    const r = checkCoverLetterVoice(text, opp, ARTIST);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /lineage paragraph/.test(i))).toBe(true);
  });

  it('flags missing opportunity name (no specificity to this opp)', () => {
    const text = `Dear Selection Committee,

I am writing to submit my work for your fellowship cycle. I am a Las Vegas-based landscape photographer with twenty years of practice. This is the right venue for my current trajectory; the third monograph deadline approaches in 2026 and your support would directly aid its production.

Thank you for your consideration.

John Knopf`;
    const r = checkCoverLetterVoice(text, opp, ARTIST);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /opportunity name/.test(i))).toBe(true);
  });

  it('flags em-dash usage', () => {
    const text = `Dear Selection Committee,

I am writing to submit my work for the Nevada Arts Council Fellowship — the cycle I have been preparing for since 2024. I am a Las Vegas-based landscape photographer with twenty years on the lower Colorado.

The third monograph deadline approaches in 2026, and the fellowship would directly aid its production phase.

Thank you for your consideration.

John Knopf`;
    const r = checkCoverLetterVoice(text, opp, ARTIST);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /em-dash/.test(i))).toBe(true);
  });

  it('flags Note 20/21 inherited banned phrases + words', () => {
    const text = `Dear Selection Committee,

My passion is to capture the visionary landscapes of the lower Colorado. The Nevada Arts Council Fellowship sits at the intersection of my long journey toward the third monograph in 2026.

Thank you for your consideration.

John Knopf`;
    const r = checkCoverLetterVoice(text, opp, ARTIST);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /sits at the intersection of/.test(i))).toBe(true);
    expect(r.issues.some((i) => /passion/.test(i))).toBe(true);
    expect(r.issues.some((i) => /capture/.test(i))).toBe(true);
    expect(r.issues.some((i) => /visionary/.test(i))).toBe(true);
    expect(r.issues.some((i) => /journey/.test(i))).toBe(true);
  });

  it('flags letters that run too short', () => {
    const text = `Dear Selection Committee,

I submit my work for the Nevada Arts Council Fellowship.

Thank you.

John Knopf`;
    const r = checkCoverLetterVoice(text, opp, ARTIST);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /word count/.test(i))).toBe(true);
  });

  it('flags "To Whom It May Concern" salutation', () => {
    const text = `To Whom It May Concern,

I am writing to submit my work for the Nevada Arts Council Fellowship. I am a Las Vegas-based landscape photographer with twenty years of practice on the lower Colorado.

The Nevada Arts Council Fellowship would directly support my third monograph in 2026, with confirmed exhibition at the Boulder City library in October. My founding role at FOTO has connected me to the Nevada arts community over the last decade.

Thank you for your consideration.

John Knopf`;
    const r = checkCoverLetterVoice(text, opp, ARTIST);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /salutation must open with "Dear"|to whom it may concern/i.test(i))).toBe(true);
  });

  // WALKTHROUGH Note 26: terminal-punctuation check. Belt-and-suspenders
  // — cover letters can hit the same truncation pattern as statements +
  // proposals when adaptive thinking exhausts the budget mid-sentence.
  it('flags truncated cover letter (no terminal punctuation)', () => {
    const text = `Dear Selection Committee,

I am writing to submit my work for the Nevada Arts Council Fellowship cycle. I am a Las Vegas-based landscape photographer with twenty years on the lower Colorado, returning to the same canyons and washes I first walked in 2005.

The Nevada Arts Council Fellowship would directly support the next phase of my long-form Colorado River project, currently entering its production stage. My founding role at FOTO has kept me close to the regional arts ecosystem, and the new work continues the river-centered practice that has defined the last decade.

The work is anchored in a single stretch of the river, and the fellowship would underwrite the production phase of`;
    const r = checkCoverLetterVoice(text, opp, ARTIST);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /terminal punctuation|truncated/.test(i))).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeTrimNote } from '@/lib/agents/package-drafter';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import { emptyAkb } from '@/lib/schemas/akb';

/**
 * WALKTHROUGH Note 22 — lock in the master-CV architecture contract:
 *
 *  22-fix.1: master CV ALWAYS includes CURATORIAL AND ORGANIZATIONAL
 *            when the AKB has the field non-empty.
 *  22-fix.2: master CV uses canonical section labels in canonical order.
 *  22-fix.3: per-opp cv_formatted column is now a TRIM NOTE (not a CV).
 *            computeTrimNote returns null when the opportunity has no
 *            stated CV cap; otherwise returns a 1-sentence note.
 *
 * The full master-CV generation is mocked at the Anthropic SDK boundary
 * so this suite runs offline + deterministically.
 */

const create = vi.fn();

vi.mock('@/lib/anthropic', () => ({
  getAnthropic: () => ({ messages: { create } }),
  MODEL_OPUS: 'claude-opus-4-7-mock',
}));

beforeEach(() => {
  create.mockReset();
});

describe('computeTrimNote — deterministic per-opp trim note', () => {
  it('returns null when oppRequirementsText is empty', () => {
    expect(computeTrimNote('Test Opp', '')).toBeNull();
  });

  it('returns null when no CV cap pattern matches', () => {
    expect(
      computeTrimNote(
        'Test Opp',
        'Submit a portfolio of recent work and a 250-word artist statement.',
      ),
    ).toBeNull();
  });

  it('detects single-page PDF cap', () => {
    const note = computeTrimNote(
      'Aperture Portfolio Prize',
      'Submit a single-page PDF resume along with the work samples.',
    );
    expect(note).toMatch(/single-page/i);
    expect(note).toMatch(/Aperture Portfolio Prize/);
  });

  it('detects one-page PDF cap', () => {
    const note = computeTrimNote(
      'MacDowell Residency',
      'Please submit a one-page CV in PDF format.',
    );
    expect(note).toMatch(/one-page/i);
  });

  it('detects character-limit cap', () => {
    const note = computeTrimNote(
      'IPA — International Photography Awards',
      'CV/resume entered into a 2,000 character limit text field.',
    );
    expect(note).toMatch(/2,?000-character cap/);
  });

  it('detects word-limit cap', () => {
    const note = computeTrimNote('VMFA Aaron Siskind Award', 'CV up to 500 word maximum.');
    expect(note).toMatch(/500-word cap/);
  });

  it('detects multi-page cap', () => {
    const note = computeTrimNote(
      'NYSCA Artist Fellowship',
      'Maximum 2 pages max for the CV / resume PDF.',
    );
    expect(note).toMatch(/2-page CV maximum/);
  });

  it('returns the first matching cap (single-page wins over character limit)', () => {
    const note = computeTrimNote(
      'Test Opp',
      'Submit a single-page PDF resume. The text field is also limited to 2,000 character max.',
    );
    expect(note).toMatch(/single-page/);
    // Should NOT include the character-cap rendering since single-page matched first.
    expect(note).not.toMatch(/2,?000-character/);
  });
});

describe('generateMasterCv — single canonical CV per run', () => {
  function akbWithCuratorial(): ArtistKnowledgeBase {
    return {
      ...emptyAkb('Jane Photographer'),
      identity: {
        ...emptyAkb('Jane Photographer').identity,
        artist_name: 'Jane Photographer',
        home_base: { city: 'Las Vegas', state: 'NV', country: 'USA' },
      },
      curatorial_and_organizational: [
        { role: 'Founder', organization: 'FOTO Magazine', year: 2016 },
        { role: 'Co-curator', organization: 'Mike Yamashita: A Retrospective', year: 2023 },
      ],
    };
  }

  it('returns the model-emitted CV text trimmed', async () => {
    create.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: `

Jane Photographer
b. 1978 | Lives and works in Las Vegas, NV, USA — Emmy-nominated landscape photographer.

EDUCATION
2000 — BFA Photography, RISD

SOLO EXHIBITIONS
2025 — Long River, Mondoir Gallery, Las Vegas

CURATORIAL AND ORGANIZATIONAL
2016 — Founder, FOTO Magazine
2023 — Co-curator, Mike Yamashita: A Retrospective
`,
        },
      ],
    });
    const { generateMasterCv } = await import('@/lib/agents/package-drafter');
    const out = await generateMasterCv(akbWithCuratorial(), {
      // minimal fingerprint shape — only career_positioning_read is consulted
      career_positioning_read: 'commercial-gallery landscape register',
    } as never);
    expect(out).toMatch(/^Jane Photographer/);
    expect(out).toMatch(/CURATORIAL AND ORGANIZATIONAL/);
    expect(out).toMatch(/EDUCATION/);
    expect(out).toMatch(/SOLO EXHIBITIONS/);
    // No leading/trailing whitespace.
    expect(out).toBe(out.trim());
  });

  it('passes the AKB through to the model unchanged so curatorial fields are visible', async () => {
    create.mockResolvedValue({
      content: [{ type: 'text', text: 'Jane Photographer\nEDUCATION\n' }],
    });
    const { generateMasterCv } = await import('@/lib/agents/package-drafter');
    await generateMasterCv(akbWithCuratorial(), {
      career_positioning_read: 'r',
    } as never);
    // Inspect the call payload to confirm curatorial data made it into the user message.
    const call = create.mock.calls[0]?.[0] as { messages: Array<{ content: string }> } | undefined;
    expect(call?.messages?.[0]?.content).toMatch(/curatorial_and_organizational/);
    expect(call?.messages?.[0]?.content).toMatch(/FOTO Magazine/);
    expect(call?.messages?.[0]?.content).toMatch(/Mike Yamashita/);
  });

  it('system prompt instructs canonical sections + always-include curatorial', async () => {
    create.mockResolvedValue({
      content: [{ type: 'text', text: 'Jane\n' }],
    });
    const { generateMasterCv } = await import('@/lib/agents/package-drafter');
    await generateMasterCv(akbWithCuratorial(), { career_positioning_read: 'r' } as never);
    const call = create.mock.calls[0]?.[0] as { system: string } | undefined;
    expect(call?.system).toMatch(/CURATORIAL AND ORGANIZATIONAL/);
    expect(call?.system).toMatch(/EDUCATION/);
    expect(call?.system).toMatch(/AWARDS AND HONORS/);
    expect(call?.system).toMatch(/COLLECTIONS/);
    expect(call?.system).toMatch(/REPRESENTATION/);
    // Curatorial-always rule per Note 22-fix.1 must be in the prompt.
    expect(call?.system).toMatch(/strengthen ANY application|never trim/i);
  });
});

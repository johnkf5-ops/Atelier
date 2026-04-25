import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Opportunity } from '@/lib/schemas/opportunity';

/**
 * WALKTHROUGH Note 19b: lock in the per-image rationale generator's parse +
 * fallback contract. Mocks the Anthropic SDK at the module boundary so the
 * test runs offline and deterministically.
 */

const create = vi.fn();

vi.mock('@/lib/anthropic', () => ({
  getAnthropic: () => ({ messages: { create } }),
  MODEL_OPUS: 'claude-opus-4-7-mock',
}));

const opp: Opportunity = {
  source: 'test',
  source_id: 'opp-1',
  name: 'Test Award',
  url: 'https://example.com',
  deadline: '2026-12-01',
  award: { type: 'grant', prestige_tier: 'mid' },
  eligibility: {},
};

const images = [
  { id: 1, filename: 'dawn-grain-elevator.jpg', exif_subject: null },
  { id: 6, filename: 'route-66-motel.jpg', exif_subject: null },
  { id: 11, filename: 'utah-canyon.jpg', exif_subject: null },
];

beforeEach(() => {
  create.mockReset();
});

describe('generateSampleRationales', () => {
  it('parses model JSON and returns image_id → rationale Map', async () => {
    create.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            rationales: [
              { image_id: 1, rationale: 'rust-belt grain elevator at dawn matches the prize\'s industrial-Americana cohort' },
              { image_id: 6, rationale: 'roadside vernacular vertical crop matches the cohort\'s preferred orientation discipline' },
              { image_id: 11, rationale: 'large-scale landscape submitted to mirror prior winner\'s scale-of-place' },
            ],
          }),
        },
      ],
    });
    const { generateSampleRationales } = await import('@/lib/agents/package-drafter');
    const m = await generateSampleRationales(opp, 'Rubric reasoning paragraph', images);
    expect(m.size).toBe(3);
    expect(m.get(1)).toMatch(/grain elevator/);
    expect(m.get(6)).toMatch(/vertical crop/);
    expect(m.get(11)).toMatch(/scale-of-place/);
    // No two rationales identical — Note 19b acceptance criterion.
    const distinct = new Set(Array.from(m.values()));
    expect(distinct.size).toBe(m.size);
  });

  it('returns empty Map on LLM error (soft fallback so caller keeps placeholder)', async () => {
    create.mockRejectedValue(new Error('boom'));
    const { generateSampleRationales } = await import('@/lib/agents/package-drafter');
    const m = await generateSampleRationales(opp, 'Rubric reasoning', images);
    expect(m.size).toBe(0);
  });

  it('returns empty Map on malformed JSON', async () => {
    create.mockResolvedValue({
      content: [{ type: 'text', text: 'not json at all' }],
    });
    const { generateSampleRationales } = await import('@/lib/agents/package-drafter');
    const m = await generateSampleRationales(opp, 'Rubric reasoning', images);
    expect(m.size).toBe(0);
  });

  it('drops entries with empty rationale strings', async () => {
    create.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            rationales: [
              { image_id: 1, rationale: 'concrete and good' },
              { image_id: 6, rationale: '' }, // empty — should drop
              { image_id: 11, rationale: '   ' }, // whitespace — should drop
            ],
          }),
        },
      ],
    });
    const { generateSampleRationales } = await import('@/lib/agents/package-drafter');
    const m = await generateSampleRationales(opp, 'r', images);
    expect(m.size).toBe(1);
    expect(m.get(1)).toBe('concrete and good');
  });

  it('returns empty Map when input images list is empty (no API call)', async () => {
    const { generateSampleRationales } = await import('@/lib/agents/package-drafter');
    const m = await generateSampleRationales(opp, 'r', []);
    expect(m.size).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  // WALKTHROUGH Note 25: rationales must NOT name a photographer (Adams,
  // Lik, Shore, Eggleston, Sugimoto, Frye, Butcher, Luong, Plant, Wall,
  // Ratcliff, Dobrowner, Burtynsky, Crewdson, Weston, Porter, Misrach).
  // Lineage discussion belongs in the artist statement, not in 30-word
  // per-image notes. Soft enforcement: rationales containing a banned
  // surname are dropped from the returned Map; the caller keeps the
  // existing placeholder string for that image.
  it('drops rationales containing photographer surname name-drops (Note 25)', async () => {
    create.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            rationales: [
              { image_id: 1, rationale: 'deep-blue palette matches the winners\' color register' },
              { image_id: 6, rationale: 'roadside vernacular signals Stephen Shore lineage the panel has rewarded twice' },
              { image_id: 11, rationale: 'in the Adams tradition that informs this cohort\'s exposure discipline' },
            ],
          }),
        },
      ],
    });
    const { generateSampleRationales } = await import('@/lib/agents/package-drafter');
    const m = await generateSampleRationales(opp, 'r', images);
    // Image 1 is clean → kept. Images 6 (Shore) and 11 (Adams) → dropped.
    expect(m.size).toBe(1);
    expect(m.get(1)).toMatch(/deep-blue palette/);
    expect(m.has(6)).toBe(false);
    expect(m.has(11)).toBe(false);
  });
});

describe('findRationaleLineageNameDrops — direct linter (Note 25)', () => {
  it('flags Adams / Shore / Sugimoto / Lik / Eggleston / Butcher / Luong by surname', async () => {
    const { findRationaleLineageNameDrops } = await import('@/lib/agents/package-drafter');
    expect(findRationaleLineageNameDrops('in the Adams tradition')).toContain('Adams');
    expect(findRationaleLineageNameDrops('signals Stephen Shore lineage')).toContain('Shore');
    expect(findRationaleLineageNameDrops('Sugimoto-register seascape')).toContain('Sugimoto');
    expect(findRationaleLineageNameDrops('Lik-saturation register')).toContain('Lik');
    expect(findRationaleLineageNameDrops('mid-century Eggleston color')).toContain('Eggleston');
    expect(findRationaleLineageNameDrops('Butcher-tier Florida swamp')).toContain('Butcher');
    expect(findRationaleLineageNameDrops('national park survey echoing Luong')).toContain('Luong');
  });

  it('does NOT flag clean rationales with no surname mentions', async () => {
    const { findRationaleLineageNameDrops } = await import('@/lib/agents/package-drafter');
    expect(findRationaleLineageNameDrops('deep-blue palette matches the winners\' color register')).toEqual([]);
    expect(findRationaleLineageNameDrops('vertical orientation echoes the cohort\'s preferred crop discipline')).toEqual([]);
    expect(findRationaleLineageNameDrops('boulder repoussoir at the wide-angle near edge')).toEqual([]);
  });

  it('does NOT false-positive on lowercase common nouns ("wall", "porter", "weston" inside other words)', async () => {
    const { findRationaleLineageNameDrops } = await import('@/lib/agents/package-drafter');
    // \b word-bounded + case-sensitive: "wall" lowercase must not fire as Wall.
    expect(findRationaleLineageNameDrops('the canyon wall reflects the late light')).toEqual([]);
    // "porter" lowercase common-noun.
    expect(findRationaleLineageNameDrops('the porter hut at the trailhead')).toEqual([]);
    // Substring "Weston" inside "Westonbirt" should NOT match — \b boundaries.
    expect(findRationaleLineageNameDrops('Westonbirt arboretum series')).toEqual([]);
  });
});

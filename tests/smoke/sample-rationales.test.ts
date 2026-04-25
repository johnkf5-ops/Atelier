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
              { image_id: 6, rationale: 'roadside vernacular signals Stephen Shore lineage the panel has rewarded twice' },
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
    expect(m.get(6)).toMatch(/Shore lineage/);
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
});

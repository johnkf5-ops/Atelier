import { describe, it, expect } from 'vitest';
import {
  buildSessionResources,
  buildRubricPrompt,
  defaultMountPath,
  type PortfolioRef,
  type OpportunityForRubric,
} from '@/lib/agents/rubric-matcher';

/**
 * WALKTHROUGH Note 27 (CRITICAL): Anthropic Managed Agents file resources
 * SILENTLY IGNORE custom mount_path. Files mount only at the SDK default
 * /mnt/session/uploads/<file_id>. The Rubric was reading at non-existent
 * /workspace/portfolio/... paths and falling back to text-only scoring
 * for the entire run history since Note 8 shipped.
 *
 * This suite enforces the contract: buildSessionResources must NOT pass
 * mount_path on file resources, and buildRubricPrompt must reference the
 * file_id-based paths the agent will actually receive.
 *
 * Probe script: scripts/probe-mount.mjs (live regression diagnostic).
 */

const portfolio: PortfolioRef[] = [
  { id: 1, thumb_url: 'https://example.com/1.jpg', file_id: 'file_aaa1' },
  { id: 6, thumb_url: 'https://example.com/6.jpg', file_id: 'file_aaa6' },
  { id: 11, thumb_url: 'https://example.com/11.jpg', file_id: 'file_aaa11' },
  // Image without a file_id (upload failed) — should be skipped from resources
  // and from the prompt's portfolio block.
  { id: 99, thumb_url: 'https://example.com/99.jpg' },
];

const opportunities: OpportunityForRubric[] = [
  {
    id: 1,
    name: 'Test Award',
    url: 'https://example.com/award',
    prestige_tier: 'mid',
    past_recipients: [
      {
        name: 'Mark Chen',
        year: 2023,
        image_urls: ['https://example.com/mark1.jpg', 'https://example.com/mark2.jpg'],
        file_ids: ['file_bbb1', 'file_bbb2'],
      },
    ],
  },
];

describe('buildSessionResources — Note 27 contract', () => {
  it('omits mount_path on every file resource', () => {
    const resources = buildSessionResources(portfolio, opportunities);
    expect(resources.length).toBeGreaterThan(0);
    for (const r of resources) {
      expect(r).not.toHaveProperty('mount_path');
    }
  });

  it('includes one resource per unique file_id', () => {
    const resources = buildSessionResources(portfolio, opportunities);
    // 3 portfolio file_ids + 2 recipient file_ids = 5 unique.
    expect(resources.length).toBe(5);
    const fileIds = resources.map((r) => r.file_id).sort();
    expect(fileIds).toEqual(
      ['file_aaa1', 'file_aaa11', 'file_aaa6', 'file_bbb1', 'file_bbb2'].sort(),
    );
  });

  it('skips portfolio entries with no file_id', () => {
    const resources = buildSessionResources(portfolio, opportunities);
    expect(resources.find((r) => r.file_id === undefined)).toBeUndefined();
  });

  it('dedupes on file_id when the same file appears twice (e.g. Scout re-ran)', () => {
    const dupOpps: OpportunityForRubric[] = [
      {
        ...opportunities[0],
        past_recipients: [
          { ...opportunities[0].past_recipients[0] },
          { ...opportunities[0].past_recipients[0] }, // duplicate recipient row
        ],
      },
    ];
    const resources = buildSessionResources(portfolio, dupOpps);
    // Same 5 unique file_ids — no doubles.
    expect(resources.length).toBe(5);
  });

  it('every resource is shape { type: "file", file_id: string }', () => {
    const resources = buildSessionResources(portfolio, opportunities);
    for (const r of resources) {
      expect(r.type).toBe('file');
      expect(typeof r.file_id).toBe('string');
      expect(r.file_id.length).toBeGreaterThan(0);
      // Exactly two keys — no mount_path leaked.
      expect(Object.keys(r).sort()).toEqual(['file_id', 'type']);
    }
  });
});

describe('defaultMountPath', () => {
  it('returns /mnt/session/uploads/<file_id>', () => {
    expect(defaultMountPath('file_xyz')).toBe('/mnt/session/uploads/file_xyz');
  });
});

describe('buildRubricPrompt — Note 27 contract', () => {
  it('lists portfolio with file_id-based mount paths, not /workspace/portfolio/*', () => {
    const prompt = buildRubricPrompt(
      { identity: { artist_name: 'A' } } as never,
      { career_positioning_read: 'r' } as never,
      portfolio,
      opportunities,
    );
    expect(prompt).toContain('/mnt/session/uploads/file_aaa1');
    expect(prompt).toContain('/mnt/session/uploads/file_aaa6');
    expect(prompt).toContain('/mnt/session/uploads/file_aaa11');
    // Pre-Note-27 convention must NOT appear in the prompt anywhere.
    expect(prompt).not.toContain('/workspace/portfolio/');
    expect(prompt).not.toContain('/workspace/recipients/');
  });

  it('lists recipient images with file_id-based mount paths', () => {
    const prompt = buildRubricPrompt(
      { identity: { artist_name: 'A' } } as never,
      { career_positioning_read: 'r' } as never,
      portfolio,
      opportunities,
    );
    expect(prompt).toContain('/mnt/session/uploads/file_bbb1');
    expect(prompt).toContain('/mnt/session/uploads/file_bbb2');
  });

  it('preserves the image_id semantic label so persist_match.supporting_image_ids stays correct', () => {
    const prompt = buildRubricPrompt(
      { identity: { artist_name: 'A' } } as never,
      { career_positioning_read: 'r' } as never,
      portfolio,
      opportunities,
    );
    // Image 1's line should pair the semantic id with the file_id-based path.
    expect(prompt).toMatch(/image 1:\s*\/mnt\/session\/uploads\/file_aaa1/);
    expect(prompt).toMatch(/image 6:\s*\/mnt\/session\/uploads\/file_aaa6/);
  });

  it('omits portfolio entries without a file_id from the block', () => {
    const prompt = buildRubricPrompt(
      { identity: { artist_name: 'A' } } as never,
      { career_positioning_read: 'r' } as never,
      portfolio,
      opportunities,
    );
    // Image id=99 had no file_id — it must not appear in the portfolio block.
    expect(prompt).not.toMatch(/image 99:\s*\/mnt\/session\/uploads/);
  });

  it('handles a recipient with zero usable file_ids by labeling "no images available"', () => {
    const oppsNoFids: OpportunityForRubric[] = [
      {
        id: 5,
        name: 'No Images Award',
        url: 'https://example.com',
        prestige_tier: 'mid',
        past_recipients: [
          {
            name: 'Empty Recipient',
            year: 2024,
            image_urls: [],
            file_ids: [],
          },
        ],
      },
    ];
    const prompt = buildRubricPrompt(
      { identity: { artist_name: 'A' } } as never,
      { career_positioning_read: 'r' } as never,
      portfolio,
      oppsNoFids,
    );
    expect(prompt).toMatch(/Empty Recipient.*no images available/s);
  });

  it('vision-access instructions reference /mnt/session/uploads/ paths, not /workspace/', () => {
    const prompt = buildRubricPrompt(
      { identity: { artist_name: 'A' } } as never,
      { career_positioning_read: 'r' } as never,
      portfolio,
      opportunities,
    );
    expect(prompt).toMatch(/\/mnt\/session\/uploads\/<file_id>/);
    expect(prompt).not.toMatch(/\/workspace\/portfolio\/<id>\.jpg/);
    expect(prompt).not.toMatch(/\/workspace\/recipients\/opp<id>/);
  });
});

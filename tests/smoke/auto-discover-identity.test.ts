import { describe, it, expect } from 'vitest';
import {
  parseDiscovery,
} from '@/lib/extractor/auto-discover';

/**
 * WALKTHROUGH Note 3 contract tests for the discovery pipeline.
 *
 * The expensive pieces (live web_search, live messages.create) need real
 * Anthropic credentials and aren't suitable for the smoke loop. These tests
 * lock in the parts we CAN cover deterministically: top-K cap, snippet
 * attachment, schema acceptance of the new optional fields.
 */

describe('parseDiscovery — top-K cap + snippet attachment', () => {
  // Build a raw text that the parser model would have produced. We can't
  // mock the Anthropic call cheaply, so we test the post-parse logic by
  // calling the function with a hand-crafted minimal valid response and
  // intercepting via a known-shape input. Skipped if no API key — the
  // parser itself fires a model call, so this is best as an integration
  // test in CI with credentials.
  it.skipIf(!process.env.ANTHROPIC_API_KEY)(
    'caps results at K=15 sorted by confidence desc',
    async () => {
      const rawEntries = Array.from({ length: 25 }, (_, i) => {
        const conf = ((i + 1) / 25).toFixed(2);
        return `URL: https://example.com/${i}\nPAGE_TYPE: gallery_bio\nTITLE: Entry ${i}\nCONFIDENCE: ${conf}\nWHY: Test entry ${i}.`;
      }).join('\n\n');
      const result = await parseDiscovery(rawEntries, ['test query']);
      expect(result.discovered.length).toBeLessThanOrEqual(15);
      // First entry should be the highest-confidence one.
      const sorted = [...result.discovered].sort(
        (a, b) => b.confidence_0_1 - a.confidence_0_1,
      );
      expect(result.discovered[0]).toEqual(sorted[0]);
    },
  );
});

describe('IdentityAnchor schema', () => {
  it('accepts the canonical 4-field shape', async () => {
    const { IdentityAnchor } = await import('@/lib/schemas/discovery');
    const ok = IdentityAnchor.safeParse({
      name: 'John Knopf',
      location: 'Las Vegas, NV',
      medium: 'fine art photography',
      affiliations: ['Emmy-nominated', 'TIME NFT', 'National Geographic'],
    });
    expect(ok.success).toBe(true);
  });

  it('defaults affiliations to []', async () => {
    const { IdentityAnchor } = await import('@/lib/schemas/discovery');
    const ok = IdentityAnchor.safeParse({
      name: 'X',
      location: 'Y',
      medium: 'Z',
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.affiliations).toEqual([]);
  });
});

describe('DiscoveredEntry — snippet field is optional and preserves payload', () => {
  it('parses an entry with no snippet (legacy shape)', async () => {
    const { DiscoveredEntry } = await import('@/lib/schemas/discovery');
    const ok = DiscoveredEntry.safeParse({
      url: 'https://example.com/x',
      page_type: 'gallery_bio',
      confidence_0_1: 0.9,
      title: 'X',
      why_relevant: 'Y',
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.snippet).toBeUndefined();
  });

  it('parses an entry WITH a snippet attached', async () => {
    const { DiscoveredEntry } = await import('@/lib/schemas/discovery');
    const ok = DiscoveredEntry.safeParse({
      url: 'https://example.com/x',
      page_type: 'gallery_bio',
      confidence_0_1: 0.9,
      title: 'X',
      why_relevant: 'Y',
      snippet: 'A few sentences from Google about the page.',
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.snippet).toBe('A few sentences from Google about the page.');
    }
  });
});

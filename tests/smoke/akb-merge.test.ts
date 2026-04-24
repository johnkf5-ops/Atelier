import { describe, it, expect } from 'vitest';
import { mergeAkb } from '@/lib/akb/merge';
import { emptyAkb } from '@/lib/schemas/akb';

describe('mergeAkb provenance', () => {
  it('stamps leaf-path provenance for scalars', () => {
    const base = emptyAkb();
    const { merged } = mergeAkb(
      base,
      { identity: { legal_name: 'Jane Doe' } },
      'ingested:https://example.com/bio',
    );
    expect(merged.identity.legal_name).toBe('Jane Doe');
    expect(merged.source_provenance['identity.legal_name']).toBe('ingested:https://example.com/bio');
  });

  it('manual provenance cannot be overwritten by ingested', () => {
    const base = emptyAkb();
    const step1 = mergeAkb(base, { identity: { legal_name: 'Jane' } }, 'manual');
    const step2 = mergeAkb(
      step1.merged,
      { identity: { legal_name: 'Janet' } },
      'ingested:https://other.com',
    );
    expect(step2.merged.identity.legal_name).toBe('Jane'); // manual wins
    expect(step2.merged.source_provenance['identity.legal_name']).toBe('manual');
  });

  it('deduplicates exhibitions by venue+year+title', () => {
    const base = emptyAkb();
    const step1 = mergeAkb(
      base,
      {
        exhibitions: [
          { title: 'Show A', venue: 'Gallery X', location: 'NYC', year: 2024, type: 'solo' as const },
        ],
      },
      'ingested:https://a.com',
    );
    const step2 = mergeAkb(
      step1.merged,
      {
        exhibitions: [
          { title: 'Show A', venue: 'Gallery X', location: 'NYC', year: 2024, type: 'solo' as const },
          { title: 'Show B', venue: 'Gallery Y', location: 'LA', year: 2025, type: 'group' as const },
        ],
      },
      'ingested:https://b.com',
    );
    expect(step2.merged.exhibitions.length).toBe(2); // A deduped, B added
  });
});

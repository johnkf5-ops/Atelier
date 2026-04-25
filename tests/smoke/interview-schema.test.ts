import { describe, it, expect } from 'vitest';
import { detectGaps } from '@/lib/akb/gaps';
import { migrateArtistName } from '@/lib/akb/persistence';
import { emptyAkb } from '@/lib/schemas/akb';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';

/**
 * WALKTHROUGH Notes 4 + 5 — interview schema for artist_name primary
 * identity + home_base structured + citizenship conditional.
 *
 * These tests lock in the gap-detection + migration contract:
 *   - artist_name ranks above legal_name in the gap list.
 *   - When legal_name_matches_artist_name = true, the legal_name gap is
 *     suppressed (no redundant question).
 *   - When home_base.country is filled, the citizenship gap is suppressed
 *     (interview defaults to home country, only re-asks on opt-out).
 *   - migrateArtistName auto-fills artist_name from legal_name on load
 *     for AKBs written before the field existed.
 */

describe('detectGaps — Notes 4 + 5 ordering', () => {
  it('ranks identity.artist_name as the top gap on a fresh AKB', () => {
    const akb = emptyAkb();
    const gaps = detectGaps(akb);
    expect(gaps[0]?.path).toBe('identity.artist_name');
  });

  it('suppresses identity.legal_name when artist_name is set + marker is true', () => {
    const akb: ArtistKnowledgeBase = {
      ...emptyAkb(),
      identity: {
        ...emptyAkb().identity,
        artist_name: 'John Knopf',
        legal_name: '', // empty
        legal_name_matches_artist_name: true,
      },
    };
    const paths = detectGaps(akb).map((g) => g.path);
    expect(paths).not.toContain('identity.legal_name');
  });

  it('still asks for legal_name when the user opted out of the default', () => {
    const akb: ArtistKnowledgeBase = {
      ...emptyAkb(),
      identity: {
        ...emptyAkb().identity,
        artist_name: 'Stage Name',
        legal_name: '', // empty
        legal_name_matches_artist_name: false,
      },
    };
    const paths = detectGaps(akb).map((g) => g.path);
    expect(paths).toContain('identity.legal_name');
  });

  it('suppresses identity.citizenship once home_base.country is set', () => {
    const akb: ArtistKnowledgeBase = {
      ...emptyAkb(),
      identity: {
        ...emptyAkb().identity,
        artist_name: 'X',
        home_base: { city: 'Las Vegas', state: 'NV', country: 'USA' },
      },
    };
    const paths = detectGaps(akb).map((g) => g.path);
    expect(paths).not.toContain('identity.citizenship');
  });

  it('still asks for citizenship when country is empty', () => {
    const akb: ArtistKnowledgeBase = {
      ...emptyAkb(),
      identity: {
        ...emptyAkb().identity,
        artist_name: 'X',
      },
    };
    const paths = detectGaps(akb).map((g) => g.path);
    expect(paths).toContain('identity.citizenship');
  });
});

describe('migrateArtistName — back-compat for pre-Note-4 AKBs', () => {
  it('auto-fills artist_name from legal_name when missing', () => {
    const akb: ArtistKnowledgeBase = {
      ...emptyAkb(),
      identity: {
        ...emptyAkb().identity,
        legal_name: 'Jane Doe',
      },
    };
    const migrated = migrateArtistName(akb);
    expect(migrated.identity.artist_name).toBe('Jane Doe');
    expect(migrated.identity.legal_name_matches_artist_name).toBe(true);
  });

  it('is a no-op when artist_name is already populated', () => {
    const akb: ArtistKnowledgeBase = {
      ...emptyAkb(),
      identity: {
        ...emptyAkb().identity,
        artist_name: 'Stage Name',
        legal_name: 'Legal Name',
        legal_name_matches_artist_name: false,
      },
    };
    const migrated = migrateArtistName(akb);
    expect(migrated.identity.artist_name).toBe('Stage Name');
    expect(migrated.identity.legal_name).toBe('Legal Name');
    expect(migrated.identity.legal_name_matches_artist_name).toBe(false);
  });

  it('leaves AKB alone if legal_name is also empty', () => {
    const akb: ArtistKnowledgeBase = {
      ...emptyAkb(),
      identity: {
        ...emptyAkb().identity,
        legal_name: '',
      },
    };
    const migrated = migrateArtistName(akb);
    expect(migrated.identity.artist_name).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { StyleFingerprint } from '@/lib/schemas/style-fingerprint';

describe('StyleFingerprint schema', () => {
  it('accepts a minimal valid fingerprint', () => {
    const good = {
      composition_tendencies: ['centered axial'],
      palette: {
        dominant_temperature: 'cool',
        saturation_register: 'muted',
        notable_palette_notes: ['slate + rust'],
      },
      subject_categories: ['landscape'],
      light_preferences: ['blue hour'],
      formal_lineage: ['Adams'],
      career_positioning_read: 'Mid-career landscape photographer.',
      museum_acquisition_signals: [],
      weak_signals: [],
    };
    expect(StyleFingerprint.safeParse(good).success).toBe(true);
  });

  it('rejects invalid enum for palette.dominant_temperature', () => {
    const bad = {
      composition_tendencies: [],
      palette: { dominant_temperature: 'rainbow', saturation_register: 'muted', notable_palette_notes: [] },
      subject_categories: [],
      light_preferences: [],
      formal_lineage: [],
      career_positioning_read: '',
      museum_acquisition_signals: [],
      weak_signals: [],
    };
    expect(StyleFingerprint.safeParse(bad).success).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(StyleFingerprint.safeParse({ composition_tendencies: [] }).success).toBe(false);
  });
});

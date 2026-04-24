import { z } from 'zod';

export const StyleFingerprint = z.object({
  composition_tendencies: z.array(z.string()),
  palette: z.object({
    dominant_temperature: z.enum(['cool', 'warm', 'neutral', 'mixed']),
    saturation_register: z.enum(['muted', 'natural', 'saturated']),
    notable_palette_notes: z.array(z.string()),
  }),
  subject_categories: z.array(z.string()),
  light_preferences: z.array(z.string()),
  formal_lineage: z.array(z.string()),
  career_positioning_read: z.string(),
  museum_acquisition_signals: z.array(z.string()),
  weak_signals: z.array(z.string()),
});

export type StyleFingerprint = z.infer<typeof StyleFingerprint>;

// Partial used by chunk-level analysis before final synthesis.
export const PartialStyleFingerprint = StyleFingerprint.partial();
export type PartialStyleFingerprint = z.infer<typeof PartialStyleFingerprint>;

import { z } from 'zod';

export const AutoDiscoverInput = z.object({
  name: z.string().min(1),
  medium: z.string().min(1),
  location: z.string().min(1), // city/state, e.g. "Las Vegas, NV"
  affiliations: z.array(z.string()).default([]),
});
export type AutoDiscoverInput = z.infer<typeof AutoDiscoverInput>;

export const DiscoveredEntry = z.object({
  url: z.string().url(),
  page_type: z.enum([
    'personal_site',
    'gallery_bio',
    'press_feature',
    'interview',
    'museum_collection',
    'exhibition_listing',
    'publication',
    'award_announcement',
    'social_profile',
    'other',
  ]),
  confidence_0_1: z.number().min(0).max(1),
  title: z.string(),
  why_relevant: z.string(),
});
export type DiscoveredEntry = z.infer<typeof DiscoveredEntry>;

export const DiscoveryResult = z.object({
  queries_executed: z.array(z.string()),
  discovered: z.array(DiscoveredEntry),
  disambiguation_notes: z.string().nullable().default(null),
});
export type DiscoveryResult = z.infer<typeof DiscoveryResult>;

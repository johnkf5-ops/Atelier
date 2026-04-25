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
  // Snippet captured from web_search per-URL during discovery. Used as the
  // fallback source-of-truth when web_fetch fails (404/403/JS-rendered SPA
  // returns empty body). WALKTHROUGH Note 3.
  snippet: z.string().optional(),
});

/**
 * Identity anchor passed to per-source extraction. Any fact extracted from
 * a page that doesn't unambiguously describe THIS identity is rejected
 * before write — eliminates the "wrong John Knopf" failure mode where a
 * same-name search hit pollutes the AKB.
 */
export const IdentityAnchor = z.object({
  name: z.string().min(1),
  location: z.string().min(1),
  medium: z.string().min(1),
  affiliations: z.array(z.string()).default([]),
});
export type IdentityAnchor = z.infer<typeof IdentityAnchor>;
export type DiscoveredEntry = z.infer<typeof DiscoveredEntry>;

export const DiscoveryResult = z.object({
  queries_executed: z.array(z.string()),
  discovered: z.array(DiscoveredEntry),
  disambiguation_notes: z.string().nullable().default(null),
});
export type DiscoveryResult = z.infer<typeof DiscoveryResult>;

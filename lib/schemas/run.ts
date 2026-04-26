import { z } from 'zod';

// WALKTHROUGH Note 35: opportunity-type filter. Photographers don't always
// want every type of opportunity in every run — sometimes you want
// competitions only; sometimes you're book-shopping; sometimes you're
// looking for grants and not interested in residencies right now. Scout
// reads the selected types and emits ONLY opportunities matching the
// allowed set. Defaults to all types ON.
export const OPPORTUNITY_TYPES = [
  'competitions',
  'grants',
  'residencies',
  'photo_books',
  'portfolio_reviews',
  'museum_acquisition',
  'commissions',
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export const OPPORTUNITY_TYPE_LABELS: Record<OpportunityType, { label: string; explainer: string }> = {
  competitions: {
    label: 'Competitions',
    explainer: 'POTY-style photo prizes — IPA, ILPOTY, FAPA, NLPA, Epson Pano, etc.',
  },
  grants: {
    label: 'Grants',
    explainer: 'Foundation + state arts council grants — Aaron Siskind, En Foco, Pollock-Krasner, state arts fellowships',
  },
  residencies: {
    label: 'Residencies',
    explainer: 'Funded studio time at photography residencies — Light Work, Penumbra, Visual Studies Workshop',
  },
  photo_books: {
    label: 'Photo books',
    explainer: 'Monograph publisher open submissions and photo-book prizes — Aperture, MACK, Lucie Photo Book',
  },
  portfolio_reviews: {
    label: 'Portfolio reviews',
    explainer: 'Get your work in front of curators face-to-face — FotoFest, Photolucida, Filter Photo',
  },
  museum_acquisition: {
    label: 'Museum acquisition tracks',
    explainer: 'Competitions feeding into museum collections — Critical Mass, Hariban, BJP',
  },
  commissions: {
    label: 'Public art commissions',
    explainer: 'RFQs for installed photographic work — civic, hospitality, university',
  },
};

export const RunConfig = z.object({
  window_start: z.string(), // ISO date — opportunities with deadlines >= this
  window_end: z.string(), // ISO date — and <= this
  budget_usd: z.number().default(0), // 0 = no entry-fee penalty
  max_travel_miles: z.number().nullable().default(null), // null = no residency travel cap
  eligibility_overrides: z.record(z.string(), z.unknown()).optional(),
  // WALKTHROUGH Note 17c: user-configurable target opportunity count.
  // Standard = 25; Scout's prompt reads this and emits a ±5 range so the
  // agent has slight slack on either side of the target.
  target_opportunity_count: z.number().int().min(5).max(80).default(25),
  // WALKTHROUGH Note 35: opportunity-type filter (see OPPORTUNITY_TYPES above).
  // Defaults to all types ON. Scout reads this and rejects opportunities
  // outside the selected set. .min(1) prevents an empty-slate run from a
  // direct API call (the UI already disables the Start button when empty,
  // but the API needs its own floor).
  opportunity_types: z
    .array(z.enum(OPPORTUNITY_TYPES))
    .min(1, 'at least one opportunity type must be selected')
    .default([...OPPORTUNITY_TYPES]),
});
export type RunConfig = z.infer<typeof RunConfig>;

export type RunStatus =
  | 'queued'
  | 'scout_running'
  | 'scout_complete'
  | 'finalizing_scout'
  | 'rubric_running'
  | 'rubric_complete'
  | 'finalizing'
  | 'complete'
  | 'error';

export function defaultWindow(): { window_start: string; window_end: string } {
  const now = new Date();
  const end = new Date(now);
  end.setMonth(end.getMonth() + 6);
  return {
    window_start: now.toISOString().slice(0, 10),
    window_end: end.toISOString().slice(0, 10),
  };
}

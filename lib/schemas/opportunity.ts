import { z } from 'zod';

export const Opportunity = z.object({
  source: z.string(), // 'cafe' | 'nea' | 'macdowell' | ...
  source_id: z.string(),
  name: z.string(),
  url: z.string(),
  deadline: z.string().optional(), // ISO date
  award: z.object({
    type: z.enum(['grant', 'residency', 'prize', 'commission', 'representation']),
    amount_usd: z.number().optional(),
    in_kind: z.string().optional(),
    prestige_tier: z.enum(['flagship', 'major', 'mid', 'regional', 'open-call']),
  }),
  eligibility: z.object({
    citizenship: z.array(z.string()).optional(),
    career_stage: z.array(z.string()).optional(),
    medium: z.array(z.string()).optional(),
    // age_range was z.tuple([z.number(), z.number()]) — zod-to-json-schema emits
    // OpenAPI-3 `items: [schema, schema]` for tuples, which Anthropic's internal
    // model validator rejects with a 500 "internal service error" at run time
    // (isolated via probe-scout-config.ts 2026-04-24). Two-element array
    // preserves intent without the tuple syntax.
    age_range: z.array(z.number()).optional(),
    residency_required: z.string().optional(),
  }),
  entry_fee_usd: z.number().optional(),
  past_recipient_archive_url: z.string().optional(),
});
export type Opportunity = z.infer<typeof Opportunity>;

export const RecipientWithUrls = z.object({
  recipient_name: z.string(),
  // .nullable() produces `nullable: true` in OpenAPI 3 — Anthropic's internal
  // validator may not recognize it. .optional() is safer; parser-side we
  // accept undefined as "year unknown".
  year: z.number().optional(),
  image_urls: z.array(z.string().url()).max(5),
});
export type RecipientWithUrls = z.infer<typeof RecipientWithUrls>;

export const OpportunityWithRecipientUrls = Opportunity.extend({
  past_recipient_image_urls: z.array(RecipientWithUrls).max(3),
});
export type OpportunityWithRecipientUrls = z.infer<typeof OpportunityWithRecipientUrls>;

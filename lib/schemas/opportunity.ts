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
    age_range: z.tuple([z.number(), z.number()]).optional(),
    residency_required: z.string().optional(),
  }),
  entry_fee_usd: z.number().optional(),
  past_recipient_archive_url: z.string().optional(),
});
export type Opportunity = z.infer<typeof Opportunity>;

export const RecipientWithUrls = z.object({
  recipient_name: z.string(),
  year: z.number().nullable(),
  image_urls: z.array(z.string().url()).max(5),
});
export type RecipientWithUrls = z.infer<typeof RecipientWithUrls>;

export const OpportunityWithRecipientUrls = Opportunity.extend({
  past_recipient_image_urls: z.array(RecipientWithUrls).max(3),
});
export type OpportunityWithRecipientUrls = z.infer<typeof OpportunityWithRecipientUrls>;

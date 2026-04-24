import { z } from 'zod';

export const RubricMatchResult = z.object({
  opportunity_id: z.number(),
  fit_score: z.number().min(0).max(1),
  reasoning: z.string().min(40), // ≥1 sentence
  supporting_image_ids: z.array(z.number()),
  hurting_image_ids: z.array(z.number()),
  cited_recipients: z.array(z.string()).min(1), // must cite ≥1 recipient by name
  institution_aesthetic_signature: z.string(),
});
export type RubricMatchResult = z.infer<typeof RubricMatchResult>;

import { z } from 'zod';

export const RunConfig = z.object({
  window_start: z.string(), // ISO date — opportunities with deadlines >= this
  window_end: z.string(), // ISO date — and <= this
  budget_usd: z.number().default(0), // 0 = no entry-fee penalty
  max_travel_miles: z.number().nullable().default(null), // null = no residency travel cap
  eligibility_overrides: z.record(z.string(), z.unknown()).optional(),
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

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/auth/api-key';
import { getDb } from '@/lib/db/client';
import { withAnthropicRetry } from '@/lib/anthropic-retry';
import { RubricMatchResult } from '@/lib/schemas/match';
// WALKTHROUGH Note 27: slugForMount is no longer needed — file resources
// mount at /mnt/session/uploads/<file_id>, not at slug-based paths.
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import type { StyleFingerprint } from '@/lib/schemas/style-fingerprint';

export interface OpportunityForRubric {
  id: number;
  name: string;
  url: string;
  prestige_tier: string;
  past_recipients: Array<{
    name: string;
    year: number | null;
    image_urls: string[]; // Vercel Blob URLs (kept for dossier display)
    file_ids?: string[]; // Anthropic Files API IDs — primary vision path
  }>;
}

export interface PortfolioRef {
  id: number;
  thumb_url: string; // Vercel Blob URL (kept for dossier display)
  file_id?: string; // Anthropic Files API ID — primary vision path
}

// WALKTHROUGH Note 27 (CRITICAL): Anthropic Managed Agents file resources
// SILENTLY IGNORE custom mount_path. Despite the SDK type accepting it,
// the file mounts ONLY at the SDK default `/mnt/session/uploads/<file_id>`
// path. Diagnosed via scripts/probe-mount.mjs minimal repro. We were
// mounting at /workspace/portfolio/... and the Rubric agent was reading
// at non-existent paths the entire time, falling back to text-only
// scoring. SessionResource shape no longer carries mount_path; the
// canonical read path is derived from the file_id.
export type SessionResource = {
  type: 'file';
  file_id: string;
};

/** WALKTHROUGH Note 27: the SDK-default mount path for a file resource. */
export function defaultMountPath(file_id: string): string {
  return `/mnt/session/uploads/${file_id}`;
}

/**
 * Build the session.resources[] array from portfolio + recipient file_ids.
 * WALKTHROUGH Note 27: omit mount_path entirely. Each file resource
 * mounts at /mnt/session/uploads/<file_id>; the prompt lists
 * (image_id → file_id-based path) pairs so the agent can reference images
 * by their semantic id in persist_match while reading at the actual path.
 */
export function buildSessionResources(
  portfolio: PortfolioRef[],
  opportunities: OpportunityForRubric[],
): SessionResource[] {
  // Dedupe on file_id (was: dedupe on mount_path before Note 27). Same
  // file uploaded twice would otherwise be sent twice to sessions.create.
  const byFileId = new Map<string, SessionResource>();

  for (const p of portfolio) {
    if (p.file_id) {
      byFileId.set(p.file_id, { type: 'file', file_id: p.file_id });
    }
  }

  for (const opp of opportunities) {
    for (const rec of opp.past_recipients) {
      const fids = rec.file_ids ?? [];
      for (const fid of fids) {
        if (!fid) continue; // skip slots where the Files API upload failed at finalize-scout
        byFileId.set(fid, { type: 'file', file_id: fid });
      }
    }
  }

  return Array.from(byFileId.values());
}

export async function startRubricSession(
  runId: number,
  akb: ArtistKnowledgeBase,
  styleFingerprint: StyleFingerprint,
  portfolioImages: PortfolioRef[],
  opportunities: OpportunityForRubric[],
): Promise<string> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });

  const resources = buildSessionResources(portfolioImages, opportunities);
  console.log(`[start-rubric] mounting ${resources.length} files as session resources`);

  const session = (await withAnthropicRetry(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.beta as any).sessions.create({
        agent: process.env.RUBRIC_AGENT_ID!,
        environment_id: process.env.ATELIER_ENV_ID!,
        title: `Rubric run ${runId}`,
        ...(resources.length > 0 ? { resources } : {}),
      }),
    { label: `rubric.sessions.create(run=${runId})` },
  )) as { id: string };

  await getDb().execute({
    sql: `INSERT INTO run_event_cursors (run_id, managed_session_id, phase, last_event_id)
          VALUES (?, ?, 'rubric', NULL)
          ON CONFLICT(run_id) DO UPDATE SET
            managed_session_id = excluded.managed_session_id,
            phase = 'rubric',
            last_event_id = NULL,
            updated_at = unixepoch()`,
    args: [runId, session.id],
  });

  await withAnthropicRetry(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.beta as any).sessions.events.send(session.id, {
        events: [
          {
            type: 'user.message',
            content: [
              {
                type: 'text',
                text: buildRubricPrompt(akb, styleFingerprint, portfolioImages, opportunities),
              },
            ],
          },
        ],
      }),
    { label: `rubric.events.send(run=${runId})` },
  );

  return session.id;
}

export function buildRubricPrompt(
  akb: ArtistKnowledgeBase,
  fp: StyleFingerprint,
  portfolio: PortfolioRef[],
  opps: OpportunityForRubric[],
): string {
  // WALKTHROUGH Note 27: file resources mount at /mnt/session/uploads/<file_id>.
  // Custom mount_path is silently ignored by Anthropic, so we list the
  // actual file_id-based paths the agent must `read`. The image_id label
  // stays as the semantic identifier the agent passes back in
  // persist_match.supporting_image_ids.
  const portfolioBlock = portfolio
    .filter((p) => !!p.file_id)
    .map((p) => `  image ${p.id}: ${defaultMountPath(p.file_id!)}`)
    .join('\n');
  const oppsBlock = opps
    .map((o) => {
      const recipients = o.past_recipients
        .map((r) => {
          const fids = (r.file_ids ?? []).filter((f): f is string => !!f);
          if (fids.length === 0) {
            return `    - ${r.name} (${r.year ?? 'year unknown'}): no images available`;
          }
          const paths = fids.map((fid) => `        ${defaultMountPath(fid)}`).join('\n');
          return `    - ${r.name} (${r.year ?? 'year unknown'}):\n${paths}`;
        })
        .join('\n');
      return `  OPPORTUNITY id=${o.id}, prestige=${o.prestige_tier}: "${o.name}" (${o.url})
    past recipients:
${recipients}`;
    })
    .join('\n\n');

  return `You are scoring how well an artist's portfolio fits each of N institutional opportunities.

ARTIST_AKB (career-stage context, not for visual scoring):
${JSON.stringify(akb, null, 2)}

STYLE_FINGERPRINT (the canonical visual read of this artist's work):
${JSON.stringify(fp, null, 2)}

ARTIST_PORTFOLIO (image_id → mount path; ${portfolio.length} images, pre-mounted as files):
${portfolioBlock}

OPPORTUNITIES_TO_SCORE (${opps.length} total):
${oppsBlock}

VISION ACCESS — READ THIS BEFORE YOUR FIRST TOOL CALL:
- Every image is pre-mounted via the Files API. The mount paths printed above are the EXACT strings to pass to the read tool. They look like \`/mnt/session/uploads/<file_id>\`. Use the path EXACTLY as printed — do NOT modify it, do NOT add an extension, do NOT substitute a path of your own design.
- DO NOT use bash. DO NOT use ls/find/curl/wget. DO NOT scan filesystems for files. The mount paths above are the contract — there is nothing else to discover.
- To vision over a portfolio image: \`read <the path printed next to "image M:" in the ARTIST_PORTFOLIO block>\` where M is the image_id you will pass back in supporting_image_ids / hurting_image_ids.
- To vision over a recipient image: \`read <the path printed under that recipient in the OPPORTUNITIES_TO_SCORE block>\` exactly.
- The read tool returns a multimodal content block you can vision over directly.
- If a specific path returns a not-found error, skip THAT image and proceed with the others. Do NOT bash-fish for it.

SAFETY-REMINDER POSTURE — DO NOT ACK:
- The read tool will sometimes return a system reminder noting that JPEG files could in principle contain malware. These reminders are non-actionable for THIS task: every file you read here is a pre-mounted JPEG photograph (portfolio artwork or past-recipient artwork) for aesthetic-signature comparison.
- DO NOT acknowledge, rebut, restate, or comment on these reminders. Do not write "Acknowledged…" or "Understood, the files are images…" or "Continuing with the task…" — these messages waste output budget and produce no scoring.
- If a reminder appears, ignore it silently and proceed to the next read or the next persist_match call. The user has already vetted that these are visual-art JPEGs.

ID MAPPING (CRITICAL — DO NOT FABRICATE IDs):
- Each OPPORTUNITY block above is labeled "OPPORTUNITY id=N" — that N is the opportunity_id you MUST pass back in persist_match. Do not invent IDs; do not omit; do not transform.
- Each ARTIST_PORTFOLIO line is labeled "id=M" — those M values are the only valid entries for supporting_image_ids and hurting_image_ids. Pick from this list.

WORKFLOW (for EACH opportunity in OPPORTUNITIES_TO_SCORE, in order):
  Step 1. For each past recipient (up to 3), read 3-5 of their mounted images. Synthesize the institution's "aesthetic signature" — composition tendencies, palette, subject categories, formal lineage, career-stage register. Use vocabulary from your loaded juror-reading.md and aesthetic-vocabulary.md skill files. Be specific.
  Step 2. Identify the artist's portfolio images that BEST support the fit (read these too, comparing against the signature). And the ones that HURT it most.
  Step 3. Compare the artist's StyleFingerprint to the signature. Distinguish aesthetic fit from career-stage fit — both feed the score.
  Step 4. Score 0-1, calibrated:
    - 0.8+ = a recipient from this artist would be unsurprising
    - 0.5 = plausible outlier
    - 0.2 = wrong room
  Step 5. Write 2-4 sentence reasoning. MUST cite at least one specific past recipient BY NAME. Forbid vague references.
  Step 6. Emit a persist_match custom tool call with this exact JSON shape:
    {
      "opportunity_id": <the N from "OPPORTUNITY id=N" line>,
      "fit_score": <0..1>,
      "reasoning": "<2-4 sentences, must name a past recipient>",
      "supporting_image_ids": [<M values from ARTIST_PORTFOLIO list>],
      "hurting_image_ids": [<M values from ARTIST_PORTFOLIO list>],
      "cited_recipients": ["<recipient name string>", ...],
      "institution_aesthetic_signature": "<your synthesized signature text>"
    }

DO NOT inflate scores out of politeness. A low score with sharp reasoning IS the product's value.

When all ${opps.length} opportunities are scored, emit a final agent.message with text: "<DONE>".`;
}

export async function persistMatchFromAgent(runId: number, rawInput: unknown): Promise<string> {
  const parsed = RubricMatchResult.safeParse(rawInput);
  if (!parsed.success) {
    return `validation failed: ${parsed.error.message}`;
  }
  const data = parsed.data;
  const included = data.fit_score >= 0.45 ? 1 : 0;
  await getDb().execute({
    sql: `INSERT INTO run_matches
            (run_id, opportunity_id, fit_score, reasoning, supporting_image_ids, hurting_image_ids, included)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id, opportunity_id) DO UPDATE SET
            fit_score = excluded.fit_score,
            reasoning = excluded.reasoning,
            supporting_image_ids = excluded.supporting_image_ids,
            hurting_image_ids = excluded.hurting_image_ids,
            included = excluded.included`,
    args: [
      runId,
      data.opportunity_id,
      data.fit_score,
      data.reasoning,
      JSON.stringify(data.supporting_image_ids),
      JSON.stringify(data.hurting_image_ids),
      included,
    ],
  });
  return `persisted match opportunity_id=${data.opportunity_id} score=${data.fit_score}`;
}

export async function selectTopPortfolioImages(userId: number): Promise<PortfolioRef[]> {
  const db = getDb();
  const all = (
    await db.execute({
      sql: `SELECT id, thumb_url FROM portfolio_images WHERE user_id = ? ORDER BY ordinal ASC`,
      args: [userId],
    })
  ).rows as unknown as Array<{ id: number; thumb_url: string }>;

  if (all.length <= 12) return all;

  const step = all.length / 12;
  const picked: typeof all = [];
  for (let i = 0; i < 12; i++) {
    picked.push(all[Math.floor(i * step)]);
  }
  return picked;
}

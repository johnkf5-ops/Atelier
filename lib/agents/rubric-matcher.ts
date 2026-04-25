import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/auth/api-key';
import { getDb } from '@/lib/db/client';
import { withAnthropicRetry } from '@/lib/anthropic-retry';
import { RubricMatchResult } from '@/lib/schemas/match';
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

/**
 * WALKTHROUGH Note 29 (CRITICAL — production vision unlock):
 *
 * Notes 27 (mount path) and 28 (Sharp normalize) were necessary preconditions
 * but not sufficient. Diagnosed via post-Note-28 audit:
 *   - All 15 vision-OK tool_results in run 2 came from web_fetch / web_search
 *   - All 26 read-tool tool_results on mounted files returned text-only
 * Isolated probes with the SAME files in fresh sessions DO return multimodal
 * binary. Difference is SESSION SCALE — probes mount 1-21 files; live Rubric
 * mounts 95. At 95 mounted resources + a large Rubric prompt, the read tool
 * silently switches to text-only mode. This is an Anthropic-side ceiling.
 *
 * NEW ARCHITECTURE (Option B from spec):
 * - DO NOT mount files as session resources at all (zero resources passed).
 * - Send images as image content blocks in user.message events.
 * - Setup message at session start: AKB + StyleFingerprint + portfolio
 *   image content blocks + opp list summary. Portfolio images travel in
 *   the agent's context throughout the session — sent ONCE.
 * - Per-opp message: recipient image content blocks for THAT opp + a
 *   per-opp scoring text instruction. Agent processes opps sequentially.
 * - No read tool involvement. No /mnt/session/uploads/ paths. Vision
 *   happens in the message context naturally.
 *
 * Validated by probe-vision.mjs Path 2 + the multi-image variant.
 */

/** Anthropic image content block shape. */
export type ImageContentBlock = {
  type: 'image';
  source: { type: 'file'; file_id: string };
};

/** A user.message event with arbitrary content blocks. */
export type UserMessageEvent = {
  type: 'user.message';
  content: Array<ImageContentBlock | { type: 'text'; text: string }>;
};

/**
 * Build the setup user.message: AKB + StyleFingerprint + portfolio image
 * content blocks + opp list summary. Sent ONCE at session start. The
 * portfolio images stay in the agent's context for all subsequent per-opp
 * scoring messages.
 */
export function buildRubricSetupMessage(
  akb: ArtistKnowledgeBase,
  fp: StyleFingerprint,
  portfolio: PortfolioRef[],
  opps: OpportunityForRubric[],
): UserMessageEvent {
  const portfolioBlocks: ImageContentBlock[] = portfolio
    .filter((p): p is PortfolioRef & { file_id: string } => !!p.file_id)
    .map((p) => ({ type: 'image', source: { type: 'file', file_id: p.file_id } }));

  const portfolioIdList = portfolio
    .filter((p) => !!p.file_id)
    .map((p) => p.id)
    .join(', ');

  const oppListText = opps
    .map((o) => {
      const recCount = o.past_recipients.reduce(
        (sum, r) => sum + (r.file_ids?.filter(Boolean).length ?? 0),
        0,
      );
      return `  OPPORTUNITY id=${o.id}, prestige=${o.prestige_tier}: "${o.name}" (${o.url}) — ${recCount} recipient images`;
    })
    .join('\n');

  const setupText = `You are scoring how well an artist's portfolio fits each of ${opps.length} institutional opportunities.

ARTIST_AKB (career-stage context, not for visual scoring):
${JSON.stringify(akb, null, 2)}

STYLE_FINGERPRINT (the canonical visual read of this artist's work):
${JSON.stringify(fp, null, 2)}

ARTIST_PORTFOLIO — the ${portfolioBlocks.length} images in THIS message (above this text) are the artist's portfolio. The image_ids in order are: [${portfolioIdList}]. Refer to them by these ids in supporting_image_ids and hurting_image_ids when you emit persist_match.

OPPORTUNITIES TO SCORE (you will receive each opportunity's recipient images in a separate follow-up message):
${oppListText}

WORKFLOW for EACH per-opportunity message that follows:
  Step 1. The message will contain N recipient images for that opportunity, followed by a text block with the opportunity_id, name, recipient names, and the scoring task. Synthesize the institution's "aesthetic signature" from the recipient images you can SEE in the message — composition tendencies, palette, subject categories, formal lineage, career-stage register. Use vocabulary from your loaded juror-reading.md and aesthetic-vocabulary.md skill files. Be specific.
  Step 2. Compare the artist's portfolio (in your context from the setup above) against the signature. Identify which portfolio image_ids BEST support the fit and which HURT it most.
  Step 3. Compare the artist's StyleFingerprint to the signature. Distinguish aesthetic fit from career-stage fit — both feed the score.
  Step 4. Score 0-1, calibrated:
    - 0.8+ = a recipient from this artist would be unsurprising
    - 0.5 = plausible outlier
    - 0.2 = wrong room
  Step 5. Write 2-4 sentence reasoning. MUST cite at least one specific past recipient BY NAME. Forbid vague references.
  Step 6. Emit a persist_match custom tool call with this exact JSON shape:
    {
      "opportunity_id": <the N from the per-opp message>,
      "fit_score": <0..1>,
      "reasoning": "<2-4 sentences, must name a past recipient>",
      "supporting_image_ids": [<ids from the portfolio id list above>],
      "hurting_image_ids": [<ids from the portfolio id list above>],
      "cited_recipients": ["<recipient name string>", ...],
      "institution_aesthetic_signature": "<your synthesized signature text>"
    }

VISION PIPELINE — IMPORTANT:
- Every image you need is delivered as a multimodal content block inside user.messages — NOT mounted as a file. Vision happens directly on the content blocks; no tool call is needed to access an image. Do NOT bash. Do NOT scan filesystems. Do NOT call any tool to fetch the image bytes — they are already attached to the message.
- Look at the images directly in the message content. That is the contract.

ID MAPPING (CRITICAL — DO NOT FABRICATE IDs):
- opportunity_id: comes from the per-opp message text block ("OPPORTUNITY id=N").
- supporting_image_ids / hurting_image_ids: must be values from the portfolio id list printed above ([${portfolioIdList}]). Do not invent ids.

DO NOT inflate scores out of politeness. A low score with sharp reasoning IS the product's value.

Acknowledge nothing. When you receive each per-opp message, perform the workflow and emit persist_match. When all ${opps.length} opportunities are scored, emit a final agent.message with text: "<DONE>".`;

  return {
    type: 'user.message',
    content: [...portfolioBlocks, { type: 'text', text: setupText }],
  };
}

/**
 * Build a per-opportunity user.message: recipient image content blocks for
 * THAT opp followed by a text block with the scoring task. Sent after the
 * setup message; one per opportunity.
 *
 * WALKTHROUGH Note 30: includes a describe-before-score instruction so
 * the agent writes 1-2 specific visible details from the cohort images
 * into persist_match.reasoning. Those details ARE the demonstrable proof
 * that vision engaged — judges reading the dossier text can see
 * specific visual claims that go beyond StyleFingerprint vocabulary.
 */
export function buildRubricOppMessage(opp: OpportunityForRubric): UserMessageEvent {
  const recipientBlocks: ImageContentBlock[] = [];
  const recipientLines: string[] = [];
  for (const r of opp.past_recipients) {
    const fids = (r.file_ids ?? []).filter((f): f is string => !!f);
    if (fids.length === 0) {
      recipientLines.push(`  - ${r.name} (${r.year ?? 'year unknown'}): no images available`);
      continue;
    }
    recipientLines.push(
      `  - ${r.name} (${r.year ?? 'year unknown'}): ${fids.length} image${fids.length === 1 ? '' : 's'} above`,
    );
    for (const fid of fids) {
      recipientBlocks.push({ type: 'image', source: { type: 'file', file_id: fid } });
    }
  }

  const scoringText = `OPPORTUNITY id=${opp.id}, prestige=${opp.prestige_tier}: "${opp.name}" (${opp.url})

The ${recipientBlocks.length} images above this text are past recipients of THIS opportunity:
${recipientLines.join('\n')}

Before scoring, briefly note 1-2 specific visible details from the cohort images (palette, composition, named visual elements, recurring subject types). This is the visual evidence for your fit reasoning — write these details into persist_match.reasoning so the dossier text demonstrates that you actually saw the cohort. Then score per the persist_match contract.

Synthesize the institution's aesthetic signature from these recipient images, compare against the artist's portfolio (in your context from the setup message), score 0-1, and emit persist_match for opportunity_id=${opp.id} per the workflow you were given. Cite at least one of the recipient names listed above in your reasoning.`;

  return {
    type: 'user.message',
    content: [...recipientBlocks, { type: 'text', text: scoringText }],
  };
}

export async function startRubricSession(
  runId: number,
  akb: ArtistKnowledgeBase,
  styleFingerprint: StyleFingerprint,
  portfolioImages: PortfolioRef[],
  opportunities: OpportunityForRubric[],
): Promise<string> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });

  // WALKTHROUGH Note 29: NO resources passed to sessions.create. The
  // resource-mount path silently degrades to text-only at scale. Vision
  // happens via image content blocks in the per-message events below.
  const session = (await withAnthropicRetry(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.beta as any).sessions.create({
        agent: process.env.RUBRIC_AGENT_ID!,
        environment_id: process.env.ATELIER_ENV_ID!,
        title: `Rubric run ${runId}`,
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

  // WALKTHROUGH Note 30: send ONLY the setup message at session start
  // (NOT batched with per-opp messages). Per-opp messages are dispatched
  // sequentially by run-poll's sendNextRubricOpp after each idle —
  // per-opp images only enter context for that opp's scoring turn,
  // avoiding the at-scale compaction risk of stuffing 100+ image content
  // blocks into turn 1.
  const setup = buildRubricSetupMessage(akb, styleFingerprint, portfolioImages, opportunities);
  const portfolioImageCount = setup.content.filter((c) => c.type === 'image').length;
  console.log(
    `[start-rubric] Note 30 sequential flow — setup with ${portfolioImageCount} portfolio images sent; ${opportunities.length} per-opp messages will be dispatched by run-poll on idle`,
  );

  await withAnthropicRetry(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.beta as any).sessions.events.send(session.id, {
        events: [setup],
      }),
    { label: `rubric.events.send.setup(run=${runId})` },
  );

  return session.id;
}

/**
 * WALKTHROUGH Note 30: dispatch the next unscored opp's user.message.
 * Called by run-poll once the session goes idle (either after the setup
 * message is acknowledged or after a persist_match round-trip). Returns
 * true if a message was sent (more work pending), false if every opp
 * already has a run_matches row (rubric phase done).
 *
 * Recomputes the next opp from DB state on every call — no in-memory
 * queue, no schema additions. The source of truth for "what's left" is
 * `opportunities JOIN run_opportunities` minus `run_matches.opportunity_id`
 * for this run.
 */
export async function sendNextRubricOpp(
  client: Anthropic,
  runId: number,
  sessionId: string,
): Promise<boolean> {
  const db = getDb();

  // Find the first opportunity for this run that has no run_matches row yet.
  // Order by opportunities.id (matches the start-rubric load order).
  const nextRow = (
    await db.execute({
      sql: `SELECT o.id, o.name, o.url, o.raw_json
            FROM opportunities o
            JOIN run_opportunities ro ON ro.opportunity_id = o.id
            LEFT JOIN run_matches rm ON rm.opportunity_id = o.id AND rm.run_id = ?
            WHERE ro.run_id = ? AND rm.id IS NULL
            ORDER BY o.id ASC
            LIMIT 1`,
      args: [runId, runId],
    })
  ).rows[0] as unknown as
    | { id: number; name: string; url: string; raw_json: string }
    | undefined;

  if (!nextRow) {
    return false;
  }

  const raw = JSON.parse(nextRow.raw_json) as { award?: { prestige_tier?: string } };
  const recRows = (
    await db.execute({
      sql: `SELECT name, year, portfolio_urls, file_ids FROM past_recipients
            WHERE opportunity_id = ? AND portfolio_urls LIKE '%blob.vercel-storage%'
              AND id IN (
                SELECT MAX(id) FROM past_recipients p2
                WHERE p2.opportunity_id = ?
                  AND p2.portfolio_urls LIKE '%blob.vercel-storage%'
                GROUP BY p2.name
              )`,
      args: [nextRow.id, nextRow.id],
    })
  ).rows as unknown as Array<{
    name: string;
    year: number | null;
    portfolio_urls: string;
    file_ids: string | null;
  }>;

  const opp: OpportunityForRubric = {
    id: nextRow.id,
    name: nextRow.name,
    url: nextRow.url,
    prestige_tier: raw.award?.prestige_tier ?? 'open-call',
    past_recipients: recRows.map((rr) => ({
      name: rr.name,
      year: rr.year,
      image_urls: JSON.parse(rr.portfolio_urls) as string[],
      file_ids: rr.file_ids ? (JSON.parse(rr.file_ids) as string[]) : [],
    })),
  };

  const oppMsg = buildRubricOppMessage(opp);
  const recipientImageCount = oppMsg.content.filter((c) => c.type === 'image').length;
  console.log(
    `[run-poll] Note 30 sending opp ${opp.id} "${opp.name}" with ${recipientImageCount} recipient images`,
  );

  await withAnthropicRetry(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.beta as any).sessions.events.send(sessionId, {
        events: [oppMsg],
      }),
    { label: `rubric.events.send.opp(run=${runId},opp=${opp.id})` },
  );

  return true;
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

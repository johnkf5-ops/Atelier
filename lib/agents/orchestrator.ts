import pLimit from 'p-limit';
import { getAnthropic, MODEL_OPUS } from '@/lib/anthropic';
import { withAnthropicRetry } from '@/lib/anthropic-retry';
import { getDb } from '@/lib/db/client';
import { getLogoUrl } from '@/lib/logos';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import type { StyleFingerprint } from '@/lib/schemas/style-fingerprint';
import type { Opportunity } from '@/lib/schemas/opportunity';
import type { RunConfig } from '@/lib/schemas/run';

const PRESTIGE_WEIGHTS: Record<string, number> = {
  flagship: 1.0,
  major: 0.85,
  mid: 0.7,
  regional: 0.55,
  'open-call': 0.4,
};

function computeUrgency(deadline: string | undefined): number {
  if (!deadline) return 0.5;
  const days = (new Date(deadline).getTime() - Date.now()) / 86_400_000;
  if (days < 7) return 0.3;
  if (days < 30) return 1.0;
  if (days < 90) return 0.85;
  return 0.65;
}

function computeAffordability(fee: number | undefined, budget: number): number {
  if (!fee) return 1.0;
  if (budget === 0) return 1.0;
  if (fee > budget) return 0;
  const ratio = fee / budget;
  return 1 - ratio * 0.5;
}

export function compositeScore(fit: number, opp: Opportunity, config: RunConfig): number {
  const prestige = PRESTIGE_WEIGHTS[opp.award.prestige_tier] ?? 0.5;
  const urgency = computeUrgency(opp.deadline);
  const affordability = computeAffordability(opp.entry_fee_usd, config.budget_usd);
  return fit * prestige * urgency * affordability;
}

async function generateCoverNarrative(
  akb: ArtistKnowledgeBase,
  fp: StyleFingerprint,
): Promise<string> {
  const client = getAnthropic();
  const resp = await withAnthropicRetry(
    () =>
      client.messages.create({
        model: MODEL_OPUS,
        max_tokens: 1500,
        thinking: { type: 'adaptive' },
        system:
          "You are writing the COVER PAGE of a Career Dossier for a working visual artist. Synthesize the StyleFingerprint + career highlights from the AKB into a 2-3 paragraph narrative the artist can read aloud. Plain text, no markdown, no preamble. The voice is serious but warm — not a marketing blurb. Lead with the work's formal identity, then the career positioning, then what the dossier ahead will do for them.",
        messages: [
          {
            role: 'user',
            content: `ARTIST_AKB:\n${JSON.stringify(akb, null, 2)}\n\nSTYLE_FINGERPRINT:\n${JSON.stringify(fp, null, 2)}\n\nWrite the cover narrative now.`,
          },
        ],
      }),
    { label: 'orchestrator.cover-narrative' },
  );
  return resp.content.find((b) => b.type === 'text')?.text?.trim() ?? '';
}

async function generateRankingNarrative(
  topMatches: Array<{ opp: Opportunity; fit_score: number; composite: number; reasoning: string }>,
): Promise<string> {
  if (topMatches.length === 0) {
    return 'No included opportunities in this window. Try widening the window or adjusting budget/travel constraints.';
  }
  const client = getAnthropic();
  const matchSummaries = topMatches
    .map(
      (m, i) =>
        `${i + 1}. ${m.opp.name} (composite ${m.composite.toFixed(2)}, fit ${m.fit_score.toFixed(2)}): ${m.reasoning}`,
    )
    .join('\n\n');
  const resp = await withAnthropicRetry(
    () =>
      client.messages.create({
        model: MODEL_OPUS,
        max_tokens: 1500,
        thinking: { type: 'adaptive' },
        system:
          'You are writing the RANKING NARRATIVE section of a Career Dossier — 3-4 paragraphs explaining why the top opportunities are ordered the way they are, what thematic threads connect them, and which to prioritize applying to first. Reference specific opportunities by name. Plain text, no markdown, no preamble.',
        messages: [
          {
            role: 'user',
            content: `TOP ${topMatches.length} OPPORTUNITIES (already composite-ranked):\n\n${matchSummaries}\n\nWrite the ranking narrative now.`,
          },
        ],
      }),
    { label: 'orchestrator.ranking-narrative' },
  );
  return resp.content.find((b) => b.type === 'text')?.text?.trim() ?? '';
}

async function generateFilteredOutBlurb(opp: Opportunity, reasoning: string): Promise<string> {
  const client = getAnthropic();
  const resp = await withAnthropicRetry(
    () =>
      client.messages.create({
        model: MODEL_OPUS,
        max_tokens: 200,
        thinking: { type: 'disabled' },
        system: `Summarize why the given opportunity was filtered out for this artist into ONE sentence starting with "Why not ${opp.name}:". The reasoning provided is the Rubric Matcher's full analysis — boil it down to its sharpest single sentence. Plain text, no markdown, no preamble.`,
        messages: [
          {
            role: 'user',
            content: `OPPORTUNITY: ${opp.name}\nRUBRIC_REASONING: ${reasoning}\n\nWrite the one-sentence "why not" blurb.`,
          },
        ],
      }),
    { label: `orchestrator.filtered-out(${opp.name})` },
  );
  return (
    resp.content.find((b) => b.type === 'text')?.text?.trim() ??
    `Why not ${opp.name}: filtered (reasoning unavailable).`
  );
}

export async function orchestrateDossier(runId: number): Promise<void> {
  const db = getDb();

  const runRow = (
    await db.execute({
      sql: `SELECT akb_version_id, style_fingerprint_id, config_json FROM runs WHERE id = ?`,
      args: [runId],
    })
  ).rows[0] as unknown as {
    akb_version_id: number;
    style_fingerprint_id: number;
    config_json: string;
  };
  const akbJson = ((
    await db.execute({ sql: `SELECT json FROM akb_versions WHERE id = ?`, args: [runRow.akb_version_id] })
  ).rows[0] as unknown as { json: string }).json;
  const fpJson = ((
    await db.execute({
      sql: `SELECT json FROM style_fingerprints WHERE id = ?`,
      args: [runRow.style_fingerprint_id],
    })
  ).rows[0] as unknown as { json: string }).json;
  const akb: ArtistKnowledgeBase = JSON.parse(akbJson);
  const fingerprint: StyleFingerprint = JSON.parse(fpJson);
  const config: RunConfig = JSON.parse(runRow.config_json);

  const matchRows = (
    await db.execute({
      sql: `SELECT rm.id, rm.opportunity_id, rm.fit_score, rm.reasoning, rm.included,
                   o.url, o.raw_json
            FROM run_matches rm
            JOIN opportunities o ON o.id = rm.opportunity_id
            WHERE rm.run_id = ?`,
      args: [runId],
    })
  ).rows as unknown as Array<{
    id: number;
    opportunity_id: number;
    fit_score: number;
    reasoning: string;
    included: number;
    url: string;
    raw_json: string;
  }>;

  const decorated = matchRows.map((row) => {
    const opp: Opportunity = JSON.parse(row.raw_json);
    const composite = row.included === 1 ? compositeScore(row.fit_score, opp, config) : 0;
    return { ...row, opp, composite };
  });

  // Persist composite scores in one batch
  if (decorated.length > 0) {
    await db.batch(
      decorated.map((d) => ({
        sql: `UPDATE run_matches SET composite_score = ? WHERE id = ?`,
        args: [d.composite, d.id],
      })),
    );
  }

  const topIncluded = decorated
    .filter((d) => d.included === 1)
    .sort((a, b) => b.composite - a.composite)
    .slice(0, 15);
  const filteredOutTopK = decorated
    .filter((d) => d.included === 0)
    .sort((a, b) => b.fit_score - a.fit_score)
    .slice(0, 15);

  const llmLimit = pLimit(5);
  const fetchLimit = pLimit(5);

  const [coverNarrative, rankingNarrative] = await Promise.all([
    generateCoverNarrative(akb, fingerprint),
    generateRankingNarrative(topIncluded),
  ]);

  // Filtered-out blurbs (capped concurrency)
  await Promise.all(
    filteredOutTopK.map((d) =>
      llmLimit(async () => {
        try {
          const blurb = await generateFilteredOutBlurb(d.opp, d.reasoning);
          await db.execute({
            sql: `UPDATE run_matches SET filtered_out_blurb = ? WHERE id = ?`,
            args: [blurb, d.id],
          });
        } catch (e) {
          console.warn(`[orchestrator] blurb failed for match ${d.id}: ${(e as Error).message}`);
        }
      }),
    ),
  );

  // Pre-cache logos for all top-N included opportunities
  await Promise.all(
    topIncluded.map((d) =>
      fetchLimit(async () => {
        try {
          await getLogoUrl(d.opportunity_id, d.url);
        } catch {
          /* logo failure is non-fatal */
        }
      }),
    ),
  );

  await db.execute({
    sql: `INSERT INTO dossiers (run_id, cover_narrative, ranking_narrative) VALUES (?, ?, ?)
          ON CONFLICT(run_id) DO UPDATE SET
            cover_narrative = excluded.cover_narrative,
            ranking_narrative = excluded.ranking_narrative`,
    args: [runId, coverNarrative, rankingNarrative],
  });
}

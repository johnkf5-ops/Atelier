import { z } from 'zod';
import { getAnthropic, MODEL_OPUS } from '@/lib/anthropic';
import { detectGaps, type Gap } from '@/lib/akb/gaps';
import {
  PartialArtistKnowledgeBase,
  type ArtistKnowledgeBase as TAkb,
  type PartialArtistKnowledgeBase as TPartialAkb,
} from '@/lib/schemas/akb';
import { parseLooseJson, extractText } from './json-parse';

export type Turn = { role: 'agent' | 'user'; content: string };

export type InterviewResponse = {
  agent_message: string;
  next_field_target: string | null;
  akb_patch: TPartialAkb;
};

const InterviewResponseSchema = z.object({
  agent_message: z.string().min(1),
  next_field_target: z.string().nullable(),
  akb_patch: PartialArtistKnowledgeBase,
});

const SYSTEM_PROMPT = `
You are an art-career interviewer building a structured Artist Knowledge Base (AKB) for a working visual artist. Your job is to:

1. Ask ONE targeted question per turn, aimed at the highest-importance gap remaining.
2. When the user answers, extract the answer into the matching AKB fields and emit a JSON Merge Patch.
3. Be brief and direct. Do not flatter, do not narrate, do not explain why you are asking.
4. If the user's answer is unclear or partial, ask the smallest follow-up to disambiguate; never accept vague text into a field.
5. If the user's answer covers multiple fields, extract all of them in your patch.
6. The artist may not be a strong writer — accept short, plain answers and structure them yourself. Do not push back on tone.

OUTPUT STRICTLY JSON in this shape (no markdown fence, no preamble):
{
  "agent_message": "<your single next message to the user>",
  "next_field_target": "<the AKB field you intend to ask about NEXT, after this turn — or null if AKB is sufficiently complete>",
  "akb_patch": { ... }   // JSON Merge Patch (RFC 7396) — partial AKB containing ONLY the fields evidenced by the user's most recent answer; omit anything you have not learned from the user. Do NOT include source_provenance.
}

For arrays: when adding an exhibition/publication/award, supply the COMPLETE new array for that field (RFC 7396 does not deep-merge arrays). The orchestrator will dedupe before persisting.

If this is the first turn (no user message yet), emit an opening question targeting the top gap and an empty akb_patch ({}).
`.trim();

export async function nextInterviewTurn(args: {
  current_akb: TAkb;
  history: Turn[];
  latest_user_message: string | null;
}): Promise<InterviewResponse> {
  const gaps = detectGaps(args.current_akb);
  const gapSummary = formatGapsForPrompt(gaps.slice(0, 8));

  const messages = buildMessages(args.history, args.latest_user_message, args.current_akb, gapSummary);

  const client = getAnthropic();
  let lastErr: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const finalMessages = lastErr
      ? [
          ...messages,
          {
            role: 'user' as const,
            content: [
              {
                type: 'text' as const,
                text: `Your previous response failed validation: ${lastErr}\nReturn corrected JSON only.`,
              },
            ],
          },
        ]
      : messages;
    const resp = await client.messages.create({
      model: MODEL_OPUS,
      max_tokens: 2000,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: finalMessages,
    });
    const text = extractText(resp.content as Array<{ type: string; text?: string }>);
    let parsed: unknown;
    try {
      parsed = parseLooseJson(text);
    } catch (err) {
      lastErr = `not JSON: ${(err as Error).message}`;
      continue;
    }
    const result = InterviewResponseSchema.safeParse(parsed);
    if (result.success) return result.data;
    lastErr = result.error.message;
  }
  throw new Error(`interview turn failed validation: ${lastErr}`);
}

function buildMessages(
  history: Turn[],
  latest: string | null,
  akb: TAkb,
  gapSummary: string,
) {
  const messages: Array<{ role: 'user' | 'assistant'; content: Array<{ type: 'text'; text: string }> }> = [];
  // Seed: send the AKB + gaps as the first "user" message context block
  messages.push({
    role: 'user',
    content: [
      {
        type: 'text',
        text: `CURRENT AKB (JSON):\n${JSON.stringify(akb, null, 2)}\n\nGAPS (in priority order — ask about the top one this turn):\n${gapSummary}`,
      },
    ],
  });
  for (const t of history) {
    messages.push({
      role: t.role === 'agent' ? 'assistant' : 'user',
      content: [{ type: 'text', text: t.content }],
    });
  }
  if (latest) {
    messages.push({ role: 'user', content: [{ type: 'text', text: latest }] });
  } else if (history.length === 0) {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: '[start the interview — emit your first question targeting the top gap]' }],
    });
  }
  return messages;
}

function formatGapsForPrompt(gaps: Gap[]): string {
  if (gaps.length === 0) return '(no gaps remaining — wrap up the interview gracefully)';
  return gaps
    .map((g, i) => `${i + 1}. ${g.field} — ${g.question_seed}`)
    .join('\n');
}

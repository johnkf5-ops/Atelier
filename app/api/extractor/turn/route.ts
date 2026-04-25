import { NextRequest } from 'next/server';
import { ensureDbReady, getDb } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';
import { loadLatestAkb, saveAkb } from '@/lib/akb/persistence';
import { mergeAkb } from '@/lib/akb/merge';
import { nextInterviewTurn, type Turn } from '@/lib/agents/interview';
import { withApiErrorHandling } from '@/lib/api/response';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  user_message: z.string().nullable(),
});

export const POST = withApiErrorHandling(async (req: NextRequest) => {
  await ensureDbReady();
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const userId = getCurrentUserId();
  const db = getDb();

  // Load history
  const histRow = await db.execute({
    sql: `SELECT role, content FROM extractor_turns
          WHERE user_id = ? ORDER BY turn_index ASC`,
    args: [userId],
  });
  const history: Turn[] = histRow.rows.map((r) => ({
    role: r.role as 'agent' | 'user',
    content: r.content as string,
  }));

  let { akb } = await loadLatestAkb(userId);

  // If user sent a message, append + persist before turn.
  // Compute turn_index atomically from MAX(turn_index)+1 so concurrent
  // submits (the "double-click during the 30s Anthropic call" race) don't
  // both write the same index and collide on the UNIQUE constraint.
  if (parsed.data.user_message !== null) {
    history.push({ role: 'user', content: parsed.data.user_message });
    await db.execute({
      sql: `INSERT INTO extractor_turns (user_id, turn_index, role, content)
            VALUES (?, COALESCE((SELECT MAX(turn_index) + 1 FROM extractor_turns WHERE user_id = ?), 0), ?, ?)`,
      args: [userId, userId, 'user', parsed.data.user_message],
    });
  }

  const turn = await nextInterviewTurn({
    current_akb: akb,
    history: history.slice(0, parsed.data.user_message !== null ? -1 : undefined),
    latest_user_message: parsed.data.user_message,
  });

  // Apply patch + save AKB if anything changed
  let saved: { id: number; version: number } | null = null;
  if (turn.akb_patch && Object.keys(turn.akb_patch).length > 0) {
    // Defensive check (§2.7): model is instructed to send ONLY new array entries,
    // not the full array. If we see an array SHORTER than what's already in AKB,
    // the model regressed — log a warning. mergeAkb's append+dedupe still handles
    // it correctly (treats the "shortened" array as a few entries to add), but
    // surfacing the regression lets us catch prompt drift in the demo.
    for (const [k, v] of Object.entries(turn.akb_patch)) {
      if (Array.isArray(v)) {
        const existingArr = (akb as unknown as Record<string, unknown>)[k];
        if (Array.isArray(existingArr) && v.length < existingArr.length) {
          console.warn(
            `[interview] akb_patch.${k} has ${v.length} items but existing has ${existingArr.length} — model may be re-emitting full array instead of deltas`,
          );
        }
      }
    }
    const { merged, changedFields } = mergeAkb(akb, turn.akb_patch, 'interview');
    if (changedFields.length > 0) {
      saved = await saveAkb(userId, merged, 'interview');
      akb = merged;
    }
  }

  // Persist agent message — same atomic-index pattern as above
  await db.execute({
    sql: `INSERT INTO extractor_turns (user_id, turn_index, role, content, akb_field_targeted)
          VALUES (?, COALESCE((SELECT MAX(turn_index) + 1 FROM extractor_turns WHERE user_id = ?), 0), ?, ?, ?)`,
    args: [userId, userId, 'agent', turn.agent_message, turn.next_field_target],
  });

  return Response.json({
    agent_message: turn.agent_message,
    next_field_target: turn.next_field_target,
    akb,
    saved,
  });
});

export const GET = withApiErrorHandling(async () => {
  await ensureDbReady();
  const userId = getCurrentUserId();
  const db = getDb();
  const r = await db.execute({
    sql: `SELECT turn_index, role, content, akb_field_targeted FROM extractor_turns
          WHERE user_id = ? ORDER BY turn_index ASC`,
    args: [userId],
  });
  return Response.json({ turns: r.rows });
});

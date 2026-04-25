import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/auth/api-key';
import { getDb } from '@/lib/db/client';
import { withAnthropicRetry } from '@/lib/anthropic-retry';
import { persistOpportunityFromAgent } from '@/lib/agents/opportunity-scout';
import { persistMatchFromAgent, sendNextRubricOpp } from '@/lib/agents/rubric-matcher';

/**
 * Handles any pending session.status_idle with stop_reason.type ==='requires_action'
 * by running the referenced custom tool calls host-side and sending user.custom_tool_result.
 */
export async function handleRequiresAction(
  client: Anthropic,
  runId: number,
  sessionId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  newEvents: any[],
): Promise<void> {
  const idleWithAction = [...newEvents].reverse().find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => e.type === 'session.status_idle' && e.stop_reason?.type === 'requires_action',
  );
  if (!idleWithAction) return;

  const eventIdsToHandle: string[] = idleWithAction.stop_reason.event_ids ?? [];
  if (eventIdsToHandle.length === 0) return;

  const db = getDb();
  const placeholders = eventIdsToHandle.map(() => '?').join(',');
  const rows = await db.execute({
    sql: `SELECT payload_json FROM run_events WHERE event_id IN (${placeholders})`,
    args: eventIdsToHandle,
  });

  for (const row of rows.rows) {
    const ev = JSON.parse((row as unknown as { payload_json: string }).payload_json) as {
      id: string;
      type: string;
      name?: string;
      input?: unknown;
    };
    if (ev.type !== 'agent.custom_tool_use') continue;

    let result: string;
    try {
      if (ev.name === 'persist_opportunity') {
        result = await persistOpportunityFromAgent(runId, ev.input);
      } else if (ev.name === 'persist_match') {
        result = await persistMatchFromAgent(runId, ev.input);
      } else {
        result = `unknown tool: ${ev.name}`;
      }
    } catch (err) {
      result = `error: ${(err as Error).message}`;
    }

    await withAnthropicRetry(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client.beta as any).sessions.events.send(sessionId, {
          events: [
            {
              type: 'user.custom_tool_result',
              custom_tool_use_id: ev.id,
              content: [{ type: 'text', text: result }],
            },
          ],
        }),
      { label: `run-poll.events.send(run=${runId},tool_use=${ev.id})` },
    );
  }
}

export async function pollRun(
  req: Request,
  runId: number,
): Promise<Response> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });
  const db = getDb();

  const cursor = await db.execute({
    sql: 'SELECT managed_session_id, phase, last_event_id FROM run_event_cursors WHERE run_id = ?',
    args: [runId],
  });
  if (cursor.rows.length === 0) {
    return Response.json({ events: [], done: false, errored: false, phase: null, runStatus: 'unknown' });
  }
  const { managed_session_id, phase, last_event_id } = cursor.rows[0] as unknown as {
    managed_session_id: string;
    phase: string;
    last_event_id: string | null;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newEvents: any[] = [];
  let latestEventId: string | null = last_event_id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const ev of (client.beta as any).sessions.events.list(managed_session_id)) {
    const e = ev as { id: string; type: string };
    const kind = e.type.includes('.') ? e.type.split('.').slice(1).join('.') : e.type;
    const agent = e.type.split('.')[0];
    const result = await db.execute({
      sql: `INSERT OR IGNORE INTO run_events (run_id, agent, kind, event_id, payload_json) VALUES (?, ?, ?, ?, ?)`,
      args: [runId, agent, kind, e.id, JSON.stringify(ev)],
    });
    if (result.rowsAffected > 0) {
      newEvents.push(ev);
      latestEventId = e.id;
    }
  }
  if (latestEventId !== last_event_id) {
    await db.execute({
      sql: `UPDATE run_event_cursors SET last_event_id = ?, updated_at = unixepoch() WHERE run_id = ?`,
      args: [latestEventId, runId],
    });
  }

  // Handle any requires_action in the NEW events
  await handleRequiresAction(client, runId, managed_session_id, newEvents);

  // Terminal detection
  let lastIdleStopReason: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const idleInBatch = [...newEvents].reverse().find((e: any) => e.type === 'session.status_idle');
  if (idleInBatch) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lastIdleStopReason = (idleInBatch as any).stop_reason?.type ?? null;
  } else {
    const dbIdle = await db.execute({
      sql: `SELECT json_extract(payload_json, '$.stop_reason.type') AS sr
            FROM run_events
            WHERE run_id = ? AND agent = 'session' AND kind = 'status_idle'
            ORDER BY id DESC LIMIT 1`,
      args: [runId],
    });
    lastIdleStopReason = ((dbIdle.rows[0] as unknown as { sr?: string })?.sr) ?? null;
  }

  const sess = (await withAnthropicRetry(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (client.beta as any).sessions.retrieve(managed_session_id),
    { label: `run-poll.sessions.retrieve(run=${runId})` },
  )) as { status: string };
  const sessionTerminal =
    sess.status === 'terminated' ||
    (sess.status === 'idle' && lastIdleStopReason !== null && lastIdleStopReason !== 'requires_action');

  // Compare-and-swap: advance status + fire the next phase ONLY if we're
  // the poll observing the just-terminal transition. Without this, every
  // subsequent poll re-fires finalize-scout (the idle Scout session stays
  // idle forever, sessionTerminal stays true) which walks status back.
  let phaseDone = false;
  if (sessionTerminal) {
    if (phase === 'scout') {
      const cas = await db.execute({
        sql: `UPDATE runs SET status = 'scout_complete' WHERE id = ? AND status = 'scout_running'`,
        args: [runId],
      });
      if (cas.rowsAffected > 0) {
        const { waitUntil } = await import('@vercel/functions');
        waitUntil(fetch(new URL(`/api/runs/${runId}/finalize-scout`, req.url), { method: 'POST' }).catch(() => {}));
        phaseDone = true;
      }
    } else if (phase === 'rubric') {
      // WALKTHROUGH Note 30 sequential dispatch: when the Rubric session
      // goes idle (after setup ack OR after a persist_match round-trip),
      // try to send the next unscored opp's user.message. If there's
      // still work to do, this is NOT a terminal idle — return without
      // marking rubric_complete so the next poll cycle drives the next
      // opp. Only when sendNextRubricOpp returns false (no more opps)
      // do we transition to rubric_complete + fire finalize.
      const sentNext = await sendNextRubricOpp(client, runId, managed_session_id);
      if (!sentNext) {
        const cas = await db.execute({
          sql: `UPDATE runs SET status = 'rubric_complete' WHERE id = ? AND status = 'rubric_running'`,
          args: [runId],
        });
        if (cas.rowsAffected > 0) {
          const { waitUntil } = await import('@vercel/functions');
          waitUntil(fetch(new URL(`/api/runs/${runId}/finalize`, req.url), { method: 'POST' }).catch(() => {}));
          phaseDone = true;
        }
      }
    }
  }

  const statusRow = await db.execute({ sql: `SELECT status FROM runs WHERE id = ?`, args: [runId] });
  const runStatus = ((statusRow.rows[0] as unknown as { status?: string })?.status) ?? 'error';
  const runDone = runStatus === 'complete';
  const runErrored = runStatus === 'error';

  return Response.json({
    events: newEvents,
    phase,
    phaseDone,
    runStatus,
    done: runDone,
    errored: runErrored,
  });
}

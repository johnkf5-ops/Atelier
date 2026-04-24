# Atelier — Build Plan

Companion to `ART_DIRECTOR_SPEC.md`. Dependency-ordered, not calendar-bound. Each phase ends with a verifiable acceptance gate.

---

## Architecture summary (locked — do not relitigate)

- **App:** Next.js 15 (App Router) + React 19 + TypeScript
- **Persistence:** Turso (LibSQL — wire-compatible SQLite, free tier 5GB) via `@libsql/client`. Single DB from day one — no local file, no migration step later
- **Blob storage:** Vercel Blob (free tier 1GB) for portfolio images. Same from day one
- **LLM surface:** `@anthropic-ai/sdk` direct calls + Managed Agents beta (`managed-agents-2026-04-01`). The Managed Agent loop runs on Anthropic's orchestration layer; we do NOT host the agent runtime
- **NOT used:** `@anthropic-ai/claude-agent-sdk` (wrong abstraction — that's for code-editing agents)
- **UI:** Tailwind v4
- **PDF:** `@react-pdf/renderer`
- **Image preprocessing:** `sharp`
- **Validation:** `zod`
- **Deploy:** Vercel for the entire app. No Cloud Run, no separate worker. Long agent runs survive Vercel's 60s function timeout because the agent loop runs at Anthropic; our routes just kick off the session and poll for events
- **Excluded:** voice input, embeddings/vector DB, Athena code reuse

## Repo layout (target)

The repo is `/Users/johnknopf/Projects/foto` (GitHub: `johnkf5-ops/Atelier`, public). Spec + build plan are committed at the bootstrap commit (pre-code lineage in git history). Next.js installs into the same root — no subdirectory wrapper.

```
foto/  (repo root, github.com/johnkf5-ops/Atelier)
├── ART_DIRECTOR_SPEC.md         (committed at bootstrap)
├── ATELIER_BUILD_PLAN.md        (committed at bootstrap)
├── README.md                     (added in Phase 5)
├── app/
│   ├── (onboarding)/
│   │   ├── upload/page.tsx
│   │   ├── interview/page.tsx
│   │   └── review/page.tsx
│   ├── (dashboard)/
│   │   ├── dossier/[runId]/page.tsx
│   │   └── runs/[id]/page.tsx
│   ├── settings/page.tsx
│   ├── api/
│   │   ├── health/route.ts
│   │   ├── portfolio/upload/route.ts
│   │   ├── portfolio/[id]/route.ts        (DELETE)
│   │   ├── portfolio/reorder/route.ts
│   │   ├── extractor/turn/route.ts
│   │   ├── akb/finalize/route.ts
│   │   ├── akb/manual-edit/route.ts
│   │   ├── runs/start/route.ts
│   │   ├── runs/[id]/events/route.ts      (poll-pull)
│   │   ├── runs/[id]/finalize-scout/route.ts  (downloads recipient images to Blob)
│   │   ├── runs/[id]/start-rubric/route.ts    (kicks off Rubric session after Scout completes)
│   │   ├── runs/[id]/finalize/route.ts    (Phase 4 synthesis trigger)
│   │   └── dossier/[id]/pdf/route.ts
│   └── layout.tsx
├── lib/
│   ├── db/
│   │   ├── schema.sql
│   │   ├── client.ts                       (Turso/LibSQL)
│   │   └── migrations.ts
│   ├── storage/
│   │   └── blobs.ts                        (Vercel Blob)
│   ├── auth/
│   │   ├── api-key.ts
│   │   └── user.ts
│   ├── agents/
│   │   ├── style-analyst.ts
│   │   ├── knowledge-extractor.ts
│   │   ├── opportunity-scout.ts            (Managed Agent client)
│   │   ├── rubric-matcher.ts                (Managed Agent client)
│   │   ├── gallery-targeter.ts
│   │   ├── package-drafter.ts
│   │   └── orchestrator.ts
│   ├── schemas/
│   │   ├── akb.ts
│   │   ├── opportunity.ts                   (Opportunity + OpportunityWithRecipientUrls + RecipientWithUrls)
│   │   ├── dossier.ts
│   │   ├── match.ts                         (RubricMatchResult)
│   │   ├── run.ts                           (RunConfig)
│   │   ├── discovery.ts                     (AutoDiscoverInput, DiscoveredEntry, DiscoveryResult)
│   │   └── style-fingerprint.ts
│   ├── pdf/
│   │   └── dossier.tsx
│   ├── logos.ts
│   └── images/
│       └── preprocess.ts
├── skills/
│   ├── opportunity-sources.md
│   ├── aesthetic-vocabulary.md
│   ├── juror-reading.md
│   ├── artist-statement-voice.md
│   ├── project-proposal-structure.md
│   ├── cv-format-by-institution.md
│   ├── eligibility-patterns.md
│   ├── submission-calendar.md
│   ├── past-winner-archives.md
│   └── cost-vs-prestige-tiers.md
├── scripts/
│   └── setup-managed-agents.ts             (one-time: creates env + agents, prints IDs)
├── public/
└── instrumentation.ts                       (runs migrations on boot)
```

---

## Phase 1 — Foundation

**Goal:** A deployed Next.js app with SQLite, schema, settings UI, and the skill-files directory seeded. Nothing AI-functional yet.

### 1.1 Project scaffold

**Bootstrap status:** the `johnkf5-ops/Atelier` GitHub repo already exists (created at planning time, public, contains the spec + build plan as the first commit). Local working dir is `/Users/johnknopf/Projects/foto`. `.gitignore` already has `.env.local`, `.next/`, `node_modules/`.

- [ ] `cd /Users/johnknopf/Projects/foto && pnpm create next-app@latest . --no-git` — installs Next.js INTO the current directory (don't reinit git; we already have the repo). App Router, TypeScript, Tailwind, ESLint
- [ ] Install (production): `pnpm add @anthropic-ai/sdk @libsql/client @vercel/blob @vercel/functions zod@^3 sharp exifr @react-pdf/renderer docx cheerio json-merge-patch p-limit react-dropzone @dnd-kit/core @dnd-kit/sortable zod-to-json-schema`
  - **`zod@^3` is pinned intentionally** — Phase 2 schemas use `.deepPartial()` which is v3-only. zod v4 would crash ingestion + interview + /review on import. If a future bump to v4 is desired, write a recursive deep-partial helper first and replace the call sites.
- [ ] Install (dev): `pnpm add -D @types/node tsx vitest @vitest/ui`
- [ ] Sign up for Turso (free tier 5GB) — create a database `atelier`, get connection URL + auth token
- [ ] Provision Vercel Blob from the Vercel project dashboard — get `BLOB_READ_WRITE_TOKEN`
- [ ] `.env.local` (gitignored — never commit):
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  TURSO_DATABASE_URL=libsql://atelier-<org>.turso.io
  TURSO_AUTH_TOKEN=...
  BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
  ```
- [ ] **Mirror all env vars into Vercel project settings (Production + Preview) before first deploy** — easy to forget; deploy will silently fail otherwise
- [ ] `vercel link` to connect repo to Vercel project; first push will auto-deploy
- [ ] Commit + push: "phase 1.1: scaffold next.js + install deps"

### 1.2 Storage layer

Path A ships with Turso + Vercel Blob from day one. Single-user mode (hardcoded `user_id=1`, API key from env). Path B = "add auth + per-user encrypted keys" only. The interface seam stays so multi-tenant is a swap of `getAnthropicKey()`.

- [ ] `lib/db/client.ts` — exports `getDb()` returning a `@libsql/client` instance:
  ```ts
  import { createClient } from '@libsql/client';
  let _db: ReturnType<typeof createClient> | null = null;
  export function getDb() {
    if (!_db) _db = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
    return _db;
  }
  ```
  All queries are async (`await db.execute(...)`, `await db.batch([...])`). **No app code imports `@libsql/client` directly — always go through `getDb()`.**
- [ ] `lib/db/schema.sql` — full DDL (see schema below). Written in standard SQLite dialect — Turso accepts as-is
- [ ] `lib/db/migrations.ts` — idempotent runner. Two-step:
  1. **Base schema:** read `lib/db/schema.sql`, split on `;`, execute each statement (all use `CREATE TABLE IF NOT EXISTS` so re-runs are no-ops)
  2. **Migrations:** scan `lib/db/migrations/*.sql` alphabetically. For each filename not in the `_migrations` table:
     - Split on `;`, execute each statement
     - **Wrap each statement in try/catch and swallow these specific SQLite error codes** (since `ALTER TABLE ADD COLUMN` and `CREATE INDEX` aren't `IF NOT EXISTS`-safe and may collide with the base schema on a fresh install):
       - `SQLITE_ERROR` with message containing `duplicate column name`
       - `SQLITE_ERROR` with message containing `table ... already exists` (covers re-runs on partial installs)
       - `SQLITE_ERROR` with message containing `index ... already exists`
       Any OTHER error rethrows and aborts the migration
     - On success, `INSERT INTO _migrations(name)` so future boots skip this file
  Use this for non-idempotent ops like `ALTER TABLE ADD COLUMN`. Example file: `lib/db/migrations/001_phase3_additions.sql`. Called once on boot from a top-level `instrumentation.ts`.
- [ ] `lib/storage/blobs.ts` — exports `getBlobs()` returning Vercel Blob helpers:
  ```ts
  import { put, head, del } from '@vercel/blob';
  export async function putBlob(key: string, body: Buffer | Blob, contentType: string) {
    return put(key, body, { access: 'public', contentType, addRandomSuffix: false, allowOverwrite: true });
  }
  ```
  Returns `{ url, pathname }`. Store `pathname` in DB (the key); construct full URL on read via the `url` field returned at upload time, or via `head(pathname)`.
- [ ] `lib/auth/api-key.ts` — exports `getAnthropicKey(): string` returning `process.env.ANTHROPIC_API_KEY!`. **Every `new Anthropic({ apiKey })` call gets its key from this function, never from `process.env` directly.** Path B replaces the body to read a per-session encrypted key from the DB; nothing else changes.
- [ ] `lib/auth/user.ts` — exports `getCurrentUserId(): number` returning `1`. Path B replaces with session lookup.
- [ ] Smoke test route `app/api/health/route.ts`:
  ```ts
  export async function GET() {
    const db = getDb();
    const r = await db.execute('SELECT 1 as ok');
    return Response.json({ db: r.rows[0].ok === 1, env: !!process.env.ANTHROPIC_API_KEY });
  }
  ```

**Why this still matters for Path B:** swapping to multi-tenant later only touches `lib/auth/api-key.ts` + `lib/auth/user.ts` + a Settings UI key field + adding NextAuth/Clerk. Two functions. No DB or blob refactor needed because Turso and Vercel Blob already handle multi-tenant load. Estimated Path B scope: ~1 day.

### 1.3 SQLite schema (full DDL)

```sql
-- Users (single-user v1, but keep the table for future)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Portfolio images
CREATE TABLE IF NOT EXISTS portfolio_images (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,            -- original filename uploaded by user
  blob_pathname TEXT NOT NULL,       -- Vercel Blob pathname for original (stable key)
  thumb_pathname TEXT NOT NULL,      -- Vercel Blob pathname for 1024px thumb
  blob_url TEXT NOT NULL,            -- public URL (cached at upload time)
  thumb_url TEXT NOT NULL,
  width INTEGER, height INTEGER,
  exif_json TEXT,                    -- camera/lens/EXIF metadata as JSON
  ordinal INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Style fingerprint (output of Style Analyst)
CREATE TABLE IF NOT EXISTS style_fingerprints (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL,
  json TEXT NOT NULL,                 -- StyleFingerprint zod-validated
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Artist Knowledge Base (versioned)
CREATE TABLE IF NOT EXISTS akb_versions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL,
  json TEXT NOT NULL,                 -- ArtistKnowledgeBase zod-validated
  source TEXT NOT NULL,               -- 'ingest' | 'interview' | 'merge'
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Knowledge Extractor interview transcript.
-- One row per message (agent question OR user answer). turn_index is monotonic per user.
-- akb_patch_json is set ONLY on agent rows; null for user rows.
CREATE TABLE IF NOT EXISTS extractor_turns (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL,                 -- 'agent' | 'user'
  content TEXT NOT NULL,
  akb_field_targeted TEXT,            -- agent-only: which field this turn was aimed at
  akb_patch_json TEXT,                -- agent-only: the RFC 7396 merge patch produced from the prior user answer
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_extractor_turns_user ON extractor_turns(user_id, turn_index);

-- Opportunity cache (shared across runs)
CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  deadline TEXT,                      -- ISO date
  award_summary TEXT,
  eligibility_json TEXT,
  raw_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(source, source_id)
);

-- Past recipients (for Rubric Matcher).
-- UNIQUE on (opportunity_id, year, name) so reruns of the same Scout opportunity
-- don't duplicate recipient rows. persistOpportunityFromAgent uses ON CONFLICT DO UPDATE
-- with a CASE on portfolio_urls: preserve Blob URLs if already mirrored,
-- refresh raw URLs otherwise.
CREATE TABLE IF NOT EXISTS past_recipients (
  id INTEGER PRIMARY KEY,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
  year INTEGER,
  name TEXT NOT NULL,
  bio_url TEXT,
  portfolio_urls TEXT,                -- JSON array
  notes TEXT,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(opportunity_id, year, name)
);

-- Runs
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  akb_version_id INTEGER NOT NULL REFERENCES akb_versions(id),
  style_fingerprint_id INTEGER NOT NULL REFERENCES style_fingerprints(id),
  status TEXT NOT NULL,               -- 'queued' | 'scout_running' | 'scout_complete' | 'finalizing_scout' | 'rubric_running' | 'rubric_complete' | 'finalizing' | 'complete' | 'error'
  config_json TEXT NOT NULL,          -- window, budget, constraints
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER,
  error TEXT
);

-- Per-run agent events (for poll UI + debugging)
CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY,
  run_id INTEGER REFERENCES runs(id),  -- nullable for orphan events (e.g. auto-discover)
  agent TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- 'start' | 'progress' | 'output' | 'error' | event subtype
  event_id TEXT UNIQUE,                -- Anthropic sevt_... ID; UNIQUE prevents concurrent-poll dupes via INSERT OR IGNORE
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id);
CREATE INDEX IF NOT EXISTS idx_run_events_event_id ON run_events(event_id);

-- Per-run match results.
-- UNIQUE on (run_id, opportunity_id) so an agent retry / rephrase doesn't double-count.
-- persistMatchFromAgent uses ON CONFLICT DO UPDATE so the latest persist call wins.
CREATE TABLE IF NOT EXISTS run_matches (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
  fit_score REAL NOT NULL,
  reasoning TEXT NOT NULL,
  supporting_image_ids TEXT,          -- JSON array of portfolio_images.id
  hurting_image_ids TEXT,
  included INTEGER NOT NULL,          -- 0 = filtered out (kept with reasoning), 1 = included
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(run_id, opportunity_id)
);

-- Per-run cursor for Anthropic event polling (one row per run; phase changes when Scout finishes and Rubric kicks off)
CREATE TABLE IF NOT EXISTS run_event_cursors (
  run_id INTEGER PRIMARY KEY REFERENCES runs(id),
  managed_session_id TEXT NOT NULL,   -- the Anthropic sesn_... ID for the CURRENT phase's session
  phase TEXT NOT NULL,                -- 'scout' | 'rubric' — tells the polling handler which terminal-idle hook to fire
  last_event_id TEXT,                 -- latest sevt_... we've ingested; NULL on first poll
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Join table: which opportunities did Scout discover for which run? Populated by persist_opportunity.
-- Needed because Scout-discovered opportunities exist in `opportunities` (cross-run cache)
-- and we need a way to scope them to "this run" for finalize-scout's image download query.
CREATE TABLE IF NOT EXISTS run_opportunities (
  run_id INTEGER NOT NULL REFERENCES runs(id),
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (run_id, opportunity_id)
);
CREATE INDEX IF NOT EXISTS idx_run_opportunities_run_id ON run_opportunities(run_id);

-- Migration tracking — one row per applied migration file, prevents re-running ALTER TABLE statements
CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Drafted materials per match
CREATE TABLE IF NOT EXISTS drafted_packages (
  id INTEGER PRIMARY KEY,
  run_match_id INTEGER NOT NULL REFERENCES run_matches(id),
  artist_statement TEXT,
  project_proposal TEXT,
  cv_formatted TEXT,
  cover_letter TEXT,
  work_sample_selection_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Final dossier (one per run)
CREATE TABLE IF NOT EXISTS dossiers (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL UNIQUE REFERENCES runs(id),
  cover_narrative TEXT NOT NULL,
  ranking_narrative TEXT NOT NULL,
  pdf_path TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

### 1.4 UI shell
- [ ] `app/layout.tsx` — Tailwind base, top nav, dark default
- [ ] Routes (placeholder bodies returning a single `<h1>` per route): `/upload`, `/interview`, `/review`, `/settings`, `/runs`, `/dossier/[id]`
- [ ] `/settings` — single-tenant for v1, so:
  - Show API key status (read `process.env.ANTHROPIC_API_KEY` on the server, return whether it's set; never expose the value to client)
  - Show Turso connection status from `/api/health`
  - Show Vercel Blob status from `/api/health`
  - "Run health test" button → POSTs to `/api/health/llm` which makes a 1-token `messages.create` round-trip and returns latency + success
  - **No model picker for v1** — model is hardcoded `claude-opus-4-7` per spec/locked architecture. Path B can add a picker if multiple models are useful

### 1.5 Skill files (initial)

**Provenance note (applies to all skill files in this plan):** Skill files are produced by a research-mode agent (reads live institutional sites, past-winner archives, published grant-writing guides), then audited by the builder against reality. The builder is not the submission expert — the skill files ARE the expertise, synthesized from public data and validated by lived experience. This is why the moat is real: the synthesis pipeline is reproducible, the audit is the human-in-the-loop quality gate.

**Format note:** Skill files are **plain markdown**. Atelier reads them with `await fs.readFile('skills/X.md', 'utf-8')` and interpolates the contents into Anthropic system prompts. They are NOT Claude Code skills (no SKILL.md frontmatter required, no skill-loader). Conventional file structure:

```markdown
# <skill name>

<one-paragraph "when to use" overview>

## <section per topic>

<body — prose, lists, YAML blocks, examples, whatever fits>
```

- [ ] Create `skills/` directory with all 10 file stubs (just the `# Title` heading + a one-line "WHEN TO USE" sentence)
- [ ] Fill `opportunity-sources.md` with the 40 curated sources from spec §Data sources, in the YAML format below
- [ ] Fill `eligibility-patterns.md` first draft (citizenship + career stage common gotchas)

**`opportunity-sources.md` format — each source is a structured YAML block embedded in the markdown, not prose:**

```yaml
- id: cafe
  name: CallForEntry.org (CaFE)
  url: https://www.callforentry.org/
  type: aggregator
  category: [competition, residency]
  past_recipients_url: null            # CaFE is an aggregator; recipients live on each opportunity's page
  eligibility_summary: varies-per-call
  deadline_pattern: rolling
  access_notes: free public listings; no API; structured HTML scrape feasible
  signal_quality: high                 # builder's lived assessment
- id: macdowell
  name: MacDowell
  url: https://www.macdowell.org/apply
  type: residency
  category: [residency]
  past_recipients_url: https://www.macdowell.org/artists
  eligibility_summary: working artists across disciplines; US + international
  deadline_pattern: 2x/year (Apr, Sep windows)
  access_notes: recipients page is paginated; bios link to artist sites
  signal_quality: flagship
```

This format is what Opportunity Scout consumes. Machine-readable, not narrative.

### Acceptance gate — Phase 1
1. `pnpm dev` boots, all routes render
2. `/api/health` returns `{ db: true, env: true }` against the real Turso instance
3. Vercel deploy live; `/api/health` returns the same JSON on the deployed URL (proves env vars + Turso reachability from Vercel functions)
4. `git log` shows ≥5 atomic commits

---

## Reference — Managed Agents API shape

This is the actual SDK surface every Phase 3 agent will use. Read once before writing any agent code.

### One-time setup (separate script: `scripts/setup-managed-agents.ts`)

Agents and environments are persistent, versioned resources. **Create once, store the IDs in `.env.local` (and Vercel env), reuse forever.** Calling `agents.create()` in a request handler is the #1 anti-pattern per the SDK docs.

```ts
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();

// Environment — one cloud sandbox config, reusable across all agents
const env = await client.beta.environments.create({
  name: 'atelier-default',
  config: { type: 'cloud', networking: { type: 'unrestricted' } },
});
console.log('ATELIER_ENV_ID=', env.id);

// Opportunity Scout agent
const scoutAgent = await client.beta.agents.create({
  name: 'Atelier Opportunity Scout',
  model: 'claude-opus-4-7',
  system: await fs.readFile('skills/opportunity-sources.md', 'utf-8'),  // skills are loaded into the system prompt at create time
  tools: [{ type: 'agent_toolset_20260401' }],  // gives bash, read, write, edit, glob, grep, web_fetch, web_search
});
console.log('SCOUT_AGENT_ID=', scoutAgent.id);

// Rubric Matcher agent
const rubricAgent = await client.beta.agents.create({
  name: 'Atelier Rubric Matcher',
  model: 'claude-opus-4-7',
  system: [
    await fs.readFile('skills/juror-reading.md', 'utf-8'),
    await fs.readFile('skills/aesthetic-vocabulary.md', 'utf-8'),
  ].join('\n\n---\n\n'),
  tools: [{ type: 'agent_toolset_20260401' }],
});
console.log('RUBRIC_AGENT_ID=', rubricAgent.id);
```

After running once, add to `.env.local`:
```
ATELIER_ENV_ID=env_...
SCOUT_AGENT_ID=agent_...
RUBRIC_AGENT_ID=agent_...
```

**Updating an agent** (e.g., revising a skill file): re-run `client.beta.agents.update(agentId, {...})` — creates a new version. Sessions in flight keep the version they pinned. New sessions get the latest unless you pin explicitly.

### Per-run lifecycle (server-side, in API routes)

```ts
// 1. Start a session (in app/api/runs/start/route.ts)
const session = await client.beta.sessions.create({
  agent: process.env.SCOUT_AGENT_ID!,  // string shorthand → latest version
  environment_id: process.env.ATELIER_ENV_ID!,
  title: `Scout run for user ${userId}`,
});
// Persist session.id to run_event_cursors.managed_session_id

// 2. Send the kickoff message
await client.beta.sessions.events.send(session.id, {
  events: [{
    type: 'user.message',
    content: [{ type: 'text', text: buildScoutPrompt(akb, window, constraints) }],
  }],
});

// 3. The agent loop now runs at Anthropic. Our server has nothing to do until the next browser poll.
return Response.json({ run_id: runId, session_id: session.id });
```

### Pulling events (in `app/api/runs/[id]/events/route.ts`, called repeatedly by browser)

**Pagination pattern (verified against Anthropic docs 2026-04-23):** `events.list()` does NOT take an `after` cursor. The documented pattern is iterate-all-events + dedupe by `event.id`. We use a UNIQUE constraint on `run_events.event_id` + `INSERT OR IGNORE` to prevent concurrent-poll dupes.

**Concurrency note:** browser polls every ~3s; if a poll takes >3s, two can overlap. Without `INSERT OR IGNORE` against a UNIQUE event_id, both polls would write the same event. The schema's UNIQUE on `run_events.event_id` + IGNORE handles this cleanly at the DB layer.

**Phase routing:** `run_event_cursors.phase` distinguishes Scout vs Rubric so the terminal-idle hook fires the right downstream route.

```ts
import type Anthropic from '@anthropic-ai/sdk';
import { waitUntil } from '@vercel/functions';

const client = new Anthropic({ apiKey: getAnthropicKey() });
const db = getDb();

const cursor = await db.execute({
  sql: 'SELECT managed_session_id, phase, last_event_id FROM run_event_cursors WHERE run_id = ?',
  args: [runId],
});
if (cursor.rows.length === 0) return Response.json({ events: [], done: false });
const { managed_session_id, phase, last_event_id } = cursor.rows[0] as any;

// Pull all events from Anthropic (auto-paginates), persist via INSERT OR IGNORE.
// We don't bother building a seenIds Set in JS — the UNIQUE constraint on run_events.event_id
// handles dedupe at the DB layer, including under concurrent polls.
const newEvents: any[] = [];
let latestEventId: string | null = last_event_id;

for await (const ev of client.beta.sessions.events.list(managed_session_id)) {
  const result = await db.execute({
    sql: `INSERT OR IGNORE INTO run_events (run_id, agent, kind, event_id, payload_json) VALUES (?, ?, ?, ?, ?)`,
    args: [
      runId,
      ev.type.split('.')[0],
      ev.type.split('.')[1] ?? ev.type,
      ev.id,
      JSON.stringify(ev)
    ]
  });
  if (result.rowsAffected > 0) {
    newEvents.push(ev);
    latestEventId = ev.id;
  }
}
if (latestEventId !== last_event_id) {
  await db.execute({
    sql: `UPDATE run_event_cursors SET last_event_id = ?, updated_at = unixepoch() WHERE run_id = ?`,
    args: [latestEventId, runId]
  });
}

// Handle requires_action gate inline — see "Custom tool result round-trip" below.
// (call handleRequiresAction(runId, managed_session_id, newEvents) — implementation in §3.x)

// Check for terminal state. Look at idle events from THIS poll first; if none, query the most recent
// idle event from run_events (handles cross-poll terminal idle).
let lastIdleStopReason: string | null = null;
const idleInBatch = [...newEvents].reverse().find(e => e.type === 'session.status_idle');
if (idleInBatch) {
  lastIdleStopReason = idleInBatch.stop_reason?.type ?? null;
} else {
  // Fall back to DB lookup
  const dbIdle = await db.execute({
    sql: `SELECT json_extract(payload_json, '$.stop_reason.type') AS sr
          FROM run_events
          WHERE run_id = ? AND kind = 'status_idle'
          ORDER BY id DESC LIMIT 1`,
    args: [runId]
  });
  lastIdleStopReason = (dbIdle.rows[0] as any)?.sr ?? null;
}

const sess = await client.beta.sessions.retrieve(managed_session_id);
const sessionTerminal = sess.status === 'terminated' ||
                        (sess.status === 'idle' && lastIdleStopReason && lastIdleStopReason !== 'requires_action');

// Phase-aware dispatch: when this phase's session terminates, fire the next phase's kickoff.
// Use waitUntil for true fire-and-forget (Vercel kills naked unawaited fetches).
let phaseDone = false;
let runDone = false;
if (sessionTerminal) {
  if (phase === 'scout') {
    await db.execute({ sql: `UPDATE runs SET status = 'scout_complete' WHERE id = ?`, args: [runId] });
    waitUntil(fetch(new URL(`/api/runs/${runId}/finalize-scout`, req.url), { method: 'POST' }));
    phaseDone = true;
    // run NOT done — Rubric still has to run
  } else if (phase === 'rubric') {
    await db.execute({ sql: `UPDATE runs SET status = 'rubric_complete' WHERE id = ?`, args: [runId] });
    waitUntil(fetch(new URL(`/api/runs/${runId}/finalize`, req.url), { method: 'POST' }));
    phaseDone = true;
    runDone = true;  // browser stops polling and navigates to dossier
  }
}

return Response.json({ events: newEvents, phase, phaseDone, done: runDone });
```

### Custom tool result round-trip (verified against Anthropic docs 2026-04-23)

When the agent invokes a custom tool, Anthropic's docs prescribe this 4-step flow:
1. The session emits an `agent.custom_tool_use` event containing the tool name (`event.name`) and input (`event.input`)
2. The session pauses with a `session.status_idle` event containing `stop_reason: { type: 'requires_action', event_ids: [eventId, ...] }`. The `event_ids` array lists which `agent.custom_tool_use` events need responses
3. We execute each tool host-side and send a `user.custom_tool_result` event with `custom_tool_use_id` set to the corresponding event ID
4. Once all blocking events are resolved, the session transitions back to `running`

```ts
// handleRequiresAction — called from the poll handler after persisting newEvents
import { persistOpportunityFromAgent } from '@/lib/agents/opportunity-scout';
import { persistMatchFromAgent } from '@/lib/agents/rubric-matcher';

async function handleRequiresAction(runId: number, sessionId: string, newEvents: any[]) {
  const idleWithAction = newEvents.find(e =>
    e.type === 'session.status_idle' && e.stop_reason?.type === 'requires_action'
  );
  if (!idleWithAction) return;

  const eventIdsToHandle: string[] = idleWithAction.stop_reason.event_ids;
  // Load the underlying agent.custom_tool_use events from run_events
  const placeholders = eventIdsToHandle.map(() => '?').join(',');
  const toolUseRows = await getDb().execute({
    sql: `SELECT payload_json FROM run_events WHERE event_id IN (${placeholders})`,
    args: eventIdsToHandle
  });

  for (const row of toolUseRows.rows) {
    const ev = JSON.parse((row as any).payload_json);
    if (ev.type !== 'agent.custom_tool_use') continue;
    // ev.name is the custom tool name; ev.input is the structured input
    let result: string;
    try {
      if (ev.name === 'persist_opportunity') {
        result = await persistOpportunityFromAgent(runId, ev.input);
      } else if (ev.name === 'persist_match') {
        result = await persistMatchFromAgent(runId, ev.input);
      } else {
        result = `unknown tool: ${ev.name}`;
      }
    } catch (e: any) {
      result = `error: ${e?.message ?? String(e)}`;
    }
    await client.beta.sessions.events.send(sessionId, {
      events: [{
        type: 'user.custom_tool_result',
        custom_tool_use_id: ev.id,  // NOT 'tool_use_id' — custom tools use a different field name
        content: [{ type: 'text', text: result }]
      }]
    });
  }
}
```

The poll handler calls `await handleRequiresAction(runId, managed_session_id, newEvents)` after the INSERT loop, before the terminal-state check. (Order matters: the requires_action handler may unblock the session, after which the next poll will see new events including the eventual terminal idle.)

### Tool name reference (correct as of `managed-agents-2026-04-01`)

- Built-in toolset: `agent_toolset_20260401` — bundles `bash`, `read`, `write`, `edit`, `glob`, `grep`, `web_fetch`, `web_search`. The `read` tool is multimodal (text, images, PDFs, notebooks).
- Beta header `managed-agents-2026-04-01` is set automatically by the SDK on `client.beta.{agents,environments,sessions,vaults,memory_stores}.*` calls.
- `client.beta.files.list({ scope_id, betas: ['managed-agents-2026-04-01'] })` requires the header EXPLICITLY because it's a Files endpoint with a Managed Agents parameter.
- Stream endpoint URL is `/v1/sessions/{id}/stream` (NOT `/events/stream`). The SDK exposes it as `client.beta.sessions.events.stream(session.id)`.
- `events.send` shape: `client.beta.sessions.events.send(sessionId, { events: [...] })` — the events array allows multiple events in one call (e.g. `user.interrupt` followed by `user.message`).
- `user.message` content blocks documented as TEXT only. For vision input, do NOT try to embed image content blocks in `user.message` — instead pass image URLs in the text and have the agent download via `bash` (`curl -o /tmp/img.jpg <url>`) then `read /tmp/img.jpg`. The `read` tool returns multimodal content blocks Claude can vision over.

---

## Reference — Long-running run orchestration on Vercel

The agent loop runs at Anthropic, so Vercel's 60s function timeout doesn't constrain run length. Our server only does short-lived work: kickoff (one Anthropic API call) and event polling (one Anthropic API call per browser poll).

**Pattern: poll-pull-on-read.**

1. **Browser:** `POST /api/runs/start` with config (window, budget, constraints)
2. **Server:** Creates DB row in `runs`, creates Managed Agents session, sends kickoff message, persists `managed_session_id` to `run_event_cursors`, returns `{run_id, session_id}` immediately. Total time: ~1-2s.
3. **Browser:** Renders run-in-progress page. Polls `GET /api/runs/[id]/events` every 2-3s.
4. **Server (each poll):** see code in §"Pulling events" above. The handler iterates all events, dedupes by `event.id` against what's already in `run_events`, persists new ones, handles any pending `requires_action` custom tool calls inline, and computes `done` from session status + last idle stop_reason.
5. **Browser:** Renders new events into the UI feed. When server returns `done: true`, navigates to `/dossier/[runId]`.

**Why not SSE proxy?** Vercel Hobby has a 60s streaming limit; even Pro caps at ~5min. Our runs go 10-30 min. Polling is simpler and survives any tier. Anthropic's SSE stream is for clients that hold long-lived connections directly (not us — our browser talks to our server, not Anthropic).

**Why not use a server-side `events.stream(sessionId)` connection?** Same reason — Vercel function timeout would kill it mid-flight.

**Polling frequency tradeoff:** every 2s gives a snappy UI; every 5s halves API call volume. `events.list` cost is negligible (mostly metadata) but pagination on a long-running session can grow. Default to 3s, escalate to 5s if rate-limit pressure appears.

**Pagination cost note:** `events.list` returns ALL events from session start each call (auto-paginates). For a 30-min Rubric Matcher run that emits ~500 events, every poll re-fetches ~500 events. At 1 poll/3s × 600 polls = 300K event fetches. Acceptable but worth knowing. Optimization for later: track `processed_at` of last seen event, fetch only events with `processed_at > cursor` (filter client-side; the docs don't show a server-side filter param).

**Trigger for Phase 4 synthesis** (Package Drafter + Orchestrator + Dossier render): when the polling handler observes terminal session status (`done === true`), it fires `fetch('/api/runs/[id]/finalize', { method: 'POST' })` and continues returning to the browser without awaiting. Set `export const maxDuration = 300` on the finalize route (Vercel Pro 5-min cap) for the synthesis to fit. See Phase 4.1 for chunking strategy if it exceeds 5min.

**Exception — for the demo recording:** John runs locally so the timing/cost isn't a concern; pre-recorded data played back via the run viewer covers the polled-state UI moments.

---

## Phase 2 — Onboarding pipeline

**Goal:** John can upload his portfolio, the Style Analyst produces a real fingerprint of his work, and the Knowledge Extractor builds a real AKB through web ingestion + interview.

### 2.1 Portfolio upload
- [ ] `app/(onboarding)/upload/page.tsx` — drag-drop dropzone (use `react-dropzone`), multi-file. Shows running count vs cap + per-file progress
- [ ] `app/api/portfolio/upload/route.ts` (POST):
  - Accept multipart form-data, iterate files
  - Read EXIF via `exifr.parse(buffer, { tiff: true, exif: true, gps: false })` — keep camera, lens, focal length, aperture, ISO, shutter, timestamp; **drop GPS** (privacy)
  - `sharp(buffer).rotate().resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer()` for the thumb
  - `sharp(buffer).rotate().withMetadata({}).jpeg({ quality: 92 }).toBuffer()` for the original (rotates, strips all metadata)
  - Compute SHA-256 of original bytes → `pathname = <hash>.jpg` (idempotent — re-uploading same file overwrites cleanly)
  - `await putBlob('originals/' + pathname, original, 'image/jpeg')` and `await putBlob('thumbs/' + pathname, thumb, 'image/jpeg')`
  - Insert `portfolio_images` row with both pathnames + URLs + width/height/exif_json
  - Return `{ inserted: N, total: M }`
- [ ] **Server-side cap enforcement:** before insert, query existing count for user. Reject with 400 if `existing + new > 100`. Browser also previews count but server is source of truth
- [ ] **Server-side dedupe enforcement:** `portfolio_images` should have `UNIQUE(user_id, blob_pathname)` (since pathname is the SHA-256 hash, this dedupes re-uploads). Use `INSERT OR IGNORE` and report skipped count to client. Add to schema:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_dedup ON portfolio_images(user_id, blob_pathname);
  ```
  (Add to migration `001_phase3_additions.sql` since the live table doesn't have it yet.)
- [ ] **Minimum 20 images** to enable "Run Style Analyst" button (spec target). If user has <20, show disabled state with count
- [ ] `app/api/portfolio/[id]/route.ts` (DELETE): row delete + `del(blob_pathname)` + `del(thumb_pathname)`
- [ ] `app/api/portfolio/reorder/route.ts` (POST `{order: number[]}`):
  ```ts
  const body = await req.json();
  const order: number[] = body.order;  // [imageId1, imageId2, ...] in desired display order
  const userId = getCurrentUserId();
  const stmts = order.map((id, idx) => ({
    sql: `UPDATE portfolio_images SET ordinal = ? WHERE id = ? AND user_id = ?`,
    args: [idx, id, userId]
  }));
  await getDb().batch(stmts);  // libSQL batch — single transaction
  return Response.json({ ok: true });
  ```
- [ ] Image grid view post-upload: drag-to-reorder (use `dnd-kit`), per-tile delete button

### 2.2 Style Fingerprint schema (`lib/schemas/style-fingerprint.ts`)

```ts
export const StyleFingerprint = z.object({
  composition_tendencies: z.array(z.string()),    // e.g. "rule-of-thirds horizon", "centered subject"
  palette: z.object({
    dominant_temperature: z.enum(['cool', 'warm', 'neutral', 'mixed']),
    saturation_register: z.enum(['muted', 'natural', 'saturated']),
    notable_palette_notes: z.array(z.string())
  }),
  subject_categories: z.array(z.string()),         // e.g. "alpine landscape", "urban geometry"
  light_preferences: z.array(z.string()),          // e.g. "low-angle golden hour", "long-exposure water"
  formal_lineage: z.array(z.string()),             // e.g. "Adams topographic formalism", "Sugimoto seascape minimalism"
  career_positioning_read: z.string(),             // 2-4 sentence narrative
  museum_acquisition_signals: z.array(z.string()),
  weak_signals: z.array(z.string())                // areas where the work shows hesitation/range gaps
});
```

### 2.3 Style Analyst (`lib/agents/style-analyst.ts`)

**Vision payload mechanics (concrete):**
- Images are referenced by `image.source.type = "url"` pointing at the **thumb URL** from Vercel Blob (1024px, ~150-300KB each). Anthropic fetches them server-side; no base64 encoding, no Files API needed
- Per-call cap: 20 images per `messages.create()` (keeps token budget per call ≈ 20 × ~1600 tokens = ~32K image tokens + skill files + response, well under TPM)
- For >20 images: chunk into batches of 20, call Style Analyst per chunk to produce **partial fingerprints**, then run a final synthesis call that merges partials into one canonical `StyleFingerprint` (no images in the synthesis call — text only)

**Implementation:**
- [ ] Top-level analyzer with `Promise.allSettled` so one bad chunk doesn't kill the whole run:
  ```ts
  import Anthropic from '@anthropic-ai/sdk';
  import { getAnthropicKey } from '@/lib/auth/api-key';
  import { StyleFingerprint } from '@/lib/schemas/style-fingerprint';

  const client = new Anthropic({ apiKey: getAnthropicKey() });

  export async function analyzePortfolio(images: PortfolioImage[]): Promise<StyleFingerprint> {
    const chunks = chunkArray(images, 20);
    const settled = await Promise.allSettled(chunks.map(c => analyzeChunk(c)));
    const partials = settled
      .filter((r): r is PromiseFulfilledResult<StyleFingerprint> => r.status === 'fulfilled')
      .map(r => r.value);
    if (partials.length === 0) throw new Error('All Style Analyst chunks failed — check Anthropic API status');
    return await synthesizePartials(partials);
  }
  ```
- [ ] `analyzeChunk(images)`: single `client.messages.create()` with explicit image block syntax:
  ```ts
  async function analyzeChunk(images: PortfolioImage[]): Promise<StyleFingerprint> {
    const skill = await fs.readFile('skills/aesthetic-vocabulary.md', 'utf-8');
    const userContent = [
      ...images.map(img => ({
        type: 'image' as const,
        source: { type: 'url' as const, url: img.thumb_url }
      })),
      { type: 'text' as const, text: `These are ${images.length} images from one artist's portfolio. Produce a partial StyleFingerprint per the schema in your system prompt. Output JSON only.` }
    ];
    return await callWithValidation(skill + '\n\n' + STYLE_ANALYST_SYSTEM, userContent);
  }
  ```
- [ ] `synthesizePartials(partials)`: text-only `messages.create()`, system prompt = "merge these N partial fingerprints into one canonical fingerprint, resolving disagreement by frequency", user message = JSON of partials, output = StyleFingerprint
- [ ] Validate-with-retry helper, used by both chunk and synthesis calls:
  ```ts
  async function callWithValidation(system: string, content: any): Promise<StyleFingerprint> {
    const messages = [{ role: 'user' as const, content }];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const resp = await client.messages.create({
        model: 'claude-opus-4-7', max_tokens: 8000,
        thinking: { type: 'adaptive' }, system, messages
      });
      const text = resp.content.find(b => b.type === 'text')?.text ?? '';
      try {
        const parsed = JSON.parse(text);
        return StyleFingerprint.parse(parsed);
      } catch (e: any) {
        if (attempt === 2) throw new Error(`Style Analyst output failed validation after retry: ${e.message}\nLast output: ${text.slice(0, 500)}`);
        // Retry with the validation error fed back
        messages.push({ role: 'assistant', content: [{ type: 'text', text }] });
        messages.push({ role: 'user', content: [{ type: 'text', text: `Your previous output failed schema validation: ${e.message}. Re-emit the StyleFingerprint as valid JSON only, no preamble, no markdown fence.` }] });
      }
    }
    throw new Error('unreachable');
  }
  ```
- [ ] Persist to `style_fingerprints` with version = `MAX(version) + 1 WHERE user_id = ?` (or 1 if none):
  ```ts
  const v = ((await db.execute({ sql: `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM style_fingerprints WHERE user_id = ?`, args: [userId] })).rows[0] as any).v;
  await db.execute({
    sql: `INSERT INTO style_fingerprints (user_id, version, json) VALUES (?, ?, ?)`,
    args: [userId, v, JSON.stringify(fingerprint)]
  });
  ```
- [ ] Surface in `/review` page after analysis finishes

**Cost note:** ~100 images at 1024px ≈ 5 chunks × ~32K image-tokens + outputs. At Opus 4.7 input pricing this is ~$2-3 per Style Analyst run. Acceptable.

**System prompt outline (per chunk):**
1. Role: senior fine-art curator + critic; expertise spans photography, painting, sculpture
2. Source of vocabulary: the loaded `aesthetic-vocabulary.md` skill — use these terms, don't invent
3. Task: read these N images as a portion of the artist's portfolio. Identify patterns visible across this batch
4. Identify cross-image patterns — composition tendencies that recur, palette through-lines, subject categories — flag tendencies that need confirmation across the full body
5. Place the work in formal lineage (specific named precedents — Adams, Sugimoto, Eggleston, etc., not generic "modernist landscape")
6. Career-positioning read: 2-4 sentences, blunt, naming the next institutional tier this batch suggests AND visible gaps
7. Identify weak signals — areas where the work shows hesitation, repetition, or unresolved range
8. Output STRICTLY as `StyleFingerprint` JSON (partial — final synthesis will merge), no preamble, no markdown fence

**System prompt outline (synthesis call):**
1. Role: same
2. Task: you have N partial StyleFingerprints from chunks of one artist's portfolio. Produce one canonical StyleFingerprint that represents the body of work as a whole
3. Resolve disagreement by frequency — a pattern named in 4 of 5 partials is real; a pattern named in 1 of 5 is noise
4. For `formal_lineage`, take the union (multiple lineages are allowed)
5. For `career_positioning_read`, write a fresh narrative — don't concatenate
6. Output STRICTLY as `StyleFingerprint` JSON

### 2.4 AKB schema (`lib/schemas/akb.ts`)

```ts
export const ArtistKnowledgeBase = z.object({
  identity: z.object({
    legal_name: z.string(),
    public_name: z.string().optional(),
    pronouns: z.string().optional(),
    citizenship: z.array(z.string()),           // for eligibility
    home_base: z.object({
      city: z.string(),
      state: z.string().optional(),             // optional — international artists may not have a US-style state
      country: z.string()
    }),
    year_of_birth: z.number().optional()
  }),
  practice: z.object({
    primary_medium: z.string(),
    secondary_media: z.array(z.string()),
    process_description: z.string(),            // long form, written in third person
    materials_and_methods: z.array(z.string()),
    typical_scale: z.string().optional()
  }),
  education: z.array(z.object({
    institution: z.string(),
    degree: z.string().optional(),
    year: z.number().optional(),
    notes: z.string().optional()
  })),
  bodies_of_work: z.array(z.object({
    title: z.string(),
    years: z.string(),
    description: z.string(),
    image_ids: z.array(z.number()).optional()   // references portfolio_images.id
  })),
  exhibitions: z.array(z.object({
    title: z.string(),
    venue: z.string(),
    location: z.string(),
    year: z.number(),
    type: z.enum(['solo', 'group', 'two-person', 'art-fair'])
  })),
  publications: z.array(z.object({
    publisher: z.string(),
    title: z.string().optional(),
    year: z.number(),
    url: z.string().optional()
  })),
  awards_and_honors: z.array(z.object({
    name: z.string(),
    year: z.number(),
    notes: z.string().optional()
  })),
  collections: z.array(z.object({
    name: z.string(),
    type: z.enum(['public', 'private', 'corporate', 'museum'])
  })),
  representation: z.array(z.object({
    gallery: z.string(),
    location: z.string(),
    since_year: z.number().optional()
  })),
  career_stage: z.enum(['emerging', 'mid-career', 'established', 'late-career']),
  intent: z.object({
    statement: z.string(),                      // what the work is about, in their words/our prose
    influences: z.array(z.string()),
    aspirations: z.array(z.string())            // institutional goals: museum acquisition, MacDowell, etc.
  }),
  source_provenance: z.record(z.string(), z.string())  // dot-path key (e.g. 'identity.legal_name', 'exhibitions') -> 'ingested:<url>' | 'interview' | 'manual'
});
export type ArtistKnowledgeBase = z.infer<typeof ArtistKnowledgeBase>;

// PartialAKB — used for ingestion output and interview akb_patch.
// z.object().partial() makes top-level fields optional but NOT their nested requireds.
// We use z.object().deepPartial() — every field at every depth is optional.
// REQUIRES zod@^3 (pinned in §1.1 install). v4 removed .deepPartial.
export const PartialAKB = ArtistKnowledgeBase.deepPartial();
export type PartialAKB = z.infer<typeof PartialAKB>;
```

**Provenance key convention:** `source_provenance` uses dot-path keys for nested fields:
- `identity.legal_name` → provenance of the legal_name value
- `identity.home_base.city` → two-level nesting OK
- `exhibitions` → provenance of the entire array (individual items don't have per-item provenance in v1)
- `bodies_of_work` → same; array-level provenance

The `/review` page should display provenance at the field level using these keys. If a parent key isn't present, render "unknown provenance".

### 2.5 Knowledge Extractor — Ingestion (`lib/agents/knowledge-extractor.ts`)

```ts
import Anthropic from '@anthropic-ai/sdk';
import * as cheerio from 'cheerio';
import { getAnthropicKey } from '@/lib/auth/api-key';
import { getDb } from '@/lib/db/client';
import { ArtistKnowledgeBase, PartialAKB } from '@/lib/schemas/akb';

const client = new Anthropic({ apiKey: getAnthropicKey() });

type IngestResult = {
  successful: { url: string; partial: PartialAKB }[];
  failed: { url: string; reason: string }[];
  merged_akb: ArtistKnowledgeBase | null;  // null if no successful ingests AND no prior AKB
  akb_version_id: number | null;
};

export async function ingestUrls(userId: number, urls: string[]): Promise<IngestResult> {
  // Load existing AKB to merge onto (or start empty)
  const existing = await loadLatestAkb(userId);

  // Process URLs in parallel with allSettled — partial success is fine
  const settled = await Promise.allSettled(urls.map(u => ingestOne(u)));
  const successful: IngestResult['successful'] = [];
  const failed: IngestResult['failed'] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') successful.push({ url: urls[i], partial: r.value });
    else failed.push({ url: urls[i], reason: r.reason?.message ?? String(r.reason) });
  });

  if (successful.length === 0) {
    return { successful, failed, merged_akb: existing, akb_version_id: null };
  }

  // Merge each partial into the AKB, tracking provenance per field
  let working: ArtistKnowledgeBase | PartialAKB = existing ?? emptyAkb();
  const provenance: Record<string, string> = { ...(existing?.source_provenance ?? {}) };

  for (const { url, partial } of successful) {
    working = mergeAkbPartial(working, partial, `ingested:${url}`, provenance);
  }

  // Final shape must be a valid ArtistKnowledgeBase. If required fields are still missing,
  // keep as PartialAKB for the interview phase to fill. For now, we store the latest state
  // as a PartialAKB-shaped JSON; the interview phase produces the first ArtistKnowledgeBase-valid row.
  const stored = { ...(working as any), source_provenance: provenance };
  const akbVersionId = await writeAkbVersion(userId, stored, 'ingest');

  return { successful, failed, merged_akb: stored as any, akb_version_id: akbVersionId };
}

async function ingestOne(url: string): Promise<PartialAKB> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { 'User-Agent': 'Mozilla/5.0 Atelier/0.1' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  // Extract text from meaningful elements only; drop scripts/styles/nav/footer
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header').remove();
  const title = $('title').text().trim();
  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 30_000); // cap input size

  const SYSTEM = `You extract biographical and career facts about a working visual artist from a web page into the ArtistKnowledgeBase schema.

Rules:
1. Extract ONLY fields evidenced in the provided text. Do NOT invent, infer, or embellish.
2. If a field is not evidenced, omit it (PartialAKB allows omission at any level).
3. For dates, prefer explicit years. Skip if ambiguous.
4. For exhibition/publication/award types, map to the nearest enum value; skip if no clear match.
5. Output STRICTLY as PartialAKB JSON — no preamble, no markdown fence.`;

  const resp = await client.messages.create({
    model: 'claude-opus-4-7', max_tokens: 4000, thinking: { type: 'adaptive' },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Page URL: ${url}\nPage title: ${title}\n\n---\n\nPAGE TEXT:\n${text}\n\n---\n\nExtract all evidenced AKB fields as PartialAKB JSON.` }]
  });
  const outText = resp.content.find(b => b.type === 'text')?.text ?? '{}';
  try {
    return PartialAKB.parse(JSON.parse(outText));
  } catch (e: any) {
    // One retry with the validation error fed back
    const retry = await client.messages.create({
      model: 'claude-opus-4-7', max_tokens: 4000, thinking: { type: 'adaptive' },
      system: SYSTEM,
      messages: [
        { role: 'user', content: `Extract AKB from this page: ${url}\n\n${text}` },
        { role: 'assistant', content: [{ type: 'text', text: outText }] },
        { role: 'user', content: [{ type: 'text', text: `Your previous output failed PartialAKB validation: ${e.message}. Re-emit as valid JSON only, omitting fields you're unsure about.` }] }
      ]
    });
    const retryText = retry.content.find(b => b.type === 'text')?.text ?? '{}';
    return PartialAKB.parse(JSON.parse(retryText));
  }
}
```

#### Merge policy for combining partials + existing AKB (`mergeAkbPartial`)

- [ ] `mergeAkbPartial(existing, partial, provenanceTag, provenanceMap): ArtistKnowledgeBase | PartialAKB`:
  - **Scalar fields** (strings, numbers, enums): if `provenanceMap[leafDotPath]` is `'interview'` or `'manual'`, SKIP (user-supplied truth wins). Otherwise write partial value and set `provenanceMap[leafDotPath] = provenanceTag`. **Leaf path** = full dot-path including all parents (e.g. `identity.home_base.city`, not `identity` or `identity.home_base`). This convention is shared across ingestion + interview + manual edit so /review can render per-field provenance reliably.
  - **Array fields** (exhibitions, publications, awards_and_honors, bodies_of_work, education, collections, representation): concat + dedupe. The provenance entry is at the array-level path (e.g. `exhibitions`), updated to whichever source most recently added items. Dedupe keys:
    - exhibitions: `normalize(venue)|year|normalize(title)`
    - publications: `normalize(publisher)|year|normalize(title)`
    - awards_and_honors: `normalize(name)|year`
    - bodies_of_work: `normalize(title)`
    - education: `normalize(institution)|year`
    - collections: `normalize(name)`
    - representation: `normalize(gallery)`
    - `normalize` = lowercase + strip non-alphanum + collapse whitespace
  - **Nested objects** (identity, practice, intent, palette): recurse, building dot-path as you descend. Stamp provenance at each LEAF (scalar value), never at the parent object.
  - **Resolution rule on /review render:** look up provenance for the most-specific dot-path first. If `identity.home_base.city` has its own entry, use that. If not, fall back to walking up (`identity.home_base`, then `identity`). This handles legacy mixed-granularity rows from any pre-fix data.

- [ ] Helper: `loadLatestAkb(userId)` — `SELECT json FROM akb_versions WHERE user_id = ? ORDER BY version DESC LIMIT 1`, parse JSON, return or null
- [ ] Helper: `writeAkbVersion(userId, akbJson, source)` — compute `version = MAX(version) + 1`, INSERT row, return `id`
- [ ] Helper: `emptyAkb()` — returns `{source_provenance: {}}` as the starting shape

**Default seed URLs for John's own ingestion run (Phase 2.8):** his personal photography site, both gallery bio pages (Las Vegas Stratosphere + Minneapolis Wayzata), TIMEPieces collection page, any National Geographic / Red Bull / Billboard feature URLs he can produce. Surface a "seed URLs" textarea on the upload page so any future user does the same.

### 2.6 Knowledge Extractor — Gap detection (`lib/agents/extractor-gaps.ts`)

```ts
import type { ArtistKnowledgeBase, PartialAKB } from '@/lib/schemas/akb';

export type GapTarget = { path: string; priority: number; why: string };

// Priority tiers — higher number = asked first
const TIERS: Record<string, number> = {
  'identity.legal_name': 100,
  'identity.citizenship': 100,
  'identity.home_base': 95,
  'practice.primary_medium': 90,
  'practice.process_description': 85,
  'intent.statement': 80,
  'career_stage': 75,
  'bodies_of_work': 70,
  'exhibitions': 60,
  'publications': 55,
  'awards_and_honors': 50,
  'education': 45,
  'collections': 40,
  'representation': 35,
  'intent.influences': 30,
  'intent.aspirations': 30,
  'practice.secondary_media': 20,
  'practice.materials_and_methods': 20,
  'identity.year_of_birth': 15
};

export function detectGaps(akb: PartialAKB | ArtistKnowledgeBase): GapTarget[] {
  const gaps: GapTarget[] = [];
  const isEmpty = (v: any): boolean => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

  for (const [path, priority] of Object.entries(TIERS)) {
    const parts = path.split('.');
    let cur: any = akb;
    for (const p of parts) {
      if (cur == null) { cur = undefined; break; }
      cur = cur[p];
    }
    if (isEmpty(cur)) {
      gaps.push({ path, priority, why: `${path} is not yet populated` });
    }
  }
  // Stable sort by priority desc
  return gaps.sort((a, b) => b.priority - a.priority);
}
```

### 2.7 Knowledge Extractor — Interview UI

- [ ] `app/(onboarding)/interview/page.tsx` — chat-style turn-by-turn. State machine: `idle` → `sending` (request in flight, input disabled, "Thinking..." indicator) → `waiting-for-user` → repeat. **Block send button while a request is in flight** (prevents double-sends).

- [ ] `app/api/extractor/turn/route.ts`:
  ```ts
  import Anthropic from '@anthropic-ai/sdk';
  import { getAnthropicKey } from '@/lib/auth/api-key';
  import { getCurrentUserId } from '@/lib/auth/user';
  import { getDb } from '@/lib/db/client';
  import { detectGaps } from '@/lib/agents/extractor-gaps';
  import { PartialAKB } from '@/lib/schemas/akb';
  import { z } from 'zod';

  const TurnRequest = z.object({ user_message: z.string() });

  const TurnResponse = z.object({
    agent_message: z.string(),
    next_field_target: z.string(),
    akb_patch: z.record(z.string(), z.unknown())   // JSON Merge Patch (RFC 7396) — structure validated by mergePatch + PartialAKB re-parse
  });

  export async function POST(req: Request) {
    const { user_message } = TurnRequest.parse(await req.json());
    const userId = getCurrentUserId();
    const db = getDb();

    // Load latest AKB from DB (source of truth — never trust client state)
    const latestAkb = JSON.parse(((await db.execute({
      sql: `SELECT json FROM akb_versions WHERE user_id = ? ORDER BY version DESC LIMIT 1`,
      args: [userId]
    })).rows[0] as any)?.json ?? '{"source_provenance":{}}');

    // Load turn history for this user
    const prior = (await db.execute({
      sql: `SELECT role, content FROM extractor_turns WHERE user_id = ? ORDER BY turn_index ASC`,
      args: [userId]
    })).rows as Array<{ role: string; content: string }>;

    const gaps = detectGaps(latestAkb);
    const topGap = gaps[0]?.path ?? '(none — AKB is complete)';

    // Append new user turn to transcript BEFORE calling Claude (so we track even on LLM failure)
    const nextTurnIndex = prior.length;
    await db.execute({
      sql: `INSERT INTO extractor_turns (user_id, turn_index, role, content) VALUES (?, ?, 'user', ?)`,
      args: [userId, nextTurnIndex, user_message]
    });

    const SYSTEM = `You are an art-career interviewer building an Artist Knowledge Base (AKB) for a working visual artist.

Your goal: ask ONE targeted question per turn to fill the next gap in the AKB. When the user answers, emit a delta as akb_patch.

Top gap right now: ${topGap}
All current gaps (in priority order): ${gaps.map(g => g.path).join(', ')}

Current AKB (what's already known):
${JSON.stringify(latestAkb, null, 2)}

Rules:
1. Ask about the TOP gap first. Phrase it conversationally — do not echo field paths.
2. If the user's answer is unclear or off-topic, clarify before patching.
3. The akb_patch is a partial AKB representing ONLY the new information from this turn:
   - For SCALARS / nested objects: include only fields the user just answered. Existing values stay if you omit them.
   - For ARRAYS (exhibitions, publications, awards_and_honors, bodies_of_work, education, collections, representation): include ONLY the new entries the user just gave you. The server appends + dedupes against the existing array. Do NOT re-emit prior items.
   - Server uses the same merge policy as ingestion (append + dedupe by composite key).
4. Never invent facts. Only patch fields the user actually answered.
5. next_field_target: the path you'll ask about in the NEXT turn (after this patch is applied).

Output JSON strictly as: { "agent_message": "...", "next_field_target": "...", "akb_patch": {...} }`;

    const userHistory = prior
      .map(t => ({ role: t.role === 'agent' ? 'assistant' as const : 'user' as const, content: [{ type: 'text' as const, text: t.content }] }))
      .concat([{ role: 'user' as const, content: [{ type: 'text' as const, text: user_message }] }]);

    const client = new Anthropic({ apiKey: getAnthropicKey() });
    const resp = await client.messages.create({
      model: 'claude-opus-4-7', max_tokens: 2000, thinking: { type: 'adaptive' },
      system: SYSTEM, messages: userHistory
    });

    const outText = resp.content.find(b => b.type === 'text')?.text ?? '{}';
    const parsed = TurnResponse.parse(JSON.parse(outText));

    // Persist agent turn with the patch
    await db.execute({
      sql: `INSERT INTO extractor_turns (user_id, turn_index, role, content, akb_field_targeted, akb_patch_json) VALUES (?, ?, 'agent', ?, ?, ?)`,
      args: [userId, nextTurnIndex + 1, parsed.agent_message, parsed.next_field_target, JSON.stringify(parsed.akb_patch)]
    });

    // Apply patch to latest AKB using SAME merge policy as ingestion (append + dedupe arrays;
    // scalar overrides; provenance preservation). Do NOT use raw RFC 7396 — that would clobber arrays.
    const provenance: Record<string, string> = { ...(latestAkb.source_provenance ?? {}) };
    const merged = mergeAkbPartial(latestAkb, parsed.akb_patch, 'interview', provenance);
    merged.source_provenance = provenance;
    const newVersion = ((await db.execute({ sql: `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM akb_versions WHERE user_id = ?`, args: [userId] })).rows[0] as any).v;
    await db.execute({
      sql: `INSERT INTO akb_versions (user_id, version, json, source) VALUES (?, ?, ?, 'interview')`,
      args: [userId, newVersion, JSON.stringify(merged)]
    });

    return Response.json({
      agent_message: parsed.agent_message,
      next_field_target: parsed.next_field_target,
      akb: merged
    });
  }
  ```

- [ ] **`mergeAkbPartial`** — reused from §2.5 (same function, same dedupe policy). Provenance stamping walks the patch and writes `'interview'` at each leaf dot-path (e.g. `identity.legal_name` not `identity`). This avoids the granularity collision the reviewer flagged.
- [ ] **Defensive check (server-side):** before calling `mergeAkbPartial`, scan `parsed.akb_patch` for any array field that's SHORTER than the existing AKB's same array. Per the §2.7 system prompt, the model should send only NEW entries — not the full array. A shortened array is a model misbehavior; mergeAkbPartial's append+dedupe handles it correctly (the "shortened" array is treated as just a few new entries to add). But log a warning if detected so prompt regressions surface in the demo.
- [ ] Note `json-merge-patch` is NOT used in interview — only as reference for the spec. Strict RFC 7396 semantics would clobber arrays. The interview uses the same `mergeAkbPartial` as ingestion.
- [ ] Side panel on the page polls/displays the latest AKB from `/api/akb/current` after each turn so it stays in sync with DB state.
- [ ] "Done" button → POSTs to `/api/akb/finalize`, which writes a final `akb_versions` row with `source='merge'` and marks the interview as complete.

### 2.7.b AKB helper routes

- [ ] `app/api/akb/current/route.ts` (GET): returns the latest `akb_versions` row for the current user. Used by the interview side panel + /review page:
  ```ts
  export async function GET() {
    const userId = getCurrentUserId();
    const row = (await getDb().execute({
      sql: `SELECT version, json FROM akb_versions WHERE user_id = ? ORDER BY version DESC LIMIT 1`,
      args: [userId]
    })).rows[0];
    if (!row) return Response.json({ akb: null, version: 0 });
    return Response.json({ akb: JSON.parse(row.json as string), version: (row as any).version });
  }
  ```

- [ ] `app/api/akb/finalize/route.ts` (POST): takes the current AKB, validates it passes `ArtistKnowledgeBase.parse()` (strict — all required fields present), writes a new row with `source='merge'` as the canonical AKB. Used as the "Done" action on the interview:
  ```ts
  export async function POST() {
    const userId = getCurrentUserId();
    const db = getDb();
    const latest = (await db.execute({
      sql: `SELECT json FROM akb_versions WHERE user_id = ? ORDER BY version DESC LIMIT 1`,
      args: [userId]
    })).rows[0];
    if (!latest) return Response.json({ error: 'no akb yet' }, { status: 400 });
    const akb = JSON.parse((latest as any).json);
    try {
      ArtistKnowledgeBase.parse(akb);  // strict
    } catch (e: any) {
      return Response.json({ error: 'AKB incomplete — missing required fields', details: e.issues }, { status: 400 });
    }
    const newVersion = ((await db.execute({ sql: `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM akb_versions WHERE user_id = ?`, args: [userId] })).rows[0] as any).v;
    await db.execute({
      sql: `INSERT INTO akb_versions (user_id, version, json, source) VALUES (?, ?, ?, 'merge')`,
      args: [userId, newVersion, JSON.stringify(akb)]
    });
    return Response.json({ ok: true, version: newVersion });
  }
  ```

- [ ] `app/api/akb/manual-edit/route.ts` (POST `{ patch: MergePatch }`): takes a user-made edit patch (from the /review page), applies it to the latest AKB, writes new version with `source='merge'` and sets provenance to `'manual'` for every top-level key in the patch.

### 2.8 `/review` page (`app/(onboarding)/review/page.tsx`)
- [ ] Renders the current AKB as an editable form (sectioned: identity, practice, education, bodies_of_work, exhibitions, publications, awards, collections, representation, intent)
- [ ] Each field shows its provenance ("from ingestion: example.com" / "from interview" / "manual")
- [ ] User can edit any field; on save, POST `/api/akb/manual-edit` with the diff, sets that field's provenance to `"manual"`, increments `akb_versions` version
- [ ] Also shows the StyleFingerprint (read-only — generated, not editable)
- [ ] "Continue to dossier" button → enabled when AKB has minimum required fields filled (identity + practice + at least one body_of_work + intent.statement)

### 2.9 Builder runs his own AKB
- [ ] John uploads his real portfolio (≥40 images recommended)
- [ ] Provides his website URL + gallery URLs for ingestion
- [ ] Completes the interview
- [ ] Reviews + edits the AKB freely on `/review`

### Acceptance gate — Phase 2
1. Upload of 40+ images works end-to-end, thumbs render in grid
2. Style Analyst produces a `StyleFingerprint` that John reads and confirms is accurate
3. Knowledge Extractor ingests his website, asks gap-targeted questions, produces a complete AKB
4. AKB persisted, versioned, editable

---

## Phase 3 — Novel primitive (Opportunity Scout + Rubric Matcher)

**Goal:** The Rubric Matcher demonstrably rejects bad-fit opportunities with specific aesthetic reasoning. This is the win condition for the project.

### 3.0 — Pre-flight schema migration + Day-1 event-shape smoke (DO FIRST)

Before writing ANY agent code in this phase, do these two things in order:

#### 3.0.a — Update schema.sql + write migration file

The plan's §1.3 schema was extended after Phase 1.3 was originally built. The live `lib/db/schema.sql` is missing tables and constraints Phase 3 depends on. Without this, the first `persist_opportunity` call throws `no such table: run_opportunities`.

- [ ] Update `lib/db/schema.sql` to match §1.3 in the plan (latest version): adds `run_opportunities`, `_migrations`, indexes, the `phase` column on `run_event_cursors`, the `event_id` column with UNIQUE on `run_events`, the `UNIQUE(opportunity_id, year, name)` on `past_recipients`, the `UNIQUE(run_id, opportunity_id)` on `run_matches`, the widened `runs.status` enum.
- [ ] Write `lib/db/migrations/001_phase3_additions.sql` for the ALTER TABLE statements that aren't covered by `CREATE TABLE IF NOT EXISTS`:
  ```sql
  ALTER TABLE run_event_cursors ADD COLUMN phase TEXT NOT NULL DEFAULT 'scout';
  ALTER TABLE run_events ADD COLUMN event_id TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_run_events_event_id_unique ON run_events(event_id) WHERE event_id IS NOT NULL;
  -- past_recipients UNIQUE: SQLite cannot add a UNIQUE constraint via ALTER. Use a unique index:
  CREATE UNIQUE INDEX IF NOT EXISTS idx_past_recipients_dedup ON past_recipients(opportunity_id, year, name);
  -- run_matches UNIQUE: same approach
  CREATE UNIQUE INDEX IF NOT EXISTS idx_run_matches_dedup ON run_matches(run_id, opportunity_id);
  -- Phase 2 addition: portfolio_images dedupe (SHA-256 hash collision dedupe)
  CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_dedup ON portfolio_images(user_id, blob_pathname);
  -- Phase 2 addition: extractor_turns.akb_patch_json column
  ALTER TABLE extractor_turns ADD COLUMN akb_patch_json TEXT;
  CREATE INDEX IF NOT EXISTS idx_extractor_turns_user ON extractor_turns(user_id, turn_index);
  ```
- [ ] Add `app/api/health/schema/route.ts` if it doesn't exist:
  ```ts
  import { getDb } from '@/lib/db/client';
  export async function GET() {
    const db = getDb();
    const tables = (await db.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)).rows.map((r: any) => r.name);
    const indexes = (await db.execute(`SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name`)).rows.map((r: any) => r.name);
    const migrations = (await db.execute(`SELECT name FROM _migrations ORDER BY applied_at`)).rows.map((r: any) => r.name);
    return Response.json({ tables, indexes, migrations });
  }
  ```
- [ ] Run the migration runner (boots automatically via `instrumentation.ts`); verify by hitting `/api/health/schema` and confirming `tables` includes `run_opportunities` + `_migrations`, `indexes` includes `idx_past_recipients_dedup` + `idx_run_matches_dedup` + `idx_run_events_event_id_unique`, `migrations` includes `001_phase3_additions.sql`

#### 3.0.b — Day-1 event-shape smoke test (BLOCKS the rest of Phase 3)

Before building `finalize-scout`, `start-rubric`, the Rubric Matcher, or any downstream code, prove the event-shape assumptions are correct. The plan claims doc-verified shapes for `agent.custom_tool_use.name`, `session.status_idle.stop_reason.event_ids`, `user.custom_tool_result.custom_tool_use_id` — but none of it has run. If any of these are wrong, every downstream piece is wrong.

- [ ] Build a minimal smoke harness `tests/integration/event-shape-probe.test.ts`:
  1. Create a temporary smoke agent (one-off, separate from the real Scout/Rubric) with:
     - `model: 'claude-opus-4-7'`
     - `system: 'When you receive any user message, immediately call the persist_test custom tool with input { "echo": "<the user message text>" }. Then emit "<DONE>" and stop.'`
     - tools: `[{ type: 'custom', name: 'persist_test', input_schema: { type: 'object', properties: { echo: { type: 'string' } }, required: ['echo'] } }]`
  2. Create a session, send `user.message` with text "hello smoke"
  3. Poll events.list until `session.status_idle` with `stop_reason.type === 'requires_action'` appears
  4. Assert: the event has `stop_reason.event_ids` array; iterate it; load each event; assert it has `type === 'agent.custom_tool_use'`, `name === 'persist_test'`, `input.echo === 'hello smoke'`
  5. Send `user.custom_tool_result` with `custom_tool_use_id` set to the event's id, `content: [{ type: 'text', text: 'ok' }]`
  6. Poll until `session.status_idle` with `stop_reason.type === 'end_turn'`
  7. Cleanup: archive the smoke agent + delete the session
- [ ] Run the smoke test. If ANY assertion fails, STOP — the event shape doesn't match the plan; report the actual shape before proceeding
- [ ] Estimated cost: ~$0.05, ~3 minutes

Once §3.0.a + §3.0.b both pass, proceed to §3.1.

### 3.1 Opportunity schema (`lib/schemas/opportunity.ts`)

```ts
export const Opportunity = z.object({
  source: z.string(),                           // 'cafe' | 'nea' | 'macdowell' | ...
  source_id: z.string(),
  name: z.string(),
  url: z.string(),
  deadline: z.string().optional(),              // ISO date
  award: z.object({
    type: z.enum(['grant', 'residency', 'prize', 'commission', 'representation']),
    amount_usd: z.number().optional(),
    in_kind: z.string().optional(),
    prestige_tier: z.enum(['flagship', 'major', 'mid', 'regional', 'open-call'])
  }),
  eligibility: z.object({
    citizenship: z.array(z.string()).optional(),
    career_stage: z.array(z.string()).optional(),
    medium: z.array(z.string()).optional(),
    age_range: z.tuple([z.number(), z.number()]).optional(),
    residency_required: z.string().optional()
  }),
  entry_fee_usd: z.number().optional(),
  past_recipient_archive_url: z.string().optional()
});
```

### 3.2 Opportunity Scout (Managed Agent) — REVISED after audit

**Architectural change from earlier draft:** Scout does NOT download recipient images itself. Scout returns recipient image *URLs* via the `persist_opportunity` custom tool. Our orchestrator (Phase 3.3) downloads URLs into Vercel Blob in a chunked process. This eliminates the Scout-writes-files → finalize-scout-downloads-files handoff entirely.

#### `RunConfig` type (`lib/schemas/run.ts`)

```ts
import { z } from 'zod';

export const RunConfig = z.object({
  window_start: z.string(),         // ISO date — opportunities with deadlines >= this
  window_end: z.string(),           // ISO date — and <= this. Default: today + 6 months
  budget_usd: z.number().default(0),  // 0 = no entry-fee penalty
  max_travel_miles: z.number().nullable().default(null),  // null = no residency travel cap
  eligibility_overrides: z.record(z.string(), z.unknown()).optional()  // user-supplied tweaks
});
export type RunConfig = z.infer<typeof RunConfig>;
```

#### Setup script (`scripts/setup-managed-agents.ts`) — execution + idempotency

Run once: `pnpm tsx scripts/setup-managed-agents.ts`. Add to `package.json` scripts: `"setup:agents": "tsx scripts/setup-managed-agents.ts"`. Add `tsx` to dev deps if not present.

The script must be idempotent — re-running should NOT create duplicate agents/environments. Pattern:

```ts
// scripts/setup-managed-agents.ts
import Anthropic from '@anthropic-ai/sdk';
import { promises as fs } from 'fs';
import { OpportunityWithRecipientUrls } from '@/lib/schemas/opportunity';
import { RubricMatchResult } from '@/lib/schemas/match';
import { zodToJsonSchema } from 'zod-to-json-schema';

const client = new Anthropic();
const ENV_NAME = 'atelier-default';
const SCOUT_NAME = 'Atelier Opportunity Scout';
const RUBRIC_NAME = 'Atelier Rubric Matcher';

// SDK list endpoints return a page object with .data + auto-pagination via async iteration.
// Use the explicit async iterator (works for environments.list and agents.list as well as events.list).
async function findByName<T extends { id: string; name: string }>(
  list: AsyncIterable<T>,
  name: string
): Promise<T | null> {
  for await (const item of list) {
    if (item.name === name) return item;
  }
  return null;
}

async function findOrCreateEnvironment() {
  const existing = await findByName(client.beta.environments.list() as any, ENV_NAME);
  if (existing) return existing;
  return client.beta.environments.create({
    name: ENV_NAME,
    config: { type: 'cloud', networking: { type: 'unrestricted' } }
  });
}

// agents.update is PATCH-like: omitted fields preserved, scalars replaced, arrays fully replaced.
// REQUIRED: pass `version` (the current version) for optimistic concurrency. Doc-verified 2026-04-23.
// `system`, `model`, `name`, `tools`, `mcp_servers`, `skills` are all MUTABLE — system prompt updates
// take effect on the new version. No-op detection: if config matches current, no new version is created.
async function findOrCreateAgent(config: { name: string; model: string; system: string; tools: any[] }) {
  const existing = await findByName(client.beta.agents.list() as any, config.name);
  if (existing) {
    return client.beta.agents.update(existing.id, {
      version: (existing as any).version,  // required for optimistic concurrency
      ...config
    });
  }
  return client.beta.agents.create(config);
}

async function main() {
  const env = await findOrCreateEnvironment();
  console.log('ATELIER_ENV_ID=' + env.id);

  const scoutSystem = (await fs.readFile('skills/opportunity-sources.md', 'utf-8'))
    + '\n\n---\n\n'
    + (await fs.readFile('skills/eligibility-patterns.md', 'utf-8'));

  const scout = await findOrCreateAgent({
    name: SCOUT_NAME,
    model: 'claude-opus-4-7',
    system: scoutSystem,
    tools: [
      { type: 'agent_toolset_20260401' },
      {
        type: 'custom',
        name: 'persist_opportunity',
        description: 'Persist a discovered Opportunity to the orchestrator database. Pass the full structured opportunity JSON including past_recipient_image_urls.',
        input_schema: zodToJsonSchema(OpportunityWithRecipientUrls, { target: 'openApi3' })
      }
    ]
  });
  console.log('SCOUT_AGENT_ID=' + scout.id);

  const rubricSystem = [
    await fs.readFile('skills/juror-reading.md', 'utf-8'),
    await fs.readFile('skills/aesthetic-vocabulary.md', 'utf-8')
  ].join('\n\n---\n\n');

  const rubric = await findOrCreateAgent({
    name: RUBRIC_NAME,
    model: 'claude-opus-4-7',
    system: rubricSystem,
    tools: [
      { type: 'agent_toolset_20260401' },
      {
        type: 'custom',
        name: 'persist_match',
        description: 'Persist a fit-score result for a single opportunity. Pass full RubricMatchResult JSON.',
        input_schema: zodToJsonSchema(RubricMatchResult, { target: 'openApi3' })
      }
    ]
  });
  console.log('RUBRIC_AGENT_ID=' + rubric.id);
}

main().catch(e => { console.error(e); process.exit(1); });
```

**Verify-update edge case:** if `agents.update(id, config)` fails with "field X is immutable" (e.g. `model` cannot change post-create), the script logs the error and tells the operator to delete the agent in the Anthropic console + re-run. For the hackathon, we don't change models — this won't trigger.

After first run, paste the three IDs into `.env.local` AND `vercel env add` for production+preview+development. Re-running is safe — it updates instead of duplicating.

**Skill file changes:** any change to `opportunity-sources.md`, `eligibility-patterns.md`, `juror-reading.md`, or `aesthetic-vocabulary.md` requires re-running this script to push a new agent version. In-flight sessions keep the version they pinned.

#### Per-run code (`lib/agents/opportunity-scout.ts`)

```ts
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/auth/api-key';
import { getDb } from '@/lib/db/client';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import type { RunConfig } from '@/lib/schemas/run';

export async function startScoutSession(
  runId: number,
  akb: ArtistKnowledgeBase,
  config: RunConfig
): Promise<string> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });

  const session = await client.beta.sessions.create({
    agent: process.env.SCOUT_AGENT_ID!,
    environment_id: process.env.ATELIER_ENV_ID!,
    title: `Scout run ${runId}`
  });

  const db = getDb();
  await db.execute({
    sql: `INSERT INTO run_event_cursors (run_id, managed_session_id, phase, last_event_id) VALUES (?, ?, 'scout', NULL)`,
    args: [runId, session.id]
  });
  await db.execute({ sql: `UPDATE runs SET status = 'scout_running' WHERE id = ?`, args: [runId] });

  await client.beta.sessions.events.send(session.id, {
    events: [{
      type: 'user.message',
      content: [{ type: 'text', text: buildScoutPrompt(akb, config) }]
    }]
  });

  return session.id;
}

export function buildScoutPrompt(akb: ArtistKnowledgeBase, config: RunConfig): string {
  return `Find institutional opportunities for this artist whose deadlines fall in the configured window.

ARTIST_AKB:
${JSON.stringify(akb, null, 2)}

RUN_CONFIG:
- window: ${config.window_start} to ${config.window_end}
- budget_usd: ${config.budget_usd} (0 = no fee cap)
- max_travel_miles: ${config.max_travel_miles ?? 'unlimited'}

YOUR TASK:
1. Traverse every source listed in your loaded skill file (opportunity-sources.md). Use web_fetch on each source's listings page.
2. For each open call in the window: web_fetch the call's detail page, extract structured fields (name, deadline, award type/amount/prestige_tier, eligibility, entry_fee_usd).
3. Apply hard eligibility filters from the AKB (citizenship, medium, career_stage). Drop opportunities the artist is plainly ineligible for.
4. For each surviving opportunity: visit the source's past_recipients_url. Identify the last 3 years of recipients. For each recipient, locate their portfolio page (their personal site OR an institutional bio page). Extract up to 5 representative portfolio image URLs per recipient (max 3 recipients per opportunity).
5. Emit one persist_opportunity custom tool call per opportunity. Pass the full structured Opportunity object PLUS a 'past_recipient_image_urls' array of objects: { recipient_name, year, image_urls: string[] }.
6. After all sources are processed, emit a final agent.message with text: "<DONE>".

DO NOT download recipient images yourself — only collect URLs. The orchestrator handles downloading.

DO NOT use the write tool for binary content. If you need to inspect any image briefly during disambiguation, use bash + curl with a proper Referer header to defeat hotlink protection:
\`\`\`
curl -fsSL -e "https://example.com/" -A "Mozilla/5.0" -o /tmp/x.jpg "https://example.com/image.jpg"
\`\`\`
Then \`read /tmp/x.jpg\`.

If web_fetch fails on a source (404, anti-scraping, paywall), skip it and continue. Note skipped sources at the end.`;
}
```

#### `OpportunityWithRecipientUrls` schema (extends Opportunity)

```ts
// lib/schemas/opportunity.ts — add to existing Opportunity definition
export const RecipientWithUrls = z.object({
  recipient_name: z.string(),
  year: z.number().nullable(),
  image_urls: z.array(z.string().url()).max(5)
});

export const OpportunityWithRecipientUrls = Opportunity.extend({
  past_recipient_image_urls: z.array(RecipientWithUrls).max(3)
});
```

#### Orchestrator-side: handling `persist_opportunity`

This is invoked from the events polling handler when it detects a `requires_action` idle event with custom tool use IDs (see Reference §"Custom tool result round-trip"). The handler:

```ts
// lib/agents/opportunity-scout.ts — continued
import { OpportunityWithRecipientUrls } from '@/lib/schemas/opportunity';

export async function persistOpportunityFromAgent(
  runId: number,
  rawInput: unknown
): Promise<string> {
  const data = OpportunityWithRecipientUrls.parse(rawInput);
  const db = getDb();

  // Upsert opportunity row
  const oppRes = await db.execute({
    sql: `INSERT INTO opportunities (source, source_id, name, url, deadline, award_summary, eligibility_json, raw_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source, source_id) DO UPDATE SET
            name = excluded.name, url = excluded.url, deadline = excluded.deadline,
            award_summary = excluded.award_summary, eligibility_json = excluded.eligibility_json,
            raw_json = excluded.raw_json, fetched_at = unixepoch()
          RETURNING id`,
    args: [
      data.source, data.source_id, data.name, data.url, data.deadline ?? null,
      `${data.award.type} ${data.award.amount_usd ?? data.award.in_kind ?? ''}`.trim(),
      JSON.stringify(data.eligibility),
      JSON.stringify(data)
    ]
  });
  const opportunityId = (oppRes.rows[0] as any).id;

  // Link this opportunity to this run so finalize-scout can find it
  await db.execute({
    sql: `INSERT OR IGNORE INTO run_opportunities (run_id, opportunity_id) VALUES (?, ?)`,
    args: [runId, opportunityId]
  });

  // Stage past_recipient_image_urls for download by finalize-scout (next phase).
  // ON CONFLICT: if Scout rediscovers a recipient (cross-run cache hit), only update
  // portfolio_urls if the existing row hasn't already been mirrored to Blob (we don't
  // want to overwrite Blob URLs with raw URLs from a fresher Scout pass).
  for (const rec of data.past_recipient_image_urls) {
    await db.execute({
      sql: `INSERT INTO past_recipients (opportunity_id, year, name, portfolio_urls)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(opportunity_id, year, name) DO UPDATE SET
              portfolio_urls = CASE
                WHEN portfolio_urls LIKE '%blob.vercel-storage%' THEN portfolio_urls
                ELSE excluded.portfolio_urls
              END,
              fetched_at = unixepoch()`,
      args: [opportunityId, rec.year, rec.recipient_name, JSON.stringify(rec.image_urls)]
    });
  }

  return 'persisted';
}
```

(Note: `past_recipients.portfolio_urls` stores URLs initially. The finalize-scout step downloads them into Blob and updates the row to point at Blob URLs.)

### 3.3 Past-recipient image downloader (Vercel-side, NOT an agent)

Triggered automatically by the events polling handler when the Scout session reaches terminal idle. Runs as `app/api/runs/[id]/finalize-scout/route.ts` (Vercel function, `maxDuration: 300`).

#### The 5-min Vercel cap problem

For 30 opportunities × 3 recipients × 5 images = up to 450 image downloads. At ~1-2s per download (network + Blob upload), that's 7-15 min sequential. Two mitigations:

1. **Parallelize.** `p-limit` at concurrency 10 reduces 450 × 1.5s to ~70s (well within 5min).
2. **Cache aggressively.** The `past_recipients` row keyed by `(opportunity_id, year, name)` lets us skip downloads if a row from a prior run within 90 days already has a Blob URL. Most reruns of the same opportunity hit cache.

```ts
// app/api/runs/[id]/finalize-scout/route.ts
import pLimit from 'p-limit';
import { put } from '@vercel/blob';
import { waitUntil } from '@vercel/functions';
import sharp from 'sharp';
import { getDb } from '@/lib/db/client';

export const runtime = 'nodejs';
export const maxDuration = 300;  // Vercel Pro

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  const db = getDb();

  // Mark phase
  await db.execute({ sql: `UPDATE runs SET status = 'finalizing_scout' WHERE id = ?`, args: [runId] });

  // Pull all past_recipients rows for this run's opportunities (via run_opportunities join table)
  // that still have URL-only portfolio_urls (haven't been mirrored to Blob yet).
  const rows = (await db.execute({
    sql: `SELECT pr.id, pr.opportunity_id, pr.name, pr.year, pr.portfolio_urls
          FROM past_recipients pr
          JOIN run_opportunities ro ON ro.opportunity_id = pr.opportunity_id
          WHERE ro.run_id = ?
            AND pr.portfolio_urls LIKE '[%'
            AND pr.portfolio_urls NOT LIKE '%blob.vercel-storage%'`,
    args: [runId]
  })).rows;

  const limit = pLimit(10);
  await Promise.all(rows.map(row => limit(() => downloadRow(row as any))));

  // Fire start-rubric in true fire-and-forget (waitUntil keeps it alive past response)
  waitUntil(fetch(new URL(`/api/runs/${runId}/start-rubric`, req.url), { method: 'POST' }));
  return Response.json({ downloaded: rows.length });
}

async function downloadRow(row: { id: number; opportunity_id: number; name: string; portfolio_urls: string }) {
  const urls: string[] = JSON.parse(row.portfolio_urls);
  const blobUrls: string[] = [];
  const failures: { url: string; reason: string }[] = [];
  for (const url of urls) {
    try {
      // Referer = the URL's origin. Many institutional portfolios gate images on Referer
      // (hotlink protection); sending the page's own origin defeats the simplest version of this.
      const referer = new URL(url).origin + '/';
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          'Referer': referer,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Atelier/0.1'
        }
      });
      if (!res.ok) {
        failures.push({ url, reason: `HTTP ${res.status}` });
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const thumb = await sharp(buf).rotate().resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
      const safeName = `${row.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}_pr${row.id}`;
      const pathname = `recipients/${row.opportunity_id}/${safeName}/${blobUrls.length}.jpg`;
      const { url: blobUrl } = await put(pathname, thumb, { access: 'public', contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true });
      blobUrls.push(blobUrl);
    } catch (e: any) {
      failures.push({ url, reason: e?.message ?? String(e) });
    }
  }

  // Log failures to run_events (visible in run-in-progress UI + post-mortem debugging)
  if (failures.length > 0) {
    await getDb().execute({
      sql: `INSERT INTO run_events (run_id, agent, kind, payload_json) VALUES (NULL, 'finalize-scout', 'error', ?)`,
      args: [JSON.stringify({ recipient_id: row.id, recipient_name: row.name, opportunity_id: row.opportunity_id, failures })]
    });
    console.warn(`[finalize-scout] recipient ${row.name} (id=${row.id}, opp=${row.opportunity_id}): ${failures.length}/${urls.length} downloads failed`, failures);
  }

  await getDb().execute({
    sql: `UPDATE past_recipients SET portfolio_urls = ?, fetched_at = unixepoch() WHERE id = ?`,
    args: [JSON.stringify(blobUrls), row.id]
  });
}
```

#### Cache check before queueing downloads

The query already filters out cached rows by checking for `blob.vercel-storage` in the JSON, so re-runs of the same opportunity skip already-downloaded recipients. For more aggressive cross-run caching: a separate `past_recipients` row keyed by `(opportunity_id, year, name)` from a prior run is reusable as-is — it just needs to be linked to the new `run_opportunities` row. The current query handles this naturally since `past_recipients.portfolio_urls` is shared across runs.

### 3.4 Rubric Matcher (Managed Agent) — REVISED after audit

**Architectural change from earlier draft:** Vision input mechanism is now explicit. The agent receives image URLs in the kickoff prompt; for each image, the agent runs `bash -c "curl -o /tmp/<id>.jpg <url>"` then `read /tmp/<id>.jpg` — the `read` tool is multimodal-aware per the toolset documentation and returns image content blocks Claude can vision over.

#### Output schema (`lib/schemas/match.ts`)

```ts
import { z } from 'zod';

export const RubricMatchResult = z.object({
  opportunity_id: z.number(),
  fit_score: z.number().min(0).max(1),
  reasoning: z.string().min(40),    // enforce ≥1 sentence
  supporting_image_ids: z.array(z.number()),
  hurting_image_ids: z.array(z.number()),
  cited_recipients: z.array(z.string()).min(1),  // enforce "cite at least one recipient by name"
  institution_aesthetic_signature: z.string()    // synthesized signature, captured for debugging + dossier
});
export type RubricMatchResult = z.infer<typeof RubricMatchResult>;
```

#### Per-run kickoff (`lib/agents/rubric-matcher.ts`)

```ts
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/auth/api-key';
import { getDb } from '@/lib/db/client';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import type { StyleFingerprint } from '@/lib/schemas/style-fingerprint';

interface OpportunityForRubric {
  id: number;
  name: string;
  url: string;
  prestige_tier: string;
  past_recipients: Array<{
    name: string;
    year: number | null;
    image_urls: string[];   // Vercel Blob URLs from finalize-scout
  }>;
}

interface PortfolioRef {
  id: number;
  thumb_url: string;        // Vercel Blob URL
}

export async function startRubricSession(
  runId: number,
  akb: ArtistKnowledgeBase,
  styleFingerprint: StyleFingerprint,
  portfolioImages: PortfolioRef[],
  opportunities: OpportunityForRubric[]
): Promise<string> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });
  const session = await client.beta.sessions.create({
    agent: process.env.RUBRIC_AGENT_ID!,
    environment_id: process.env.ATELIER_ENV_ID!,
    title: `Rubric run ${runId}`
  });

  await getDb().execute({
    sql: `INSERT INTO run_event_cursors (run_id, managed_session_id, phase, last_event_id) VALUES (?, ?, 'rubric', NULL)
          ON CONFLICT(run_id) DO UPDATE SET managed_session_id = excluded.managed_session_id, phase = 'rubric', last_event_id = NULL, updated_at = unixepoch()`,
    args: [runId, session.id]
  });

  await client.beta.sessions.events.send(session.id, {
    events: [{
      type: 'user.message',
      content: [{ type: 'text', text: buildRubricPrompt(akb, styleFingerprint, portfolioImages, opportunities) }]
    }]
  });

  return session.id;
}

function buildRubricPrompt(
  akb: ArtistKnowledgeBase,
  fp: StyleFingerprint,
  portfolio: PortfolioRef[],
  opps: OpportunityForRubric[]
): string {
  const portfolioBlock = portfolio.map(p => `  id=${p.id}: ${p.thumb_url}`).join('\n');
  const oppsBlock = opps.map(o => {
    const recipients = o.past_recipients.map(r =>
      `    - ${r.name} (${r.year ?? 'year unknown'}): ${r.image_urls.join(', ')}`
    ).join('\n');
    return `  OPPORTUNITY id=${o.id}, prestige=${o.prestige_tier}: "${o.name}" (${o.url})
    past recipients:
${recipients}`;
  }).join('\n\n');

  return `You are scoring how well an artist's portfolio fits each of N institutional opportunities.

ARTIST_AKB (career-stage context, not for visual scoring):
${JSON.stringify(akb, null, 2)}

STYLE_FINGERPRINT (the canonical visual read of this artist's work):
${JSON.stringify(fp, null, 2)}

ARTIST_PORTFOLIO (12 representative images by id and URL):
${portfolioBlock}

OPPORTUNITIES_TO_SCORE (${opps.length} total):
${oppsBlock}

VISION ACCESS (READ THIS — IT'S HOW YOU "SEE" IMAGES):
- The user.message you receive cannot embed image content blocks directly. To vision over any image, you must:
  1. Download it (use Referer + UA to defeat hotlink protection):
     bash -c 'curl -fsSL -e "$(echo URL | sed -E '"'"'s|^(https?://[^/]+).*|\\1/|'"'"')" -A "Mozilla/5.0" -o /tmp/<unique-name>.jpg "URL"'
     (Or simpler if you can compute the origin yourself: -e "https://host.example/")
  2. Read it as multimodal: read /tmp/<unique-name>.jpg  (the read tool returns a vision-usable content block)
- Use unique filenames (e.g. /tmp/portfolio_<id>.jpg, /tmp/opp_<oppid>_<recipient>_<n>.jpg) so reads don't clash.
- Use the bash tool, NOT the write tool, for binary downloads.
- If a download returns 403 even with Referer + UA, skip that image and proceed with the others. Note the skip in your reasoning if it materially affected your read.

ID MAPPING (CRITICAL — DO NOT FABRICATE IDs):
- Each OPPORTUNITY block above is labeled "OPPORTUNITY id=N" — that N is the opportunity_id you MUST pass back in persist_match. Do not invent IDs; do not omit; do not transform.
- Each ARTIST_PORTFOLIO line is labeled "id=M" — those M values are the only valid entries for supporting_image_ids and hurting_image_ids. Pick from this list; do not invent IDs for images that aren't in this list.

WORKFLOW (for EACH opportunity in OPPORTUNITIES_TO_SCORE, in order):
  Step 1. For each past recipient (up to 3), download and read 3-5 of their portfolio images. Synthesize the institution's "aesthetic signature" — composition tendencies, palette, subject categories, formal lineage, career-stage register. Use vocabulary from your loaded juror-reading.md and aesthetic-vocabulary.md skill files. Be specific.
  Step 2. Identify the artist's portfolio images that BEST support the fit (download + read these too, comparing against the signature). And the ones that HURT it most.
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
```

#### Cost note for vision

Each vision read of a 1024px image is ~1500-1900 tokens. For 30 opportunities × (3 recipients × 5 images + 12 portfolio reads referenced) = ~~~30 × (15 + ~5 portfolio refs that get read across opps) = ~600 image reads × 1700 tokens = ~1M image tokens just for vision. At Opus 4.7 input pricing ($5/M tokens) = ~$5 per Rubric Matcher run for vision alone. Plus output tokens. Budget ~$8-12 per full run.

The agent will likely cache portfolio image reads across opportunities (Claude tends to reuse rather than re-download identical files), but vision tokens are the dominant cost.

#### Orchestrator-side: handling `persist_match`

```ts
// lib/agents/rubric-matcher.ts — continued
import { RubricMatchResult } from '@/lib/schemas/match';

export async function persistMatchFromAgent(runId: number, rawInput: unknown): Promise<string> {
  const data = RubricMatchResult.parse(rawInput);
  const included = data.fit_score >= 0.45 ? 1 : 0;
  // ON CONFLICT: if the agent re-emits persist_match for the same opportunity (retry/rephrase),
  // the latest call overwrites the prior row. UNIQUE(run_id, opportunity_id) enforces 1 match per opp per run.
  await getDb().execute({
    sql: `INSERT INTO run_matches (run_id, opportunity_id, fit_score, reasoning, supporting_image_ids, hurting_image_ids, included)
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
      included
    ]
  });
  return 'persisted';
}
```

The polling handler routes `persist_match` calls here (analogous to `persist_opportunity` for Scout). Threshold: scores `< 0.45` still get persisted but with `included = 0` for the dossier's "filtered out" section.

#### Concurrency within the agent session

The Managed Agent loop is single-threaded per session — the agent processes opportunities sequentially. For 30 opportunities × ~30-60s each (download + read + reason) = ~15-30 min run time. Within the 10-30min window the spec targets.

If runtime exceeds 30 min for a single Rubric session, consider splitting opportunities across multiple sessions (run 3 Rubric sessions in parallel, each handling 10 opportunities). Polling handler treats each as a separate session_id.

#### `start-rubric` route (`app/api/runs/[id]/start-rubric/route.ts`)

```ts
import { waitUntil } from '@vercel/functions';
import { getDb } from '@/lib/db/client';
import { startRubricSession } from '@/lib/agents/rubric-matcher';
import { selectTopPortfolioImages } from '@/lib/agents/rubric-matcher';

export const runtime = 'nodejs';
export const maxDuration = 60;  // tiny — just kicks off a session

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  const db = getDb();

  // Mark phase
  await db.execute({ sql: `UPDATE runs SET status = 'rubric_running' WHERE id = ?`, args: [runId] });

  // Load context
  const runRow = (await db.execute({ sql: `SELECT user_id, akb_version_id, style_fingerprint_id FROM runs WHERE id = ?`, args: [runId] })).rows[0] as any;
  const akb = JSON.parse((await db.execute({ sql: `SELECT json FROM akb_versions WHERE id = ?`, args: [runRow.akb_version_id] })).rows[0]!.json as string);
  const fingerprint = JSON.parse((await db.execute({ sql: `SELECT json FROM style_fingerprints WHERE id = ?`, args: [runRow.style_fingerprint_id] })).rows[0]!.json as string);

  const top12 = await selectTopPortfolioImages(runRow.user_id);

  // Load opportunities for this run with their past_recipients (now with Blob URLs)
  const oppRows = (await db.execute({
    sql: `SELECT o.id, o.name, o.url, o.raw_json
          FROM opportunities o
          JOIN run_opportunities ro ON ro.opportunity_id = o.id
          WHERE ro.run_id = ?`,
    args: [runId]
  })).rows;

  const opportunities = await Promise.all(oppRows.map(async (r: any) => {
    const raw = JSON.parse(r.raw_json);
    const recRows = (await db.execute({
      sql: `SELECT name, year, portfolio_urls FROM past_recipients WHERE opportunity_id = ? AND portfolio_urls LIKE '%blob.vercel-storage%'`,
      args: [r.id]
    })).rows;
    return {
      id: r.id,
      name: r.name,
      url: r.url,
      prestige_tier: raw.award.prestige_tier,
      past_recipients: recRows.map((rr: any) => ({
        name: rr.name,
        year: rr.year,
        image_urls: JSON.parse(rr.portfolio_urls)
      }))
    };
  }));

  if (opportunities.length === 0) {
    // No opportunities to score — skip Rubric, mark complete
    await db.execute({ sql: `UPDATE runs SET status = 'rubric_complete' WHERE id = ?`, args: [runId] });
    waitUntil(fetch(new URL(`/api/runs/${runId}/finalize`, req.url), { method: 'POST' }));
    return Response.json({ skipped: true, reason: 'no opportunities' });
  }

  await startRubricSession(runId, akb, fingerprint, top12, opportunities);
  return Response.json({ session_started: true, opportunity_count: opportunities.length });
}
```

#### Portfolio image selection algorithm (`selectTopPortfolioImages`)

Picks the 12 most representative portfolio images. Selection algorithm:

```ts
// lib/agents/rubric-matcher.ts — addition
export async function selectTopPortfolioImages(userId: number): Promise<PortfolioRef[]> {
  const db = getDb();
  // V1 algorithm: spread across portfolio order. If user has reordered (ordinal column),
  // their ordering reflects their own preference — sample evenly across it.
  const all = (await db.execute({
    sql: `SELECT id, thumb_url FROM portfolio_images WHERE user_id = ? ORDER BY ordinal ASC`,
    args: [userId]
  })).rows as Array<{ id: number; thumb_url: string }>;

  if (all.length <= 12) return all;

  // Even-spaced sample of 12 across the ordering
  const step = all.length / 12;
  const picked: typeof all = [];
  for (let i = 0; i < 12; i++) {
    picked.push(all[Math.floor(i * step)]);
  }
  return picked;
}
```

Note for v1.1: this could be replaced with a smarter algorithm (e.g., images cited as `supporting_image_ids` in past Rubric runs are candidates). For v1, even-spaced sampling across user-curated order is good enough.

#### Orchestration sequence (Scout → finalize-scout → start-rubric → Rubric → finalize)

End-to-end flow from `POST /api/runs/start`. Each step's failure mode + status transitions:

| Step | Route / function | Sets `runs.status` to | Fires next step via |
|---|---|---|---|
| 1 | `POST /api/runs/start` | `scout_running` | (returns `{run_id, session_id}` to browser) |
| 2 | Browser poll `/api/runs/[id]/events` (×N) | (no change while running) | (no fire — handler does inline `handleRequiresAction` for custom tools) |
| 3 | Polling handler detects Scout terminal idle | `scout_complete` | `waitUntil(fetch('/finalize-scout'))` |
| 4 | `POST /api/runs/[id]/finalize-scout` | `finalizing_scout` → (no further set; start-rubric overwrites) | `waitUntil(fetch('/start-rubric'))` |
| 5 | `POST /api/runs/[id]/start-rubric` | `rubric_running` | startRubricSession overwrites `run_event_cursors.managed_session_id` + `phase='rubric'` |
| 6 | Browser poll continues against same `/events` endpoint | (no change while running) | inline `handleRequiresAction` for `persist_match` |
| 7 | Polling handler detects Rubric terminal idle | `rubric_complete` | `waitUntil(fetch('/finalize'))` |
| 8 | `POST /api/runs/[id]/finalize` (Phase 4) | `finalizing` → `complete` | (response: dossier URL) |

**At each phase boundary:** if the next-step `fetch` fails (network blip, route 500), the run wedges in the intermediate status (`scout_complete`, `rubric_complete`). Mitigation: a "Resume" button on the dossier page checks `runs.status` and re-fires the appropriate next-step route.

**Deployment Protection caveat:** if the Vercel project has Deployment Protection on, server-to-server `fetch` between routes may be blocked. Two fixes:
- For the demo / public deploy: turn Deployment Protection off (Phase 5 pre-flight already flags this)
- For dev with protection on: use Vercel Bypass Token in the fetch headers (`'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET`)

### 3.5 Gallery Targeter

Same Managed Agent pattern as Rubric Matcher, with one shape change:
- "Past recipients" → "currently represented artists" (gallery rosters)
- Each gallery in `skills/opportunity-sources.md` has `type: gallery` with a `roster_url` field instead of `past_recipients_url`
- Reuses the Rubric Matcher agent definition + `persist_match` custom tool. The agent doesn't need to know it's looking at galleries vs grants — same task structure
- [ ] Add a `category: 'gallery'` discriminator to `Opportunity.award.type = 'representation'` so the dossier UI can render gallery matches in their own section
- [ ] In the `opportunity-sources.md` YAML, gallery entries look like:
  ```yaml
  - id: foley-gallery-nyc
    name: Foley Gallery
    url: https://www.foleygallery.com
    type: gallery
    category: [representation]
    roster_url: https://www.foleygallery.com/artists      # used in place of past_recipients_url
    eligibility_summary: open submissions accepted; no fee
    deadline_pattern: rolling
    access_notes: roster page lists current represented artists with portfolio links
    signal_quality: mid
  ```

### 3.6 Pre-test on three known opportunities
- [ ] Run Rubric Matcher manually against:
  1. Magnum Foundation (expected: low fit — documentary social practice ≠ landscape formalism)
  2. Critical Mass / Photolucida (expected: high fit — lens-based fine art, broad aesthetic territory)
  3. Guggenheim Fellowship (expected: medium-high — depends on AKB framing)
- [ ] If reasoning is thin or scores are noisy, iterate the system prompt and `juror-reading.md` skill

### 3.7 Smoke tests + testing infrastructure (NEW — applies to all phases)

Automated tests so John doesn't have to manually verify every component, AND so the repo demonstrates rigor to hackathon judges.

#### Setup

- [ ] `vitest.config.ts` at repo root:
  ```ts
  import { defineConfig } from 'vitest/config';
  import { resolve } from 'path';
  export default defineConfig({
    test: {
      environment: 'node',
      globals: true,
      include: ['tests/**/*.test.ts'],
      // Smoke tests are fast (mocks); integration tests are slow (real APIs)
      pool: 'threads',
      testTimeout: 30_000  // smoke; override per-file for integration
    },
    resolve: { alias: { '@': resolve(__dirname, '.') } }
  });
  ```
- [ ] `package.json` scripts:
  ```json
  "test": "vitest run tests/smoke",
  "test:integration": "vitest run tests/integration",
  "test:e2e": "vitest run tests/e2e --testTimeout=600000",
  "test:all": "vitest run",
  "test:ui": "vitest --ui"
  ```
- [ ] `tests/fixtures/` directory with:
  - 5 small JPEG portfolio images (~50KB each, real photos John provides)
  - 1 known-good `AKB.json` for John
  - 1 known-good `StyleFingerprint.json`
  - 3 mock `Opportunity` JSONs (Magnum, Critical Mass, Guggenheim) with hand-curated `past_recipient_image_urls`

#### Smoke tests (fast, mocked, runs every commit, ~30s total)

`tests/smoke/`:

- [ ] `health.test.ts` — `GET /api/health` returns `{db: true, env: true}`. Hits real Turso.
- [ ] `db-schema.test.ts` — verify all 13 tables exist + key columns + indexes + FKs. Detects schema drift.
- [ ] `web-search-enabled.test.ts` — `GET /api/health/web-search` returns `enabled: true`. Detects org admin disabling web_search.
- [ ] `blob-roundtrip.test.ts` — `putBlob` a 1KB test blob, fetch the URL, assert content matches, `del` it.
- [ ] `anthropic-ping.test.ts` — `messages.create` with `max_tokens: 8` and a trivial prompt. Asserts response.usage.input_tokens > 0. Detects API key issues, model availability, rate limits.
- [ ] `style-fingerprint-validation.test.ts` — load fixture portfolio images, run `analyzePortfolio`, assert output passes `StyleFingerprint.parse()`.
- [ ] `akb-merge.test.ts` — JSON merge patch helper unit tests (RFC 7396 conformance).
- [ ] `composite-ranking.test.ts` — `compositeScore` unit tests across PRESTIGE_WEIGHTS, urgency thresholds, affordability edge cases.

#### Integration tests (slow, real Anthropic, runs on demand)

`tests/integration/`:

- [ ] `auto-discover.test.ts` — POST to `/api/extractor/auto-discover` with John's identity. Assert `discovered.length >= 8`, jknopf.com confidence >= 0.9, deduped URLs.
- [ ] `style-analyst-real.test.ts` — full Style Analyst run on John's actual 40-image portfolio. Assert `composition_tendencies.length >= 3`, `formal_lineage.length >= 2`, `career_positioning_read` is 200-800 chars.
- [ ] `knowledge-extractor-ingest.test.ts` — ingest jknopf.com + 1 known press URL. Assert AKB has `identity.legal_name === 'John Knopf'`, at least one publication, at least one exhibition.
- [ ] `scout-session-shape.test.ts` — start a Scout session with a tiny 1-source skill file; assert it produces at least 1 `agent.custom_tool_use` event with `name === 'persist_opportunity'` within 2 minutes.
- [ ] `rubric-vision-roundtrip.test.ts` — start a Rubric session against ONE pre-curated opportunity (Magnum). Wait for terminal idle. Assert `run_matches` row exists with `cited_recipients.length >= 1` and reasoning > 100 chars.
- [ ] `event-dedup.test.ts` — fire 3 concurrent polls against the same session; assert `run_events.event_id` UNIQUE constraint kept counts honest (no dupes).
- [ ] `setup-agents-idempotency.test.ts` — call `findOrCreateEnvironment` + `findOrCreateAgent` twice; assert second call returns same IDs (no duplicate Anthropic resources). NOTE: this hits real Anthropic to create resources, hence integration not smoke.
- [ ] `event-shape-probe.test.ts` — the §3.0.b smoke harness, kept as a regression check after Phase 3 ships.

#### E2E tests (full pipeline, runs before demo recording)

`tests/e2e/`:

- [ ] `full-pipeline-tiny.test.ts` — fixture: 5 portfolio images, 1 source (Magnum only). Run from `/api/runs/start` to dossier render. Assert in <10 min, no errors logged, dossier has 1 opportunity scored.
- [ ] `full-pipeline-real.test.ts` — John's real portfolio + AKB + 5 sources. Assert in <30 min, dossier has ≥3 opportunities, PDF renders.

#### Coverage report

- [ ] `pnpm test --coverage` (vitest's built-in c8) → coverage report. Target: smoke tests cover ≥80% of `lib/` non-agent code (schemas, helpers, db, storage). Agent code (LLM calls) is hard to unit-cover; integration tests provide functional coverage.

#### Testing doc (`TESTING.md` at repo root)

- [ ] Write `TESTING.md` with:
  - Test categories table (smoke vs integration vs e2e), what each covers, runtime, when to run
  - How to run each: `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`
  - Test fixtures: where they live, how to update
  - Known limitations (LLM outputs are non-deterministic; assertions check structure not content)
  - For hackathon judges: explicit list of what's verified, including the 6 smoke + 6 integration + 2 e2e suites

#### Acceptance for §3.7

- [ ] `pnpm test` runs all smoke tests and all pass in <60s
- [ ] `pnpm test:integration` runs (≥1 hour budget, ~$5 in API costs) and all pass
- [ ] `TESTING.md` exists with all of the above
- [ ] CI hook (or at least a documented pre-commit step) running `pnpm test` before `git push` (optional but recommended)

### Acceptance gate — Phase 3
1. Opportunity Scout returns ≥30 candidate opportunities for John's profile
2. Rubric Matcher produces a fit score + 2-4 sentence reasoning for each, citing specific recipient aesthetic territory
3. The Magnum-vs-Critical-Mass demo moment works on real data
4. Both Scout + Matcher run as Managed Agents (side-prize requirement)
5. All §3.7 smoke tests pass; integration tests pass at least once

---

## Phase 4 — Output (Package Drafter + Orchestrator + Dossier)

**Goal:** Top-ranked opportunities have submission-ready materials. Final Career Dossier renders as web view + PDF.

### 4.1 Package Drafter (`lib/agents/package-drafter.ts`)

**Not a Managed Agent** — direct `client.messages.create()` calls. One call per match, one call per material type per match (so for 10 matches × 5 materials = 50 calls). All cheap (text-only, ~2-4K output tokens each).

- [ ] For each top match (top 10-15 by composite ranking):
  - Artist statement (300-500 words, institutional voice per `artist-statement-voice.md`)
  - Project proposal (per opportunity's stated requirements parsed from the opportunity URL; fall back to generic structure from `project-proposal-structure.md`)
  - CV formatted per institution (`cv-format-by-institution.md` — match if pattern exists, fall back to standard)
  - Cover letter (200-300 words)
  - Work-sample selection: 10-20 images from portfolio with per-image rationale
- [ ] Pull facts from AKB; never invent
- [ ] Persist to `drafted_packages`

**Concurrency strategy:**
- Package Drafter runs as a single Vercel function invocation triggered by `/api/runs/[id]/finalize`
- For 50 calls at ~15s each, sequential = ~12.5min — exceeds Vercel Pro 5min limit even with `maxDuration: 300`
- Solution: parallelize with `p-limit` at concurrency 5 (avoids rate-limit hits, ~50/5 × 15s = ~150s, fits in Pro 5min)
- Hobby tier (60s function limit): split into 5 batches of 10 calls each; trigger sequential batches via fire-and-forget `fetch` to `/api/runs/[id]/finalize?batch=N`
- **Pro tier recommended for the demo** — set `export const maxDuration = 300` on `app/api/runs/[id]/finalize/route.ts`

**Rate-limit guards:**
- Wrap every `messages.create` call in a try/catch; on `Anthropic.RateLimitError`, sleep `Number(error.headers['retry-after']) * 1000` ms and retry once
- The SDK does this automatically via `max_retries: 2` default — don't double-implement; just rely on it

### 4.2 Orchestrator (`lib/agents/orchestrator.ts`)

**Composite ranking — fully defined:**

```ts
function compositeScore(match: RunMatch, opportunity: Opportunity, config: RunConfig): number {
  const fit = match.fit_score;                          // 0-1, from Rubric Matcher
  const prestige = PRESTIGE_WEIGHTS[opportunity.award.prestige_tier];  // see table below
  const timeUrgency = computeUrgency(opportunity.deadline);            // see formula below
  const affordability = computeAffordability(opportunity.entry_fee_usd, config.budget_usd);
  return fit * prestige * timeUrgency * affordability;
}

const PRESTIGE_WEIGHTS = {
  flagship: 1.0,    // Guggenheim, MacDowell, NEA, Creative Capital — top-tier
  major: 0.85,      // Critical Mass, USA, Anonymous Was A Woman — heavyweight but not flagship
  mid: 0.70,        // Joan Mitchell, Ruth Arts, mid-tier residencies
  regional: 0.55,   // state arts councils, regional commissions
  'open-call': 0.40, // CaFE-tier open calls
};

function computeUrgency(deadline: string | undefined): number {
  if (!deadline) return 0.5;  // unknown deadline = neutral
  const days = (new Date(deadline).getTime() - Date.now()) / 86400000;
  if (days < 7)  return 0.3;  // too late to do well — penalize
  if (days < 30) return 1.0;  // sweet spot — actionable now
  if (days < 90) return 0.85; // good — plan ahead
  return 0.65;                 // far out — won't act on it soon
}

function computeAffordability(fee: number | undefined, budget: number): number {
  if (!fee) return 1.0;       // no fee = ideal
  if (budget === 0) return 1.0;  // no budget set = don't penalize
  if (fee > budget) return 0;    // over budget = excluded entirely
  const ratio = fee / budget;    // 0-1
  return 1 - (ratio * 0.5);      // half-weight: a fee at 100% of budget still scores 0.5, not 0
}
```

- [ ] Run composite scoring on all `included = 1` matches; sort descending; take top 15
- [ ] Generate cover narrative via `messages.create()` — system prompt = "you are writing the cover page of a Career Dossier for an artist; synthesize the StyleFingerprint into a 2-3 paragraph narrative", input = full StyleFingerprint
- [ ] Generate ranking narrative — input = top 15 matches with their reasoning + composite scores; output = 3-4 paragraphs explaining the ranking
- [ ] Generate "filtered out" one-liners — for each `included = 0` match, generate a single sentence from its reasoning ("Why not Magnum: documentary social practice, low fit with landscape formalism")
- [ ] Persist to `dossiers`

### 4.3 Dossier UI (`app/(dashboard)/dossier/[runId]/page.tsx`)
- [ ] Cover page (aesthetic read narrative)
- [ ] Top-N opportunities grid: card per opportunity with logo, deadline, award, fit score badge, expand → reasoning + drafted materials inline
- [ ] Deadline calendar component (visual timeline) — use `@nivo/calendar` or hand-roll a simple month-grid SVG
- [ ] Filtered-out section (collapsed by default, expand to read why-nots)
- [ ] Per-package: copy-to-clipboard, download as `.docx` (use the `docx` package already in installs)

**Logo scraping:** add `lib/logos.ts` with `getLogoUrl(opportunityUrl: string): Promise<string | null>`:
1. Fetch the opportunity URL, parse with cheerio
2. First try `meta[property="og:image"]` — the Open Graph image is usually the org's hero/logo
3. Fallback to `link[rel="icon"]` or `link[rel="apple-touch-icon"]` — favicons are at least branded
4. Final fallback: `null` — UI shows a placeholder gradient with first letter of org name
5. Cache result in a new `opportunity_logos` table keyed by `opportunity_id` to avoid re-scraping every dossier render

### 4.4 PDF export (`lib/pdf/dossier.tsx`)
- [ ] `@react-pdf/renderer` document mirroring the web view
- [ ] `app/api/dossier/[id]/pdf/route.ts` streams the PDF
- [ ] "Download Dossier PDF" button on `/dossier/[id]`

### 4.5 Run polling UI

(Was "streaming" — switched to polling per the Vercel orchestration design in the §Long-running run orchestration reference section.)

- [ ] `app/api/runs/[id]/events/route.ts` (GET): pull-on-read pattern — fetch new Anthropic events since cursor, persist, return diff. See §Long-running run orchestration for the implementation pattern
- [ ] `app/(dashboard)/runs/[id]/page.tsx` — Run-in-progress UI:
  - `useEffect` polling loop calling `/api/runs/[id]/events` every 3 seconds
  - Renders incoming events into a live activity feed (agent thinking, tool calls, tool results, status changes)
  - When response includes `done: true`, redirects to `/dossier/[runId]`
  - Used both during real runs and during the demo recording (the demo just plays back a real prior run's saved events at 10x via a `?playback=<run_id>&speed=10` URL param)

### 4.6 Remaining skill files

(Same provenance model as §1.5: research-mode agent drafts, builder audits.)

- [ ] `juror-reading.md` — fully fleshed out (most important after `opportunity-sources.md`)
- [ ] `artist-statement-voice.md` — anti-patterns + 3-5 worked examples
- [ ] `project-proposal-structure.md`
- [ ] `cv-format-by-institution.md` — Guggenheim, MacDowell, NEA, Creative Capital at minimum
- [ ] `submission-calendar.md`
- [ ] `past-winner-archives.md`
- [ ] `cost-vs-prestige-tiers.md`

### Acceptance gate — Phase 4
1. End-to-end run from John's AKB produces a dossier with ≥10 opportunities + drafted materials
2. PDF exports cleanly, prints legibly
3. John reads at least one drafted artist statement and confirms it's better than what he'd write
4. ≥10 skill files committed; each is real lived knowledge, not LLM filler

---

## Phase 5 — Submission

**Goal:** Clean recorded demo + submitted package.

### 5.1 Pre-flight
- [ ] Run `scripts/setup-managed-agents.ts` against the Anthropic prod API; capture the resulting `ATELIER_ENV_ID`, `SCOUT_AGENT_ID`, `RUBRIC_AGENT_ID` into Vercel env vars
- [ ] Full clean run from empty Turso DB on a fresh deploy (drop tables, re-run migrations, run the pipeline end-to-end)
- [ ] All 6 agent activities observable in the run polling UI
- [ ] No hardcoded test data anywhere; all real
- [ ] `pnpm build` clean; no TS errors; no console errors in prod

### 5.2 Demo recording
- [ ] Pre-run the full pipeline morning of recording, save the run
- [ ] Record per shot-list in spec §Demo strategy
- [ ] First Style Analyst pass = live recording; rest = playback of the saved run at 10x
- [ ] Single take of kicker line

### 5.3 README + submission
- [ ] README: one-paragraph what-it-is, 90-second setup (`pnpm i`, env, `pnpm dev`), architecture diagram, link to spec, link to skills directory
- [ ] Note in README linking Athena repo as "prior 5-day-build evidence of velocity"
- [ ] Written summary (180 words — pull from spec §Written summary)
- [ ] Submit via CV platform

### Acceptance gate — Phase 5
1. Repo clones + boots clean on a machine that has never seen it
2. Demo video uploaded
3. Submission confirmation received

---

## Cross-cutting concerns

### Polling + observability
- Managed Agent runs: events pulled from Anthropic on each browser poll, persisted to `run_events`
- Direct `messages.create()` calls (Style Analyst, Knowledge Extractor, Package Drafter, Orchestrator): wrap each in a helper `runAgentCall(runId, agentName, fn)` that writes a `start` event before, a `progress` event with usage during, an `output` event with the result on success, an `error` event on failure
- `run_events.payload_json` is verbose by design (debugging the demo if it stalls)
- UI polls `/api/runs/[id]/events?since=<lastEventId>` every 3s

### Error handling philosophy
- Validate every Claude JSON output with zod, retry once on failure with explicit "your previous output failed validation: <error>" prepended
- If second validation fails, persist the raw output to `run_events` with `kind='error'` and skip that match
- Never block the whole run on one bad opportunity

### Prompt-caching
- Style Analyst, Rubric Matcher, Package Drafter all reuse the same skill files — cache the system prompt aggressively (`cache_control: { type: 'ephemeral' }`)

### What's deliberately not in this plan
- Authentication / user accounts (single-user local v1; Phase 1.2 storage interfaces leave the door open)
- Auto-submit to forms (legal risk, scope cut in spec)
- Email notifications, mobile, deadline reminders (spec §v1 OUT)

### Path B (post-hackathon, public deploy) — what's left

Most of Path B is already in Path A: Turso scales multi-tenant, Vercel Blob scales multi-tenant, the agent orchestration pattern (poll-pull-on-read) handles concurrent runs naturally because each run has its own `managed_session_id`. Going from John-only to public is just:

1. **Auth:** add NextAuth or Clerk. Wire to a `users` table (already exists in schema). Replace `lib/auth/user.ts` body to return the session user's ID. **~half day.**
2. **BYO API key:** add a Settings UI field for the user's `ANTHROPIC_API_KEY`. Store encrypted at rest in a new `user_api_keys` table (use `crypto.subtle` AES-GCM with an `ENCRYPTION_KEY` env var). Update `lib/auth/api-key.ts` to look up the per-user key. **~half day.**
3. **Quotas + abuse prevention:** rate-limit run starts per user (e.g., 5 runs/day on free tier). **~quarter day.**

**Estimated scope: ~1-1.5 days post-hackathon.** Agent code, schema, blob store, and DB are all unchanged.

---

## Risk-driven checkpoints

Pull from spec §Risk register, with explicit decision points:

1. **Rubric Matcher quality dry-run** — end of Phase 3.6. If reasoning is thin, halt and iterate `juror-reading.md` + system prompt before continuing to Phase 4.
2. **Managed Agents port** — if Opportunity Scout works as Managed but Rubric Matcher hits friction, ship Scout as Managed and leave Matcher on direct SDK calls. One Managed Agent unlocks the side-prize narrative; two is optimal but not required.
3. **Demo dry-run** — full unedited 30-min run end-to-end before recording. If any step needs babysitting, fix before recording, not in post.

---

## Amendments

Additive features added after the original plan was written. These are appended (not edited inline) so the original phase numbering stays stable for in-flight coder sessions.

### Phase 2.10 — Portfolio URL ingestion (added 2026-04-23, mid-Phase-2)

Auto-scrape portfolio images from a list of URLs as an alternative to drag-drop. Pulls forward spec §38 ("Optional: URL to existing portfolio site for auto-ingest in v1.1") into v1.0 because (a) it removes a manual step from the demo and (b) the builder's site (Squarespace) makes the implementation trivial.

**Scope:**
- UI: above the existing dropzone on `/upload`, add a textarea labeled "Or paste portfolio URLs (one per line)" with a "Scrape" button
- New route: `app/api/portfolio/scrape/route.ts` (POST, body: `{urls: string[]}`)
  - For each URL: `fetch` HTML, parse with `cheerio`
  - Extract image URLs from `<img src>`, `<img data-src>`, `<img srcset>` (largest variant), `<picture><source srcset>`, `<a href>` ending in `.jpg/.jpeg/.png/.webp`
  - Filter: minimum 500px on either dimension (skip if dimensions known via `width`/`height` attrs; otherwise download + verify with `sharp`)
  - Dedupe across all URLs and against existing `portfolio_images.blob_pathname` (SHA-256 of original bytes is the key)
  - For each surviving image: pipe through the SAME upload pipeline as the dropzone. Refactor the per-image steps from `app/api/portfolio/upload/route.ts` into a shared helper (`lib/portfolio/ingest.ts`) so both routes use one code path
  - Stream progress to UI via SSE or chunked response so user sees images appearing as scraped
- **Squarespace optimization:** if a URL host is `images.squarespace-cdn.com/content/v1/`, append `?format=2500w` to request full-res. Handles the builder's site (jknopf.com) and any other Squarespace artist site cleanly
- UX after scrape: scraped images appear in the same grid as drag-drop uploads, with a "review" state (checkbox per image) so user can deselect false positives before commit. Default = all selected

**Test URLs (builder's site):**
- https://www.jknopf.com/art
- https://www.jknopf.com/the-art
- https://www.jknopf.com/panoart
- https://www.jknopf.com/square-45
- https://www.jknopf.com/sunrisesymphonynew
- https://www.jknopf.com/vertical-2

**Acceptance:** pasting all six URLs returns 30+ unique images (deduped across pages) in the grid, ready for Style Analyst.

**Sequencing:** build AFTER current Phase 2 work (2.5 Knowledge Extractor, 2.6 gap detection, 2.7 interview UI, 2.8 `/review` page, 2.9 Builder runs his own AKB) but BEFORE the Phase 2 acceptance gate. The gate's image-upload check can use the URL scraper in place of manual drag-drop.

### Phase 2.12 — Auto-discover mode for Knowledge Extractor (added 2026-04-23, mid-Phase-2; revised after audit)

Auto-discover an artist's public web presence (gallery bios, press features, interviews, official pages) by searching the web from name + keywords. Removes the manual URL-gathering tedium for the Knowledge Extractor. NOT to be named "Google me" anywhere — trademark.

#### API surface (verified against Anthropic docs 2026-04-23)

- Web search: `web_search_20260209` (Opus 4.7 supports this version with dynamic filtering)
- **Dynamic filtering REQUIRES `code_execution_20260120` to ALSO be in the `tools` array.** Per docs: "Dynamic filtering requires the code execution tool to be enabled." Without it, you get the basic `web_search_20250305` behavior (less efficient, more tokens). Always include both.
- Pricing: $10 per 1,000 web searches + standard token costs + code_execution time. A 6-10 query discovery run ≈ $0.06-0.15 total.
- Stop reason `pause_turn`: server-side loop hit iteration cap. Re-send with the assistant's prior content appended.
- Streaming: SDK emits `content_block_start` events for `server_tool_use` blocks (queries) and `web_search_tool_result` blocks (results). Wrap as SSE — concrete pattern below.
- **Two-call pattern (mandatory):** Step A does the discovery as text output (no `output_config.format`). Step B is a separate, dirt-cheap parse call that converts the text into `DiscoveryResult` JSON via `output_config.format`. Reason: combining `tools: [web_search]` with `output_config.format` in one call is not documented as compatible — keeping them separate is guaranteed to work.

#### Pre-flight (build FIRST, before any other work in this amendment)

The Anthropic org admin must enable web_search in Claude Console → settings → privacy. If not enabled, the API returns errors and the entire feature fails. Test with a tiny health endpoint before building anything else.

`app/api/health/web-search/route.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/auth/api-key';

export async function GET() {
  const client = new Anthropic({ apiKey: getAnthropicKey() });
  try {
    const r = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 256,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 1 }],
      messages: [{ role: 'user', content: 'Search the web for "anthropic claude" and return one result.' }]
    });
    return Response.json({
      enabled: true,
      response_id: r.id,
      stop_reason: r.stop_reason,
      web_search_requests: r.usage.server_tool_use?.web_search_requests ?? 0
    });
  } catch (e: any) {
    return Response.json({
      enabled: false,
      error_message: e?.message ?? String(e),
      hint: 'If error mentions permission/tool not enabled, enable web_search in Claude Console → settings → privacy.'
    }, { status: 503 });
  }
}
```

Hit `/api/health/web-search` once. If `enabled: false`, STOP and tell John before building anything else.

#### Install

```bash
pnpm add zod-to-json-schema
```

#### Zod schemas — `lib/schemas/discovery.ts`

```ts
import { z } from 'zod';

export const AutoDiscoverInput = z.object({
  name: z.string().min(1),
  medium: z.string().min(1),
  location: z.string().min(1),       // city/state, e.g. "Las Vegas, NV"
  affiliations: z.array(z.string()).default([])
});
export type AutoDiscoverInput = z.infer<typeof AutoDiscoverInput>;

export const DiscoveredEntry = z.object({
  url: z.string().url(),
  page_type: z.enum([
    'personal_site', 'gallery_bio', 'press_feature', 'interview',
    'museum_collection', 'exhibition_listing', 'publication',
    'award_announcement', 'social_profile', 'other'
  ]),
  confidence_0_1: z.number().min(0).max(1),
  title: z.string(),
  why_relevant: z.string()
});

export const DiscoveryResult = z.object({
  queries_executed: z.array(z.string()),
  discovered: z.array(DiscoveredEntry),
  disambiguation_notes: z.string().nullable().default(null)
});
export type DiscoveryResult = z.infer<typeof DiscoveryResult>;
```

#### Step A — Discovery call (returns text findings)

`lib/extractor/auto-discover.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/auth/api-key';
import type { AutoDiscoverInput, DiscoveryResult } from '@/lib/schemas/discovery';

export type DiscoveryEvent =
  | { type: 'started' }
  | { type: 'query_running'; query: string }
  | { type: 'results_received'; query: string; count: number }
  | { type: 'continuing_after_pause'; attempt: number }
  | { type: 'parsing' }
  | { type: 'complete'; result: DiscoveryResult; usage: DiscoveryUsage }
  | { type: 'error'; message: string };

export type DiscoveryUsage = {
  input_tokens: number;
  output_tokens: number;
  web_search_requests: number;
};

const SYSTEM_PROMPT = `You are a research agent gathering public web evidence about a working artist for the purpose of building their Artist Knowledge Base.

You will be given the artist's name, primary medium, location, and notable affiliations.

Your job:
1. Generate 6-10 targeted web searches. Vary across: name + "artist", name + medium, name + each affiliation, name + "interview" / "feature" / "profile" / "exhibition", name + location.
2. Execute searches via the web_search tool.
3. From the results, identify URLs of pages CLEARLY about THIS artist (not someone with the same name). Use medium, location, and affiliations to disambiguate.
4. Skip: social-media listicles, paywalled previews, generic agency thumbnail pages, and pages where the artist is only briefly mentioned.
5. If you find evidence of multiple same-name people, note this explicitly at the end.

When done, return ONLY a final text response in this exact format (one entry per discovered URL):

URL: https://example.com/page
PAGE_TYPE: gallery_bio
TITLE: Page title here
CONFIDENCE: 0.95
WHY: One-sentence justification.

(blank line between entries)

Valid PAGE_TYPE values: personal_site, gallery_bio, press_feature, interview, museum_collection, exhibition_listing, publication, award_announcement, social_profile, other.

If you found multiple same-name people, end with:
DISAMBIGUATION_NOTES: text describing what you found.`;

export function buildAutoDiscoverPrompt(input: AutoDiscoverInput): string {
  const affs = input.affiliations.length
    ? input.affiliations.join(', ')
    : 'none provided';
  return `Find public web evidence about this artist:
- Name: ${input.name}
- Medium: ${input.medium}
- Location: ${input.location}
- Notable affiliations: ${affs}

Run searches and return the discovery list per the format in your instructions.`;
}

const MAX_PAUSE_RETRIES = 3;

const BLOCKED_DOMAINS = [
  'pinterest.com', 'instagram.com', 'facebook.com', 'tiktok.com',
  'twitter.com', 'x.com', 'reddit.com', 'gettyimages.com',
  'shutterstock.com', 'alamy.com', 'youtube.com', 'linkedin.com'
];

export async function discoverArtist(
  input: AutoDiscoverInput,
  onEvent: (e: DiscoveryEvent) => void
): Promise<{ rawText: string; queries: string[]; usage: DiscoveryUsage }> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });
  let messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildAutoDiscoverPrompt(input) }
  ];

  const queries: string[] = [];
  const usage: DiscoveryUsage = { input_tokens: 0, output_tokens: 0, web_search_requests: 0 };
  let pauseCount = 0;

  while (true) {
    const stream = client.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      tools: [
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: 10,
          blocked_domains: BLOCKED_DOMAINS,
          user_location: { type: 'approximate', country: 'US' }
        },
        // REQUIRED for dynamic filtering on web_search_20260209
        { type: 'code_execution_20260120', name: 'code_execution' }
      ],
      system: SYSTEM_PROMPT,
      messages
    });

    // Track partial input_json for server_tool_use blocks so we can emit the query when it completes.
    const partialInputs = new Map<number, string>();

    for await (const ev of stream) {
      if (ev.type === 'content_block_start') {
        const block = ev.content_block as any;
        if (block.type === 'server_tool_use' && block.name === 'web_search') {
          partialInputs.set(ev.index, '');
        } else if (block.type === 'web_search_tool_result') {
          const content = (block as any).content;
          const count = Array.isArray(content) ? content.length : 0;
          // We may not have the matching query string here; the prior server_tool_use already emitted query_running.
          onEvent({ type: 'results_received', query: '', count });
        }
      } else if (ev.type === 'content_block_delta') {
        if ((ev.delta as any).type === 'input_json_delta') {
          const prev = partialInputs.get(ev.index) ?? '';
          partialInputs.set(ev.index, prev + (ev.delta as any).partial_json);
        }
      } else if (ev.type === 'content_block_stop') {
        const partial = partialInputs.get(ev.index);
        if (partial !== undefined) {
          try {
            const parsed = JSON.parse(partial);
            if (parsed.query) {
              queries.push(parsed.query);
              onEvent({ type: 'query_running', query: parsed.query });
            }
          } catch { /* incomplete JSON, skip */ }
          partialInputs.delete(ev.index);
        }
      }
    }

    const final = await stream.finalMessage();
    usage.input_tokens += final.usage.input_tokens;
    usage.output_tokens += final.usage.output_tokens;
    usage.web_search_requests += final.usage.server_tool_use?.web_search_requests ?? 0;

    if (final.stop_reason === 'pause_turn') {
      if (++pauseCount > MAX_PAUSE_RETRIES) {
        throw new Error(`Hit pause_turn ${MAX_PAUSE_RETRIES} times — search loop not terminating.`);
      }
      // Echo assistant content back, continue the server-side loop
      messages = [...messages, { role: 'assistant', content: final.content }];
      onEvent({ type: 'continuing_after_pause', attempt: pauseCount });
      continue;
    }

    // Done — extract final text
    const textBlock = final.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    return {
      rawText: textBlock?.text ?? '',
      queries,
      usage
    };
  }
}
```

#### Step B — Parse text findings into DiscoveryResult JSON

Same file (`lib/extractor/auto-discover.ts`), continuation:

```ts
import { zodToJsonSchema } from 'zod-to-json-schema';
import { DiscoveryResult } from '@/lib/schemas/discovery';

export async function parseDiscovery(rawText: string, queries: string[]): Promise<DiscoveryResult> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });

  const r = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 4000,
    system: 'Parse the input text into the DiscoveryResult schema. Preserve every URL, page_type, confidence, title, and rationale exactly. Dedupe URLs (if the same URL appears twice, keep the higher-confidence entry). Set queries_executed from the provided list. If the input contains "DISAMBIGUATION_NOTES:", populate disambiguation_notes; otherwise set to null.',
    output_config: {
      format: {
        type: 'json_schema',
        schema: zodToJsonSchema(DiscoveryResult, { target: 'openApi3' })
      }
    },
    messages: [{
      role: 'user',
      content: `QUERIES_EXECUTED:\n${queries.join('\n')}\n\n---\n\nDISCOVERY_TEXT:\n\n${rawText}`
    }]
  });

  const text = r.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '';
  const parsed = JSON.parse(text);
  return DiscoveryResult.parse(parsed);  // zod validates; throws if shape wrong
}
```

#### Step C — Route handler with SSE streaming

`app/api/extractor/auto-discover/route.ts`:

```ts
import { AutoDiscoverInput } from '@/lib/schemas/discovery';
import { discoverArtist, parseDiscovery, type DiscoveryEvent } from '@/lib/extractor/auto-discover';
import { getDb } from '@/lib/db/client';
import { getCurrentUserId } from '@/lib/auth/user';

export const runtime = 'nodejs';
export const maxDuration = 90;  // discovery can take 30-60s

export async function POST(req: Request) {
  const input = AutoDiscoverInput.parse(await req.json());
  const userId = getCurrentUserId();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: DiscoveryEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };

      try {
        send({ type: 'started' });

        const { rawText, queries, usage } = await discoverArtist(input, send);

        send({ type: 'parsing' });
        const result = await parseDiscovery(rawText, queries);

        // Cost tracking — log to run_events with run_id=NULL (not tied to a Run yet)
        const db = getDb();
        await db.execute({
          sql: `INSERT INTO run_events (run_id, agent, kind, payload_json) VALUES (NULL, ?, ?, ?)`,
          args: ['auto-discover', 'output', JSON.stringify({
            user_id: userId, input, queries, usage, result_count: result.discovered.length
          })]
        });

        send({ type: 'complete', result, usage });
      } catch (e: any) {
        send({ type: 'error', message: e?.message ?? String(e) });
      } finally {
        controller.close();
      }
    },
    cancel() {
      // Browser navigated away. The Anthropic call continues server-side and incurs
      // its committed cost; we can't actually cancel the API call mid-flight. Acceptable.
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'  // disables proxy buffering
    }
  });
}
```

#### Step D — Browser-side streaming consumer (in the React component)

```ts
async function startDiscovery(
  input: AutoDiscoverInput,
  signal: AbortSignal,
  onEvent: (e: DiscoveryEvent) => void
) {
  const res = await fetch('/api/extractor/auto-discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal
  });

  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6)) as DiscoveryEvent;
          onEvent(event);
        } catch { /* malformed line, skip */ }
      }
    }
  }
}
```

Component side: AbortController on unmount, status state machine (idle → searching → parsing → reviewing → complete | error), per-event UI updates.

#### Step E — Refactor existing AKB ingestion into shared helper

`lib/extractor/ingest-urls.ts`:

```ts
export type IngestSource = 'auto-discover' | 'paste' | 'manual';

export interface IngestUrlsOptions {
  source: IngestSource;
  baseAkbVersionId?: number | null;  // null/undefined = build from latest existing version (or empty)
  onProgress?: (e: IngestProgressEvent) => void;
}

export type IngestProgressEvent =
  | { type: 'fetching'; url: string }
  | { type: 'extracted'; url: string; fields_added: string[] }
  | { type: 'failed'; url: string; reason: string };

export interface IngestResult {
  akb_version_id: number;
  ingested_count: number;
  failed: { url: string; reason: string }[];
  fields_touched: string[];
}

export async function ingestUrls(
  urls: string[],
  userId: number,
  opts: IngestUrlsOptions
): Promise<IngestResult>;
```

Behavior:
- If `baseAkbVersionId` is given, load that AKB row; else load latest for `userId`; else start with empty AKB.
- For each URL: fetch HTML, extract text, send to Claude with extraction prompt, get partial AKB JSON, merge per the §2.5 merge policy.
- Provenance for each field set/updated this run = `'ingested:' + url` (preserves existing `'manual'` or `'interview'` provenance — never overwrite).
- Errors per URL collected and returned (not thrown — partial success is fine).
- Calls `onProgress` for each URL transition.
- Writes a single new `akb_versions` row at the end with `source='ingest'`, returns its id.

The existing manual-paste route (built in §2.5) refactors to call this helper with `{source: 'paste'}`. The auto-discover route's "Confirm" handler calls it with `{source: 'auto-discover'}` after the user's selection.

#### UI — `/interview` page changes

Two ingestion modes as a toggled choice at the top:
- Tab A: "Auto-discover" — fields below
  - Name (text input, required)
  - Medium (text input, required, placeholder: "fine art photography", "oil painting", etc.)
  - City/State (text input, required, placeholder: "Las Vegas, NV")
  - Notable affiliations (textarea, comma- or newline-separated, optional, placeholder: "Emmy-nominated, National Geographic, TIME")
  - Submit button: "Discover my web presence" → triggers SSE stream
- Tab B: "Paste URLs" — current behavior

Discovery in progress (after submit, while streaming):
- Loading state with running queries shown as they arrive: "Searching: <query>" (one line per active/completed query)
- "Found N results" subtitle as result blocks come in
- Cancel button (calls abort on AbortController)

Discovery complete (when `complete` event arrives):
- If `disambiguation_notes` is non-null: show as yellow callout above the list ("⚠ Multiple people named X found: <notes>")
- Discovered URLs render as a checkbox list, grouped by `page_type` with collapsible sections per group
- Each row: checkbox + page_type pill + title + URL (truncated, opens in new tab) + why_relevant text + confidence badge (red <0.5, yellow 0.5–0.7, green >0.7)
- Default check state: all entries with `confidence_0_1 >= 0.7` checked
- Empty state: "No matches found. Try adding more affiliations or refining your medium."
- "Confirm and ingest" button → POSTs the checked URLs to `app/api/extractor/ingest/route.ts` (which calls `ingestUrls(checked, userId, {source: 'auto-discover'})`)
- After ingestion completes, transition into the existing interview turn-by-turn UI

Error states:
- Pre-flight failure: "Web search not enabled — admin must enable in Claude Console settings."
- Mid-stream error event: render error message, "Retry" button.
- Network drop / abort: "Discovery interrupted. Retry?"

#### Acceptance

1. `/api/health/web-search` returns `{ enabled: true, ... }`.
2. Submitting `{ name: "John Knopf", medium: "fine art photography", location: "Las Vegas, NV", affiliations: ["Emmy-nominated", "National Geographic", "TIME"] }`:
   - Streams "query_running" events for each search Claude runs (visible in UI as queries-in-flight)
   - Returns 8+ discovered URLs deduped, with jknopf.com confidence ≥0.9
   - If Claude finds another person named "John Knopf" (any other-domain John Knopf), `disambiguation_notes` is populated and the unrelated URLs have `confidence_0_1 ≤ 0.3`
3. Confirming the checked subset writes a new `akb_versions` row with `source='ingest'`, populated fields have provenance `'ingested:<url>'`, no existing `'manual'` or `'interview'` provenance is overwritten.
4. The streaming UI shows queries running in real time (no single multi-second freeze with no feedback).
5. The discovery + parse cost (per `run_events` payload) is < $0.20.
6. On admin-not-enabled: pre-flight returns `enabled: false` with a clear hint pointing to Claude Console settings.

#### Sequencing

Build AFTER §2.10 (URL scraper) and current Knowledge Extractor work. Build BEFORE Phase 2 acceptance gate. Order within this amendment:
1. Pre-flight health endpoint + verify enabled (block on this)
2. Schemas (`lib/schemas/discovery.ts`)
3. `discoverArtist` + `parseDiscovery` in `lib/extractor/auto-discover.ts`
4. `ingestUrls` shared helper in `lib/extractor/ingest-urls.ts` (refactor §2.5 inline logic into this; update existing paste route to call it)
5. SSE route handler `app/api/extractor/auto-discover/route.ts`
6. UI changes on `/interview`
7. Run acceptance tests in order.

#### Cost note

~$0.10–0.20 per discovery run. Logged to `run_events` per the schema. For demo prep, expect ~10–20 runs total = under $5.

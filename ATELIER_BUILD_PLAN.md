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
│   │   ├── opportunity.ts
│   │   ├── dossier.ts
│   │   ├── match.ts                         (RubricMatchResult)
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
- [ ] Install (production): `pnpm add @anthropic-ai/sdk @libsql/client @vercel/blob zod sharp exifr @react-pdf/renderer docx cheerio json-merge-patch p-limit react-dropzone @dnd-kit/core @dnd-kit/sortable`
- [ ] Install (dev): `pnpm add -D @types/node`
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
- [ ] `lib/db/migrations.ts` — idempotent runner. Splits `schema.sql` on `;`, executes each statement via `db.execute(sql)`. Called once on boot from a top-level `instrumentation.ts`
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

-- Knowledge Extractor interview transcript
CREATE TABLE IF NOT EXISTS extractor_turns (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL,                 -- 'agent' | 'user'
  content TEXT NOT NULL,
  akb_field_targeted TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

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

-- Past recipients (for Rubric Matcher)
CREATE TABLE IF NOT EXISTS past_recipients (
  id INTEGER PRIMARY KEY,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
  year INTEGER,
  name TEXT NOT NULL,
  bio_url TEXT,
  portfolio_urls TEXT,                -- JSON array
  notes TEXT,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Runs
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  akb_version_id INTEGER NOT NULL REFERENCES akb_versions(id),
  style_fingerprint_id INTEGER NOT NULL REFERENCES style_fingerprints(id),
  status TEXT NOT NULL,               -- 'queued' | 'running' | 'complete' | 'error'
  config_json TEXT NOT NULL,          -- window, budget, constraints
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER,
  error TEXT
);

-- Per-run agent events (for stream UI + debugging)
CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  agent TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- 'start' | 'progress' | 'output' | 'error'
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Per-run match results
CREATE TABLE IF NOT EXISTS run_matches (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id),
  fit_score REAL NOT NULL,
  reasoning TEXT NOT NULL,
  supporting_image_ids TEXT,          -- JSON array of portfolio_images.id
  hurting_image_ids TEXT,
  included INTEGER NOT NULL,          -- 0 = filtered out (kept with reasoning), 1 = included
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Per-run cursor for Anthropic event polling (one row per run)
CREATE TABLE IF NOT EXISTS run_event_cursors (
  run_id INTEGER PRIMARY KEY REFERENCES runs(id),
  managed_session_id TEXT NOT NULL,   -- the Anthropic sesn_... ID
  last_event_id TEXT,                 -- latest sevt_... we've ingested; NULL on first poll
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
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

```ts
const cursor = await db.execute({
  sql: 'SELECT managed_session_id, last_event_id FROM run_event_cursors WHERE run_id = ?',
  args: [runId],
});
const { managed_session_id, last_event_id } = cursor.rows[0];

const events = await client.beta.sessions.events.list(managed_session_id, {
  // pagination cursor; first call has none
  ...(last_event_id ? { after: last_event_id } : {}),
  limit: 1000,
});

// Persist each event into run_events (filter to types we care about), update cursor to last event.id
for (const ev of events.data) { /* ... */ }

// Check for terminal state
const sess = await client.beta.sessions.retrieve(managed_session_id);
const done = sess.status === 'terminated' ||
             (sess.status === 'idle' && /* idle with end_turn or retries_exhausted, not requires_action */);

return Response.json({ events: newEvents, done });
```

### Custom tool result round-trip

Used when our agent needs the orchestrator to do something host-side (e.g., write to our DB):

```ts
// On poll: detect agent.custom_tool_use event
if (ev.type === 'agent.custom_tool_use' && ev.tool_name === 'persist_opportunity') {
  await persistOpportunityToDb(ev.input);
  await client.beta.sessions.events.send(managed_session_id, {
    events: [{
      type: 'user.custom_tool_result',
      custom_tool_use_id: ev.id,
      content: [{ type: 'text', text: 'persisted' }],
    }],
  });
}
```

### Tool name reference (correct as of `managed-agents-2026-04-01`)

- Built-in toolset: `agent_toolset_20260401` — bundles `bash`, `read`, `write`, `edit`, `glob`, `grep`, `web_fetch`, `web_search`. No need to declare individual tools.
- Beta header `managed-agents-2026-04-01` is set automatically by the SDK on `client.beta.{agents,environments,sessions,...}.*` — do not pass it manually.
- For `client.beta.files.list({ scope_id, betas: ['managed-agents-2026-04-01'] })` — this single Files endpoint requires the header explicitly because it's cross-API.

---

## Reference — Long-running run orchestration on Vercel

The agent loop runs at Anthropic, so Vercel's 60s function timeout doesn't constrain run length. Our server only does short-lived work: kickoff (one Anthropic API call) and event polling (one Anthropic API call per browser poll).

**Pattern: poll-pull-on-read.**

1. **Browser:** `POST /api/runs/start` with config (window, budget, constraints)
2. **Server:** Creates DB row in `runs`, creates Managed Agents session, sends kickoff message, persists `managed_session_id` to `run_event_cursors`, returns `{run_id, session_id}` immediately. Total time: ~1-2s.
3. **Browser:** Renders run-in-progress page. Polls `GET /api/runs/[id]/events?since=<cursor>` every 2-3s.
4. **Server (each poll):**
   - Read cursor from DB
   - Call `client.beta.sessions.events.list(managed_session_id, { after: last_event_id, limit: 1000 })`
   - Insert new events into `run_events`, update cursor
   - Check session status; if terminal, mark `runs.status = 'complete'` and trigger Phase 4 (Package Drafter + Orchestrator) as a follow-up call
   - Return `{events: newEvents, done: bool}` to browser
5. **Browser:** Streams new events into the UI. When `done`, navigates to `/dossier/[runId]`.

**Why not SSE?** Vercel Hobby has a 60s streaming limit; even Pro caps at ~5min. Our runs go 10-30 min. Polling is simpler and survives any tier.

**Polling frequency tradeoff:** every 2s gives a snappy UI; every 5s halves Anthropic API calls (`events.list` is cheap but not free). Default to 3s.

**Trigger for Phase 4 synthesis** (Package Drafter + Orchestrator + Dossier render): when the polling handler observes terminal session status, it `fetch`-es `POST /api/runs/[id]/finalize` (in the same request lifecycle, fire-and-forget) which runs the synthesis inline. That handler has 60s — Package Drafter is parallel `messages.create()` calls (Phase 4.1), each ~10-30s; for 10-15 packages we may need to chunk or use Vercel's `maxDuration: 300` (Pro tier) — see Phase 4.1 for the concurrency plan.

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
- [ ] Cap at 100 images. **Minimum: 20 images required to enable the "Run Style Analyst" button** (spec target). If user has <20, show "Upload at least 20 images to continue" disabled state
- [ ] `app/api/portfolio/[id]/route.ts` (DELETE): row delete + `del(blob_pathname)` + `del(thumb_pathname)`
- [ ] `app/api/portfolio/reorder/route.ts` (POST `{order: number[]}`): batch update `ordinal` values via `db.batch([...])` in one transaction
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
- [ ] `analyzePortfolio(images: PortfolioImage[]): Promise<StyleFingerprint>`:
  ```ts
  const chunks = chunk(images, 20);
  const partials = await Promise.all(chunks.map(c => analyzeChunk(c)));
  return await synthesizePartials(partials);
  ```
- [ ] `analyzeChunk(images)`: single `client.messages.create()` with `model: 'claude-opus-4-7'`, `max_tokens: 8000`, `thinking: { type: 'adaptive' }`, system prompt = `skills/aesthetic-vocabulary.md` + role/task instructions, user message = N image blocks + "produce a partial StyleFingerprint for these images"
- [ ] `synthesizePartials(partials)`: text-only `messages.create()`, system prompt = "merge these N partial fingerprints into one canonical fingerprint, resolving disagreement by frequency", user message = JSON of partials, output = StyleFingerprint
- [ ] Validate with zod, retry once on parse fail with `"your previous output failed schema validation: <error>"` prepended
- [ ] Persist to `style_fingerprints` table (increment version)
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
    home_base: z.object({ city: z.string(), state: z.string(), country: z.string() }),
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
  source_provenance: z.record(z.string(), z.string())  // field-name -> 'ingested:url' | 'interview' | 'manual'
});
```

### 2.5 Knowledge Extractor — Ingestion (`lib/agents/knowledge-extractor.ts`)
- [ ] `ingest(urls: string[])` — for each URL:
  - `fetch(url)` → HTML. Parse with `cheerio` to text (strip scripts/styles, preserve headings + paragraphs)
  - `client.messages.create()` with system prompt = "extract fields of the ArtistKnowledgeBase schema that are evidenced in this page; do not invent; return partial JSON", user message = cleaned HTML text + AKB schema description
  - Validate output against `ArtistKnowledgeBase.partial()` (zod). Retry once on fail
- [ ] **Merge policy for combining partials + existing AKB:**
  - **Scalar fields** (strings, numbers, enums): last-write-wins, **but** record provenance of whoever wrote the current value
  - **Array fields** (exhibitions, publications, awards, bodies_of_work): concat + de-dupe by composite key (e.g. exhibitions dedupe on `{venue, year, title}` normalized lowercase)
  - **Nested objects** (identity, practice, intent): merge field-by-field with same scalar/array rules
  - Record provenance per field in `source_provenance`: `"ingested:<url>"` overwrites only if same URL; never overwrites `"interview"` or `"manual"` provenance (user-supplied truth wins)
- [ ] Persist merged result as `akb_versions` row with `source='ingest'`

**Default seed URLs for John's own ingestion run (Phase 2.8):** his personal photography site, both gallery bio pages (Las Vegas Stratosphere + Minneapolis Wayzata), TIMEPieces collection page, any National Geographic / Red Bull / Billboard feature URLs he can produce. Surface a "seed URLs" textarea on the upload page so any future user does the same.

### 2.6 Knowledge Extractor — Gap detection
- [ ] Compute "missing" fields: empty strings, empty arrays, optional gaps
- [ ] Rank gaps by importance (identity > practice > intent > exhibitions > rest)
- [ ] Output ordered list of question-targets

### 2.7 Knowledge Extractor — Interview UI
- [ ] `app/(onboarding)/interview/page.tsx` — chat-style turn-by-turn
- [ ] `app/api/extractor/turn/route.ts`:
  - POST `{ user_message: string, current_akb: AKB, gap_targets: string[] }`
  - Claude is given: system prompt = "you are an art-career interviewer building an AKB; ask one targeted question at a time aimed at the top gap; when the user answers, extract the answer into AKB fields", user history = prior turns + current user message
  - Output JSON: `{ agent_message: string, next_field_target: string, akb_patch: object }`
  - **`akb_patch` shape: JSON Merge Patch (RFC 7396)** — a partial AKB object. Apply via `mergePatch(currentAkb, patch)`: for each key in patch, if value is `null` → delete that field; if value is object → recurse; otherwise replace. Use `json-merge-patch` npm package or hand-roll (tiny)
  - For arrays in patches (e.g. adding an exhibition), the patch supplies the **complete new array** for that field — extractor decides whether to append-and-dedupe or replace based on context. (RFC 7396 doesn't deep-merge arrays; that's the standard limitation.)
- [ ] After each turn, apply `akb_patch` to draft AKB held in component state; persist turn (user msg + agent msg + akb_patch JSON) to `extractor_turns`
- [ ] Side panel shows AKB filling in live (re-renders on each turn)
- [ ] "Done" button finalizes — POST current AKB to `/api/akb/finalize`, which writes a new `akb_versions` row with `source='merge'`

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

### 3.2 Opportunity Scout (Managed Agent)

Agent is created in the one-time setup script (Reference §Managed Agents API shape). Per-run code lives in `lib/agents/opportunity-scout.ts`:

```ts
export async function startScoutSession(runId: number, akb: AKB, config: RunConfig) {
  const session = await client.beta.sessions.create({
    agent: process.env.SCOUT_AGENT_ID!,
    environment_id: process.env.ATELIER_ENV_ID!,
    title: `Scout run ${runId}`,
  });
  await db.execute({
    sql: 'INSERT INTO run_event_cursors (run_id, managed_session_id) VALUES (?, ?)',
    args: [runId, session.id],
  });
  await client.beta.sessions.events.send(session.id, {
    events: [{
      type: 'user.message',
      content: [{ type: 'text', text: buildScoutPrompt(akb, config) }],
    }],
  });
  return session.id;
}
```

**Kickoff prompt structure** (`buildScoutPrompt`):
1. Here is the artist's AKB (full JSON)
2. Here is the window: opportunities with deadlines between `<start>` and `<end>`
3. Here are constraints: budget cap `$<X>`, max travel `<Y>` miles for residencies, eligibility filters from AKB
4. Your job: traverse every source listed in the system prompt's `opportunity-sources.md`. For each: web_fetch the source's listings page, identify active calls in the window, fetch each call's detail page, extract structured Opportunity data. **Filter out anything failing hard eligibility** (citizenship mismatch, wrong medium, age outside range)
5. For each opportunity that passes, also fetch its past-recipients page (use `past_recipients_url` from the source skill) and download up to 5 representative recipient images per recipient (max 3 recipients per opportunity for v1) — **save each image to `/mnt/session/outputs/recipients/<opportunity_id>/<recipient_name>/<n>.jpg`** using the `write` tool
6. Emit each opportunity via the `persist_opportunity` custom tool (defined on the agent), passing the structured Opportunity JSON. The orchestrator will write it to our DB
7. When all 40 sources are processed, emit `<DONE>` and stop

**Custom tool declared on the Scout agent** (`persist_opportunity`):
```ts
tools: [
  { type: 'agent_toolset_20260401' },
  {
    type: 'custom',
    name: 'persist_opportunity',
    description: 'Persist a single Opportunity object to the orchestrator database. Returns confirmation.',
    input_schema: zodToJsonSchema(Opportunity),
  },
]
```
- [ ] When the polling handler sees `agent.custom_tool_use` with `tool_name === 'persist_opportunity'`: validate input via zod, upsert into `opportunities`, send `user.custom_tool_result` confirming
- [ ] Recipient images stay in `/mnt/session/outputs/` for the Rubric Matcher's session to read; the Rubric Matcher's session attaches the same files via the Files API or via a memory store (see §3.3 below)

### 3.3 Past-recipient fetcher (handled within Scout)

Folded into the Scout agent's task list (§3.2 step 5). Each opportunity's recipient images are written to the Scout session's `/mnt/session/outputs/recipients/<opportunity_id>/...`.

After Scout finishes, our orchestrator (in `app/api/runs/[id]/finalize-scout/route.ts`):
- [ ] List the Scout session's output files: `client.beta.files.list({ scope_id: scoutSessionId, betas: ['managed-agents-2026-04-01'] })`
- [ ] Download each: `client.beta.files.download(fileId)` → write to a fresh Vercel Blob path: `recipients/<opportunity_id>/<recipient_name>/<n>.jpg`
- [ ] Insert `past_recipients` rows pointing at the new blob URLs
- [ ] Cache: a `past_recipients` row keyed by `(opportunity_id, year, name)` is unique. Skip re-fetching if already cached within last 90 days

**Why blobs not memory stores:** memory stores attach at session-create time only and have a 100KB-per-memory cap (text only, not binary). Image data goes through the Files API or our own blob store.

### 3.4 Rubric Matcher (Managed Agent)

Agent created in setup script. Per-run code in `lib/agents/rubric-matcher.ts`:

```ts
export async function startRubricSession(runId: number, akb: AKB, opportunities: Opportunity[], styleFingerprint: StyleFingerprint, portfolioImages: PortfolioImage[]) {
  const session = await client.beta.sessions.create({
    agent: process.env.RUBRIC_AGENT_ID!,
    environment_id: process.env.ATELIER_ENV_ID!,
    title: `Rubric run ${runId}`,
  });
  // ... persist managed_session_id
  await client.beta.sessions.events.send(session.id, {
    events: [{
      type: 'user.message',
      content: [{ type: 'text', text: buildRubricPrompt(akb, opportunities, styleFingerprint, portfolioImages) }],
    }],
  });
  return session.id;
}
```

**Kickoff prompt structure:**
1. Here is the artist's `StyleFingerprint` (full JSON)
2. Here are the top 12 representative portfolio images by `id` and `thumb_url` (the agent can `web_fetch` the URLs)
3. Here are N opportunities to score (full JSON list, including their `past_recipients` array with image URLs to vision-over)
4. For each opportunity, in order:
   1. `web_fetch` 3-5 past-recipient images (the URLs are provided in the opportunity JSON)
   2. Synthesize the institution's aesthetic signature
   3. Score the artist's StyleFingerprint vs that signature: 0-1, calibrated per the system prompt's anchors
   4. Identify supporting + hurting portfolio image IDs
   5. Write 2-4 sentence reasoning citing at least one specific past recipient by name
   6. Emit via `persist_match` custom tool
5. When all opportunities scored, emit `<DONE>` and stop

**Concurrency within the agent:** the agent processes opportunities sequentially within its session (Managed Agent loop is single-threaded per session). For 30 opportunities × ~30s each = ~15min run time. Acceptable for the 10-30min window per spec.

**Custom tool:** `persist_match` — same pattern as Scout. Input schema = `RubricMatchResult` zod-derived JSON Schema.

- [ ] Threshold: scores < 0.45 still get persisted but with `included = 0` (kept with reasoning for the "filtered out" section)
- [ ] All matches persisted to `run_matches`

**System prompt outline:** (unchanged from previous version — see existing 9 bullets)

**Output schema** (`RubricMatchResult` — also lives in `lib/schemas/match.ts`):
```ts
export const RubricMatchResult = z.object({
  opportunity_id: z.number(),
  fit_score: z.number().min(0).max(1),
  reasoning: z.string(),
  supporting_image_ids: z.array(z.number()),
  hurting_image_ids: z.array(z.number()),
  cited_recipients: z.array(z.string()).min(1),  // enforce the "cite at least one recipient" rule
});
```

**System prompt outline:**
1. Role: jury-side reader — you are reading like the panel that selected past recipients, not like a fan of the artist
2. Inputs provided per opportunity: opportunity metadata, past recipients (3 yrs) with bios + portfolio image samples, applicant's `StyleFingerprint`, applicant's top-N portfolio images
3. Step 1 — synthesize the institution's aesthetic signature from the recipient set. Be specific: composition tendencies, subject categories, formal lineage. Use vocabulary from the loaded skill files
4. Step 2 — compare applicant fingerprint to that signature. Distinguish *aesthetic fit* from *career-stage fit* — both feed the score
5. Step 3 — score 0-1, calibrated. Anchor: 0.8+ = a recipient from this artist would be unsurprising; 0.5 = plausible outlier; 0.2 = wrong room
6. Step 4 — name supporting and hurting portfolio image IDs explicitly. Forbid vague references
7. Reasoning: 2-4 sentences, must cite at least one specific past recipient by name to ground the comparison
8. NEVER inflate scores out of politeness — a low score with sharp reasoning is the product's value
9. Output STRICTLY as `RubricMatchResult` JSON

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

### Acceptance gate — Phase 3
1. Opportunity Scout returns ≥30 candidate opportunities for John's profile
2. Rubric Matcher produces a fit score + 2-4 sentence reasoning for each, citing specific recipient aesthetic territory
3. The Magnum-vs-Critical-Mass demo moment works on real data
4. Both Scout + Matcher run as Managed Agents (side-prize requirement)

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

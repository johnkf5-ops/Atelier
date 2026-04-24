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
- [ ] `lib/db/migrations.ts` — idempotent runner. Concrete implementation:

  ```ts
  import { promises as fs } from 'fs';
  import { join, resolve } from 'path';
  import { getDb } from './client';

  const SWALLOWED_ERROR_FRAGMENTS = [
    'duplicate column name',
    'already exists'  // catches both "table X already exists" and "index X already exists"
  ];

  function shouldSwallow(err: unknown): boolean {
    const msg = String((err as any)?.message ?? err).toLowerCase();
    return SWALLOWED_ERROR_FRAGMENTS.some(f => msg.includes(f));
  }

  function splitStatements(sql: string): string[] {
    // Naive split on `;` — works for our schema (no string literals contain `;`).
    // If we ever add seeded data with `;` in strings, swap to a real SQL tokenizer.
    return sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
  }

  let _migrationsApplied = false;

  export async function runMigrations(): Promise<void> {
    if (_migrationsApplied) return;
    const db = getDb();

    // Step 1 — base schema (always idempotent: all CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS)
    const schemaPath = resolve(process.cwd(), 'lib/db/schema.sql');
    const schemaSql = await fs.readFile(schemaPath, 'utf-8');
    for (const stmt of splitStatements(schemaSql)) {
      await db.execute(stmt);
    }

    // Step 2 — migrations (numbered files in lib/db/migrations/)
    const migrationsDir = resolve(process.cwd(), 'lib/db/migrations');
    let files: string[] = [];
    try {
      files = (await fs.readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
    } catch (e: any) {
      if (e?.code === 'ENOENT') return;  // no migrations yet — fine
      throw e;
    }

    const applied = new Set<string>(
      (await db.execute(`SELECT name FROM _migrations`)).rows.map((r: any) => r.name)
    );

    for (const name of files) {
      if (applied.has(name)) continue;
      const sql = await fs.readFile(join(migrationsDir, name), 'utf-8');
      for (const stmt of splitStatements(sql)) {
        try {
          await db.execute(stmt);
        } catch (e) {
          if (shouldSwallow(e)) continue;
          throw new Error(`Migration ${name} failed on statement:\n${stmt}\n\n${(e as any)?.message ?? e}`);
        }
      }
      await db.execute({ sql: `INSERT INTO _migrations (name) VALUES (?)`, args: [name] });
    }

    _migrationsApplied = true;
  }
  ```

- [ ] `instrumentation.ts` at repo root (Next.js auto-loads this once per server boot):
  ```ts
  export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
      const { runMigrations } = await import('./lib/db/migrations');
      await runMigrations();
    }
  }
  ```
  Note: Next.js calls `register()` at runtime startup. Migration errors propagate and crash the server (visible in Vercel logs) rather than running with a stale schema.
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
  portfolio_urls TEXT,                -- JSON array (raw URLs initially; rewritten to Vercel Blob URLs by finalize-scout)
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
  composite_score REAL,               -- set by Orchestrator in Phase 4 (fit × prestige × urgency × affordability); NULL until finalize
  filtered_out_blurb TEXT,            -- one-sentence "why not" copy for the dossier; NULL for included matches
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(run_id, opportunity_id)
);

-- Cached per-opportunity logo URLs (scraped from opportunity.url once; reused across runs).
CREATE TABLE IF NOT EXISTS opportunity_logos (
  opportunity_id INTEGER PRIMARY KEY REFERENCES opportunities(id),
  logo_url TEXT,                       -- null if scrape found nothing; UI renders placeholder
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Per-run cursor for Anthropic event polling (one row per run; phase changes when Scout finishes and Rubric kicks off)
CREATE TABLE IF NOT EXISTS run_event_cursors (
  run_id INTEGER PRIMARY KEY REFERENCES runs(id),
  managed_session_id TEXT NOT NULL,         -- the Anthropic sesn_... ID for the CURRENT phase's session
  phase TEXT NOT NULL DEFAULT 'scout',      -- 'scout' | 'rubric' — tells the polling handler which terminal-idle hook to fire
  last_event_id TEXT,                       -- latest sevt_... we've ingested; NULL on first poll
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

**Pagination pattern (verified in SDK exercise 2026-04-24):** the TypeScript SDK's `events.list()` uses a `page:` cursor parameter for manual pagination. The async iterator (`for await (const ev of client.beta.sessions.events.list(sessionId))`) handles the cursor internally — do NOT hand-build `page:` params unless you have a specific reason (e.g., the `processed_at` optimization suggestion below). Stick with the iterator. We dedupe via UNIQUE constraint on `run_events.event_id` + `INSERT OR IGNORE` so concurrent polls are safe regardless of pagination mechanics.

**Streaming event-shape note (discovered during Phase 2.12 ship):** for `web_search` server tool, the `query` field arrives FULLY-FORMED in the `content_block_start` event's `content_block.input`, NOT via `input_json_delta` deltas. If you're streaming agent activity to a UI and want to display "Searching: <query>" the moment a search starts, prefer reading from `event.content_block.input.query` first; fall back to accumulating `input_json_delta` chunks across `content_block_delta` events for tools that DO stream input (custom tools and other server tools may differ). Both paths should be present.

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

// Check for terminal state.
// IMPORTANT (verified during §3.0.b smoke 2026-04-24): `sessions.retrieve()` returns the live
// session.status string ('idle', 'running', 'rescheduling', 'terminated') BUT does NOT include
// stop_reason. stop_reason lives ONLY on session.status_idle events in the event stream.
// Terminal detection must pair the live status with the most recent stop_reason from events
// — relying on sessions.retrieve() alone causes pre-run idle states to read as terminal and
// the polling handler returns done:true prematurely.
//
// Look at idle events from THIS poll first; if none, query the most recent idle event from
// run_events (handles cross-poll terminal idle).
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
if (sessionTerminal) {
  if (phase === 'scout') {
    await db.execute({ sql: `UPDATE runs SET status = 'scout_complete' WHERE id = ?`, args: [runId] });
    waitUntil(fetch(new URL(`/api/runs/${runId}/finalize-scout`, req.url), { method: 'POST' }));
    phaseDone = true;
  } else if (phase === 'rubric') {
    await db.execute({ sql: `UPDATE runs SET status = 'rubric_complete' WHERE id = ?`, args: [runId] });
    waitUntil(fetch(new URL(`/api/runs/${runId}/finalize`, req.url), { method: 'POST' }));
    phaseDone = true;
  }
}

// CRITICAL: `done: true` ONLY when the full run is complete (i.e., finalize has written
// the dossier). Between rubric_complete and complete, we're still drafting packages +
// synthesizing the dossier. If we return done:true early, the browser redirects to
// /dossier/[runId] which has no data yet.
// Read runs.status fresh (it's the source of truth for finalize completion).
const statusRow = await db.execute({
  sql: `SELECT status FROM runs WHERE id = ?`,
  args: [runId]
});
const runStatus: string = (statusRow.rows[0] as any)?.status ?? 'error';
const runDone = runStatus === 'complete';
const runErrored = runStatus === 'error';

return Response.json({
  events: newEvents,
  phase,
  phaseDone,           // informational — browser UI can show "Scout done, running Rubric..." etc.
  runStatus,           // full status string for UI messaging
  done: runDone,       // browser redirects to dossier only when true
  errored: runErrored
});
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
- **JSON Schema sanitization for `output_config.format.schema` and custom tool `input_schema` (discovered in Phase 2.12; extended after Phase 3 audit):** Anthropic's schema validator rejects several standard JSON Schema constraints. When passing zod-derived JSON Schemas via `zodToJsonSchema(...)`, run a stripper that recursively removes ALL of these keywords wherever they appear:

  | Keyword | Source zod method | Why we strip it |
  |---|---|---|
  | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` | `.min()`, `.max()`, `.gt()`, `.lt()`, etc. on numbers | Rejected on number types |
  | `minLength`, `maxLength` | `.min()`, `.max()` on strings | Rejected on strings |
  | **`minItems`, `maxItems`** | `.min(N)`, `.max(N)` on arrays | Rejected on arrays. Used by `RubricMatchResult.cited_recipients.min(1)`, `OpportunityWithRecipientUrls.past_recipient_image_urls.max(3)`, `RecipientWithUrls.image_urls.max(5)` |
  | **`format`** | `.url()`, `.email()`, `.datetime()`, `.uuid()`, etc. | Rejected (including `"uri"`). Used by every URL field in our schemas |
  | `pattern` | `.regex()` | Unverified behavior; strip to be safe |

  Zod still validates the parsed response post-hoc — correctness is preserved for all constraints at the app layer. Without sanitization, `messages.create()` returns 400 with a confusing schema-validation error.

  **Reference implementation:**
  ```ts
  const STRIP_KEYS = new Set([
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    'minLength', 'maxLength',
    'minItems', 'maxItems',
    'format',
    'pattern'
  ]);

  export function sanitizeJsonSchema(schema: any): any {
    if (Array.isArray(schema)) return schema.map(sanitizeJsonSchema);
    if (schema && typeof schema === 'object') {
      const out: any = {};
      for (const [k, v] of Object.entries(schema)) {
        if (STRIP_KEYS.has(k)) continue;
        out[k] = sanitizeJsonSchema(v);
      }
      return out;
    }
    return schema;
  }
  ```
  Apply via `sanitizeJsonSchema(zodToJsonSchema(MySchema, { target: 'openApi3' }))`. Used in `setup-managed-agents.ts` (for every `input_schema` passed to `agents.create`) and in any `output_config.format.schema` call site.

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
  - Insert `portfolio_images` row. **`ordinal` is NOT NULL with no DB default — compute inline:**
    ```ts
    const nextOrdinal = ((await db.execute({
      sql: `SELECT COALESCE(MAX(ordinal), -1) + 1 AS o FROM portfolio_images WHERE user_id = ?`,
      args: [userId]
    })).rows[0] as any).o;
    await db.execute({
      sql: `INSERT OR IGNORE INTO portfolio_images
            (user_id, filename, blob_pathname, thumb_pathname, blob_url, thumb_url, width, height, exif_json, ordinal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [userId, filename, pathname, pathname, blobUrl, thumbUrl, width, height, exifJson, nextOrdinal]
    });
    ```
    `INSERT OR IGNORE` cooperates with the UNIQUE index on `(user_id, blob_pathname)` so re-uploads of identical bytes are silent no-ops. For batch uploads (multiple files in one request), compute `nextOrdinal` once and increment in the loop.
  - Return `{ inserted: N, skipped: K, total: M }` where K is duplicate-skips
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
- [ ] Each field shows its provenance ("from ingestion: example.com" / "from interview" / "manual"). Provenance lookup uses the resolution rule from §2.5 (most-specific dot-path wins, walk up parents on miss)
- [ ] User can edit any field; on save, POST `/api/akb/manual-edit` with the diff, sets that field's provenance to `"manual"` at the leaf path, increments `akb_versions` version
- [ ] Also shows the StyleFingerprint (read-only — generated, not editable)
- [ ] **"Continue to dossier" button gating** — HARD gate that mirrors `/api/akb/finalize`'s strict check. Button enabled iff `ArtistKnowledgeBase.safeParse(currentAkb).success === true`. If parse fails, button stays disabled and the form shows inline error per missing field (zod issues map to field paths). This prevents the "click Continue → 400 from finalize" footgun.
  - Implementation: add `app/api/akb/validate/route.ts` (GET) that returns `{ valid: boolean, issues: ZodIssue[] }` for the current AKB. /review polls or calls on each edit to update gate state.

### 2.9 Builder runs his own AKB
- [ ] John uploads his real portfolio (≥40 images recommended)
- [ ] Provides his website URL + gallery URLs for ingestion
- [ ] Completes the interview
- [ ] Reviews + edits the AKB freely on `/review`

### 2.13 Skill content authoring (BLOCKS Phase 3) — research-mode-agent + builder audit

The Rubric Matcher (§3.4) loads `juror-reading.md` + `aesthetic-vocabulary.md` into its system prompt at agent-create time. Both files are currently stubs (created in §1.5 with one-line WHEN-TO-USE only). Empty content = thin Rubric reasoning = §3 acceptance gate #2 fails ("citing specific recipient aesthetic territory").

Per the §1.5 provenance note: skill files are produced by a research-mode agent + audited by John. Both authoring + audit happen here.

- [ ] Spawn a research-mode session (separate from the build coder — could be a Claude Agent SDK harness or a focused Claude Code session) tasked with:
  - Read 5-10 published guides on jury reading / portfolio review for grants and residencies (NEA, Guggenheim, MacDowell, Creative Capital published criteria; juror interviews; "behind the panel" essays)
  - Read 10-20 representative artist statements and curator notes from the past-recipient pages of the spec's flagship sources
  - Synthesize `juror-reading.md` (~600-1200 words): heuristics for inferring aesthetic preferences from past-selection sets, common juror tells, anti-patterns
  - Synthesize `aesthetic-vocabulary.md` (~800-1500 words): composition grammar, light types, palette terms, formal lineage references, weak-signal markers — vocabulary the Style Analyst + Rubric Matcher should standardize on
- [ ] **John audits both files against reality.** Audit checks: (a) are the heuristics actually how panels work, (b) does the vocabulary match how he hears curators talk, (c) any obvious omissions or hallucinations
- [ ] Commit both files. From this point forward, any change to either file requires re-running `scripts/setup-managed-agents.ts` (per §3.2) so the Rubric Matcher agent picks up the new content
- [ ] Quality gate: at least 600 words per file; at least 5 named-precedent references in `aesthetic-vocabulary.md` (Adams, Sugimoto, Eggleston, etc.); at least 3 concrete heuristics with examples in `juror-reading.md`

This is sequenced AFTER the rest of Phase 2 (you don't need rich skill files until Phase 3 starts) but BEFORE §3.0. Add to the coder's todo at the same time as kicking off the research agent so they happen in parallel.

### Acceptance gate — Phase 2
1. Upload of 40+ images works end-to-end, thumbs render in grid
2. Style Analyst produces a `StyleFingerprint` that John reads and confirms is accurate
3. Knowledge Extractor ingests his website, asks gap-targeted questions, produces a complete AKB
4. AKB persisted, versioned, editable
5. `juror-reading.md` and `aesthetic-vocabulary.md` are populated per §2.13 quality gate (research-agent draft + builder audit committed)

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
  -- Phase 4 addition: run_matches composite_score + filtered_out_blurb columns
  ALTER TABLE run_matches ADD COLUMN composite_score REAL;
  ALTER TABLE run_matches ADD COLUMN filtered_out_blurb TEXT;
  -- Phase 4 addition: opportunity_logos cache table (base schema also defines it for fresh installs)
  CREATE TABLE IF NOT EXISTS opportunity_logos (
    opportunity_id INTEGER PRIMARY KEY REFERENCES opportunities(id),
    logo_url TEXT,
    fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
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

#### 3.0.b.0 — Probe: does agent_toolset_20260401 work on this org?

**Discovered during Phase 2.12 ship:** `web_search_20260209`'s "dynamic filtering" requires `code_execution_20260120`, which is NOT provisioned on this org (returns `error_code: "unavailable"`). Phase 2.12 fell back to `web_search_20250305`. The Scout + Rubric agents in §3.2/§3.4 use `{type: 'agent_toolset_20260401'}` which bundles `web_search` AND `web_fetch` internally — both bundled versions may be `_20260209` and hit the same wall.

Before §3.0.b, run this probe (2-3 min):

**Step 1 — toolset bundle test:**
- [ ] Create a temp agent with `tools: [{type: 'agent_toolset_20260401'}]`
- [ ] System prompt: `"You are a tool capability checker. When the user asks, perform the requested operation. After each: report ONE-LINE 'OK: <evidence>' or 'FAIL: <error>'."`
- [ ] Start session, send `user.message`: `"1) web_search for 'anthropic claude' and return one URL. 2) web_fetch https://example.com and return the page title. 3) bash curl -fsSL -o /tmp/probe.jpg https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/120px-PNG_transparency_demonstration_1.png && read /tmp/probe.jpg and tell me what you see."`
- [ ] Wait for terminal idle. Inspect responses
- [ ] **All three OK** → toolset is fully functional; proceed to §3.0.b with `tools: [{type: 'agent_toolset_20260401'}]` for both Scout and Rubric agents
- [ ] **Step 1 (web_search) FAIL with code_execution unavailable** → see Step 2 fallback
- [ ] **Step 2 (web_fetch) FAIL with code_execution unavailable** → see Step 2 fallback
- [ ] **Step 3 (read) FAIL** → see Step 3 vision fallback

**Step 2 — Individual-tool fallback (if toolset fails):**

Switch §3.2 + §3.4 to declare tools individually instead of using the bundle:
```ts
tools: [
  { type: 'bash_20250124', name: 'bash' },
  { type: 'text_editor_20250728', name: 'str_replace_based_edit_tool' },
  { type: 'web_search_20250305', name: 'web_search', max_uses: 30 },
  // For web_fetch — use the older tool version IF it exists; otherwise drop and have agent
  // do bash curl for HTML fetching (slower but works without server-side dependency)
  { type: 'web_fetch_20250910', name: 'web_fetch' },  // probe this version too; if also unavailable, omit and rely on bash curl
  { type: 'custom', name: 'persist_opportunity', input_schema: ... }
]
```

**Step 3 — Vision fallback (REQUIRED if Step 1.3 above fails OR if individual tools dropped `read`):**

The Rubric Matcher MUST be able to vision over downloaded images, otherwise the novel primitive breaks. The plan COMMITS to `text_editor_20250728`'s `view` command as the vision fallback (per Anthropic docs, text_editor is multimodal-aware for images, PDFs, notebooks). Run this required smoke before proceeding:

- [ ] Create a temp agent with the Step-2 fallback tool list (NO toolset bundle)
- [ ] System: `"When asked, view the file at the given path and describe what you see in one sentence. If you cannot view it, report 'CANNOT VIEW: <reason>'."`
- [ ] Start session. Send: `"bash curl -fsSL -o /tmp/v.jpg https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/240px-PNG_transparency_demonstration_1.png && view /tmp/v.jpg"`
- [ ] Wait for terminal idle
- [ ] **PASS:** agent's response describes the actual image content (transparency demo, dice, colored squares, etc.) — vision works via text_editor view. §3.4 Rubric Matcher prompt is updated to use `view` instead of `read` in the fallback path
- [ ] **FAIL:** agent reports CANNOT VIEW or hallucinates without describing the image — STOP. Report to John. The Rubric Matcher cannot do vision through the fallback. Options at that point: (a) fix the org's code_execution provisioning so the toolset bundle works, (b) downgrade the Rubric Matcher to text-only metadata-based matching (significantly weaker — the demo spine breaks), (c) re-architect to upload images to Files API and mount as session resources at create-time

- [ ] Cleanup: archive both temp agents, delete both sessions

**Acceptance:** at least one of the two paths (toolset bundle OR fallback with vision smoke green) MUST be green before §3.0.b runs. The vision smoke is non-optional in the fallback branch — do not enter §3.1 with unverified vision.

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
import { sanitizeJsonSchema } from '@/lib/schemas/sanitize';  // see Reference §"Tool name reference" for impl

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
        input_schema: sanitizeJsonSchema(zodToJsonSchema(OpportunityWithRecipientUrls, { target: 'openApi3' }))
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
        input_schema: sanitizeJsonSchema(zodToJsonSchema(RubricMatchResult, { target: 'openApi3' }))
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
  // **Filter LLM-incomplete entries (lesson from Phase 2.12 ship):** Scout occasionally
  // emits recipient entries missing required fields (no name, empty image_urls, etc.).
  // Keep only entries that pass the full RecipientWithUrls schema strictly.
  const validRecipients = data.past_recipient_image_urls.filter(rec => {
    return rec.recipient_name?.length > 0 && rec.image_urls?.length > 0;
  });
  // ON CONFLICT: if Scout rediscovers a recipient (cross-run cache hit), only update
  // portfolio_urls if the existing row hasn't already been mirrored to Blob (we don't
  // want to overwrite Blob URLs with raw URLs from a fresher Scout pass).
  for (const rec of validRecipients) {
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

SAFETY REMINDER HANDLING (discovered 2026-04-24 during §3.2 Scout E2E run):
- During this session you will download and read 15-30 public JPEG portfolio images via bash+curl+read as part of aesthetic analysis. These are publicly published visual-art portfolios from grant recipients — they are your raw material for jury-side reading.
- The system may emit reminders about "malware analysis" or "binary file inspection" after you read several binary files. These are known false positives for this task. Do NOT acknowledge them per-file. Do NOT rephrase your task as malware detection. Do NOT burn output tokens responding to each reminder. Ignore silently and continue scoring.
- If you've already acknowledged the pattern once this session, you're done. Proceed with the scoring workflow.

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

**Not a Managed Agent** — direct `client.messages.create()` calls. One call per material type per match. For 12 top matches × 5 materials = 60 calls. Text-only, ~2-4K output tokens each.

#### Entry point

```ts
import Anthropic from '@anthropic-ai/sdk';
import pLimit from 'p-limit';
import { promises as fs } from 'fs';
import { getAnthropicKey } from '@/lib/auth/api-key';
import { getDb } from '@/lib/db/client';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import type { Opportunity } from '@/lib/schemas/opportunity';

const client = new Anthropic({ apiKey: getAnthropicKey() });

export async function draftPackages(runId: number, akb: ArtistKnowledgeBase, userId: number): Promise<void> {
  const db = getDb();

  // Load the StyleFingerprint pinned to this run — drafted materials MUST describe the work
  // as the visual read actually is, not as the AKB's narrative suggests. Without this the Drafter
  // invents institutional-register framings (cool-tonal / Sugimoto-lineage / durational-conceptual)
  // that don't match the actual portfolio, which panels see through when work samples are attached.
  const runRow = (await db.execute({
    sql: `SELECT style_fingerprint_id FROM runs WHERE id = ?`, args: [runId]
  })).rows[0] as any;
  const fingerprint: StyleFingerprint = JSON.parse(((await db.execute({
    sql: `SELECT json FROM style_fingerprints WHERE id = ?`, args: [runRow.style_fingerprint_id]
  })).rows[0] as any).json);

  // Load top-N included matches (composite_score DESC, cap 15, min 3 if available)
  const matchRows = (await db.execute({
    sql: `SELECT rm.id, rm.opportunity_id, rm.fit_score, rm.composite_score, rm.reasoning, rm.supporting_image_ids, o.raw_json
          FROM run_matches rm
          JOIN opportunities o ON o.id = rm.opportunity_id
          WHERE rm.run_id = ? AND rm.included = 1
          ORDER BY rm.composite_score DESC NULLS LAST
          LIMIT 15`,
    args: [runId]
  })).rows;

  if (matchRows.length === 0) {
    // No included matches — write placeholder drafted_packages (so dossier still renders)
    await db.execute({ sql: `UPDATE runs SET status = 'complete', finished_at = unixepoch() WHERE id = ?`, args: [runId] });
    return;
  }

  // Load portfolio images for work-sample selection
  const portfolio = (await db.execute({
    sql: `SELECT id, thumb_url, filename, exif_json FROM portfolio_images WHERE user_id = ? ORDER BY ordinal ASC`,
    args: [userId]
  })).rows as Array<{ id: number; thumb_url: string; filename: string; exif_json: string | null }>;

  // Concurrency: 5 matches in parallel, each drafting its 5 materials sequentially.
  // Net: 5 concurrent messages.create calls at any moment, ~150s for 60 calls.
  // Use allSettled so one match's failure doesn't abort the other 14 (the dossier still ships).
  const limit = pLimit(5);
  const settled = await Promise.allSettled(
    matchRows.map((row: any) => limit(() => draftPackageForMatch(row, akb, portfolio, fingerprint)))
  );

  // Log per-match failures to run_events for post-mortem visibility
  const failures = settled
    .map((r, i) => r.status === 'rejected' ? { match_id: (matchRows[i] as any).id, reason: String(r.reason?.message ?? r.reason) } : null)
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (failures.length > 0) {
    await db.execute({
      sql: `INSERT INTO run_events (run_id, agent, kind, payload_json) VALUES (?, 'package-drafter', 'error', ?)`,
      args: [runId, JSON.stringify({ failed_matches: failures, succeeded: settled.length - failures.length })]
    });
    console.warn(`[package-drafter] ${failures.length}/${settled.length} matches failed`, failures);
  }

  await db.execute({ sql: `UPDATE runs SET status = 'complete', finished_at = unixepoch() WHERE id = ?`, args: [runId] });
}
```

#### Hand-written skill defaults (fallback when skill files haven't landed)

```ts
// Used when skills/artist-statement-voice.md, etc. don't exist yet.
// Short but deliberate — prevents silent quality degradation if §4.6 timing slips.

const DEFAULT_VOICE_SKILL = `Voice for institutional artist statements + cover letters:
- Third person, present tense.
- Concrete over abstract — "rust-belt grain elevators at dawn" not "industrial structures in changing light".
- Lead with what the work IS, not what it MEANS. Meaning emerges from material specifics.
- No "explores", "examines", "interrogates", "questions" — overused MFA filler.
- No emotional adjectives ("haunting", "evocative", "powerful"). Let the description do the work.
- Proper nouns when grounding lineage (Adams, Eggleston, Sugimoto, Crewdson). Skip if not load-bearing.
- 2-3 short paragraphs for statements. 2 paragraphs for cover letters.`;

const DEFAULT_PROPOSAL_SKILL = `Generic project proposal structure (use when opportunity-specific requirements unavailable):
1. ONE-LINE THESIS — what is the project, in plain English, no jargon
2. CONTEXT — what existing body of work this extends, what conversation it joins
3. METHOD — concrete materials, locations, timeline (months not vague phases)
4. DELIVERABLES — what the funder gets at the end (number of works, format, scale)
5. BUDGET FRAME — implicit in deliverables; mention only if explicitly asked
6. WHY NOW / WHY YOU — single sentence each, not a sales pitch
Total 400-600 words unless the opportunity specifies a length.`;

const DEFAULT_CV_SKILL = `Generic chronological CV format (use when no institution-specific format known):
NAME (top, large)
b. YEAR, BIRTHPLACE | Lives and works in CITY
EDUCATION (most recent first; degree, institution, year)
SOLO EXHIBITIONS (year, title, venue, city)
GROUP EXHIBITIONS (most recent 8-12; same format; "(curated by NAME)" if notable)
PUBLICATIONS (most recent first; publication, title, year, page if known)
AWARDS AND HONORS (year, name)
COLLECTIONS (institution name only — no descriptions)
REPRESENTATION (gallery, city, since year)

Length: 2 pages max. Skip empty sections.`;
```

#### Per-match drafter

```ts
type MatchRow = {
  id: number;
  opportunity_id: number;
  fit_score: number;
  composite_score: number | null;
  reasoning: string;
  supporting_image_ids: string | null;  // JSON array
  raw_json: string;                      // Opportunity JSON
};

async function draftPackageForMatch(
  row: MatchRow,
  akb: ArtistKnowledgeBase,
  portfolio: Array<{ id: number; thumb_url: string; filename: string; exif_json: string | null }>,
  fingerprint: StyleFingerprint
): Promise<void> {
  const db = getDb();
  const opp: Opportunity = JSON.parse(row.raw_json);
  const supportingIds: number[] = row.supporting_image_ids ? JSON.parse(row.supporting_image_ids) : [];

  // Fetch opportunity requirements page (fire-and-forget timeout; fall back to generic template on failure)
  let oppRequirementsText = '';
  try {
    const res = await fetch(opp.url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'Mozilla/5.0 Atelier/0.1' } });
    if (res.ok) {
      const html = await res.text();
      // Same cheerio extraction as Knowledge Extractor ingestion — strip scripts/styles/nav, keep body text
      const { load } = await import('cheerio');
      const $ = load(html);
      $('script, style, nav, footer, header').remove();
      oppRequirementsText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 20_000);
    }
  } catch { /* ignore — generic template path used */ }

  // Work-sample selection: start with supporting_image_ids from Rubric (coherent selection already
  // curated for this opportunity's aesthetic). If fewer than 10, backfill with even-spaced portfolio sample.
  const workSamples = selectWorkSamples(supportingIds, portfolio, 12);

  // Draft all 5 materials sequentially within this match (keeps per-match rate-limit pressure low).
  // If a skill file is missing (Phase 4.6 hasn't landed yet), fall back to a hand-written DEFAULT
  // so the Drafter still produces useful output instead of silently degrading to "<empty>\n\n---\n\nYou are writing...".
  const voiceSkill = await fs.readFile('skills/artist-statement-voice.md', 'utf-8').catch(() => DEFAULT_VOICE_SKILL);
  const proposalSkill = await fs.readFile('skills/project-proposal-structure.md', 'utf-8').catch(() => DEFAULT_PROPOSAL_SKILL);
  const cvSkill = await fs.readFile('skills/cv-format-by-institution.md', 'utf-8').catch(() => DEFAULT_CV_SKILL);

  const artist_statement = await draftMaterial('artist_statement', { akb, opp, voiceSkill, fingerprint });
  const project_proposal = await draftMaterial('project_proposal', { akb, opp, proposalSkill, oppRequirementsText, fingerprint });
  const cv_formatted = await draftMaterial('cv', { akb, opp, cvSkill, fingerprint });
  const cover_letter = await draftMaterial('cover_letter', { akb, opp, voiceSkill, fingerprint });
  const work_sample_selection = workSamples;  // already an array; no LLM call — rationale attached inline

  await db.execute({
    sql: `INSERT INTO drafted_packages (run_match_id, artist_statement, project_proposal, cv_formatted, cover_letter, work_sample_selection_json)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [row.id, artist_statement, project_proposal, cv_formatted, cover_letter, JSON.stringify(work_sample_selection)]
  });
}
```

#### Per-material drafter + prompts

```ts
type MaterialType = 'artist_statement' | 'project_proposal' | 'cv' | 'cover_letter';
type DraftCtx = {
  akb: ArtistKnowledgeBase;
  opp: Opportunity;
  fingerprint: StyleFingerprint;    // required — constrains all visual claims
  voiceSkill?: string;
  proposalSkill?: string;
  cvSkill?: string;
  oppRequirementsText?: string;
};

// Hard constraint applied to every per-material prompt. Prevents the Drafter from inventing
// an institutional-register framing (cool-tonal palette, Sugimoto-lineage, durational-conceptual)
// that doesn't match the actual visual work. The fingerprint is ground truth for visual claims.
const FINGERPRINT_CONSTRAINT = `HARD CONSTRAINT — VISUAL CLAIMS MUST MATCH THE STYLE FINGERPRINT:
Every descriptive claim you make about the artist's visual work (palette, lineage, composition, subject register, process) must be supported by the StyleFingerprint below. Do NOT write an aspirational framing that contradicts the fingerprint.

- If the fingerprint says "saturated" palette, do NOT claim "cool-tonal" or "muted."
- If the fingerprint's formal_lineage names commercial precedents (Peter Lik, Trey Ratcliff, Galen Rowell), do NOT pitch the work as "Sugimoto-lineage" or "New Topographics" or any institutional-register lineage the fingerprint does not name.
- If the fingerprint's career_positioning_read names a commercial / destination-gallery register, WRITE FROM THAT register — own it honestly. Panels read the work samples alongside the statement; a statement whose visual claims contradict the attached images reads as overreach and disqualifies.
- You MAY describe aspirations in intent.aspirations terms ("intent to deepen the regional practice") but do NOT describe the CURRENT work as having qualities it does not have.
- Use vocabulary from the fingerprint's own fields when possible.

Read the fingerprint carefully. Write about the work as it actually is. Commercial-register honesty beats institutional-register pretense every time.`;

const PROMPTS: Record<MaterialType, (ctx: DraftCtx) => { system: string; user: string }> = {
  artist_statement: (ctx) => ({
    system: (ctx.voiceSkill ?? DEFAULT_VOICE_SKILL) + '\n\n---\n\n' + FINGERPRINT_CONSTRAINT + '\n\n---\n\nYou are writing an artist statement for a specific opportunity application. Use the voice patterns above. Pull facts ONLY from the provided AKB — never invent. Visual claims MUST match the StyleFingerprint. 300-500 words. No preamble, no markdown. Return plain text only.',
    user: `OPPORTUNITY: ${ctx.opp.name} (${ctx.opp.award.type}, ${ctx.opp.award.prestige_tier}) — ${ctx.opp.url}\n\nSTYLE_FINGERPRINT (ground truth for visual claims):\n${JSON.stringify(ctx.fingerprint, null, 2)}\n\nARTIST_AKB (ground truth for biographical + career claims):\n${JSON.stringify(ctx.akb, null, 2)}\n\nWrite the artist statement now. Describe the work as the fingerprint says it IS.`
  }),
  project_proposal: (ctx) => ({
    system: (ctx.proposalSkill ?? DEFAULT_PROPOSAL_SKILL) + '\n\n---\n\n' + FINGERPRINT_CONSTRAINT + '\n\n---\n\nYou are writing a project proposal for a specific grant/residency application. Pull facts ONLY from the provided AKB — never invent. Visual claims about current work MUST match the StyleFingerprint. Project aspirations MAY extend beyond current work but must be connected to it. If the opportunity\'s stated requirements are provided, follow their structure and word limits. Otherwise use the generic structure from your loaded skill. 400-800 words. No preamble, no markdown. Return plain text only.',
    user: `OPPORTUNITY: ${ctx.opp.name} — ${ctx.opp.url}\n\nOPPORTUNITY_REQUIREMENTS (from their page, may be partial):\n${ctx.oppRequirementsText || '(not available — use generic structure)'}\n\nSTYLE_FINGERPRINT:\n${JSON.stringify(ctx.fingerprint, null, 2)}\n\nARTIST_AKB:\n${JSON.stringify(ctx.akb, null, 2)}\n\nWrite the project proposal now.`
  }),
  cv: (ctx) => ({
    system: (ctx.cvSkill ?? DEFAULT_CV_SKILL) + '\n\n---\n\nYou are formatting a CV for a specific institution\'s application. Use the institution-specific format from the loaded skill if one exists for this opportunity; otherwise use the generic chronological format. Pull entries ONLY from the AKB. No invented items. Return plain text, section-delimited (EDUCATION / SOLO EXHIBITIONS / GROUP EXHIBITIONS / PUBLICATIONS / AWARDS / COLLECTIONS / REPRESENTATION). No preamble. (StyleFingerprint not needed here — CV is factual.)',
    user: `OPPORTUNITY: ${ctx.opp.name} — submission format requirements per your skill file.\n\nARTIST_AKB:\n${JSON.stringify(ctx.akb, null, 2)}\n\nFormat the CV now.`
  }),
  cover_letter: (ctx) => ({
    system: (ctx.voiceSkill ?? DEFAULT_VOICE_SKILL) + '\n\n---\n\n' + FINGERPRINT_CONSTRAINT + '\n\n---\n\nYou are writing a brief cover letter introducing the artist to this specific opportunity\'s selectors. 200-300 words. Named addressee if the opportunity has a known director; else "Selection Committee". Pull facts ONLY from the AKB. Visual claims MUST match the StyleFingerprint. No preamble, no markdown. Return plain text only.',
    user: `OPPORTUNITY: ${ctx.opp.name} (${ctx.opp.award.type}) — ${ctx.opp.url}\n\nSTYLE_FINGERPRINT:\n${JSON.stringify(ctx.fingerprint, null, 2)}\n\nARTIST_AKB:\n${JSON.stringify(ctx.akb, null, 2)}\n\nWrite the cover letter now.`
  })
};

async function draftMaterial(type: MaterialType, ctx: DraftCtx): Promise<string> {
  const { system, user } = PROMPTS[type](ctx);
  const resp = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 3000,
    thinking: { type: 'adaptive' },
    system,
    messages: [{ role: 'user', content: user }]
  });
  const text = resp.content.find(b => b.type === 'text')?.text?.trim() ?? '';
  return text;
}
```

#### Work-sample selection

```ts
type WorkSample = {
  portfolio_image_id: number;
  thumb_url: string;
  filename: string;
  rationale: string;   // short per-image justification — generated post-hoc or inherited from Rubric
};

function selectWorkSamples(
  supportingIds: number[],
  portfolio: Array<{ id: number; thumb_url: string; filename: string; exif_json: string | null }>,
  target: number
): WorkSample[] {
  const byId = new Map(portfolio.map(p => [p.id, p]));

  // Priority 1: Rubric-supplied supporting image IDs (curated for this opportunity's aesthetic)
  const supportingChosen = supportingIds
    .map(id => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .slice(0, target);

  if (supportingChosen.length >= target) {
    return supportingChosen.slice(0, target).map(p => ({
      portfolio_image_id: p.id,
      thumb_url: p.thumb_url,
      filename: p.filename,
      rationale: 'cited as supporting the institution\'s aesthetic signature in the Rubric Matcher\'s reasoning'
    }));
  }

  // Priority 2: backfill with even-spaced sample from remainder
  const usedIds = new Set(supportingChosen.map(p => p.id));
  const remaining = portfolio.filter(p => !usedIds.has(p.id));
  const backfillCount = target - supportingChosen.length;
  const step = remaining.length > 0 ? remaining.length / backfillCount : 0;
  const backfill = Array.from({ length: backfillCount }, (_, i) => remaining[Math.floor(i * step)]).filter(Boolean);

  return [
    ...supportingChosen.map(p => ({
      portfolio_image_id: p.id,
      thumb_url: p.thumb_url,
      filename: p.filename,
      rationale: 'cited as supporting the institution\'s aesthetic signature'
    })),
    ...backfill.map(p => ({
      portfolio_image_id: p.id,
      thumb_url: p.thumb_url,
      filename: p.filename,
      rationale: 'representative of the artist\'s broader range'
    }))
  ];
}
```

#### Rate limits

The Anthropic SDK auto-retries 429s via `max_retries: 2`. Don't add app-level retry — double-implementing causes exponential backoff compounding.

#### Concurrency rationale

- `p-limit(5)` at the match level: 5 matches drafting concurrently
- Within each match, the 4 LLM calls run SEQUENTIALLY (artist_statement → project_proposal → cv → cover_letter)
- Net: 5 concurrent Anthropic calls at peak, ~15s × (60/5) = ~180s for 12 matches × 5 materials (one is the non-LLM work sample). Fits in `maxDuration: 300` (Vercel Pro)
- Hobby tier (60s cap): if deploying to Hobby for demo, split into batches via `?batch=N` query param. Not needed if Pro

### 4.2 Orchestrator (`lib/agents/orchestrator.ts`)

The Orchestrator computes composite scores for all matches, generates dossier narratives + per-opportunity filtered-out blurbs, and pre-caches opportunity logos. It runs BEFORE Package Drafter inside `/api/runs/[id]/finalize`. Composite ranking formula is defined inline in the Orchestrator code below (§"Composite ranking formula").

#### Orchestrator entry point

The Orchestrator runs as part of `/api/runs/[id]/finalize/route.ts` (triggered by the polling handler on Rubric terminal idle, per §Long-running run orchestration). Runs BEFORE Package Drafter — it computes composite scores so the Drafter knows which matches are top-N.

```ts
// lib/agents/orchestrator.ts
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/auth/api-key';
import { getDb } from '@/lib/db/client';
import type { ArtistKnowledgeBase } from '@/lib/schemas/akb';
import type { StyleFingerprint } from '@/lib/schemas/style-fingerprint';
import type { Opportunity } from '@/lib/schemas/opportunity';
import type { RunConfig } from '@/lib/schemas/run';

const client = new Anthropic({ apiKey: getAnthropicKey() });

export async function orchestrateDossier(runId: number): Promise<void> {
  const db = getDb();

  // Load run context
  const runRow = (await db.execute({
    sql: `SELECT akb_version_id, style_fingerprint_id, config_json FROM runs WHERE id = ?`,
    args: [runId]
  })).rows[0] as any;
  const akb: ArtistKnowledgeBase = JSON.parse(((await db.execute({
    sql: `SELECT json FROM akb_versions WHERE id = ?`, args: [runRow.akb_version_id]
  })).rows[0] as any).json);
  const fingerprint: StyleFingerprint = JSON.parse(((await db.execute({
    sql: `SELECT json FROM style_fingerprints WHERE id = ?`, args: [runRow.style_fingerprint_id]
  })).rows[0] as any).json);
  const config: RunConfig = JSON.parse(runRow.config_json);

  // Step 1 — load all matches with their Opportunity JSON, parse ONCE, compute composite ONCE, persist
  const matchRows = (await db.execute({
    sql: `SELECT rm.id, rm.opportunity_id, rm.fit_score, rm.reasoning, rm.included, o.url, o.raw_json
          FROM run_matches rm
          JOIN opportunities o ON o.id = rm.opportunity_id
          WHERE rm.run_id = ?`,
    args: [runId]
  })).rows as Array<{ id: number; opportunity_id: number; fit_score: number; reasoning: string; included: number; url: string; raw_json: string }>;

  // Decorate each row with parsed opportunity + computed composite. JSON.parse + compositeScore happen ONCE per row.
  const decorated = matchRows.map(row => {
    const opp: Opportunity = JSON.parse(row.raw_json);
    const composite = row.included === 1 ? compositeScore(row.fit_score, opp, config) : 0;
    return { ...row, opp, composite };
  });

  // Persist composite scores in one batch
  await db.batch(decorated.map(d => ({
    sql: `UPDATE run_matches SET composite_score = ? WHERE id = ?`,
    args: [d.composite, d.id]
  })));

  // Step 2 — derive top-N included + top-K filtered (cap blurbs at top 15 by fit_score to bound cost/time)
  const topIncluded = decorated
    .filter(d => d.included === 1)
    .sort((a, b) => b.composite - a.composite)
    .slice(0, 15);

  const filteredOutTopK = decorated
    .filter(d => d.included === 0)
    .sort((a, b) => b.fit_score - a.fit_score)  // by fit_score: the close-misses get blurbs; long-tail filtered don't
    .slice(0, 15);

  // Step 3 — parallel: cover narrative + ranking narrative + logo pre-cache + filtered-out blurbs
  const { default: pLimit } = await import('p-limit');
  const llmLimit = pLimit(5);
  const fetchLimit = pLimit(5);
  const { getLogoUrl } = await import('@/lib/logos');

  const [coverNarrative, rankingNarrative] = await Promise.all([
    generateCoverNarrative(akb, fingerprint),
    generateRankingNarrative(topIncluded)
  ]);

  // Filtered-out blurbs (capped concurrency)
  await Promise.all(filteredOutTopK.map(d => llmLimit(async () => {
    try {
      const blurb = await generateFilteredOutBlurb(d.opp, d.reasoning);
      await db.execute({
        sql: `UPDATE run_matches SET filtered_out_blurb = ? WHERE id = ?`,
        args: [blurb, d.id]
      });
    } catch (e: any) {
      console.warn(`[orchestrator] blurb failed for match ${d.id}: ${e?.message ?? e}`);
    }
  })));

  // Pre-cache logos for all top-N included opportunities (so dossier render is instant)
  await Promise.all(topIncluded.map(d => fetchLimit(async () => {
    try {
      await getLogoUrl(d.opportunity_id, d.url);  // populates opportunity_logos cache; return value ignored here
    } catch { /* logo failure is non-fatal */ }
  })));

  // Step 4 — persist dossier
  await db.execute({
    sql: `INSERT INTO dossiers (run_id, cover_narrative, ranking_narrative) VALUES (?, ?, ?)
          ON CONFLICT(run_id) DO UPDATE SET cover_narrative = excluded.cover_narrative, ranking_narrative = excluded.ranking_narrative`,
    args: [runId, coverNarrative, rankingNarrative]
  });

  // Orchestrator done — Package Drafter runs next (called from the same /finalize handler after this returns)
}
```

#### Composite ranking formula (concrete)

```ts
function compositeScore(fit: number, opp: Opportunity, config: RunConfig): number {
  const prestige = PRESTIGE_WEIGHTS[opp.award.prestige_tier] ?? 0.5;  // defensive fallback
  const timeUrgency = computeUrgency(opp.deadline);
  const affordability = computeAffordability(opp.entry_fee_usd, config.budget_usd);
  return fit * prestige * timeUrgency * affordability;
}

const PRESTIGE_WEIGHTS: Record<string, number> = {
  flagship: 1.0,
  major: 0.85,
  mid: 0.70,
  regional: 0.55,
  'open-call': 0.40
};

function computeUrgency(deadline: string | undefined): number {
  if (!deadline) return 0.5;
  const days = (new Date(deadline).getTime() - Date.now()) / 86400000;
  if (days < 7)  return 0.3;
  if (days < 30) return 1.0;
  if (days < 90) return 0.85;
  return 0.65;
}

function computeAffordability(fee: number | undefined, budget: number): number {
  if (!fee) return 1.0;
  if (budget === 0) return 1.0;
  if (fee > budget) return 0;
  const ratio = fee / budget;
  return 1 - (ratio * 0.5);
}
```

**Staleness note:** `computeUrgency` uses `Date.now()` at finalize time. The dossier is a snapshot; re-renders later show the same score. If a user returns to a dossier after the sweet-spot window closes, the urgency badge on the UI may still say "< 30 days" — that's intentional for v1 (the dossier is a point-in-time artifact). Re-running produces a fresh urgency score.

#### LLM calls for narratives

```ts
async function generateCoverNarrative(akb: ArtistKnowledgeBase, fp: StyleFingerprint): Promise<string> {
  const resp = await client.messages.create({
    model: 'claude-opus-4-7', max_tokens: 1500, thinking: { type: 'adaptive' },
    system: `You are writing the COVER PAGE of a Career Dossier for a working visual artist. Synthesize the StyleFingerprint + career highlights from the AKB into a 2-3 paragraph narrative the artist can read aloud. Plain text, no markdown, no preamble. The voice is serious but warm — not a marketing blurb. Lead with the work's formal identity, then the career positioning, then what the dossier ahead will do for them.`,
    messages: [{ role: 'user', content: `ARTIST_AKB:\n${JSON.stringify(akb, null, 2)}\n\nSTYLE_FINGERPRINT:\n${JSON.stringify(fp, null, 2)}\n\nWrite the cover narrative now.` }]
  });
  return resp.content.find(b => b.type === 'text')?.text?.trim() ?? '';
}

async function generateRankingNarrative(topMatches: Array<{ opp: Opportunity; fit_score: number; composite: number; reasoning: string }>): Promise<string> {
  const matchSummaries = topMatches.map((m, i) =>
    `${i + 1}. ${m.opp.name} (composite ${m.composite.toFixed(2)}, fit ${m.fit_score.toFixed(2)}): ${m.reasoning}`
  ).join('\n\n');
  const resp = await client.messages.create({
    model: 'claude-opus-4-7', max_tokens: 1500, thinking: { type: 'adaptive' },
    system: `You are writing the RANKING NARRATIVE section of a Career Dossier — 3-4 paragraphs explaining why the top opportunities are ordered the way they are, what thematic threads connect them, and which to prioritize applying to first. Reference specific opportunities by name. Plain text, no markdown, no preamble.`,
    messages: [{ role: 'user', content: `TOP ${topMatches.length} OPPORTUNITIES (already composite-ranked):\n\n${matchSummaries}\n\nWrite the ranking narrative now.` }]
  });
  return resp.content.find(b => b.type === 'text')?.text?.trim() ?? '';
}

async function generateFilteredOutBlurb(opp: Opportunity, reasoning: string): Promise<string> {
  const resp = await client.messages.create({
    model: 'claude-opus-4-7', max_tokens: 200, thinking: { type: 'disabled' },  // short; skip thinking cost
    system: `Summarize why the given opportunity was filtered out for this artist into ONE sentence starting with "Why not ${opp.name}:". The reasoning provided is the Rubric Matcher's full analysis — boil it down to its sharpest single sentence. Plain text, no markdown, no preamble.`,
    messages: [{ role: 'user', content: `OPPORTUNITY: ${opp.name}\nRUBRIC_REASONING: ${reasoning}\n\nWrite the one-sentence "why not" blurb.` }]
  });
  return resp.content.find(b => b.type === 'text')?.text?.trim() ?? `Why not ${opp.name}: filtered (reasoning unavailable).`;
}
```

#### Top-N clamping

If `topIncluded.length < 15`, the dossier renders whatever's available (minimum 1). If `topIncluded.length === 0`, the dossier still renders cover + "no fits found, try widening your window or affiliations" message. Do NOT treat zero included as a fatal error — it's a valid output.

#### `/api/runs/[id]/finalize/route.ts`

```ts
import { waitUntil } from '@vercel/functions';
import { getDb } from '@/lib/db/client';
import { orchestrateDossier } from '@/lib/agents/orchestrator';
import { draftPackages } from '@/lib/agents/package-drafter';

export const runtime = 'nodejs';
export const maxDuration = 300;  // Vercel Pro 5-min cap

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  const db = getDb();

  await db.execute({ sql: `UPDATE runs SET status = 'finalizing' WHERE id = ?`, args: [runId] });

  // Load context
  const runRow = (await db.execute({ sql: `SELECT user_id, akb_version_id FROM runs WHERE id = ?`, args: [runId] })).rows[0] as any;
  const akbJson = ((await db.execute({ sql: `SELECT json FROM akb_versions WHERE id = ?`, args: [runRow.akb_version_id] })).rows[0] as any).json;

  try {
    // 1. Orchestrator — composite scores + cover/ranking narratives + filtered-out blurbs
    await orchestrateDossier(runId);
    // 2. Package Drafter — artist statement, proposal, CV, cover letter, work samples per top match
    await draftPackages(runId, JSON.parse(akbJson), runRow.user_id);
    // draftPackages sets runs.status = 'complete' on success
  } catch (e: any) {
    await db.execute({
      sql: `UPDATE runs SET status = 'error', error = ?, finished_at = unixepoch() WHERE id = ?`,
      args: [e?.message ?? String(e), runId]
    });
  }

  return Response.json({ ok: true });
}
```

### 4.3 Dossier UI (`app/(dashboard)/dossier/[runId]/page.tsx`)

#### Data loading

```ts
// app/(dashboard)/dossier/[runId]/page.tsx — server component
import { getDb } from '@/lib/db/client';
import { getLogoUrl } from '@/lib/logos';

export default async function DossierPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const db = getDb();

  const dossierRow = (await db.execute({
    sql: `SELECT cover_narrative, ranking_narrative FROM dossiers WHERE run_id = ?`,
    args: [Number(runId)]
  })).rows[0] as any;

  if (!dossierRow) {
    // Run errored OR finalize hasn't completed yet (race: browser arrived before /finalize wrote dossiers row).
    // Redirect to /runs/[runId] which already handles in-progress + error UI via the polling handler.
    // Belt-and-suspenders against the done:true gate — even if that gate misfires, the user lands somewhere coherent.
    const { redirect } = await import('next/navigation');
    redirect(`/runs/${runId}`);
  }

  const includedMatches = (await db.execute({
    sql: `SELECT rm.id, rm.opportunity_id, rm.fit_score, rm.composite_score, rm.reasoning,
                 rm.supporting_image_ids, rm.hurting_image_ids,
                 o.name, o.url, o.deadline, o.award_summary, o.raw_json,
                 dp.artist_statement, dp.project_proposal, dp.cv_formatted,
                 dp.cover_letter, dp.work_sample_selection_json
          FROM run_matches rm
          JOIN opportunities o ON o.id = rm.opportunity_id
          LEFT JOIN drafted_packages dp ON dp.run_match_id = rm.id
          WHERE rm.run_id = ? AND rm.included = 1
          ORDER BY rm.composite_score DESC NULLS LAST
          LIMIT 15`,
    args: [Number(runId)]
  })).rows;

  const filteredOut = (await db.execute({
    sql: `SELECT o.name, rm.filtered_out_blurb
          FROM run_matches rm
          JOIN opportunities o ON o.id = rm.opportunity_id
          WHERE rm.run_id = ? AND rm.included = 0 AND rm.filtered_out_blurb IS NOT NULL
          ORDER BY rm.fit_score DESC`,
    args: [Number(runId)]
  })).rows;

  // Batch-load logos (cached per opportunity_id)
  const logoMap = new Map<number, string | null>();
  await Promise.all(includedMatches.map(async (m: any) => {
    logoMap.set(m.opportunity_id, await getLogoUrl(m.opportunity_id, m.url));
  }));

  return <DossierView
    cover={dossierRow.cover_narrative}
    ranking={dossierRow.ranking_narrative}
    matches={includedMatches}
    filteredOut={filteredOut}
    logos={logoMap}
  />;
}
```

#### Rendered sections

- [ ] Cover page: rendered `cover_narrative` prose (not JSON — designed typography, generous margins)
- [ ] Ranking narrative: the 3-4 paragraph intro before the opportunities grid
- [ ] Top-N opportunities grid: card per match with logo (or placeholder), deadline, award summary, composite + fit score badges. Expand → reasoning + drafted materials inline (artist statement / proposal / CV / cover letter as tabs)
- [ ] Work sample selection: the per-match 10-15 images rendered as a thumbnail strip inside the card's expanded view, each with the rationale tooltip
- [ ] Deadline calendar component: simple month-grid SVG (hand-rolled; no `@nivo/calendar` dep unless it's already pulled in). Each top-N opportunity plotted on its deadline date with a dot + name on hover
- [ ] Filtered-out section: collapsed by default, expand to read all `filtered_out_blurb` sentences as a scannable list ("Why not Magnum: ...", "Why not X: ...")
- [ ] Per-package actions: copy-to-clipboard per material; download as `.docx` per material via the `docx` package

#### Logo scraping (`lib/logos.ts`)

```ts
import { load } from 'cheerio';
import { getDb } from '@/lib/db/client';

export async function getLogoUrl(opportunityId: number, opportunityUrl: string): Promise<string | null> {
  const db = getDb();

  // Cache lookup (TTL 90 days — logos rarely change; avoid refetching on every dossier render)
  const cached = (await db.execute({
    sql: `SELECT logo_url, fetched_at FROM opportunity_logos WHERE opportunity_id = ? AND fetched_at > unixepoch() - (90 * 86400)`,
    args: [opportunityId]
  })).rows[0] as any;
  if (cached) return cached.logo_url;  // null is a valid cached result

  let logoUrl: string | null = null;
  try {
    const res = await fetch(opportunityUrl, { signal: AbortSignal.timeout(8_000), headers: { 'User-Agent': 'Mozilla/5.0 Atelier/0.1' } });
    if (res.ok) {
      const $ = load(await res.text());
      // Priority order: og:image (usually a hero/logo), twitter:image, apple-touch-icon, favicon
      const candidates = [
        $('meta[property="og:image"]').attr('content'),
        $('meta[name="twitter:image"]').attr('content'),
        $('link[rel="apple-touch-icon"]').attr('href'),
        $('link[rel="icon"]').attr('href')
      ].filter((u): u is string => !!u);
      const first = candidates[0];
      if (first) {
        // Resolve relative URLs against the opportunity URL
        logoUrl = new URL(first, opportunityUrl).toString();
      }
    }
  } catch { /* silent fail — null cached */ }

  // Cache result (including null, to prevent re-scraping on every render)
  await db.execute({
    sql: `INSERT INTO opportunity_logos (opportunity_id, logo_url) VALUES (?, ?)
          ON CONFLICT(opportunity_id) DO UPDATE SET logo_url = excluded.logo_url, fetched_at = unixepoch()`,
    args: [opportunityId, logoUrl]
  });
  return logoUrl;
}
```

UI falls back to `<div class="logo-placeholder">{opp.name[0]}</div>` when `logoUrl === null` — a gradient tile with the first letter. Avoids broken-image boxes in the dossier grid.

#### DOCX download

```ts
// app/api/dossier/[runId]/material/[materialType]/docx/route.ts
import { Document, Packer, Paragraph, HeadingLevel } from 'docx';
// GET — renders a .docx for a single material from drafted_packages
// materialType ∈ 'artist_statement' | 'project_proposal' | 'cv' | 'cover_letter'
```

Implementation: fetch the drafted_packages row for the given run_match_id, pull the specific material column, build a Document with a title heading + paragraphs (split on `\n\n`), `Packer.toBuffer(doc)`, return as `Response` with `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

### 4.4 PDF export (`lib/pdf/dossier.tsx`)

```ts
// lib/pdf/dossier.tsx
import { Document, Page, Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: 'Helvetica' },
  coverTitle: { fontSize: 28, marginBottom: 16 },
  coverNarrative: { fontSize: 12, lineHeight: 1.5, marginBottom: 32 },
  h2: { fontSize: 18, marginTop: 24, marginBottom: 12 },
  matchCard: { marginBottom: 24, borderBottom: '1pt solid #ddd', paddingBottom: 16 },
  matchTitle: { fontSize: 14, fontWeight: 'bold' },
  matchMeta: { fontSize: 10, color: '#666', marginBottom: 8 },
  materialBlock: { fontSize: 10, marginTop: 8, lineHeight: 1.4 }
});

export function DossierDocument(props: {
  cover: string;
  ranking: string;
  matches: Array<{ name: string; deadline?: string; award_summary?: string; fit_score: number; composite_score: number | null; reasoning: string; artist_statement?: string; project_proposal?: string; cv_formatted?: string; cover_letter?: string }>;
  filteredOut: Array<{ name: string; filtered_out_blurb: string }>;
}) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.coverTitle}>Career Dossier</Text>
        <Text style={styles.coverNarrative}>{props.cover}</Text>
        <Text style={styles.h2}>Ranked Opportunities</Text>
        <Text style={styles.coverNarrative}>{props.ranking}</Text>
      </Page>
      {props.matches.map((m, i) => (
        <Page key={i} size="LETTER" style={styles.page}>
          <View style={styles.matchCard}>
            <Text style={styles.matchTitle}>{i + 1}. {m.name}</Text>
            <Text style={styles.matchMeta}>
              Deadline: {m.deadline ?? 'rolling'} · Award: {m.award_summary ?? 'see page'} · Fit: {m.fit_score.toFixed(2)} · Composite: {(m.composite_score ?? 0).toFixed(2)}
            </Text>
            <Text style={styles.materialBlock}>{m.reasoning}</Text>
            {m.artist_statement && <><Text style={styles.h2}>Artist Statement</Text><Text style={styles.materialBlock}>{m.artist_statement}</Text></>}
            {m.project_proposal && <><Text style={styles.h2}>Project Proposal</Text><Text style={styles.materialBlock}>{m.project_proposal}</Text></>}
            {m.cover_letter && <><Text style={styles.h2}>Cover Letter</Text><Text style={styles.materialBlock}>{m.cover_letter}</Text></>}
            {m.cv_formatted && <><Text style={styles.h2}>CV</Text><Text style={styles.materialBlock}>{m.cv_formatted}</Text></>}
          </View>
        </Page>
      ))}
      {props.filteredOut.length > 0 && (
        <Page size="LETTER" style={styles.page}>
          <Text style={styles.h2}>Filtered Out</Text>
          {props.filteredOut.map((f, i) => (
            <Text key={i} style={styles.materialBlock}>{f.filtered_out_blurb}</Text>
          ))}
        </Page>
      )}
    </Document>
  );
}
```

- [ ] `app/api/dossier/[runId]/pdf/route.ts`: render-on-demand, not streamed. `@react-pdf/renderer` exposes `renderToBuffer(element)` which returns a `Promise<Buffer>`. Return as `Response` with `Content-Type: application/pdf`.
  ```ts
  import { renderToBuffer } from '@react-pdf/renderer';
  import { DossierDocument } from '@/lib/pdf/dossier';

  export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
    const { runId } = await params;
    const data = await loadDossierData(Number(runId));  // same query as DossierPage above
    const buffer = await renderToBuffer(<DossierDocument {...data} />);
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="atelier-dossier-${runId}.pdf"`
      }
    });
  }
  ```
- [ ] "Download Dossier PDF" button on `/dossier/[runId]` — `<a href="/api/dossier/[runId]/pdf" download>Download PDF</a>`
- [ ] `dossiers.pdf_path` column is UNUSED in v1 (PDF is render-on-demand, not cached). Left in schema for v1.1 when caching to Blob becomes worth the complexity.

### 4.5 Run polling UI

(Was "streaming" — switched to polling per the Vercel orchestration design in the §Long-running run orchestration reference section.)

- [ ] `app/api/runs/[id]/events/route.ts` (GET): pull-on-read pattern — fetch new Anthropic events since cursor, persist, return diff. See §Long-running run orchestration for the implementation pattern. Returns `{events, phase, phaseDone, runStatus, done, errored}`.
- [ ] `app/(dashboard)/runs/[id]/page.tsx` — Run-in-progress UI:
  - `useEffect` polling loop calling `/api/runs/[id]/events` every 3 seconds
  - Renders incoming events into a live activity feed. Event filters:
    - SHOW: `agent.message` (text), `agent.thinking` (collapsible), `agent.custom_tool_use` (as "persisted X"), `session.status_*` transitions
    - HIDE or fold: `agent.tool_use` / `agent.tool_result` for low-level file ops (bash, read, write, edit, glob, grep) — too noisy for the UI. Show web_search / web_fetch though (interesting).
  - Header banner shows `runStatus` in plain English: "Scout searching 40 sources...", "Downloading recipient images...", "Rubric Matcher scoring opportunities...", "Drafting packages...", etc. Maps `runStatus` values to strings.
  - When response includes `done: true` → navigate to `/dossier/[runId]`
  - When response includes `errored: true` → show error with the `runs.error` text + "Retry from last phase" button

#### Demo playback mode

For the demo recording (per spec §Demo strategy, "First Style Analyst pass = live; rest = playback at 10x"):

- [ ] URL param: `/runs/[id]?playback=<run_id>&speed=10`
- [ ] When `playback` param is present, the page does NOT poll the live `/events` endpoint. Instead:
  ```ts
  // app/(dashboard)/runs/[id]/page.tsx — playback mode
  useEffect(() => {
    const url = new URL(window.location.href);
    const playbackRunId = url.searchParams.get('playback');
    const speed = Number(url.searchParams.get('speed') ?? '1');
    if (!playbackRunId) return;  // live mode

    let cancelled = false;
    (async () => {
      const events = await fetch(`/api/runs/${playbackRunId}/events-all`).then(r => r.json());
      // events-all returns rows ordered by id ASC, each carrying _created_at (unix epoch seconds INTEGER from run_events.created_at)
      for (let i = 0; i < events.length; i++) {
        if (cancelled) return;
        const ev = events[i];
        const next = events[i + 1];
        // _created_at is unix epoch SECONDS (integer). Multiply by 1000 to get ms. Apply speed factor.
        const gapMs = next ? Math.max(0, (next._created_at - ev._created_at) * 1000 / speed) : 0;
        dispatchEventToUI(ev);
        await new Promise(r => setTimeout(r, Math.min(gapMs, 5000)));  // cap max gap at 5s so dead air doesn't hang
      }
    })();
    return () => { cancelled = true; };
  }, []);
  ```
- [ ] `app/api/runs/[id]/events-all/route.ts` (GET): returns all run_events rows for a run, ordered by `id ASC`. Used only for playback — does NOT hit Anthropic.
  ```ts
  export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const rows = (await getDb().execute({
      sql: `SELECT event_id, kind, payload_json, created_at FROM run_events WHERE run_id = ? ORDER BY id ASC`,
      args: [Number(id)]
    })).rows.map((r: any) => ({ ...JSON.parse(r.payload_json), _kind: r.kind, _created_at: r.created_at }));
    return Response.json(rows);
  }
  ```
- [ ] Demo recording recipe: (a) do a full real run against John's real data, wait for `complete`; (b) record video on a fresh tab with `?playback=<run_id>&speed=10`; (c) voiceover layered on top in post

### 4.6 Remaining skill files (Package Drafter + extended skill base for §Depth scoring)

(Same provenance model as §1.5: research-mode agent drafts, builder audits. `juror-reading.md` and `aesthetic-vocabulary.md` already landed in §2.13 for the Rubric Matcher — not repeated here.)

**Spec target: 20-30 skill files for §Depth & Execution scoring.** With §1.5's 2 + §2.13's 2 + §4.6's 16 below, we land at **20 total** — meeting the lower bound of the spec target. Each file below is load-bearing (consumed by an agent OR by the dossier render), not count-padding.

#### Drafter-consumed (hard dependency on Phase 4 quality)

- [ ] `artist-statement-voice.md` — anti-patterns + 3-5 worked examples of strong institutional artist statements. Feeds §4.1 `artist_statement` + `cover_letter` prompts.
- [ ] `project-proposal-structure.md` — generic grant-proposal structure (research questions, timeline, budget framing, deliverables, impact) for opportunities whose URL fetch doesn't surface specific requirements. Feeds §4.1 `project_proposal` prompt.
- [ ] `cv-format-by-institution.md` — institution-specific CV format conventions. Minimum coverage: Guggenheim, MacDowell, NEA, Creative Capital. Each entry gives: section order, date formatting, what to include/exclude, length cap. Feeds §4.1 `cv` prompt.
- [ ] `cover-letter-templates.md` — distinct cover-letter shapes by opportunity type (foundation grant / gallery open call / residency / public art commission / museum donation pitch). Feeds §4.1 `cover_letter` prompt — selects template based on `opp.award.type`.
- [ ] `artist-statement-voice-by-medium.md` — voice patterns differ across photography / painting / sculpture / video / installation. Photography lineage references (Frank, Eggleston, Mann) read different from painting lineage references (Marden, Tuymans, Doig). Feeds §4.1 by selecting the medium-specific section based on `akb.practice.primary_medium`.
- [ ] `work-sample-rationale-patterns.md` — how to write the per-image rationale text in the work sample selection (3-5 sentence formula: what the image IS → what it does formally → why this institution will respond). Feeds §4.1 `work_sample_selection` text generation when we expand v1.1.

#### Drafter-consumed (medium-specific application norms)

- [ ] `medium-specific-application-norms.md` — application requirements differ by medium: photographers need print specs + edition info, sculptors need installation diagrams + dimensions, painters need substrate details, video artists need duration + format, installation artists need site requirements. Feeds §4.1 `project_proposal` to ensure the right material info is included.

#### Orchestrator + dossier context (informs ranking narrative + filtered-out blurbs)

- [ ] `submission-calendar.md` — seasonal patterns of when major opportunities open/close (NEA Spring window, Guggenheim Sep deadline, MacDowell Apr/Sep windows, etc.). Informs the `ranking_narrative` ("prioritize X now, Y dormant until Sept").
- [ ] `timeline-by-opportunity-type.md` — typical decision-to-result timelines. NEA: 8 months. MacDowell: 4 months. Yaddo: 3 months. Magnum: 6 months. Lets the dossier flag "this needs prep TODAY" vs "decide in Q3". Used in `composite_score` urgency tier override and ranking narrative.
- [ ] `cost-vs-prestige-tiers.md` — entry-fee-vs-signal heuristics. Used by user-facing copy on the Run Config page ("spending $40 on Opportunity X is a pay-to-play trap; redirect toward Y").
- [ ] `regional-arts-economies.md` — what each US region offers. NYSCA / Texas Commission / Illinois Arts Council / California Arts Council each have distinct programs + eligibility quirks. Informs ranking narrative when AKB.identity.home_base hits a region with strong local funding.
- [ ] `gallery-tier-taxonomy.md` — primary vs secondary market, blue-chip vs mid-career galleries, what each represents and how an artist gets through their door. Feeds the Gallery Targeter (§3.5) interpretation of `roster_url` data.
- [ ] `museum-acquisition-pathways.md` — how works enter museum collections (purchase committees, donations, direct curatorial picks, residency-to-acquisition pipelines). Informs `museum_acquisition_signals` in the StyleFingerprint AND the cover narrative when AKB.intent.aspirations mentions museum acquisition.

#### Knowledge Extractor side

- [ ] `interview-question-templates.md` — by AKB field. For `process_description`: "Walk me through making one piece, start to finish." For `intent.statement`: "If a curator asked you what your work is about in one sentence, what would you say?" For `bodies_of_work`: "What's the through-line connecting your last 3 series?" Feeds §2.7 interview prompt.
- [ ] `akb-disambiguation-patterns.md` — same-name disambiguation playbook for the auto-discover (§2.12). Standard tells: medium mismatch (photographer vs musician), location mismatch, era mismatch (active 1980s vs active now). Feeds §2.12 system prompt.

#### Aesthetic / lineage extension (Rubric Matcher + Style Analyst)

- [ ] `photography-specific-lineages.md` — extends `aesthetic-vocabulary.md` with granular photographic lineages (Becher school, color landscape, New Topographics, street, portrait, documentary social practice, photojournalism, fashion-art crossover). Loaded into Style Analyst + Rubric Matcher when `akb.practice.primary_medium` includes "photography".

#### Operational / mechanics

- [ ] `past-winner-archives.md` — per-opportunity scraping mechanics where institutions publish past recipient lists. URL patterns, pagination handling, recipient-bio link patterns. Cuts Scout's discovery time for known sources.

**Quality gate for §4.6:** at least 500 words per Drafter-consumed file (the first 7 above); at least 300 words per Orchestrator-context file (next 6); at least 200 words per Extractor + Operational file (last 3). Total 16 new files. Combined with §1.5 (2) + §2.13 (2) = **20 skill files total** for the repo, hitting the spec's lower bound. Stretch to 25-30 by adding per-major-prize deep-dives (`guggenheim-fellowship-deep.md`, `nea-grant-deep.md`, etc.) as time permits.

### Acceptance gate — Phase 4
1. End-to-end run from John's AKB produces a dossier with ≥10 opportunities + drafted materials
2. PDF exports cleanly, prints legibly
3. John reads at least one drafted artist statement and confirms it's better than what he'd write
4. **≥20 skill files committed** (§1.5's 2 + §2.13's 2 + §4.6's 16), each passing the per-file word-count quality gate, each real lived knowledge not LLM filler. Stretch target: 25-30 via per-major-prize deep-dives

---

## Phase 5 — Submission

**Goal:** Clean recorded demo + submitted package.

### 5.1 Pre-flight

- [ ] Run `scripts/setup-managed-agents.ts` against the Anthropic prod API; capture the resulting `ATELIER_ENV_ID`, `SCOUT_AGENT_ID`, `RUBRIC_AGENT_ID` into Vercel env vars (Production + Preview + Development)

- [ ] **Disable Vercel Deployment Protection** (Project Settings → Deployment Protection → off) so hackathon judges hitting the prod URL see the app, NOT a Vercel auth page. This is non-negotiable for the submission. Confirm by loading the prod URL in an incognito window with no Vercel account logged in.

- [ ] **Database reset script** — `scripts/reset-db.ts` for the clean-run test. Script MUST have a hard guardrail or it can nuke production data. Single-tenant hackathon means prod URL and local URL BOTH contain "atelier" (substring check is defeated). Use a dedicated env-var opt-in that ONLY the local `.env.local` sets:

  ```ts
  // scripts/reset-db.ts
  import { createClient } from '@libsql/client';

  async function main() {
    // PRIMARY GUARDRAIL: explicit opt-in env var. Set ATELIER_IS_RESETTABLE_DB=true ONLY in your
    // local .env.local. NEVER set this in Vercel's Production env vars. If accidentally set in
    // Vercel + you run this script with the prod TURSO_DATABASE_URL = data loss.
    if (process.env.ATELIER_IS_RESETTABLE_DB !== 'true') {
      console.error('Refusing to reset: ATELIER_IS_RESETTABLE_DB is not set to "true".');
      console.error('This guard is ONLY set in your local .env.local — NEVER in Vercel.');
      console.error('If you are SURE you want to reset this DB, edit .env.local to add:');
      console.error('  ATELIER_IS_RESETTABLE_DB=true');
      process.exit(1);
    }

    // BELT-AND-SUSPENDERS: confirmation flag on argv
    const confirmArg = process.argv[2];
    if (confirmArg !== '--yes-reset-everything') {
      console.error('Pass --yes-reset-everything to confirm. This DROPS all tables.');
      process.exit(1);
    }

    // Bonus: log the URL host (not the token) so the operator sees what they're about to nuke
    const url = process.env.TURSO_DATABASE_URL!;
    const host = new URL(url.replace(/^libsql:/, 'https:')).host;
    console.log(`About to drop all tables on Turso DB at: ${host}`);
    console.log('Proceeding in 3 seconds — Ctrl-C to abort.');
    await new Promise(r => setTimeout(r, 3000));

    const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
    const tables = (await db.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)).rows.map((r: any) => r.name);
    for (const t of tables) await db.execute(`DROP TABLE IF EXISTS ${t}`);
    console.log(`Dropped ${tables.length} tables.`);
  }
  main().catch(e => { console.error(e); process.exit(1); });
  ```

  Setup:
  - Add `ATELIER_IS_RESETTABLE_DB=true` to your LOCAL `.env.local` only
  - DO NOT add this var to Vercel's Production env vars (verify in Vercel dashboard)
  - Add `ATELIER_IS_RESETTABLE_DB` to `.env.example` with comment: `# Set to "true" ONLY in local .env.local. NEVER set in Vercel Production.`

  Run: `pnpm tsx scripts/reset-db.ts --yes-reset-everything`. On next server boot, `runMigrations()` rebuilds everything fresh.

  **For full safety post-hackathon:** provision a second Turso DB (`atelier-dev` or similar) and point local `.env.local` at it. Then prod and dev URLs are physically separate. Single-DB acceptable for hackathon since cost of accidental wipe is "rerun the demo data ingest once," not "lost user data."

- [ ] **Clean-run test** (after reset): upload portfolio → run Style Analyst → Knowledge Extractor (auto-discover + interview + review) → start a full run → wait for dossier → download PDF. The full path must work on a fresh DB with no manual DB poking.

- [ ] All 6 agent activities observable in the run polling UI (Scout, finalize-scout, start-rubric, Rubric, Orchestrator, Package Drafter)

- [ ] No hardcoded test data anywhere; all real

- [ ] `pnpm build` clean; no TS errors

- [ ] **Browser DevTools console check:** open the prod URL in a fresh incognito window with DevTools open. Walk the full user path (upload → analyze → interview → review → run → dossier). Assert zero uncaught errors in the console. Network tab shows no failed requests beyond expected (e.g., an opportunity_logos fetch that 404s is OK — we handle that).

- [ ] **All §3.7 smoke tests pass** (`pnpm test`); integration tests pass at least once (`pnpm test:integration`); one full e2e runs clean (`pnpm test:e2e`)

### 5.1.a Pre-demo polish batch (MUST ship before §5.2 recording)

**Why this section exists:** the clean-run test in §5.1 surfaced 11 real issues — 2 bugs and 9 UX gaps — that a judge will hit the moment they touch the deploy. These are NOT bandaids. Each is a real product issue that affects every user, not just the demo. This section documents every issue, its root cause, the fix, and the acceptance criteria, so the coder has a single canonical hand-off and the hackathon record has evidence of discipline.

**Order of work:** user-flow order. Fix one flow completely (bug + UX in that flow) before moving on. Retest the whole flow after each group lands. No partial merges.

---

#### Group A — Entry & Runs management

**Fix A1 — `/runs` page is a stub** (task #20)
- **Broken:** `app/(dashboard)/runs/page.tsx` renders a placeholder with no run list and no way to start a new run. Judge lands here after a first run and has nothing to do.
- **Fix:** Render the user's run list (newest first) with: run_id, status badge (`running` / `complete` / `errored`), started_at (relative), top-line counts (`N discovered / M scored / K included`). Include a prominent "New Run" button that routes to a new `/runs/new` page (Fix A2). Link each row to its dossier or status page per current status.
- **Files:** `app/(dashboard)/runs/page.tsx`, new `app/(dashboard)/runs/new/page.tsx`, new `lib/db/queries/runs.ts` helper `listRunsForUser(userId)`.
- **Acceptance:** after a fresh run completes, judge navigates to `/runs` and sees the completed run with a link to its dossier AND a "New Run" button. Clicking the button takes them to a page where they can start another run. No placeholder text.

**Fix A2 — Re-run cadence guidance + visible path to start another run** (task #22)
- **Broken:** there is no page or prompt telling the user when to run Atelier again or how to start the next run. After the first dossier, the product looks done forever.
- **Fix:** new `app/(dashboard)/runs/new/page.tsx` that:
  1. Shows guidance copy: "Atelier surfaces new opportunities as they open. Re-run every 2–4 weeks, or when you update your portfolio / AKB."
  2. Lists what the run will use: current StyleFingerprint (with last-updated date), current AKB version, portfolio image count.
  3. Has a single "Start New Run" button that POSTs to `/api/runs` and redirects to the status page.
- **Files:** new `app/(dashboard)/runs/new/page.tsx`.
- **Acceptance:** from `/runs` the "New Run" button lands here; copy reads naturally to a non-technical user; one click starts a run and navigates to its status page.

**Fix A3 — Favicon 404** (task #21)
- **Broken:** `/favicon.ico` 404s on every page load; console noise.
- **Fix:** add `app/favicon.ico` (or `public/favicon.ico` per Next.js 15 App Router convention — App Router prefers the `app/` location). Use a simple monochrome mark, not a placeholder. If no brand mark exists, use a neutral "A" glyph.
- **Files:** `app/favicon.ico`.
- **Acceptance:** fresh incognito load of any page shows no favicon 404 in Network tab, and a visible favicon in the browser tab.

---

#### Group B — Upload → Style Analyst flow

**Fix B1 — No progress indicator during Style Analyst** (task #8)
- **Broken:** after upload, the user clicks "Analyze" and the vision call takes 30–90s with no visible feedback. Looks frozen.
- **Fix:** show a progress state on the Style Analyst page with:
  1. Spinner + copy "Analyzing your portfolio…"
  2. Live status line that updates as the call progresses (at minimum: "Reading N images…" → "Identifying aesthetic lineage…" → "Writing fingerprint…"). Status can come from intermediate API writes or a simple staged timer if real progress isn't available.
  3. Disable the Analyze button while running.
- **Files:** wherever the Style Analyst UI lives (likely `app/(onboarding)/style-analyst/page.tsx` or `app/(onboarding)/upload/page.tsx`).
- **Acceptance:** clicking Analyze immediately shows the progress state; user never sees a frozen screen.

**Fix B2 — Render StyleFingerprint as designed view, not JSON** (task #10)
- **Broken:** completed StyleFingerprint is shown as a raw JSON dump. Non-technical user can't read it.
- **Fix:** render as a polished card view:
  - **Lineage** (with names pulled from the fingerprint, comma-separated)
  - **Register** (prose sentence)
  - **Palette** (prose + optional color swatches if hex values present)
  - **Crop / format** (prose)
  - **Subject** (prose)
  - **Anti-references** (if present) styled as a distinct block
  - "View raw" disclosure at the bottom for the curious / for audit, NOT as default
- **Files:** wherever the Style Analyst result view lives; likely a new `components/StyleFingerprintCard.tsx`.
- **Acceptance:** after Style Analyst completes, user sees the polished card; JSON is hidden behind a "View raw" toggle.

**Fix B3 — Post-Style-Analyst next-step CTA** (task #9)
- **Broken:** after the fingerprint renders, the user has no visible next step. They don't know to go build their Knowledge Base.
- **Fix:** primary CTA at the bottom of the fingerprint card: "Next: Build your Knowledge Base" linking to `/interview` (or `/auto-discover` if that's the new entry). Include a one-sentence explainer: "We'll research your public record — shows, publications, residencies — so we can match you to the right opportunities."
- **Files:** same as Fix B2.
- **Acceptance:** user can complete upload → analyze → navigate to interview without touching the URL bar or guessing.

---

#### Group C — Auto-discover + Knowledge Extractor flow

**Fix C1 — Auto-discover ingest route returns 200 but never writes `akb_versions`** (task #17, BUG)
- **Broken:** `/api/akb/auto-discover` (or whatever the route is) fires, returns 200 in ~43s, but no new `akb_versions` row is written. v1 of AKB ends up with only the legal_name from the interview's first turn. Cost is incurred (~$0.50–1 per call) with zero persisted result.
- **Root cause:** unknown — needs debugging. Likely candidates: the agent session returns but the ingest handler's DB write path is broken, errors silently, or the response shape the handler expects doesn't match what the agent returns. Check if the handler is awaiting the write, if there's a silent catch, and if the akb_versions INSERT is actually firing.
- **Fix:** trace the route end-to-end. Add explicit error logging at the write step. Confirm the ingest agent's output is being parsed into the AKB merge format expected by `mergeAkbPartial`. Verify a new `akb_versions` row is written with the discovered facts. Include the writeback in a transaction if not already.
- **Files:** `app/api/akb/auto-discover/route.ts` (or equivalent), `lib/agents/knowledge-extractor.ts`, `lib/db/queries/akb.ts`.
- **Acceptance:** run the flow, confirm a new `akb_versions` row exists after the 200 response, confirm the row contains the discovered facts (affiliations, publications, residencies, exhibitions), confirm the UI reflects these facts without a manual re-fetch. Write a smoke test in `tests/integration/auto-discover.test.ts` that asserts the row is written.

**Fix C2 — Scraper review UI shows log dump, not thumbnails** (task #12)
- **Broken:** after auto-discover runs, the review screen shows a log of URLs and fetch results, not the actual images that were discovered. User can't evaluate what to keep.
- **Fix:** render discovered images as a thumbnail grid. Each thumbnail shows:
  - image
  - source URL (truncated, with hover for full)
  - source archetype if known (portfolio / publication / social)
  - accept / reject toggle
- Support bulk accept / reject. Persist the user's selections so they feed into the portfolio for Style Analyst re-analysis.
- **Files:** whichever page hosts the auto-discover review UI; likely `app/(onboarding)/auto-discover/review/page.tsx` or similar.
- **Acceptance:** user sees actual thumbnails, can accept/reject each or in bulk, selections persist to the portfolio table.

---

#### Group D — Interview flow

**Fix D1 — Interview page state + clarity after auto-discover** (task #15)
- **Broken:** after auto-discover, the Interview page doesn't tell the user what it's doing. Is it running? Waiting? Done? No state indicator.
- **Fix:** the Interview page has three visible states that are always obvious:
  1. **Idle / ready** — "Your Knowledge Base has N facts. Click Start Interview to fill gaps."
  2. **In progress** — "Interview running…" with spinner and current question visible. Disable other controls.
  3. **Complete** — "Interview complete. M new facts added." with CTA to review or proceed.
- Include a visible progress indicator (N of M questions answered) if the interview has a known question count; otherwise a live question counter.
- **Files:** `app/(onboarding)/interview/page.tsx`.
- **Acceptance:** at every point during the flow, the user knows what state the interview is in and what their next action is.

**Fix D2 — Hide internal field paths from Interview UI** (task #16)
- **Broken:** questions display as `identity.citizenship → What's your full legal name?` leaking the internal AKB schema path. Confusing and unprofessional.
- **Fix:** show only the question text. Also verify the target/question match — the bug report notes that the target field (`identity.citizenship`) doesn't always match the asked question ("What's your full legal name?"). This is a real logic bug, not just a display issue. Audit the gap-detection + question-generation pipeline so the target field always matches the question being asked.
- **Files:** `app/(onboarding)/interview/page.tsx`, `lib/agents/extractor-gaps.ts`, `lib/agents/knowledge-extractor.ts` (wherever questions are generated).
- **Acceptance:** the user never sees dot-path field references in the UI. Every question's target field matches the content of the question. Add a unit test that asserts `generatedQuestion.targetField` is about the same concept as `generatedQuestion.questionText` for a sample of 10 gap targets.

---

#### Group E — Review flow (`/review`)

**Fix E1 — Controlled/uncontrolled input warning** (task #19, BUG)
- **Broken:** editing fields on `/review` logs `A component is changing an uncontrolled input to be controlled` to the console. Classic React bug: initial value is `undefined`, then becomes a string after first edit.
- **Fix:** root-cause the initial state. Every input must have a defined initial value (empty string `""`, not `undefined`). If the underlying AKB field is optional, normalize to `""` at the form-state layer, and only convert `""` back to `undefined` (or omit) at submit time. Don't use `value={field ?? ""}` as a bandaid — fix the state initialization upstream.
- **Files:** `app/(onboarding)/review/page.tsx`, plus whatever form-state layer feeds it.
- **Acceptance:** editing every field on `/review` produces zero React console warnings.

---

#### Group F — Post-interview → runs flow

**Fix F1 — Post-interview completion CTA + "AKB" jargon** (task #18)
- **Broken:** after completing the interview, the user sees a completion screen that references "AKB" and has no clear next step. User doesn't know what "AKB" is or what to do next.
- **Fix:**
  1. Rename every user-facing "AKB" reference to "Knowledge Base". Internal schema / code can keep `akb_` prefix; UI strings must never use the acronym.
  2. After the interview completes, show: "Knowledge Base complete — N facts across M categories." with a primary CTA: "Review & Start Your First Run" linking to `/review` (or to `/runs/new` if the review is optional).
- **Files:** `app/(onboarding)/interview/page.tsx`, `app/(onboarding)/review/page.tsx`, any other user-facing view referencing "AKB". Grep for `AKB` in `app/`, `components/`, and any string literal in `lib/` that's rendered to the UI.
- **Acceptance:** grep of all files rendered to users shows no "AKB" string. Completion screen has a clear next-step CTA that gets the user to their first run.

---

#### Acceptance gate — §5.1.a

- [ ] All 11 fixes merged to main
- [ ] Full clean-run test (from §5.1) passes with zero regressions
- [ ] Fresh incognito prod walk-through (upload → analyze → auto-discover → review discovered images → interview → review AKB → start run → dossier) produces zero uncaught console errors, zero leaked internal strings ("AKB", dot-paths), and a continuous set of next-step CTAs — the user never hits a dead end
- [ ] Every item above logged in `BUILD_LOG.md` with commit SHAs and the specific bug/gap → fix narrative

### 5.2 Demo recording

- [ ] **Record setup:** ScreenFlow (macOS, paid but best for post-production) OR QuickTime (free, simpler) OR OBS Studio (free, more flexible). Recommend ScreenFlow if available — the 10x playback compression is critical and ScreenFlow's clip-speed controls are cleanest. Retina display at native resolution; browser window at 1440×900 for a clean 1080p crop.
- [ ] **Voiceover:** record SEPARATE from screen capture. Do a first pass of the screen activity, then record voice against playback in editing. This lets you retake voice without rerecording the demo.
- [ ] **Pre-run the full pipeline morning of recording.** Use John's real data. Save the `run_id`.
- [ ] **Record per shot-list (3 min total; UPDATED post-§3.6 with actual run data — spec's original Magnum/Critical-Mass pivot is superseded by the stronger Guggenheim-rejection + Nevada-acceptance bookends):**
  - 0:00–0:15 cold open (black screen quote from spec, cut to John in gallery)
  - 0:15–0:45 identity + stakes (builder on camera, cut to laptop)
  - 0:45–1:15 Style Analyst fires — LIVE recording of first Style Analyst pass (real, no playback). Voiceover reads Claude's actual output naming Peter Lik / Trey Ratcliff lineage
  - 1:15–1:45 Knowledge Extractor — builder on camera + auto-discover mode (§2.12) discovering his 17 URLs from name + affiliations
  - 1:45–2:15 **Opportunity Scout + Rubric Matcher** — 10x playback via `/runs/[id]?playback=<run_id>&speed=10`. **The demo-spine moment: builder asks "why shouldn't I apply to Guggenheim Photography?" Rubric responds with 0.04 fit, citing Tarrah Krajnak + Matthew Brandt + Dylan Hausthor (actual 2024 Fellows verified on gf.org) as the cohort register, naming Knopf's portfolio as the precise Section-1 anti-reference.** Hold a beat on that reasoning text.
  - 2:15–2:30 **The right-room flip.** Cut to the same run's top included match — Nevada Arts Council Artist Fellowship 0.58. Voiceover reads that reasoning: "Knopf's Las Vegas residency, two-gallery representation, NatGeo/TIME publication record are precisely the career-stage markers NAC panels reward." Pause on the score.
  - 2:30–2:50 Package Drafter — builder reads the drafted artist statement for Nevada Arts Council on camera, visible reaction
  - 2:50–3:00 kicker line + end card with GitHub link

  **The narrative shift from spec:** the system does not flatter. It named the builder's work as Peter-Lik-register and refused Guggenheim/MacDowell/Critical Mass. THEN it surfaced the right fit — the regional state fellowship nobody predicted. That's a harder, more honest product claim than the spec's original "just redirect to a better-fit photography prize." The Rubric Matcher's value is telling you truth your own aspirations are obscuring.
- [ ] **Single take of kicker line.** Emotional honesty over polish per the spec.
- [ ] Export at 1080p H.264 MP4, max file size per submission platform requirements.

### 5.3 README + submission

- [ ] **README.md** — create at repo root (if not present) with these sections in order:

  ```markdown
  # Atelier

  AI art director for working visual artists. Upload your portfolio, build an
  Artist Knowledge Base from public web data, and get a ranked Career Dossier
  with draft submission materials for the grants, residencies, competitions,
  and galleries that actually fit your aesthetic.

  **Built for the "Built with Opus 4.7" hackathon (Apr 2026).**
  **Submission focus:** Problem Statement #1 — Build From What You Know.

  ## What it does
  <one paragraph: six specialist agents, Claude Managed Agents, skills-as-knowledge>

  ## Demo video
  <youtube/vimeo unlisted link — DO NOT forget this>

  ## Prior work
  Atelier builds on rapid-prototype experience from [Project Athena](link) —
  a 33k-line prediction-market pipeline shipped in ~2 days. Same velocity model
  applied to the visual-arts-application problem.

  ## Architecture
  <one short paragraph + link to ATELIER_BUILD_PLAN.md>

  ## Setup (local)
  ```bash
  git clone https://github.com/johnkf5-ops/Atelier.git
  cd Atelier
  pnpm install
  cp .env.example .env.local    # fill in ANTHROPIC_API_KEY, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, BLOB_READ_WRITE_TOKEN
  pnpm tsx scripts/setup-managed-agents.ts   # one-time — creates Scout + Rubric agents, prints IDs to add to .env.local
  pnpm dev
  # open http://localhost:3000/upload
  ```
  ## Skills (the moat)
  See [skills/](./skills) — 10+ hand-audited lived-knowledge files codifying
  the visual-arts submission economy. Each file is inspectable.

  ## Testing
  See [TESTING.md](./TESTING.md) — smoke / integration / e2e test categories
  + what each verifies.
  ```

- [ ] **Written summary (180 words)** — pull from spec §Written summary verbatim. Save as `SUMMARY.md` at repo root so reviewers can find it without reading the README.

- [ ] **`BUILD_LOG.md`** — chronological narrative of what actually happened during the build. This is the "wrestling with it" signal for §Depth & Execution scoring, delivered as prose rather than git history. Written as the LAST pre-submission artifact (source material is already in the checkpoint reports this conversation generated). Format — one entry per checkpoint, 2-4 sentences each:

  ```markdown
  # Atelier — Build Log

  Chronological record of the build. Each entry is a checkpoint moment: what
  happened, what broke, what we changed. Shows the iteration that the clean
  final codebase hides.

  ## Phase 1 — Foundation (~40 min)
  Acceptance gate green in 8 min of code-writing. The actual wall was
  credential setup — Turso signup, Vercel Blob provisioning, Vercel project
  linking, mirroring env vars into Production + Preview + Development.
  Learned: the bet was "Phase 1 in 20 min"; reality was ~40 min because
  signups are clicks not code. (coffee lost)

  ## Phase 2.12 ship — auto-discover mode (~1 hour)
  Shipped with 5 deviations from the spec:
  - web_search_20260209 → web_search_20250305 because code_execution_20260120
    was unavailable on our org
  - JSON Schema sanitizer added (Anthropic rejects minimum/maximum/minItems/
    maxItems/format on zod-derived schemas)
  - Event shape: web_search.input.query arrives in content_block_start, not
    via input_json_delta deltas
  - Merge robustness: filter incomplete LLM-extracted array items before insert
  - run_events.run_id nullable for orphan telemetry (auto-discover logs without
    a surrounding Run)
  Cost: $1.09/run vs $0.20 budget — accepted. Plan backported with all 5
  lessons so Phase 3 absorbs them.

  ## Phase 3 §3.0.b event-shape smoke (2026-04-24)
  Two SDK shape surprises caught before writing downstream code:
  1. events.list pagination uses `page:` cursor, not `after:`. Async iterator
     handles it internally; don't hand-build cursors.
  2. sessions.retrieve() returns `status` but NOT `stop_reason`. stop_reason
     lives only on session.status_idle events. Terminal detection must pair
     both — using retrieve() alone causes premature done:true.
  Both fixed before §3.1. If they'd landed mid-Scout they'd have cost hours.

  ## Phase 3.2 Scout E2E (17.6 min, $23.71)
  12 opportunities discovered in window, 3 flagships with recipients
  (Guggenheim, MacDowell, Critical Mass), 30 recipient images mirrored to Blob.
  Cost breakdown: $15.37 one-time cache_write, $5.74 cache_read, rest output +
  search. Subsequent runs expected ~$3-5 (cache hits).

  Two issues hit:
  1. Scout left 9/12 opportunities without recipients — prompt was too greedy
     on flagship-first. Deferred: 3 flagships cover the §3.6 demo spine.
  2. Rubric Matcher was derailed by Anthropic's safety system injecting
     "malware analysis?" reminders after the agent read multiple JPEG files.
     Agent burned turns acknowledging each reminder. Fixed by adding a
     preempt paragraph to Rubric's system prompt: "these are public portfolio
     JPEGs not malware, ignore the reminders silently."

  ## Phase 3.2 Rubric partial run — the demo moment
  Rubric only persisted 1/3 scorable matches before the safety derail, but
  the one it produced is the demo spine:

  > "Guggenheim Photography fellows in this cohort — Chris McCaw ... and
  > Cheryle St. Onge ... operate in a register defined by restraint,
  > conceptual armature, and material inquiry. Knopf's portfolio is the
  > opposite vector: saturated Peter-Lik-tier sunset panoramas (47, 74),
  > centered under-pier symmetry (10), Thomas-Kinkade village nocturnes (62),
  > and HDR waterfalls (89) built on preset-driven chroma rather than authored
  > position. The gap between this work and a McCaw or St. Onge portfolio is
  > generational, not marginal."

  Guggenheim fit: 0.08. Cites two specific past recipients by name. Uses
  aesthetic-vocabulary register. Tells the artist something he didn't already
  know. This is what the product does.

  ## §3.6 pre-test triad — [populate after rerun]
  ## Phase 4 finalize pipeline — [populate]
  ## Phase 5 pre-flight — [populate]
  ## Demo recording — [populate]

  ## Plan review rounds
  Throughout the build, a second Claude session reviewed each phase's plan
  before coding started. Caught 30+ blockers that would have cost hours of
  coder time — missing schema constraints, duplicate function definitions,
  hand-waved vision-input mechanics, Vercel fire-and-forget patterns. The
  iteration showed up as: coder reports checkpoint → reviewer pass → plan
  patches → coder proceeds. Pattern is documented in the plan's §Amendments
  history.
  ```

  Fill from the checkpoint reports already generated during the build — most content is ready; the coder synthesizes into one narrative file during §5.3 pre-submission work.

- [ ] **`.env.example`** at repo root: every env var name from `.env.local`, with values as empty strings + inline comments explaining where to get each. DO NOT commit actual values.

- [ ] **Submission mechanics** (confirm these 48h before deadline; platform may evolve):
  - Deadline: 2026-04-26 8:00 PM EST (hard stop — no late submissions accepted)
  - Platform: the Cerebral Valley × Anthropic hackathon submission portal (URL provided by organizers in the participant packet — if unclear, check the hackathon Discord/Slack)
  - Required submission fields (typical — verify against the actual portal):
    - Project name (final: "Atelier" unless renamed)
    - Team / solo builder (solo, John Knopf)
    - GitHub repo URL: https://github.com/johnkf5-ops/Atelier
    - Live demo URL: the Vercel production URL (Deployment Protection OFF per §5.1)
    - Demo video URL: YouTube unlisted OR Vimeo unlisted (both work; YouTube preferred for reviewer familiarity). Upload ~24h before submission so the URL is stable.
    - Written summary: paste from SUMMARY.md
    - Problem Statement selection: #1 "Build From What You Know"
    - Prize category targets: Most Creative Opus 4.7 Exploration, Best Use of Claude Managed Agents, Keep Thinking (per spec §Side-prize fit)
  - After submission: confirm confirmation email received. Screenshot the submission page as backup evidence.

### Acceptance gate — Phase 5

1. Repo clones + boots clean on a machine that has never seen it (run §5.3 setup steps against a new laptop / fresh clone; dev server comes up green)
2. Vercel Deployment Protection is OFF; prod URL opens for unauthenticated visitors
3. Demo video uploaded to YouTube/Vimeo with unlisted visibility
4. README + SUMMARY.md + .env.example + TESTING.md all committed
5. Submission platform confirmation received; deadline hit with ≥2h buffer

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
   - **Important:** Phase 2 modules (`lib/agents/style-analyst.ts`, `lib/agents/knowledge-extractor.ts`, etc.) currently construct `new Anthropic({ apiKey: getAnthropicKey() })` at MODULE TOP LEVEL. This caches the key at import time. For Path B, refactor each agent module to construct the client inside the request handler instead (so per-request user keys flow through). About 30 min of mechanical edits across the agent files. Flag for the Path B PR.
3. **Quotas + abuse prevention:** rate-limit run starts per user (e.g., 5 runs/day on free tier). **~quarter day.**

**Estimated scope: ~1.5-2 days post-hackathon** (added 30min for the module-level client refactor in #2). Agent logic, schema, blob store, and DB are all unchanged.

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

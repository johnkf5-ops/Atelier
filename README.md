# Atelier

An AI art director for working visual artists. Upload your portfolio, build a Knowledge Base from public web data and a short interview, and get a Career Dossier with ranked grant / residency / competition / gallery opportunities and submission-ready application materials.

[![Built with Claude Opus 4.7](https://img.shields.io/badge/Built%20with-Claude%20Opus%204.7-d97706)](https://platform.claude.com/docs/en/about-claude/models/overview)
[![Hackathon entry](https://img.shields.io/badge/Built%20with%20Opus%204.7-Hackathon%20entry-1f2937)](https://cerebralvalley.ai/events/~/e/built-with-4-7-hackathon)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#license)

---

## What it is

Every working visual artist in the United States spends roughly thirty percent of their working time on applications — grants, residencies, competitions, gallery submissions, public-art commissions — and most of those applications go to opportunities they were never going to win. Discovery is scattered across forty-plus aggregators and foundation websites. Fit is opaque: artists apply blind to programs whose past recipients worked in completely different aesthetic territory. And every package needs a tailored statement, proposal, CV, cover letter, and work-sample selection — six to ten hours per submission, even with templates. The same artist can spend forty hours preparing an application for a program they had a three-percent chance of winning.

Atelier is the tool that removes the writing wall. It reads your portfolio with vision, ingests your public record, interviews you to fill the gaps, then runs a long synchronous pipeline that scouts current open calls, scores each one for aesthetic fit against past recipients, drops the bad fits with specific reasoning, and drafts the materials for the ones that remain in the institutional voice each opportunity expects. The artifact at the end is a Career Dossier — printable PDF and web view — that names what to apply to, what to skip, and why.

It is built for mid-career US visual artists with an established body of work and intent to pursue institutional opportunities. The builder is the prototypical user.

## Demo

- [Live deploy](https://atelier-hazel.vercel.app)
- [Demo video](TBD)

## Built for

[Cerebral Valley × Anthropic — Built with Opus 4.7](https://cerebralvalley.ai/events/~/e/built-with-4-7-hackathon). Submission deadline 2026-04-26 8:00 PM EST. Targets Problem Statement #1, "Build From What You Know" — the builder is a working photographer building for working photographers.

## How it works

A single user run is a long synchronous pipeline. Six specialist agents move in dependency order; the orchestrator synthesizes the output into the Career Dossier.

```
   onboarding (one-time, durable)            run pipeline (10–30 min, repeatable)
   ─────────────────────────────             ─────────────────────────────────────

   Portfolio upload                          Opportunity Scout  ── Managed Agent
        │                                            │
        ▼                                            ▼
   Style Analyst         ──┐                  Rubric Matcher    ── Managed Agent
   (Opus vision)           │                         │
        │                  │                         ▼
        ▼                  │                  Package Drafter
   Knowledge Extractor   ──┤                         │
   (URL ingest +           │                         ▼
    interview +            │                   Orchestrator
    gap detection)         │                         │
        │                  │                         ▼
        ▼                  │                   Career Dossier
   Artist Knowledge       ─┘                   (web + PDF)
   Base (AKB)
```

- **Style Analyst** — Opus 4.7 vision over the full portfolio. Produces a structured aesthetic fingerprint: composition, palette, subject, light, formal lineage, career-positioning read. Direct SDK call.
- **Knowledge Extractor** — Builds the Artist Knowledge Base by ingesting URLs the artist provides (personal site, gallery bios, press mentions), then interviewing them via text to fill gaps the ingestion missed. Direct SDK call. Versioned and durable across runs.
- **Opportunity Scout** *(Managed Agent)* — Searches twenty-plus curated source archetypes for current open calls in the artist's window. Runs long; uses `agent_toolset_20260401` (web_search, web_fetch, bash, read).
- **Rubric Matcher** *(Managed Agent)* — For each candidate opportunity, fetches past recipients, downloads their portfolio images to the Anthropic Files API, mounts them as session resources, and scores the artist's portfolio fit against the cohort. Produces a fit score, reasoning, and supporting / weakening images per match.
- **Package Drafter** — For matched opportunities, drafts artist statement, project proposal, CV, and cover letter in the institutional voice each program expects. Pulls facts exclusively from the AKB. Direct SDK call.
- **Orchestrator** — Synthesizes specialist outputs into the final ranked Dossier. Writes the "why this ranking" narrative and the "why not these others" filtered-out reasoning.

The two Managed Agent surfaces (Scout, Rubric) run on Anthropic's hosted orchestration layer. Our Vercel routes kick off the session and poll for events; the long agent loop survives Vercel's 60-second function timeout because no long-lived connection lives on our infrastructure.

## Architecture summary

- **App framework:** Next.js 15 (App Router) + React 19 + TypeScript
- **UI:** Tailwind v4
- **Persistence:** Turso (LibSQL — open-source SQLite over the network) via `@libsql/client`. Single DB from day one — no local file, no migration step
- **Blob storage:** Vercel Blob via `@vercel/blob` for portfolio images and recipient cohort thumbnails
- **LLM surface:** `@anthropic-ai/sdk` for direct specialist calls; Managed Agents beta (`managed-agents-2026-04-01`) for Scout and Rubric Matcher
- **Files API:** Anthropic Files API for past-recipient images mounted as Managed Agent session resources
- **PDF export:** `@react-pdf/renderer`
- **Validation:** `zod` (pinned to v3 — schemas use `.deepPartial()`)
- **Image preprocessing:** `sharp`, EXIF read via `exifr`
- **Deploy:** Vercel for the entire app — no Cloud Run, no separate worker
- **Model:** `claude-opus-4-7` everywhere, with adaptive thinking

Detailed architecture, including the run lifecycle, Managed Agent session shape, and AKB merge semantics, lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Two novel primitives

These are the contributions that distinguish Atelier from a chat-with-your-portfolio prototype.

### 1. Knowledge Extractor — durable structured artist knowledge from public web data plus interview

Most working artists are not very googlable, and most cannot write well about their own work. The Extractor solves both. It runs a search → rank → top-K → fetch pipeline against URLs the artist seeds and against discovered references, with a snippet-fallback for JS-rendered pages and bot-blocked sources. Every fact written to the AKB carries a `source_url`, an `extracted_quote`, and an identity-anchor check — the same name belonging to a different person never enters the record. Then a gap-detection pass identifies which AKB fields are still empty and runs a structured text interview targeted at exactly those gaps. The output is a versioned Artist Knowledge Base — a durable user asset reusable across every future run. See [`lib/agents/knowledge-extractor.ts`](./lib/agents/knowledge-extractor.ts) and [`lib/extractor/`](./lib/extractor/).

### 2. Rubric Matcher — aesthetic-judgment-as-matching against past-recipient cohorts

For each candidate opportunity, the Matcher fetches the last three years of recipients, finds their portfolio images, uploads those images to the Anthropic Files API, and mounts them inside the Managed Agent session at known paths alongside the artist's own portfolio. The agent then reads both cohorts directly with vision and scores the fit, with reasoning that cites which of the artist's specific images support the match and which weaken it. Programs whose past recipients work in different aesthetic territory get filtered out with explicit "why not" reasoning surfaced to the user — saying no with reasons is part of the value, not a by-product. See [`lib/agents/rubric-matcher.ts`](./lib/agents/rubric-matcher.ts) and [`app/api/runs/[id]/finalize-scout/`](./app/api/runs/) for the recipient-image pipeline.

## Setup

Atelier requires Node.js 20+, pnpm, an Anthropic API key with Managed Agents beta access, a Turso database, and a Vercel Blob store.

### 1. Clone and install

```bash
git clone https://github.com/johnkf5-ops/Atelier
cd Atelier
pnpm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env.local` and fill in:

```
ANTHROPIC_API_KEY=sk-ant-...
TURSO_DATABASE_URL=libsql://atelier-<org>.turso.io
TURSO_AUTH_TOKEN=...
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...

# Written by `pnpm setup:agents` after the one-time provisioning step:
ATELIER_ENV_ID=env_...
SCOUT_AGENT_ID=agent_...
RUBRIC_AGENT_ID=agent_...

# Local-only destructive-reset guardrail. Do NOT set in Vercel.
ATELIER_IS_RESETTABLE_DB=true
```

A free Turso account at [turso.tech](https://turso.tech) provisions a 5 GB database in under a minute. Vercel Blob is provisioned from the Vercel project dashboard.

### 3. Provision Managed Agents (one-time)

```bash
pnpm setup:agents
```

This calls `client.beta.environments.create()` once, then `client.beta.agents.create()` once per agent definition (Scout, Rubric). It prints the resulting IDs so you can paste them into `.env.local`. Re-running the script is safe — it skips agents that already exist.

### 4. Bootstrap the database

```bash
pnpm db:reset
```

Drops and recreates all tables from `lib/db/schema.sql` plus any pending migrations under `lib/db/migrations/`. Refuses to run unless `ATELIER_IS_RESETTABLE_DB=true` is set in the environment, so production is structurally protected.

### 5. (Optional) Seed a demo state

```bash
pnpm seed:demo
```

Restores a known-good portfolio + Style fingerprint + AKB from `fixtures/`. Useful for skipping the fifteen-minute onboarding loop while iterating on the run / Rubric / Drafter / Dossier path. Photos in `fixtures/portfolio/` are gitignored — provide your own, or use the `fixtures/portfolio.ci.json` picsum.photos manifest for a generic seed.

The companion `pnpm seed:export` captures whatever state your local DB is in into the `fixtures/` directory so you can re-seed it later.

### 6. Run the dev server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Onboarding starts at `/upload`.

### Tests

```bash
pnpm test
```

Runs the smoke suite under `tests/smoke/` — API error contract, Anthropic retry behavior, AKB merge invariants, finalize-scout file uploads, portfolio count consistency, and others.

## Project structure

```
foto/
├── app/                              Next.js App Router
│   ├── (onboarding)/
│   │   ├── upload/                   Portfolio upload + Style Analyst
│   │   ├── interview/                Auto-discover ingest + gap-detection interview
│   │   └── review/                   AKB review + manual edit
│   ├── (dashboard)/
│   │   ├── runs/                     Run list, /runs/new preflight, /runs/[id] live
│   │   └── dossier/[runId]/          Career Dossier (web view)
│   ├── settings/                     API key + model surface
│   └── api/                          Backend routes
│       ├── health/                   Anthropic + Turso + Blob probes
│       ├── portfolio/                Upload, reorder, delete
│       ├── extractor/                Auto-discover, ingest, interview turn
│       ├── akb/                      Finalize, manual edit
│       ├── runs/                     Start, events poll, finalize-scout, start-rubric, finalize
│       ├── style-analyst/            Vision pass over the portfolio
│       ├── dossier/                  Web view + PDF export
│       └── admin/                    Maintenance endpoints
├── lib/
│   ├── agents/                       The six specialist agents + orchestrator + run-poll
│   ├── akb/                          AKB schema merge + provenance + identity-anchor
│   ├── api/                          withApiErrorHandling, fetchJson, response helpers
│   ├── anthropic.ts                  SDK client factory
│   ├── anthropic-retry.ts            withAnthropicRetry — backoff on 529/503/502/429
│   ├── anthropic-files.ts            Files API upload helper
│   ├── auth/                         Single-user mode + future per-user-key seam
│   ├── db/
│   │   ├── schema.sql                Full DDL
│   │   ├── client.ts                 Turso/LibSQL singleton
│   │   ├── migrations.ts             Idempotent migration runner
│   │   └── queries/                  Per-table query modules (portfolio, runs, akb, ...)
│   ├── extractor/                    URL discovery, fetch, rank, ingest pipeline
│   ├── images/                       Sharp-based preprocessing
│   ├── pdf/                          @react-pdf/renderer Dossier template
│   ├── portfolio/                    Canonical portfolio queries (single source of truth)
│   ├── schemas/                      zod schemas: akb, opportunity, match, run, discovery, style-fingerprint
│   ├── storage/                      Vercel Blob wrapper
│   └── ui/                           Centralized user-facing copy constants
├── skills/                           21 skill files — codified domain knowledge
├── scripts/                          setup-managed-agents, reset-db, seed-export/demo, diagnostics
├── tests/smoke/                      Integration smoke tests
├── fixtures/                         Seed fixtures (photos gitignored)
├── instrumentation.ts                Runs migrations on boot
├── ART_DIRECTOR_SPEC.md              Original product spec
├── ATELIER_BUILD_PLAN.md             Phase-by-phase build plan
├── BUILD_LOG.md                      Narrative log of shipped work
└── WALKTHROUGH_NOTES.md              Production walkthrough notes (open)
```

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — detailed architecture: run lifecycle, Managed Agent session shape, AKB merge semantics, retry posture
- [`SUMMARY.md`](./SUMMARY.md) — hackathon writeup (180-word version + extended)
- [`BUILD_LOG.md`](./BUILD_LOG.md) — narrative log of shipped work, commit-by-commit
- [`ART_DIRECTOR_SPEC.md`](./ART_DIRECTOR_SPEC.md) — original product spec
- [`ATELIER_BUILD_PLAN.md`](./ATELIER_BUILD_PLAN.md) — full phase-ordered build plan
- [`skills/README.md`](./skills/README.md) — skill catalog: what each of the 21 skill files codifies
- [`WALKTHROUGH_NOTES.md`](./WALKTHROUGH_NOTES.md) — running notes from production walkthroughs

## License

MIT. See [`LICENSE`](./LICENSE).

Open source per the hackathon rule: every component — backend, frontend, schemas, skill files — is published. Managed services used (Turso/LibSQL, Vercel Blob, Anthropic API) are accessed through public APIs and could be swapped for self-hosted equivalents (a local LibSQL file, S3-compatible blob storage, any Anthropic API endpoint) without architectural change.

## Credits

Built by [John Knopf](https://www.johnknopfphotography.com) — Emmy-nominated fine-art landscape photographer, two galleries (Las Vegas, Minneapolis), published by National Geographic, TIME, Red Bull, USA Today, Billboard, and Google. Fifteen years inside the visual-arts-submission economy; never applied to a single grant because writing was the wall. Atelier is the tool that would have removed the wall.

Built with Claude Opus 4.7 for the [Cerebral Valley × Anthropic "Built with Opus 4.7" hackathon](https://cerebralvalley.ai/events/~/e/built-with-4-7-hackathon).

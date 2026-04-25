# Atelier — Architecture

*An AI art director for working visual artists.*

[![Built with Claude Opus 4.7](https://img.shields.io/badge/Built_with-Claude_Opus_4.7-C15F3C?style=flat-square)](https://platform.claude.com/docs/en/about-claude/models/overview)
[![Managed Agents](https://img.shields.io/badge/Managed_Agents-managed--agents--2026--04--01-1f2937?style=flat-square)](https://platform.claude.com/docs/en/about-claude/models/overview)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![Turso (LibSQL)](https://img.shields.io/badge/Turso-LibSQL-4FF8D2?style=flat-square)](https://turso.tech)

---

This document describes how Atelier is built. Atelier is a single-user-per-deploy Next.js app that turns a visual artist's portfolio into a Career Dossier — ranked grant / residency / competition opportunities and submission-ready application materials. The submission for the Cerebral Valley × Anthropic *Built with Opus 4.7* hackathon. The implementation runs six specialist agents on Anthropic's API: four direct `messages.create` agents and two Managed Agents on the `agent_toolset_20260401` toolset. Long-running runs survive Vercel's 60-second function timeout via a poll-pull-on-read pattern: state lives in Turso (LibSQL), the browser polls a thin Next.js route, and that route reads new events from Anthropic and persists them on every poll.

The rest of this document is in the order a reader new to the codebase would want it: system shape, stack rationale, the agents, the data flow per run phase, the long-running pattern, the database, the Anthropic-integration patterns, the image-content-block multimodal pattern that makes Rubric work, the skill files, the structural decisions documented in [`WALKTHROUGH_NOTES.md`](./WALKTHROUGH_NOTES.md), and finally the Path B (multi-tenant) hooks.

---

## 1. System overview

Three logical surfaces. The browser is a Next.js 15 React app — onboarding pages, run dashboard, dossier viewer. The Next.js API routes (`app/api/**/route.ts`) run on Vercel as serverless Node functions; they own all writes to Turso, all uploads to Vercel Blob, and all calls to the Anthropic API. The Anthropic API hosts both direct `messages.create` calls (Style Analyst, Knowledge Extractor, Package Drafter, Orchestrator, Interview) and per-session containers running the Managed Agent loop (Opportunity Scout and Rubric Matcher); those containers execute the `agent_toolset_20260401` bundle (`bash`, `read`, `write`, `edit`, `glob`, `grep`, `web_fetch`, `web_search`) and our two custom tools (`persist_opportunity`, `persist_match`).

```
           ┌──────────────────────────────────────┐
           │              browser                 │
           │   onboarding · run · dossier (PDF)   │
           └──────────────────┬───────────────────┘
                              │ HTTP (poll every 3s while a run is live)
                              ▼
   ┌──────────────────────────────────────────────────────────┐
   │            Next.js 15 App Router on Vercel               │
   │     app/api/**/route.ts — serverless Node functions      │
   │                                                          │
   │   · runs/start          · runs/[id]/events  (POLL)       │
   │   · runs/[id]/finalize-scout                             │
   │   · runs/[id]/start-rubric                               │
   │   · runs/[id]/finalize  (Drafter + Orchestrator)         │
   │   · style-analyst/run · extractor/turn · akb/* etc.      │
   └─────────┬─────────────────────┬─────────────────┬────────┘
             │                     │                 │
             │ libsql/client       │ @vercel/blob    │ @anthropic-ai/sdk
             ▼                     ▼                 ▼
        ┌────────┐          ┌──────────────┐   ┌────────────────────────┐
        │ Turso  │          │ Vercel Blob  │   │     Anthropic API      │
        │ (state)│          │  (binaries)  │   │                        │
        └────────┘          └──────────────┘   │  · messages.create     │
                                               │    (4 direct agents)   │
                                               │                        │
                                               │  · beta.sessions       │
                                               │    (Managed Agents:    │
                                               │     Scout, Rubric)     │
                                               │                        │
                                               │  · beta.files.upload   │
                                               │    (Files API mounts   │
                                               │     for Rubric)        │
                                               └────────────────────────┘
```

What runs where:

- **Browser** — page renders, drag-drop upload, the 3-second polling loop, the dossier UI, PDF download trigger.
- **Vercel function** — every API route, every Turso write, every Anthropic SDK call. No long-lived process; functions live for one request (max 60s on standard routes; finalize routes use `maxDuration = 300`).
- **Anthropic-hosted container** — the Managed Agent loop. After we POST a session prompt, the Anthropic platform spins up a session container, runs the loop using the bundle's tools (with internet access via `web_fetch`/`web_search` and a sandboxed filesystem at `/workspace`), and emits structured events we read back via `client.beta.sessions.events.list()`. We never run our own worker, no Cloud Run, no SSE connections out of Vercel — the long-running runtime is Anthropic's.

---

## 2. Tech stack with rationale

**Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4.** App Router fits the pattern we need: server components for any page that owns DB reads (no client-side state hydration of secret-bearing rows), `route.ts` files as the API surface, and per-route `maxDuration` knobs that map directly onto Vercel function timeouts. React 19 is the version Next.js 15 is built against; we use no React 19-specific features beyond what Next ships. Tailwind v4 is the current major; the migration to v4's `@theme`/`@source` directives is a one-time setup cost.

**Turso (LibSQL) over `node:sqlite`.** Vercel serverless functions have an ephemeral filesystem — files written by one invocation are not visible to the next, and nothing persists across deploys. A local SQLite file therefore cannot be the durable store for a Vercel-hosted app even in single-tenant mode. Turso is SQLite-compatible with an HTTP+websocket protocol, has a 5GB free tier, and `@libsql/client` exposes the same `execute({ sql, args })` interface from any environment (server function, script, dev box) without configuration changes. Switching back to a local file would require Cloud Run or a long-lived VM. See `lib/db/client.ts` for the connection (lazy init, self-healing bootstrap that re-runs `schema.sql` if a sentinel `users` table is missing).

**Vercel Blob over `public/uploads/`.** Same constraint. `public/uploads/` would not survive a deploy and would not be visible to a function on a different invocation. `@vercel/blob`'s `put(pathname, data, { access: 'public' })` returns a public CDN URL that we cache in `portfolio_images.blob_url` (and `thumb_url` for the 1024px sharp-resized thumb). Past-recipient images are mirrored into `recipients/{opp_id}/{name}_pr{id}/{idx}.jpg` by `app/api/runs/[id]/finalize-scout/route.ts`.

**`@anthropic-ai/sdk` for direct calls.** Style Analyst, Knowledge Extractor (URL ingest), Interview, Package Drafter, Orchestrator, and Auto-Discover all use `client.messages.create({...})` directly. These are workloads where we want full control over `max_tokens`, `system` content + caching, the message-history shape, and per-call schema validation. The SDK ships beta surfaces (`client.beta.sessions`, `client.beta.files`, `client.beta.agents`, `client.beta.environments`) for the Managed Agents path; the SDK sets the `managed-agents-2026-04-01` beta header automatically.

**Managed Agents for Scout + Rubric.** The Opportunity Scout runs a multi-archetype web-search loop and may emit 50+ events over 5–10 minutes; the Rubric Matcher reads dozens of mounted images and persists 10–15 match results across 5–10 minutes. Both exceed Vercel's 60-second function timeout by orders of magnitude. Managed Agents fits because the agent loop runs on Anthropic's orchestration layer in a per-session container provisioned with the `agent_toolset_20260401` bundle; we just kick the session off and read events back. Setup is in `scripts/setup-managed-agents.ts` (one-time, idempotent — uses `agents.update` with optimistic-concurrency `version` if the agent already exists). The two agent IDs and one environment ID land in env vars (`ATELIER_ENV_ID`, `SCOUT_AGENT_ID`, `RUBRIC_AGENT_ID`).

**`claude-opus-4-7` everywhere with `thinking: { type: 'adaptive' }`.** One model across every direct call (`MODEL_OPUS = 'claude-opus-4-7'` in `lib/anthropic.ts`) and configured on both Managed Agents in `scripts/setup-managed-agents.ts` (`model: 'claude-opus-4-7'`). Adaptive thinking is on for narrative/judgment-heavy calls (Drafter materials, Orchestrator cover/ranking narratives); explicitly disabled (`thinking: { type: 'disabled' }`) only on the short filtered-out one-sentence blurbs in the Orchestrator where reasoning headroom would just inflate cost.

**`@react-pdf/renderer` for the dossier PDF.** React-shaped declarative renderer; cleaner integration with the dossier React tree than running headless Chromium. **`sharp` for image preprocessing** — every uploaded portfolio image and every downloaded recipient image gets resized to 1024px (max dimension, `fit: inside`) JPEG-85 before being persisted to Blob and uploaded to the Files API. **`exifr` for EXIF** read on portfolio uploads (camera/lens/exposure metadata persisted as JSON in `portfolio_images.exif_json`). **`docx`** for Word exports of drafted application materials.

**Pinned `zod ^3`.** Zod 4 removed `.deepPartial()`. The AKB schema in `lib/schemas/akb.ts` uses `ArtistKnowledgeBase.deepPartial()` to derive the partial used in URL-ingest output and interview merge patches. Upgrading to v4 would force a full rewrite of the partial-derivation logic. Pin stays.

**`p-limit` for bounded concurrency.** Used in three places — Package Drafter (5 concurrent matches), Orchestrator (5 concurrent filtered-out blurbs and 5 concurrent logo fetches), and finalize-scout (10 concurrent recipient downloads). Without this, a 15-match Drafter run would launch 60 simultaneous Anthropic calls.

**`json-merge-patch` for AKB updates.** Interview turns emit RFC-7396 merge patches against the current AKB; `lib/akb/merge.ts` applies them and writes a new versioned row. Arrays are replaced wholesale per RFC 7396 (no array deep-merge), which is documented in the interview system prompt so the agent emits complete arrays.

---

## 3. Six specialist agents

### 3.1 Style Analyst — `lib/agents/style-analyst.ts`

Vision over the portfolio in chunks of `CHUNK_SIZE = 20` images, then a synthesis pass. The structure: split portfolio into batches of 20 (`chunk()`), run `analyzeChunk` over each batch in parallel via `Promise.allSettled`, then call `synthesizePartials` on whatever succeeded.

```
analyzePortfolio(images)
  ├── chunk(images, 20)
  ├── Promise.allSettled(chunks.map(analyzeChunk))    // vision call per chunk
  │     └── messages.create with N image blocks       // wrapped in withAnthropicRetry
  │     └── parses to PartialStyleFingerprint
  └── synthesizePartials(survivors)                   // single text-only call
        └── messages.create with all partials as JSON in user message
        └── parses to StyleFingerprint (full schema)
```

Each chunk call includes the full `skills/aesthetic-vocabulary.md` as a `cache_control: { type: 'ephemeral' }` system block so the vocabulary doesn't get re-billed per chunk. Each call sends image URLs (`source: { type: 'url', url: thumb_url }`) — Vercel Blob CDN URLs are public, so Anthropic can fetch them directly without us pre-uploading bytes.

`Promise.allSettled` is deliberate: a single chunk's transient 529 (or schema-validation failure after retry) shouldn't kill an entire 60-image portfolio. Surviving partials fan into `synthesizePartials`, which produces one canonical `StyleFingerprint`. If 0 of N chunks survive, the route throws with the explicit message `All N Style Analyst chunks failed — check Anthropic API status`.

`callWithSchema` does two things: parses the model output via `parseLooseJson` (tolerates code-fence wrappers and stray prose), then validates against the zod schema. On validation failure it does ONE additional retry, sending the validation error back to the model with `Return corrected JSON only`. On the second failure, throws. Every individual `messages.create` is wrapped in `withAnthropicRetry` (`label: 'style-analyst'`) — so the wrapper handles transient HTTP failures, and the in-function retry handles the model returning unparseable JSON.

`StyleFingerprint` schema (`lib/schemas/style-fingerprint.ts`): `composition_tendencies`, `palette` (`dominant_temperature`, `saturation_register`, `notable_palette_notes`), `subject_categories`, `light_preferences`, `formal_lineage`, `career_positioning_read`, `museum_acquisition_signals`, `weak_signals`. Persisted versioned per user in `style_fingerprints` (`user_id`, `version`, `json`).

### 3.2 Knowledge Extractor — `lib/agents/knowledge-extractor.ts` + `lib/extractor/auto-discover.ts` + `lib/agents/interview.ts`

Three coordinated paths build the Artist Knowledge Base (AKB):

**Auto-discover (`lib/extractor/auto-discover.ts`).** Streaming `messages.create` with the `web_search_20250305` tool, prompted to generate 6–10 queries about the artist (name + medium, name + each affiliation, name + city, etc.) and return a discovery list. We use `client.messages.stream(...)` (one of two places we don't go through `withAnthropicRetry` — the wrapper can't safely retry mid-stream because events would replay). The stream is captured for two purposes: (a) emit `query_running` and `results_received` server-sent events to the client for the cycling status UI, and (b) capture per-URL snippets from `web_search_tool_result` blocks (the `encrypted_content` field) into `snippetsByUrl`. The stream tolerates `pause_turn` up to `MAX_PAUSE_RETRIES = 3` by echoing assistant content back and continuing. After the stream resolves, `parseDiscovery` is a second non-streaming call that re-parses the freeform text into the strict `DiscoveryResult` schema using `output_config.format.schema` (with `stripUnsupportedJsonSchemaKeys` applied since Anthropic's structured-output validator rejects `minimum`/`maximum`/`format`/`pattern`). Top-K cap of 15: `parsed.discovered.sort((a, b) => b.confidence_0_1 - a.confidence_0_1).slice(0, 15)`. Eliminates the 60-link noise wall (Note 3 fix #1) before we burn fetch calls.

**URL ingest (`lib/agents/knowledge-extractor.ts`).** For each top-K URL, `ingestUrl(url, { anchor, snippet })`:
1. Try `fetchHtml(url)` with a 15s timeout and a real UA string.
2. On fetch failure (404/403/JS-SPA timeout), fall back to the `web_search` snippet captured during auto-discover (Note 3 fix #2 — snippet is JS-rendered as Google sees it, often sufficient for fact extraction).
3. Pass cleaned HTML or snippet to `extractFromText` with the **identity anchor** baked into the system prompt (`buildInstructions`): "If this page describes a DIFFERENT person with the same or similar name… return {} for this source. Do NOT extract any facts from a same-name page about another person." This is Note 3 fix #3 — it makes "wrong John Knopf" facts structurally impossible to ingest.
4. Schema validation against `PartialArtistKnowledgeBase` with the same ONE-retry-on-validation-failure pattern as Style Analyst.
5. Per-call `withAnthropicRetry` with `label: knowledge-extractor.ingest(${url})`.

The merged AKB is written to `akb_versions` with `source: 'ingest'`. Each version is an immutable row; the latest is what `loadLatestAkb()` returns.

**Interview (`lib/agents/interview.ts`).** Conversational turn-loop driven by gap detection (`lib/akb/gaps.ts`). Each turn:
1. `detectGaps(currentAkb)` walks the priority-tiered field list (e.g., `identity.artist_name = 115`, `identity.legal_name = 100`, `identity.home_base = 95`, …, `identity.year_of_birth = 15`) and returns gaps ordered by priority.
2. **DEFAULT_EQUALS suppression** — `legal_name` is suppressed when `legal_name_matches_artist_name === true` (Note 4). Citizenship is suppressed when `home_base.country` is filled (Note 5 — most users' citizenship equals home country; the interview only re-asks if the user explicitly says different).
3. Top 8 gaps are formatted into the prompt; the model returns `{ agent_message, next_field_target, akb_patch }` validated against `InterviewResponseSchema`. The system prompt enumerates exact question phrasings for the high-priority identity fields so the conversation doesn't ask "What's your full legal name?" before "How should your name appear in your bio?" (the artist-name-primacy fix from Note 4).
4. The merge patch is applied via `json-merge-patch` and a new `akb_versions` row is written with `source: 'interview'`.

The interview turn handler is wrapped in `withAnthropicRetry` (`label: 'interview.turn'`) — the intermittent 500s John saw on `/api/extractor/turn` (answer the question twice and the second works) were Anthropic transient throws escaping the agent loop. The retry wrapper fixes them at the source.

### 3.3 Opportunity Scout (Managed Agent) — `lib/agents/opportunity-scout.ts`

Provisioned in `scripts/setup-managed-agents.ts` as a Managed Agent with the `agent_toolset_20260401` bundle plus one custom tool `persist_opportunity`. System prompt is the concatenation of `skills/opportunity-sources.md` and `skills/eligibility-patterns.md`. Model: `claude-opus-4-7`.

`startScoutSession(runId, akb, fingerprint, config)`:
1. `client.beta.sessions.create({ agent: SCOUT_AGENT_ID, environment_id: ATELIER_ENV_ID, title: ... })` — wrapped in `withAnthropicRetry` (label `scout.sessions.create`).
2. Insert a row into `run_event_cursors` with `phase = 'scout'` and `last_event_id = NULL`.
3. Update `runs.status = 'scout_running'`.
4. `client.beta.sessions.events.send(session.id, { events: [{ type: 'user.message', content: [{ type: 'text', text: prompt }] }] })` — wrapped in `withAnthropicRetry`.

The Scout prompt (in `buildScoutPrompt`) hard-codes the workflow:

- **Step 0 — Archetype inference** (before any web_search). Read AKB + StyleFingerprint and emit a 5–8 archetype list as an `agent.message`. No fixed taxonomy — reason from primary medium, aesthetic register, career positioning, home state. The aesthetic-honesty rule is explicit: "if the work is commercial-gallery-register landscape spectacle, a Yaddo fellowship is a distraction."
- **Step 1 — Discovery.** For each archetype, 2–4 `web_search` queries.
- **Step 2 — Fetch + structure.** For each candidate, `web_fetch` listing + detail page. Extract `name, deadline, award.{type, amount_usd, prestige_tier}, eligibility, entry_fee_usd`.
- **Step 3 — Eligibility filter.** Drop ineligibles based on AKB.
- **Step 4 — Past recipients.** For each surviving opportunity, locate up to 3 recent recipients with up to 5 portfolio image URLs each. **URLs only — no downloads.**
- **Step 5 — Emit.** One `persist_opportunity` custom tool call per opportunity.
- **Step 6 — Complete.** Final `agent.message` with text `<DONE>`.

Hard caps in the prompt: 12–20 opportunities total, ≥4 archetypes, no archetype >40% of slate, stop adding sources at 20.

The custom tool input schema is `OpportunityWithRecipientUrls` (`lib/schemas/opportunity.ts`) run through `zodToJsonSchema(..., { target: 'openApi3' })` then `sanitizeJsonSchema` — strips `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`/`multipleOf`/`minLength`/`maxLength`/`minItems`/`maxItems`/`format`/`pattern`/`additionalProperties` (every key Anthropic's validator rejects; see `lib/schemas/sanitize.ts:17`). Note in `lib/schemas/opportunity.ts:21–25`: `eligibility.age_range` was originally a `z.tuple([z.number(), z.number()])` but `zod-to-json-schema` emits `items: [schema, schema]` for tuples and Anthropic's internal model validator rejected that as an internal 500; the field is now `z.array(z.number()).optional()`.

`persistOpportunityFromAgent(runId, rawInput)` validates against `OpportunityWithRecipientUrls`, upserts into `opportunities` (ON CONFLICT(source, source_id)), inserts into `run_opportunities` (the run-to-opportunity join), and upserts each recipient row into `past_recipients` — preserving any existing Blob URLs (`CASE WHEN portfolio_urls LIKE '%blob.vercel-storage%' THEN portfolio_urls ELSE excluded.portfolio_urls END`) so a second Scout run on the same opportunity doesn't clobber the already-mirrored URLs.

**No Files API at this stage.** Scout works with public URLs only. Files API mounting happens later in `finalize-scout`.

### 3.4 Rubric Matcher (Managed Agent) — `lib/agents/rubric-matcher.ts`

Same Managed Agent shape as Scout. System prompt is `skills/juror-reading.md` + `skills/aesthetic-vocabulary.md`. Custom tool `persist_match` with input schema derived from `RubricMatchResult`.

The architectural difference from Scout: **vision happens via image content blocks in `user.message` events, not via the `read` tool on mounted resources.** `sessions.create({ agent, environment_id, title })` is called **without** a `resources` field. File IDs are still uploaded (we need `file_id` strings) but they live in the per-message content blocks, not in the session container's filesystem.

Two prompt builders compose the conversation:

**`buildRubricSetupMessage(akb, fingerprint, portfolioImageIds, opportunities)`** — the initial `user.message` content. Image content blocks for the 12 representative portfolio images, then a text block with the AKB + StyleFingerprint and the list of opportunities (names, URLs, recipient names) the session will score one-by-one. The agent's first reply is a brief acknowledgement that it can see the portfolio and is ready for per-opportunity messages.

**`buildRubricOppMessage(opp, recipientImageIds, portfolioImageIds)`** — the per-opportunity `user.message` content. Image content blocks for that opportunity's recipient cohort, optionally a small portfolio re-send, then the scoring task as a text block. The agent reads both cohorts naturally as multimodal context, no `read`-tool round-trip.

```ts
// Per-opportunity message shape:
{
  type: 'user.message',
  content: [
    ...recipientFileIds.map(fid => ({ type: 'image', source: { type: 'file', file_id: fid } })),
    { type: 'text', text: `Score the artist's portfolio against ${opp.name}'s cohort recipients shown above. ...` },
  ],
}
```

Per-opportunity dispatch is **sequential**, driven from the run-poll loop. `startRubricSession(runId, akb, fingerprint, top12, opportunities)` sends only the setup message and returns; the session goes idle. On each poll, `sendNextRubricOpp(client, runId, sessionId)` recomputes the next unscored opportunity from the DB and sends its message. When `sendNextRubricOpp` returns `false` (no opps remain), the run-poll terminal-detection path fires `finalize` instead of advancing further. The agent emits one `persist_match` custom tool call per opportunity; `persistMatchFromAgent(runId, rawInput)` validates against `RubricMatchResult`, computes `included = fit_score >= 0.45 ? 1 : 0`, and upserts into `run_matches` (ON CONFLICT(run_id, opportunity_id) — dedup across agent retries).

The workflow per opportunity in the prompt: read the opportunity's recipient images (visible in the message above) → synthesize aesthetic signature → identify supporting + hurting portfolio images (visible from setup) → score 0–1 with calibration anchors (0.8+ unsurprising, 0.5 plausible outlier, 0.2 wrong room) → emit `persist_match` with `{opportunity_id, fit_score, reasoning, supporting_image_ids, hurting_image_ids, cited_recipients, institution_aesthetic_signature}`.

Why this shape — at session scale (95+ resources mounted), the `read` tool on mounted files silently switches to text-only output, which made every Rubric run produce text-only blind scoring with the StyleFingerprint as the entire signal. Image content blocks in `user.message` are the documented multimodal path and engage vision at any session size. See §8 for the full diagnosis chain.

`selectTopPortfolioImages(userId)` picks 12 evenly-spaced portfolio images by `ordinal` (`step = all.length / 12; picked.push(all[Math.floor(i * step)])`) so we don't blow context budget sending the entire portfolio inside every per-opportunity message.

### 3.5 Package Drafter — `lib/agents/package-drafter.ts`

Direct `messages.create` for each material. For each top-15 included match (`composite_score DESC NULLS LAST, fit_score DESC LIMIT 15`), draft four materials sequentially: artist statement, project proposal, CV, cover letter. `pLimit(5)` at the match level, sequential within a match. Net peak load: 5 concurrent `messages.create` calls.

Two hard constraints in every per-material prompt (except CV, which is purely factual):

**FINGERPRINT_CONSTRAINT** — visual claims must match the StyleFingerprint. The Drafter is forbidden from inventing institutional-register framings (cool-tonal, Sugimoto-lineage, durational-conceptual) when the fingerprint says otherwise. The constraint is verbatim in `package-drafter.ts:68–77`:

> If the fingerprint says "saturated" palette, do NOT claim "cool-tonal" or "muted." If the fingerprint's formal_lineage names commercial precedents (Peter Lik, Trey Ratcliff, Galen Rowell), do NOT pitch the work as "Sugimoto-lineage" or "New Topographics" or any institutional-register lineage the fingerprint does not name…

**NAME_PRIMACY_CONSTRAINT** — `identity.artist_name` is the public-facing byline (Note 4). `identity.legal_name` is administrative metadata used only when a template explicitly asks for "legal name (for tax/contract)". The constraint is verbatim in `package-drafter.ts:84–87`.

Skill files loaded once per match via `Promise.all`: `skills/artist-statement-voice.md`, `skills/project-proposal-structure.md`, `skills/cv-format-by-institution.md`. Each has a hand-written DEFAULT fallback (in `package-drafter.ts:13–42`) so the Drafter never silently degrades when a skill file is missing.

`oppRequirementsText`: best-effort fetch of the opportunity URL (10s timeout, cheerio-clean to plain text, truncated to 20K chars). Passed to the project-proposal prompt so the proposal can match the funder's stated structure.

Each of the four material calls uses `thinking: { type: 'adaptive' }` and `withAnthropicRetry({ label: 'drafter-${type}' })`.

`selectWorkSamples(supportingIds, portfolio, target=12)` builds the work-sample selection. Priority 1: Rubric-supplied supporting IDs. Priority 2: even-spaced backfill from remainder. Each sample carries a `rationale` field — supporting picks get "cited as supporting the institution's aesthetic signature in the Rubric Matcher's reasoning"; backfills get "representative of the artist's broader range".

Persistence: ON CONFLICT(run_match_id) DO UPDATE — re-drafting overwrites instead of throwing on duplicate.

### 3.6 Orchestrator — `lib/agents/orchestrator.ts`

Three direct `messages.create` calls plus a deterministic composite-score computation:

1. **`compositeScore(fit, opp, config)`** — `fit × prestige × urgency × affordability`. Prestige weights: flagship=1.0, major=0.85, mid=0.7, regional=0.55, open-call=0.4 (`PRESTIGE_WEIGHTS`). Urgency penalises both very-near (<7 days, 0.3) and very-far (>90 days, 0.65) deadlines, with the sweet spot at 7–30 days (1.0). Affordability is `1 - (fee/budget)*0.5` capped at 1.0; over-budget is 0.
2. **`generateCoverNarrative(akb, fp)`** — 2–3 paragraph cover narrative from AKB + fingerprint. `thinking: { type: 'adaptive' }`, `max_tokens: 1500`.
3. **`generateRankingNarrative(topMatches)`** — 3–4 paragraph "why this ordering" narrative across the top opportunities. Same shape.
4. **`generateFilteredOutBlurb(opp, reasoning)`** — one-sentence "Why not [opportunity]:…" boil-down per filtered-out opportunity. `thinking: { type: 'disabled' }` here — the call is short and reasoning headroom inflates cost without value.

All three calls use `withAnthropicRetry`. Filtered-out blurbs are batched at `pLimit(5)`. Logos for the top-included opps are fetched in parallel at `pLimit(5)` via `getLogoUrl(opportunity_id, url)` (fails are non-fatal — logos are decoration).

The dossier row is upserted with the cover + ranking narratives. The Drafter then runs (`draftPackages`) and flips `runs.status = 'complete'`.

---

## 4. Data flow per phase

A fresh user runs through this entire flow once before the run pipeline can fire.

### 4.1 Pre-run — onboarding

1. **Portfolio upload** (`POST /api/portfolio/upload`). Drag-drop, multipart. Each image gets SHA-256 hashed; `blob_pathname = originals/<sha256>.jpg` deduplicates re-upload (UNIQUE INDEX on `(user_id, blob_pathname)`). Sharp resizes to 1024px max for `thumb_pathname`. Writes a `portfolio_images` row with both Blob URLs cached.
2. **Style Analyst** (`POST /api/style-analyst/run`). Reads all portfolio thumb URLs, calls `analyzePortfolio(images)`. Persists to `style_fingerprints` with the next version number. Requires ≥20 images.
3. **Auto-discover** (`POST /api/extractor/auto-discover`). Server-sent events stream — emits `query_running`, `results_received`, etc. for the cycling-status UI. After the stream completes, `parseDiscovery` returns the top-15 ranked URLs with snippets.
4. **URL ingest** (`POST /api/extractor/ingest`). For each URL the user keeps, `ingestUrl(url, { anchor, snippet })` extracts a partial AKB. Merged into a new `akb_versions` row with `source: 'ingest'`.
5. **Interview** (`POST /api/extractor/turn`). Conversational gap-fill loop. Each turn writes a new `akb_versions` row with `source: 'interview'`.
6. **Review** (`/review` page). User can edit/delete any fact regardless of source (Note 10). Deleted facts that came from a source URL can mark that URL as untrusted (`POST /api/akb/untrust-source` → row in `untrusted_sources`). Future auto-discover runs skip untrusted URLs.
7. **Finalize AKB** (`POST /api/akb/finalize`). Validates the latest `akb_versions` row against the strict (non-partial) `ArtistKnowledgeBase` schema. Sets the gating flag for run-start.

### 4.2 Run start

`POST /api/runs/start` (`app/api/runs/start/route.ts`):
1. Load latest finalized AKB + latest StyleFingerprint. 400 if either is missing.
2. Insert `runs` row with `status='queued'`, `akb_version_id`, `style_fingerprint_id`, `config_json` (window dates, budget, max travel miles).
3. Call `startScoutSession(runId, akb, fingerprint, config)`. Returns the Anthropic `session.id`. `runs.status` is now `scout_running`.
4. Respond `{ run_id, session_id, phase: 'scout' }`.

The browser is now polling.

### 4.3 Scout phase (long-running, browser polls)

Browser polls `GET /api/runs/[id]/events` every 3s. Each poll runs `pollRun(req, runId)` (`lib/agents/run-poll.ts`):

1. Read `(managed_session_id, phase, last_event_id)` from `run_event_cursors`.
2. Iterate `client.beta.sessions.events.list(managed_session_id)`. The SDK's async iterator handles pagination internally using the `page:` cursor (note: the SDK uses `page:` for this resource, not `after:`). For each event: `INSERT OR IGNORE INTO run_events (..., event_id, payload_json)`. The unique partial index `idx_run_events_event_id_unique ON run_events(event_id) WHERE event_id IS NOT NULL` makes this idempotent — repeated polls don't duplicate rows. We collect newly-inserted rows into `newEvents` and update `last_event_id`.
3. Update the cursor row.
4. `handleRequiresAction(client, runId, sessionId, newEvents)` — see §7.3 below.
5. Terminal detection — find the latest `session.status_idle` event in `newEvents` (or fall back to a DB lookup for the last one); read its `stop_reason.type`. Terminal iff `sessions.retrieve()` returns `status === 'terminated'`, OR (`status === 'idle'` AND last `stop_reason !== 'requires_action'`).
6. **Compare-and-swap phase advance.** If terminal AND `phase === 'scout'`: `UPDATE runs SET status = 'scout_complete' WHERE id = ? AND status = 'scout_running'`. The CAS guard prevents every subsequent poll re-firing finalize-scout (Scout's session stays `idle` forever after the first terminal — without CAS, every poll would walk status back).
7. If the CAS succeeded, fire-and-forget `POST /api/runs/[id]/finalize-scout` via `waitUntil(fetch(...))`.
8. Return `{ events: newEvents, phase, phaseDone, runStatus, done, errored }`.

`sessions.retrieve()` is wrapped in `withAnthropicRetry`. Critical SDK gotcha: **`sessions.retrieve()` returns live `status` but NOT `stop_reason`**; `stop_reason` lives only on `session.status_idle` events. Terminal detection MUST pair the retrieve `status` with the last-seen stop_reason from the event stream — relying on retrieve alone causes premature `done: true`.

### 4.4 finalize-scout (Files API mounting)

`POST /api/runs/[id]/finalize-scout` (`maxDuration = 300`):

1. `UPDATE runs SET status = 'finalizing_scout'`.
2. Query past_recipients on this run that need processing — recipients where `portfolio_urls` are either still raw source URLs OR already mirrored to Blob but `file_ids` is empty (the latter case catches a prior finalize-scout that mirrored to Blob but failed Files-API upload).
3. `pLimit(10)` over `downloadRow(row, runId)`. For each row, for each URL in `portfolio_urls`:
   - Fetch bytes (`Referer` header for raw source URLs to bypass hotlink protection; no extra headers for already-mirrored Blob CDN URLs).
   - Sharp resize to 1024px JPEG-85.
   - Mirror to Vercel Blob (skip if already mirrored).
   - **Upload to Anthropic Files API** via `uploadToFilesApi(thumb, filename, 'image/jpeg')`. **Throws loudly on failure** — no swallow. (Note 8: the prior swallow-and-continue pattern is what shipped `file_ids = []` to prod and blinded the Rubric.)
   - Append `blobUrl` and `fileId` to per-row arrays.
4. Update `past_recipients` with both arrays — `portfolio_urls` (Blob URLs, position-aligned) and `file_ids` (Anthropic Files API IDs, position-aligned).
5. Post-pass audit: query for any recipient on this run with empty `file_ids` despite having had source URLs; if any, write a CRITICAL `run_events` row with `kind='rubric_will_be_blind'` so the run page surfaces the failure instead of completing silently with a 1-of-12 dossier.
6. Fire `POST /api/runs/[id]/start-rubric` via `waitUntil(fetch(...))`.

### 4.5 Rubric phase (long-running, browser polls)

`POST /api/runs/[id]/start-rubric` (`maxDuration = 60`):

1. `UPDATE runs SET status = 'rubric_running'`.
2. Load AKB, fingerprint, and 12 portfolio images (`selectTopPortfolioImages`).
3. Upload each portfolio image to Files API via `uploadVisionReadyImage` (Sharp-normalized JPEG-85, 1024px max). Best-effort — log failures but don't throw; Rubric can score with N-1 if one fails.
4. Load opportunities + their past_recipients (only recipients with Blob-mirrored `portfolio_urls` AND deduped to `MAX(id)` per name to handle duplicate Scout runs on the same opp).
5. `startRubricSession(runId, akb, fingerprint, top12, opportunities)`:
   - `client.beta.sessions.create({ agent: RUBRIC_AGENT_ID, environment_id: ATELIER_ENV_ID, title: ... })` — **no `resources` field**. The session container has no mounted files.
   - Insert/update `run_event_cursors` with `phase = 'rubric'`.
   - `client.beta.sessions.events.send(...)` with the setup `user.message` from `buildRubricSetupMessage` — image content blocks for the 12 portfolio images plus AKB / StyleFingerprint / opportunity-list text.
   - Returns immediately; the per-opportunity dispatch happens in the run-poll loop.

Browser polling continues against the same `/api/runs/[id]/events` route — `pollRun` reads `phase` from the cursor row. On each terminal-detection pass during the Rubric phase, the loop calls `sendNextRubricOpp(client, runId, sessionId)`. If it returns `true` (an opportunity was dispatched), the loop returns without firing `rubric_complete` — the agent will work on that opp and idle again, and the next poll will dispatch the next opp. If it returns `false` (no unscored opps remain), the CAS path advances `runs.status = 'rubric_complete'` and fires `POST /api/runs/[id]/finalize`. This is the sequential per-opportunity dispatch pattern.

### 4.6 Finalize (Drafter + Orchestrator)

`POST /api/runs/[id]/finalize` (`maxDuration = 300`):

1. CAS guard: only advance if `status IN ('rubric_complete', 'queued', 'finalizing')`. If already past, return `skipped`.
2. `UPDATE runs SET status = 'finalizing'`.
3. `orchestrateDossier(runId)` — composite scores written in one batch, cover + ranking narratives generated, filtered-out blurbs generated for top-15 filtered, logos pre-cached, `dossiers` row upserted.
4. `draftPackages(runId, akb, userId)` — top-15 included matches, 4 materials each, p-limit 5, persisted to `drafted_packages`. On success, sets `runs.status = 'complete'` and `finished_at = unixepoch()`.
5. On any throw, `runs.status = 'error'` with the error message in `runs.error`.

Browser's next poll sees `status === 'complete'`, sets `done: true`, and routes to the dossier page.

---

## 5. Long-running run pattern — poll-pull-on-read

Vercel functions have a 60s default timeout (300s on Pro for explicitly-marked routes). A 10–30 minute Scout/Rubric run cannot be a single function invocation. There is also no SSE channel from Anthropic that we could subscribe to from a long-lived process — and Vercel functions cannot host long-lived processes anyway.

**The pattern.** State lives in Turso. The Anthropic API is the durable workspace for the run (the session container survives across function invocations as long as the agent is doing work). Our job is to bridge: (a) kick off the session, (b) periodically read new events from Anthropic and persist them to Turso, (c) hand the persisted events back to the browser.

```
browser                  /api/runs/[id]/events                   Anthropic
   │                              │                                  │
   │── GET (every 3s) ───────────▶│                                  │
   │                              │── sessions.events.list(id) ─────▶│
   │                              │◀── async iterator of new events ─│
   │                              │                                  │
   │                              │── INSERT OR IGNORE into          │
   │                              │   run_events (event_id UNIQUE)   │
   │                              │                                  │
   │                              │── if requires_action:            │
   │                              │   handle persist_* tool call,    │
   │                              │   sessions.events.send result ──▶│
   │                              │                                  │
   │                              │── sessions.retrieve(id) ────────▶│
   │                              │◀── { status }                    │
   │                              │   (combined with event-stream    │
   │                              │    last stop_reason for terminal │
   │                              │    detection)                    │
   │                              │                                  │
   │                              │── if terminal: CAS advance,      │
   │                              │   waitUntil(POST next phase)     │
   │                              │                                  │
   │◀── { events, phase, done, … }│                                  │
```

Properties:

- **Resumable across function invocations.** Each poll is independent. If the function dies mid-poll, the next poll picks up at the cursor's `last_event_id`.
- **Idempotent persistence.** `INSERT OR IGNORE` against the `event_id` unique partial index means re-reading old events is a no-op; we never double-handle a `requires_action`.
- **No long-lived connections from Vercel.** Each poll is a single HTTP round-trip from the browser to a function that returns within a few seconds.
- **CAS guards prevent re-firing phase advances.** A Managed Agent session that has emitted its terminal `session.status_idle` stays `idle` forever; without the `WHERE status = 'scout_running'` clause on the phase-advance UPDATE, every subsequent poll would re-trigger finalize-scout.

**SDK gotchas worth naming explicitly:**

- `client.beta.sessions.events.list(sessionId)` returns an async iterator. Internally it paginates via a `page:` cursor parameter (not `after:`); just consume the iterator and don't hand-build cursors.
- `client.beta.sessions.retrieve(sessionId)` returns live `status` but **does NOT return `stop_reason`**. `stop_reason` only appears on `session.status_idle` events in the event stream. Use `status` AND last-seen `stop_reason` together; using `status` alone causes premature `done: true` on `requires_action`-stalled sessions.

---

## 6. Database schema

Single source of truth: `lib/db/schema.sql`. One file, applied idempotently on cold start by `lib/db/migrations.ts:runMigrations` (every statement is `CREATE TABLE IF NOT EXISTS` or `CREATE [UNIQUE] INDEX IF NOT EXISTS`). On boot, `lib/db/client.ts:ensureDbReady` runs migrations, seeds `users(id=1, name='Default User')`, and self-heals if a sentinel `users`-table check fails after first ready (catches "dev ran `pnpm db:reset` against a running server"). The `_migrations` table is kept for historical compatibility but no individual files are tracked any more; CHANGELOG lives at `lib/db/CHANGELOG.md`. `lib/db/migrations.ts` exports an `EXPECTED_TABLES` constant that the smoke tests verify.

### Tables

**`users`** — single-tenant placeholder (`id=1`); kept as a real table so multi-tenant migration is just changing what `getCurrentUserId()` returns.

**`portfolio_images`** — one row per uploaded image. `(filename, blob_pathname, thumb_pathname, blob_url, thumb_url, width, height, exif_json, ordinal)`. UNIQUE INDEX on `(user_id, blob_pathname)` — `blob_pathname` is the SHA-256 of the bytes, so re-upload is a no-op.

**`style_fingerprints`** — versioned per user. `(user_id, version, json, created_at)`. The latest version is what drives Scout, Rubric, and Drafter.

**`akb_versions`** — versioned per user with provenance. `(user_id, version, json, source, created_at)` where `source IN ('ingest', 'interview', 'merge')`. Each interview turn writes a new row; each ingest path writes a new row. Latest version is the current AKB.

**`extractor_turns`** — interview transcript. `(user_id, turn_index, role, content, akb_field_targeted, akb_patch_json, created_at)`. UNIQUE INDEX on `(user_id, turn_index)` prevents the double-submit race where two concurrent POSTs compute the same `turn_index` from a stale read of `history.length`.

**`opportunities`** — discovered opportunities, shared across runs. `(source, source_id, name, url, deadline, award_summary, eligibility_json, raw_json, fetched_at)` with `UNIQUE(source, source_id)` so persistOpportunity ON CONFLICT upserts.

**`opportunity_logos`** — fetched og:image / favicon URLs, keyed by `opportunity_id`.

**`past_recipients`** — `(opportunity_id, year, name, bio_url, portfolio_urls, file_ids, notes, fetched_at)`. `portfolio_urls` is a JSON array of Vercel Blob URLs; `file_ids` is a JSON array of Anthropic Files API IDs (position-aligned with `portfolio_urls`). UNIQUE INDEX on `(opportunity_id, year, name)` deduplicates across Scout re-runs.

**`runs`** — one row per run. `(user_id, akb_version_id, style_fingerprint_id, status, config_json, started_at, finished_at, error)`. `status` walks: `queued → scout_running → scout_complete → finalizing_scout → rubric_running → rubric_complete → finalizing → complete` (or → `error`).

**`run_events`** — full Anthropic event stream, plus our own emitted operational events (e.g., `finalize-scout` `rubric_will_be_blind`). `(run_id, agent, kind, event_id, payload_json, created_at)`. UNIQUE partial index `idx_run_events_event_id_unique ON run_events(event_id) WHERE event_id IS NOT NULL` enforces idempotent INSERT OR IGNORE on Anthropic event IDs. `run_id` is nullable so orphan events (auto-discover, pre-run telemetry) can use the same table without a surrounding `runs` row.

**`run_opportunities`** — join. Composite PK on `(run_id, opportunity_id)`. Populated by `persist_opportunity`.

**`run_matches`** — Rubric output. `(run_id, opportunity_id, fit_score, composite_score, reasoning, supporting_image_ids, hurting_image_ids, filtered_out_blurb, included)`. UNIQUE INDEX on `(run_id, opportunity_id)` lets `persist_match` ON CONFLICT upsert (handles agent re-emit on retry). `composite_score` is set by Orchestrator; `filtered_out_blurb` is set by Orchestrator for filtered matches.

**`run_event_cursors`** — one row per run. `(run_id PK, managed_session_id, last_event_id, phase, updated_at)`. Drives the polling loop's resumability.

**`drafted_packages`** — one row per drafted match. `(run_match_id PK-via-unique-index, artist_statement, project_proposal, cv_formatted, cover_letter, work_sample_selection_json)`. UNIQUE INDEX on `run_match_id` enables Drafter's ON CONFLICT(run_match_id) DO UPDATE re-draft pattern.

**`dossiers`** — one row per run. `(run_id PK UNIQUE, cover_narrative, ranking_narrative, pdf_path)`.

**`untrusted_sources`** — `(user_id, url, reason, rejected_at)` with composite PK. Note 10. When a user rejects a fact on `/review`, the source URL goes here; future auto-discover runs read this table and skip those URLs. Prevents the "delete this hallucination forever" treadmill.

**`_migrations`** — historical bookkeeping. Not actively used since the single-file `schema.sql` model.

### Relationships

```
users (1)──┬──portfolio_images (N)
           ├──style_fingerprints (N — versioned)
           ├──akb_versions (N — versioned)
           ├──extractor_turns (N)
           ├──untrusted_sources (N)
           └──runs (N)
                 ├──run_event_cursors (1)
                 ├──run_events (N)
                 ├──run_opportunities (N) ──▶ opportunities (cross-run cache)
                 │                                ├──opportunity_logos (1)
                 │                                └──past_recipients (N)
                 ├──run_matches (N) ──▶ opportunities
                 │     └──drafted_packages (1 per match)
                 └──dossiers (1)
```

---

## 7. Anthropic integration patterns

Three recurring patterns across the codebase.

### 7.1 Direct messages.create with `withAnthropicRetry`

`lib/anthropic-retry.ts` exports `withAnthropicRetry(fn, opts?)`. Retries on transient HTTP statuses (`408, 409, 425, 429, 500, 502, 503, 504, 529`) and network errors (`ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `UND_ERR_SOCKET`, `UND_ERR_CONNECT_TIMEOUT`, plus message-substring matches on `socket hang up` / `fetch failed` / `overloaded`). Default 4 attempts, base 500ms, max 8s, exponential backoff with jitter. Logs every retry as `[label] transient failure on attempt N/M: HTTP S Msg — retrying in Xms`.

Every Anthropic call site is wrapped. The full inventory:

- `lib/agents/style-analyst.ts:174` — `style-analyst` (every chunk and synthesis call)
- `lib/agents/knowledge-extractor.ts:184` — `knowledge-extractor.ingest(${url})` (every URL extraction)
- `lib/agents/interview.ts:97` — `interview.turn`
- `lib/agents/package-drafter.ts:157` — `drafter-${type}` (every of the four materials per match)
- `lib/agents/orchestrator.ts:48, 81, 103` — `orchestrator.cover-narrative`, `orchestrator.ranking-narrative`, `orchestrator.filtered-out(${name})`
- `lib/agents/opportunity-scout.ts:18, 42` — `scout.sessions.create`, `scout.events.send`
- `lib/agents/rubric-matcher.ts:89, 112` — `rubric.sessions.create`, `rubric.events.send`
- `lib/agents/run-poll.ts:57, 141` — `run-poll.events.send`, `run-poll.sessions.retrieve`
- `lib/anthropic-files.ts:29` — `files.upload(${filename})`
- `lib/extractor/auto-discover.ts:278` — `auto-discover.parse`
- `app/api/health/route.ts:46` — `health.capacity-probe`

The two intentional exceptions are documented in source: `lib/extractor/auto-discover.ts` uses `client.messages.stream(...)` directly (a mid-stream retry would replay events already consumed; the outer pause/resume loop handles transients via `pause_turn`), and `lib/anthropic-files.ts` is the wrapper itself.

**ESLint enforcement** (`eslint.config.mjs:38–75`). Five `no-restricted-syntax` rules ban the bare patterns:

- `await client.messages.create(...)`
- `await client.beta.sessions.create(...)`
- `await client.beta.sessions.retrieve(...)`
- `await client.beta.sessions.events.send(...)`
- `await client.beta.files.upload(...)`

The wrapped form `await withAnthropicRetry(() => client.messages.create(...))` is allowed because the `messages.create` call there is parented by an `ArrowFunctionExpression`, not the AwaitExpression directly. The retry helper file and the Files API wrapper are explicitly ignored. CI fails the build on any direct call.

### 7.2 Managed Agents session lifecycle

Agents are created once via `scripts/setup-managed-agents.ts` (Anthropic anti-pattern: never call `agents.create` from a request handler).

`findOrCreateAgent(cfg)`:
- `client.beta.agents.list()` — async iterator, find by `name`.
- If exists: `client.beta.agents.update(id, { version, name, model, system, tools })` with the current version for optimistic concurrency. The API no-ops if nothing changed; throws `immutable` if model changed (in which case the script prints "Archive in console then re-run").
- If new: `client.beta.agents.create(cfg)`.

`findOrCreateEnvironment()` does the equivalent for environments — `name = 'atelier-default'`, `config = { type: 'cloud', networking: { type: 'unrestricted' } }`.

Both Scout and Rubric are configured with `model: 'claude-opus-4-7'` and `tools: [{ type: 'agent_toolset_20260401' }, { type: 'custom', name: '...', input_schema: ... }]`. The custom-tool input schema is `zodToJsonSchema(zodSchema, { target: 'openApi3' })` then `sanitizeJsonSchema`.

Setup script prints the resulting IDs:

```
ATELIER_ENV_ID=env_...
SCOUT_AGENT_ID=agt_...
RUBRIC_AGENT_ID=agt_...
```

Pasted into `.env.local` and `vercel env add` for production/preview/development.

Per-run: `client.beta.sessions.create({ agent: AGENT_ID, environment_id: ENV_ID, title, [resources] })` once, then `events.send` once (the prompt), then poll-pull-on-read.

### 7.3 Custom tools — `persist_opportunity` and `persist_match`

The custom-tool round-trip (managed agents):

1. Agent emits `agent.custom_tool_use` with `{ id, type, name, input }`. We persist the event (it has an `event_id`).
2. Session's last event becomes `session.status_idle` with `stop_reason.type === 'requires_action'` and `stop_reason.event_ids = [...]` listing the tool-use IDs awaiting result.
3. `lib/agents/run-poll.ts:handleRequiresAction` finds the latest `requires_action` idle in `newEvents`, queries the persisted `run_events` rows for those IDs, and dispatches each one:
   - `persist_opportunity` → `persistOpportunityFromAgent(runId, ev.input)` → `opportunities` upsert + `run_opportunities` insert + `past_recipients` upserts → returns a string like `persisted opportunity_id=42 recipients=2`.
   - `persist_match` → `persistMatchFromAgent(runId, ev.input)` → `run_matches` upsert → returns `persisted match opportunity_id=42 score=0.78`.
4. For each handled tool use, `client.beta.sessions.events.send(sessionId, { events: [{ type: 'user.custom_tool_result', custom_tool_use_id: ev.id, content: [{ type: 'text', text: result }] }] })` — wrapped in `withAnthropicRetry`.
5. Agent receives the result, resumes, may do more work or emit another `<DONE>`-bearing message.

**Schema sanitization** (`lib/schemas/sanitize.ts`). Anthropic's validator rejects `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minLength`, `maxLength`, `minItems`, `maxItems`, `format`, `pattern`, and `additionalProperties`. `sanitizeJsonSchema` recursively strips them. Zod still validates after parse — the schema we send to Anthropic is purely for shape/type guidance.

A separate variant `stripUnsupportedJsonSchemaKeys` lives in `lib/extractor/auto-discover.ts:235` for the structured-output path (`output_config.format.schema`); same idea, narrower set (only the numeric constraint keys).

---

## 8. Files API + image-content-block multimodal pipeline

The architectural pattern that lets the Rubric Matcher actually see images. The current shape is the result of three diagnosis cycles documented as Notes 27, 28, and 29 in `WALKTHROUGH_NOTES.md`. The first two patterns failed at production scale in ways that did not appear at probe scale; the current pattern is the one that works.

**The job.** Rubric needs to vision over each opportunity's past-recipient cohort and the artist's portfolio together. Recipient images live at arbitrary URLs (gallery sites, personal portfolios, foundation press pages) — many require Referer headers to defeat hotlink protection, some are JS-rendered. The Files API gets us bytes-into-Anthropic; the harder question is how the agent reads those bytes inside a long-running session.

**What we tried that didn't work.**

*Pattern 1 — custom mount paths + `read` tool.* `sessions.create({ resources: [{ type: 'file', file_id, mount_path: '/workspace/recipients/...' }] })` and a Rubric prompt that listed the exact mount paths so the agent could `read /workspace/portfolio/12.jpg` directly. **The Files API silently ignored the custom `mount_path`** and mounted everything at the default `/mnt/session/uploads/<file_id>`. Every `read` returned "File not found." Diagnosed via `scripts/probe-mount.mjs`. Note 27.

*Pattern 2 — default mount paths + `read` tool.* Same shape, but using the documented default mount path, not a custom one. Worked in 5-file probes; failed at 95-file production scale. **Above some session-resource ceiling that isn't documented anywhere, the `read` tool on mounted files silently returns text-only output ("Output could not be decoded as text") instead of multimodal binary.** Diagnosed via per-tool audit on a failed prod run: every `web_fetch` returned multimodal binary, every `read` of a mounted file returned text-only. Probes at 1, 5, and 21 files all worked; production at 95 files (12 portfolio + 83 recipient) did not. Note 29.

**The current pattern — image content blocks in `user.message` events.** Bypass mounted resources and the `read` tool entirely. Send images as `{ type: 'image', source: { type: 'file', file_id } }` content blocks inside `user.message` events. This is Anthropic's documented multimodal pattern and engages vision regardless of session size.

The full pipeline:

1. **Upload normalization (Note 28).** Raw bytes from arbitrary source sites — and even some bytes already in Vercel Blob — fail Anthropic's vision check until they're re-encoded through Sharp as standard sRGB JPEG-85 at 1024px max. `lib/anthropic-files.ts:normalizeForVision(rawBuf, fallbackContentType?)` returns `{ buf, contentType, extension, usedFallback }`. `uploadVisionReadyImage(rawBuf, filename)` wraps the Files API upload around it. **All Files API uploads — recipient images in `finalize-scout`, portfolio images in `start-rubric` — go through `uploadVisionReadyImage`.** This is the single source of truth for vision-ready uploads.
2. **Recipient mirror.** `finalize-scout` downloads each past-recipient image, mirrors to Vercel Blob (with the 1024px Sharp resize), and uploads to the Files API via `uploadVisionReadyImage`. The Files API call **throws loudly on failure** (the prior swallow-on-error pattern was the prod root cause from Note 8). The returned `file_id` is appended to the recipient's `file_ids` JSON array in `past_recipients`, position-aligned with `portfolio_urls`.
3. **Portfolio upload.** `start-rubric` runs the same `uploadVisionReadyImage` over each of the 12 selected portfolio images. Best-effort — Rubric can score with N-1 if one upload fails.
4. **Session creation — no `resources`.** `sessions.create({ agent, environment_id, title })` is called without a `resources` field. The session container has nothing mounted; the Rubric agent never opens a file from disk.
5. **Setup message.** `buildRubricSetupMessage(akb, fingerprint, portfolioFileIds, opportunities)` returns a `user.message` content array with image content blocks for the 12 portfolio file_ids, then a text block carrying AKB + StyleFingerprint + the list of opportunities the session will score one-by-one. Sent once via `events.send` from `startRubricSession`.
6. **Per-opportunity dispatch (Note 30).** `sendNextRubricOpp(client, runId, sessionId)` runs from the run-poll terminal-detection path on each idle event. It recomputes the next unscored opportunity from the DB on demand, builds a per-opp `user.message` from `buildRubricOppMessage(opp, recipientFileIds)`, and sends it. Returns `true` if an opp was dispatched, `false` if no unscored opps remain. The poll loop uses the boolean to decide whether to continue (advance to next opp on next idle) or fall through to phase-advance + `finalize`. This sequential pattern keeps each turn under context limits and avoids inline loops that would block past Vercel's 60-second function timeout.
7. **Match persistence.** Per opp, the agent emits one `persist_match` custom tool call. `persistMatchFromAgent(runId, rawInput)` validates against `RubricMatchResult` and upserts into `run_matches` with ON CONFLICT(run_id, opportunity_id) for retry safety.

**Failure-mode safety net.** Inside `finalize-scout`, after all downloads complete, an audit query checks for any recipient on this run with `file_ids = []` despite having had source URLs. If any, a `run_events` row is inserted with `kind = 'rubric_will_be_blind'` and the run page surfaces it instead of completing silently with empty cohorts.

**Health probe.** `GET /api/health` (`app/api/health/route.ts`) does a tiny Files API probe: upload a 1×1 white JPEG (`TINY_JPEG_BASE64`), capture the file_id, delete it. Verifies the prod `ANTHROPIC_API_KEY` has Files API access — without this, every run ships Rubric-blind.

**Diagnostic scripts retained in `scripts/`.** `probe-mount.mjs` (proves custom mount_path is silently ignored), `probe-vision.mjs` (proves all four vision patterns engage in isolation), `probe-real-file.mjs` and `probe-many-files.mjs` (probe-scale verifications), `probe-portfolio.mjs` (the diagnosis that found portfolio files needed Sharp normalization while recipient files didn't), `probe-prod-scale.mjs` (production-scale probe with 8 portfolio + 5 recipient images that confirmed the image-content-block pattern engages vision at production scale). These exist as a regression-detection corpus — if any future change to the vision pipeline regresses, the probes will catch it before a prod run does.

---

## 9. Skill files as knowledge

`skills/` directory contains 21 markdown files that codify the lived-knowledge moat. They are loaded as system-prompt content in three places:

- `scripts/setup-managed-agents.ts` reads `opportunity-sources.md` + `eligibility-patterns.md` into the Scout system; reads `juror-reading.md` + `aesthetic-vocabulary.md` into the Rubric system. Loaded once at agent provisioning; baked into the Managed Agent's `system` field.
- `lib/agents/style-analyst.ts:48–57` (`loadAestheticVocab`) reads `aesthetic-vocabulary.md` once per process and caches it; sent on every chunk call as a `cache_control: { type: 'ephemeral' }` system block.
- `lib/agents/package-drafter.ts:44–50` (`readSkill`) reads `artist-statement-voice.md`, `project-proposal-structure.md`, `cv-format-by-institution.md` per draft call, with hand-written DEFAULT fallbacks if the file is missing.

The catalog (21 files):

```
aesthetic-vocabulary.md            akb-disambiguation-patterns.md
artist-statement-voice-by-medium.md  artist-statement-voice.md
cost-vs-prestige-tiers.md          cover-letter-templates.md
cv-format-by-institution.md        eligibility-patterns.md
gallery-tier-taxonomy.md           interview-question-templates.md
juror-reading.md                   medium-specific-application-norms.md
museum-acquisition-pathways.md     opportunity-sources.md
past-winner-archives.md            photography-specific-lineages.md
project-proposal-structure.md      regional-arts-economies.md
submission-calendar.md             timeline-by-opportunity-type.md
work-sample-rationale-patterns.md
```

Provenance (per `project_atelier.md` memory): skill files are produced by a research-mode agent that reads live institutional sites, past-winner archives, and published grant-writing guides, then audited by John against reality. Not freestyle dumps — the moat is the reproducible synthesis pipeline plus the human audit.

---

## 10. Key structural decisions documented in `WALKTHROUGH_NOTES.md`

The walkthrough notes are John's incognito-prod walkthrough log. Each note that landed as a structural decision is documented in code; the highlights:

**Note 7 — Canonical `getPortfolioCount()` function** (`lib/db/queries/portfolio.ts:22`). Three different files were doing inline `SELECT COUNT(*) FROM portfolio_images` with subtle differences (one read `Number(rowObj)` instead of `Number(rowObj.n)`); the `/runs/new` page silently returned 0 against the same DB the upload page read 21 from. Single source of truth eliminates page-to-page count drift. Same module also exports `getNextPortfolioOrdinal`, `listPortfolio`, `existingPortfolioHashes`.

**Note 8 — Fail-loud Files API uploads + per-run audit safety net**. `lib/anthropic-files.ts:uploadVisionReadyImage` throws on Files API non-2xx (no swallow). `app/api/runs/[id]/finalize-scout/route.ts` runs a post-pass audit that emits a `rubric_will_be_blind` `run_events` row if any recipient on this run still has empty `file_ids` despite source URLs. The "how Rubric reads images" architectural shape was iterated through Notes 27, 28, 29, and 30 and lives in its current form in §8 above (image content blocks in per-opportunity `user.message` events, dispatched sequentially from the run-poll loop).

**Note 10 — `untrusted_sources` table** (`lib/db/schema.sql:204–210`, queries in `lib/db/queries/untrusted-sources.ts`). When the user rejects a fact on `/review` that came from auto-discover, the source URL is recorded here. Auto-discover and the URL ingest path skip any URL in this list — prevents the "delete this fact forever" treadmill where every re-ingest re-introduces the same hallucination.

**Note 11 — `withAnthropicRetry` helper, ESLint rule, capacity probe**. `lib/anthropic-retry.ts` is the systemic fix for transient 529/503/429/network errors that surface to users as "Failed to fetch". Every Anthropic call site is wrapped (full inventory in §7.1). `eslint.config.mjs:38–75` bans direct `await client.<method>(...)` calls via `no-restricted-syntax`. `app/api/health/route.ts` probes Anthropic capacity with a tiny `messages.create` call so we can spot upstream weather before running expensive flows.

**Note 13 — Tier labels replace numerical scores in user-facing surfaces**. Internal `composite_score` and `fit_score` REAL columns stay in `run_matches` (used for sorting + Drafter selection). Dossier UI displays qualitative tiers ("Strong fit", "Solid fit", "Worth applying", "Wrong room — see why") mapped from the score ranges; raw numbers do not appear in user-facing surfaces.

Other notes that landed as structural decisions but were not specifically called out in the prompt: Note 4's `identity.artist_name` primacy (schema field added in `lib/schemas/akb.ts:9`, gap-detection priority bumped above `legal_name`, NAME_PRIMACY_CONSTRAINT in Drafter); Note 5's DEFAULT_EQUALS suppression for `legal_name`/`artist_name` and `citizenship`/`home_base.country` in `lib/akb/gaps.ts:55–104`.

---

## 11. Path B (post-hackathon multi-tenant) hooks

Path A ships single-tenant; Path B is the multi-tenant deploy. The architecture is pre-wired so Path B is a small surface change.

**Already wired:**

- **Turso** scales multi-tenant out of the box. `users` table already exists with `id` PK and is referenced by every per-user row (`portfolio_images.user_id`, `style_fingerprints.user_id`, `akb_versions.user_id`, `runs.user_id`, etc.). Foreign keys are in place.
- **Vercel Blob** scales multi-tenant. Pathnames are user-scoped where it matters (e.g., `recipients/<opp_id>/...`, `originals/<sha256>.jpg`).
- **The agent orchestration pattern (poll-pull-on-read)** handles concurrent runs naturally because each run has its own `managed_session_id` and its own `run_event_cursors` row.
- **Auth seam.** `lib/auth/user.ts` exports `getCurrentUserId(): number` returning `1`. Every route uses it.
- **API key seam.** `lib/auth/api-key.ts` exports `getAnthropicKey(): string` returning `process.env.ANTHROPIC_API_KEY!`. Every `new Anthropic({ apiKey })` call goes through it. (`lib/anthropic.ts:8` constructs the singleton client from this seam.)

**What Path B requires:**

1. **Auth.** Add NextAuth or Clerk; wire to the `users` table. Replace the body of `lib/auth/user.ts:getCurrentUserId()` to return the session user's id. ~half day.
2. **BYO API key.** Add a Settings UI field for the user's `ANTHROPIC_API_KEY`. New `user_api_keys` table; encrypt at rest with `crypto.subtle` AES-GCM keyed off an `ENCRYPTION_KEY` env var. Replace the body of `lib/auth/api-key.ts:getAnthropicKey()` to look up the per-user key. **One known refactor needed:** several agent modules (`style-analyst.ts`, `interview.ts`, etc.) construct `getAnthropic()` at module top level, caching the key at import time. For Path B, move client construction into request handlers so per-request user keys flow through. About 30 min of mechanical edits.
3. **Run rate limits.** New per-user counter, enforced in `app/api/runs/start/route.ts` before insert.

Estimated total: ~1–1.5 days. The agent code, schema, and storage layers are unchanged.

---

## Source map (key files referenced in this document)

```
lib/
  anthropic.ts                       # singleton client + MODEL_OPUS
  anthropic-retry.ts                 # withAnthropicRetry wrapper (Note 11)
  anthropic-files.ts                 # normalizeForVision + uploadVisionReadyImage (Sharp-normalize + fail-loud, Notes 8/28)
  agents/
    style-analyst.ts                 # chunked vision pipeline
    knowledge-extractor.ts           # URL ingestion w/ identity anchor (Note 3)
    interview.ts                     # gap-driven conversational AKB fill
    opportunity-scout.ts             # Managed Agent session + persist_opportunity
    rubric-matcher.ts                # Managed Agent + image content blocks (sequential per-opp dispatch)
    package-drafter.ts               # 4 materials × top 15 matches; FINGERPRINT_CONSTRAINT, NAME_PRIMACY_CONSTRAINT
    orchestrator.ts                  # composite scores + cover/ranking/filtered narratives
    run-poll.ts                      # poll-pull loop, requires_action handler, terminal CAS
    json-parse.ts                    # parseLooseJson
  akb/
    gaps.ts                          # priority tiers + DEFAULT_EQUALS + citizenship suppression
    merge.ts, persistence.ts         # AKB versioning + RFC 7396
  extractor/
    auto-discover.ts                 # streaming web_search + parseDiscovery
    ingest-urls.ts
  schemas/
    akb.ts                           # ArtistKnowledgeBase + .deepPartial() (zod ^3)
    style-fingerprint.ts             # StyleFingerprint
    opportunity.ts                   # Opportunity, OpportunityWithRecipientUrls (age_range tuple→array fix)
    match.ts                         # RubricMatchResult
    run.ts, discovery.ts
    sanitize.ts                      # sanitizeJsonSchema (strip Anthropic-rejected keys)
  db/
    schema.sql                       # single source of truth
    client.ts                        # ensureDbReady + self-healing sentinel
    migrations.ts                    # idempotent application of schema.sql
    queries/
      portfolio.ts                   # canonical getPortfolioCount (Note 7)
      runs.ts
      untrusted-sources.ts           # Note 10
  api/
    fetch-client.ts                  # client-side fetchJson
    response.ts                      # withApiErrorHandling
  auth/
    user.ts, api-key.ts              # Path B seam

app/
  (onboarding)/upload, interview, review
  (dashboard)/runs/new, runs/[id], dossier/[runId]
  api/
    portfolio/upload                 # multipart, sharp, exifr, dedupe
    style-analyst/run                # POST analyzePortfolio
    extractor/auto-discover          # SSE stream
    extractor/ingest, turn           # URL ingest, interview turn
    akb/{current, finalize, manual-edit, delete-fact, untrust-source, validate}
    runs/start                       # creates run, starts Scout session
    runs/[id]/events                 # poll-pull-on-read
    runs/[id]/finalize-scout         # Files API mounting (Note 8)
    runs/[id]/start-rubric           # Rubric session, setup user.message with image content blocks
    runs/[id]/finalize               # Orchestrator + Drafter
    dossier/[runId]/pdf, /match/...  # PDF render, docx export
    health, health/schema, health/web-search

scripts/
  setup-managed-agents.ts            # one-time agent provisioning
  reset-db.ts, seed-export.ts, seed-demo.ts
```

---

## Notes on what this document doesn't cover

- **PDF rendering.** `@react-pdf/renderer` declarations live in `app/(dashboard)/dossier/[runId]/`; the structure mirrors the dossier React tree but isn't load-bearing for the architecture.
- **Settings UI.** `app/settings/` exists for the API key field and health-check dashboard; out of scope here.
- **Demo seed scripts.** `scripts/seed-export.ts` and `scripts/seed-demo.ts` (Note 9) are dev tooling — they capture/restore a known-good DB state for fast iteration on the run/Rubric/Drafter loop without redoing 15+ minutes of onboarding per iteration.

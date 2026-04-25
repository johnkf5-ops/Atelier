# Atelier

**An AI art director for working visual artists.** Submission to the Cerebral Valley × Anthropic *Built with Opus 4.7* hackathon (Apr 21–26, 2026). Solo build by John Knopf — Emmy-nominated landscape photographer, two physical galleries, published by National Geographic, TIME, Red Bull, USA Today, Billboard, and Google. Problem statement #1: *Build From What You Know*.

Repository: `github.com/johnkf5-ops/Atelier` · Live deploy: Vercel (Deployment Protection off for judges) · Demo video: linked in `README.md`.

---

## 1. The problem

I am a working photographer with fifteen years of credentials. I have been Emmy-nominated, published by National Geographic and TIME, run two physical galleries, sold work through TIMEPieces, shot for Red Bull. In fifteen years, I have applied to **zero** grants, residencies, or institutional opportunities.

The reason is the writing wall.

Every grant, every residency, every competition, every commission gate uses the same filter: a 500-word artist statement, a 1,500-word project proposal, a CV in the institution's exact format, a cover letter in the institution's voice. The application is not a measure of artistic quality — it is a measure of writing skill, institutional fluency, and the patience to spend forty hours on a package whose probability of acceptance is single digits. Working artists self-select out of the entire institutional pipeline because the bureaucratic surface is hostile to their actual practice.

I am the prototypical user. I have the credentials, the body of work, the gallery representation, and the publishing record that would make me a competitive applicant on paper. I cannot write the paperwork. So I do not apply. The same is true for thousands of working visual artists in the United States, and millions globally. Applications get filed by artists who can write or who can pay someone to write — not by artists who can see and make. The institutional pipeline is being filled by the wrong people, and the right people are being filtered out at a layer that has nothing to do with art.

That is the wall Atelier removes.

---

## 2. The solution

Atelier is a single-shot, long-running synchronous agent system. It runs ten to thirty minutes end-to-end and produces a **Career Dossier**: a ranked list of grants, residencies, competitions, and gallery opportunities that actually fit the artist's aesthetic, with submission-ready application materials drafted for each, with honest per-opportunity reasoning explaining why each one is or is not the artist's room.

The pipeline:

1. **Portfolio upload** — drag-drop 20–100 images, or paste a Squarespace/portfolio URL and the scraper pulls them. Stored in Vercel Blob.
2. **Style Analyst** — Opus 4.7 vision over the full portfolio. Produces a structured `StyleFingerprint`: lineage (named precedents), composition grammar, light register, palette, subject categories, career-positioning read. Calls precedents by name (Adams, Sugimoto, Misrach, McCaw) instead of using empty adjectives. This is the primitive everything downstream depends on.
3. **Knowledge Extractor** — *novel primitive #1*. Auto-discovers the artist's public web presence from name + medium + location + affiliations, ranks results, fetches them with a snippet-fallback for JS-rendered sites, and runs identity-anchor enforcement so facts about a same-name different person never enter the Knowledge Base. Then a structured text interview fills gaps detected against the AKB schema. Output: a versioned Artist Knowledge Base — the durable user asset, reusable across every future run.
4. **Opportunity Scout** — Anthropic Managed Agent. Searches across multiple opportunity archetypes (federal grants, state arts council fellowships, residencies, photography prizes, commissions, gallery open calls) for live deadlines in the user's window. Returns a structured list of opportunities with each one's past recipients (last three cycles), each recipient's bio URL and three to five portfolio image URLs.
5. **Past-recipient downloader** — server-side, not an agent. For each Scout-discovered recipient, downloads their portfolio images, mirrors them to Vercel Blob, and uploads them to the Anthropic Files API. Each opportunity ends up with its cohort mounted as Files API resources the Rubric agent can read.
6. **Rubric Matcher** — *novel primitive #2*, also a Managed Agent. For each opportunity, mounts the cohort's images into the agent's session via the Files API `resources[]` parameter, mounts the user's portfolio the same way, scores fit (0.0–1.0) against the cohort, writes reasoning that names specific recipients and specific portfolio images. Drops opportunities below threshold but keeps the reasoning so the dossier can show *why not*.
7. **Package Drafter** — for the included opportunities, drafts artist statement, project proposal, CV in the institution's required format, and cover letter. Writes in the institution's voice (Guggenheim ≠ MacDowell ≠ Nevada Arts Council), pulled from the per-medium and per-institution skill files. Pulls every fact from the AKB so nothing is invented; the byline is always the artist name (Note 4 schema work), the legal name appears only in administrative sections.
8. **Orchestrator + Career Dossier** — Opus 4.7 with long context synthesizes a cover narrative, a ranked list with qualitative tier labels (Strong fit / Solid fit / Worth applying / Long shot — not raw scores), per-opportunity reasoning disclosures, and a "we considered these but they're not your room" section for the filtered-outs. Web view + PDF export via `@react-pdf/renderer`.

Six specialist agents, one orchestrator, one user-visible artifact.

---

## 3. Two novel primitives

These are the hackathon-distinctive contributions. Both are inspectable in the repo (`lib/agents/knowledge-extractor.ts`, `lib/extractor/auto-discover.ts`, `lib/agents/rubric-matcher.ts`, plus the system prompts derived from the skill files).

### 3.1 Knowledge Extractor — building structured ground truth from a noisy web

The pre-existing pattern for "what does a model know about this person" is RAG over a vector store, or a single web search. Both fail on working artists. Most working artists are not Wikipedia-prominent. Their web presence is half-broken: gallery sites ten years stale, podcast pages bot-blocked behind Cloudflare, modern artist sites built as JavaScript SPAs that server-side fetchers cannot read, and search results polluted by other people who share the artist's name.

The Knowledge Extractor is the agent that solves this end-to-end:

- **Search → rank → top-K**. Web search returns dozens of links. A Claude pass ranks them by *(name match × location match × medium match × is-this-actually-the-right-person confidence)* and keeps the top 15. Noise is eliminated before any fetch budget is burned.
- **Two-tier fetch with snippet fallback**. For each ranked URL, attempt `web_fetch`. If the fetch returns 404, 403, an empty body, or fewer than 50 characters of extractable text (the JS-SPA case), fall back to the search-engine snippet that already exists for that URL. Snippets are JS-rendered as Google sees them, which is often sufficient for fact extraction. Both fetch and snippet feed the same extractor pass. This single change recovers about half of the previously-dropped sources.
- **Identity-anchor enforcement.** The disambiguated identity (`{ name, location, medium, affiliations }`) is passed as a structured constraint into every per-source extraction prompt. The model rule: *"If this source describes a different person matching the same name, return zero facts for this source. Only extract facts that are unambiguously about this anchor."* The first prod run hallucinated a "StarCraft competition winner" award onto John (wrong John Knopf). After identity-anchor enforcement landed, that class of fact is structurally impossible to ingest. See `WALKTHROUGH_NOTES.md` Note 3 for the full diagnosis and the structural fix.
- **Untrusted-source tracking.** When a user deletes a fact on `/review` and confirms "delete + untrust source," the source URL goes into an `untrusted_sources` table. Future ingests skip those URLs forever. The same hallucination cannot re-enter on the next run.
- **Gap-detection interview.** After ingestion, the Extractor runs the AKB schema against what's filled in and asks targeted questions for what's empty. The schema treats `artist_name` as primary identity (the public-facing byline) and `legal_name` as administrative metadata; the interview asks artist name first and only conditionally asks for legal name. Home base is asked once as a structured city/state/country form. Citizenship defaults to the home country and only re-fires if the user differs. No question is ever asked twice in sequence (Notes 4 and 5).

The output is a versioned Artist Knowledge Base — the structured ground truth the Rubric Matcher and Package Drafter both depend on. It is the user's durable asset across every future run.

### 3.2 Rubric Matcher — aesthetic-judgment-as-matching at scale

This is the expressive core. It is the capability that, as far as I have seen, has not been demonstrated at this surface area before.

The premise: *the cohort is the rubric*. What an institution says it values is press-release text. What it has actually selected in the last three cycles is the functioning rubric. To score an artist's fit for an opportunity, you cannot read the prospectus — you have to read the cohort, derive its aesthetic signature, and compare the artist's portfolio to that signature with reasoning.

Mechanics:

- For each opportunity, the past-recipient downloader (`scripts/recover-finalize-scout.ts`, `app/api/runs/[id]/finalize-scout/route.ts`) pulls the cohort's portfolio images and uploads them to the Anthropic Files API. The file IDs are persisted on `past_recipients.file_ids`.
- A Rubric session is created via `client.beta.sessions.create()` with the recipient image files and the user's portfolio mounted as `resources[]`. The agent sees `/workspace/portfolio/{N}.jpg` and `/workspace/recipients/{opp_id}/{recipient}/{N}.jpg` as a real filesystem.
- The agent's system prompt is `juror-reading.md` + `aesthetic-vocabulary.md` concatenated — the two highest-leverage skill files. Juror-reading codifies how selection panels actually work (rotating panels, consensus-darling vs decisive-champion dynamics, cohort coherence beats individual brilliance, read the negative space, process-forward beats subject-forward). Aesthetic-vocabulary forces the agent to use named precedents and a controlled grammar instead of soft adjectives — every descriptive claim must resolve to a term in the file or a named precedent.
- The agent reads each recipient's images, derives the cohort signature in one sentence, then scores the user's portfolio against that signature. Calls `persist_match` (a custom tool) with `{ opportunity_id, fit_score, included, reasoning, supporting_image_ids, hurting_image_ids }`. Reasoning paragraphs name the cohort's aesthetic axis, name the specific portfolio images that support or undermine the match, and name the gap.

The harsh-truth honesty is the product. The Rubric does not flatter. From the actual run that produced the demo material:

> *"Guggenheim Photography fellows in this cohort — Chris McCaw and Cheryle St. Onge — operate in a register defined by restraint, conceptual armature, and material inquiry. Knopf's portfolio is the opposite vector: saturated Peter-Lik-tier sunset panoramas (47, 74), centered under-pier symmetry (10), Thomas-Kinkade village nocturnes (62), and HDR waterfalls (89) built on preset-driven chroma rather than authored position. The gap between this work and a McCaw or St. Onge portfolio is generational, not marginal."*

Guggenheim Photography Fellowship: fit **0.08**. Then, on the same run, Nevada Arts Council Artist Fellowship: fit **0.58**, with reasoning naming the Las Vegas residency, two-gallery representation, and NatGeo/TIME publication record as the precise career-stage markers Nevada Arts Council panels reward. Same artist, same portfolio, same run — one system, two honest verdicts. The artist now knows the room they are in and the room they are not in. That is what the Rubric Matcher does.

---

## 4. How it maps to the judging criteria

The hackathon weights are: **Impact (30%), Demo (25%), Opus 4.7 Use (25%), Depth & Execution (20%)**. Atelier addresses each with concrete evidence in the repository.

### Impact (30%)

- **Audience.** Hundreds of thousands of working US visual artists; millions globally. The same bureaucratic wall exists in every adjacent creative profession (writers, composers, filmmakers, choreographers).
- **Stakes.** Billions of dollars in annual grants, gallery sales, and commission allocations are routed through application bureaucracy. Most of that money is allocated by who can write the paperwork, not who can make the work.
- **Institutional weight.** Atelier's outputs are filed with NEA, Guggenheim, Creative Capital, MacDowell, NYSCA, Nevada Arts Council, real galleries, real municipal commissions. The dossier is not a toy — it is the artifact a working artist hands to an institution.
- **"Build From What You Know" fit.** The builder is the prototypical user. Fifteen years in the working-artist economy. Has lived the pain exhaustively. Has applied to zero opportunities. Will use this tool to apply to several within days of submission. The product is not theoretical.
- **Compression.** The status quo: forty hours per application, ten applications per year, single-digit win rate. Atelier compresses the discovery + matching + drafting work into a single ten-to-thirty-minute run; the artist's remaining work is review, edit, submit. The compression unlocks application *volume* the artist could never have done by hand, which is the actual lever for institutional outcomes.

### Demo (25%)

- **Real data, real institutions, no canned outputs.** The demo run uses the builder's actual 21-image portfolio, real Anthropic Files API uploads, real web search against live opportunity sources, real Rubric scoring against the verified 2024 Guggenheim Fellow cohort.
- **Live recording of Style Analyst.** The first vision pass is recorded live during the demo — the StyleFingerprint writes itself in front of the camera. Voiceover reads Claude's actual output naming Peter Lik / Trey Ratcliff as anti-references for the builder's own work.
- **Rubric harsh-truth pivot.** The demo spine is the Guggenheim 0.08 reasoning above, held on screen, then the right-room flip to Nevada Arts Council 0.58 with the cohort-fit reasoning. This is the moment the product reveals what it actually does. It refuses to flatter.
- **Drafted statement read on camera.** The builder reads the Drafter's Nevada Arts Council artist statement on camera. Every fact in it is true. The voice is institutional, not the builder's. The artist visibly reacts.
- **Kicker.** "I'm submitting to three of these next week."

The demo is shot to three minutes per the spec's shot-list and is built from a single end-to-end run, not stitched from rehearsals.

### Opus 4.7 Use (25%)

Atelier is built *with* Opus 4.7 and uses Opus 4.7 in production. Specific surfaces:

- **Vision over large image sets.** Style Analyst reads 20–100 user portfolio images plus, per Rubric session, three to five images each across multiple recipient cohorts. The demo run's Files API bill alone shows tens of mounted recipient images per opportunity.
- **Long context.** Orchestrator runs over the full StyleFingerprint, full AKB, all twelve discovered opportunities with their reasoning paragraphs, plus the relevant skill files. Cover narrative + ranking narrative + per-opportunity filtered-out blurbs are all generated in one Opus 4.7 pass.
- **Managed Agents.** Scout and Rubric run as Anthropic Managed Agents (`agent_toolset_20260401`, `managed-agents-2026-04-01` beta header). The agent loop runs on Anthropic's orchestration layer, not on Vercel. Our routes kick off sessions and use the poll-pull-on-read pattern to survive Vercel's 60s function timeout. See §7.
- **Adaptive thinking.** `thinking: { type: 'adaptive' }` on narrative and judgment-heavy calls. No hand-tuned `budget_tokens`.
- **Skills as codified knowledge.** Twenty-one skill files (`skills/`) mount into agent system prompts as ground truth. Juror-reading and aesthetic-vocabulary feed the Rubric. Artist-statement-voice, project-proposal-structure, cv-format-by-institution feed the Drafter. Opportunity-sources and eligibility-patterns feed Scout. Each file is hand-audited against published primary sources.
- **Custom tools as persistence boundary.** `persist_opportunity` and `persist_match` are custom tools the Managed Agents call to write structured results back to Turso. The agent does not have to manage a workspace filesystem of result files; the orchestrator owns persistence.
- **Novel capability demonstrated.** The Rubric Matcher's aesthetic-judgment-as-matching at scale, with cohort images mounted as Files API resources and reasoning that names specific recipients and specific portfolio images, is the use of Opus 4.7 the project is built around.

### Depth & Execution (20%)

- **`BUILD_LOG.md`** is the prose narrative of what actually happened during the build. Every shipped commit is accounted for.
- **`WALKTHROUGH_NOTES.md`** is fourteen production-bug walkthrough notes from the builder's incognito prod walk-throughs. Each note is root-caused, each fix is structural (not a patch), each ships with regression-test coverage. The notes are the visible-craft evidence: this is what discipline looks like when the builder is also the user.
- **Twenty-one skill files**, each citing primary sources (NEA review process pages, MacDowell application guidelines, Creative Capital published reports, gallery directories, juror essays). Inspectable in the repo.
- **Real architectural choices, defensible on craft grounds.** Vision-first over embeddings (more capable for aesthetic reasoning, simpler architecture). Poll-pull-on-read over Cloud Run (no own worker, survives Vercel's function timeout, decouples agent runtime from our infra). Identity-anchor enforcement over post-hoc validation (structurally impossible to ingest a wrong-person fact instead of "we'll catch it on review"). Single source of schema truth in `lib/db/schema.sql` after a structural consolidation pass. Centralised query module `lib/db/queries/portfolio.ts` after the upload-vs-runs-page count drift bug (Note 7 fix). Each of these is documented in the build log with the "why" not just the "what."

---

## 5. Side-prize positioning

Atelier targets three of the $5k side prizes.

### Best Use of Claude Managed Agents ($5k)

- Scout and Rubric run as Managed Agents using the `managed-agents-2026-04-01` beta header. Configuration is one-time via `scripts/setup-managed-agents.ts` (idempotent: `findOrCreateEnvironment` / `findOrCreateAgent` patterns), with `ATELIER_ENV_ID`, `SCOUT_AGENT_ID`, `RUBRIC_AGENT_ID` stored in environment variables.
- Both agents use `agent_toolset_20260401` (verified end-to-end on the org: web_search, web_fetch, bash, read with multimodal vision all green).
- Custom tools `persist_opportunity` and `persist_match` give the agents a structured persistence boundary back to Turso.
- The Rubric Matcher mounts past-recipient images via the Files API `resources[]` parameter — a nontrivial Managed Agents pattern that enables vision-based aesthetic comparison inside the session.
- Long-running runs are handled via **poll-pull-on-read**: API routes kick off sessions and return immediately. The browser polls `/api/runs/[id]/events` every three seconds; each poll calls `client.beta.sessions.events.list()` against Anthropic, persists new events to Turso, returns the diff. There is no Cloud Run, no own worker process. The agent loop runs on Anthropic; our infrastructure runs the poll. This is the long-running pattern Managed Agents was designed for, used as designed.

### Most Creative Opus 4.7 Exploration ($5k)

The Rubric Matcher is the expressive core and the surface judges have not seen before. Aesthetic judgment is not a common LLM use. Rubric Matcher does it at scale with reasoning that names specific past recipients, names specific user portfolio images that support or undermine the match, uses the controlled vocabulary defined in `aesthetic-vocabulary.md` (named precedents over adjectives), and produces calibrated honesty: the Guggenheim 0.08 + Nevada Arts Council 0.58 pivot on the same portfolio in the same run. The system tells the artist their aspirations are wrong about Guggenheim *and* tells them where they actually fit. That harsh-truth honesty is the creative move — most LLM products are sycophantic; Rubric Matcher is the opposite.

### Keep Thinking ($5k)

Visual arts bureaucracy is an unexpected target domain for Claude. Most LLM tools target obvious B2B verticals — sales, support, code, legal, finance. Visual artists are a marginalized creative profession that has been almost entirely neglected by the LLM tool economy, despite being one of the clearest fits for what these models actually do well: sustained-context reasoning over messy structured + unstructured data, aesthetic reasoning over images, institutional voice generation. Atelier is the move that lands somewhere nobody else looked.

---

## 6. The demo narrative

The three-minute video tells one story.

**Cold open.** Black screen, white text: *"Most working artists spend 30% of their time on applications that were never going to win."* Cut to the builder on camera, in his Las Vegas gallery: *"I'm John Knopf. Fine-art landscape photographer. Emmy-nominated. Published by Nat Geo, TIME, Red Bull. Two galleries. After fifteen years, I have never applied to a single grant. Because I can't write the paperwork."*

**Style Analyst fires live.** First emotional beat. The builder uploads his portfolio (or auto-scrapes from `jknopf.com`). The vision pass runs in real time. Voiceover reads Claude's actual output naming the lineage — and naming Peter Lik and Trey Ratcliff as anti-references the builder's portfolio sits adjacent to. The system has just told the builder something true about his own work that flatters nothing.

**Knowledge Extractor.** Builder on camera: *"I have never written an artist statement in my life. Two galleries, Emmy nomination, TIME, National Geographic. Never written a word about my own work. Let's see if Claude can."* Cut to auto-discover: search ranks, identity-anchor enforcement skips the wrong-John-Knopf hits, the AKB fills in. Then targeted gap-interview questions; builder types short answers. The Knowledge Base is built from public web data plus a few minutes of structured input.

**Opportunity Scout + Rubric Matcher** — 10× playback of the actual run. The demo-spine moment: the dossier shows Guggenheim Photography Fellowship at fit 0.08, *included = false*. Hold on the reasoning paragraph: *"Guggenheim Photography fellows in this cohort — Chris McCaw and Cheryle St. Onge — operate in a register defined by restraint, conceptual armature, and material inquiry. Knopf's portfolio is the opposite vector..."* The system has refused the builder's most aspirational target with named recipients and named images.

**The right-room flip.** Cut to the same run's top included match: Nevada Arts Council Artist Fellowship, fit 0.58. Voiceover reads the reasoning naming the Las Vegas residency, two-gallery representation, and NatGeo/TIME publication record as the precise career-stage markers Nevada Arts Council panels reward. The system has just surfaced a regional fellowship the builder would never have prioritized, and explained exactly why it is the right room.

**Package Drafter.** The builder reads the Drafter's Nevada Arts Council artist statement on camera. Every fact in it is true about him. The voice is institutional. The byline uses his artist name. The builder reacts: *"I couldn't have written this. But every fact in it is true about me. And it's better than anything I would have put on paper."*

**Kicker.** *"This isn't a demo. I'm submitting three of these next week."* End card: project name, GitHub link.

The narrative shift is the product. The system does not flatter — it tells the artist the truth their own aspirations are obscuring, then surfaces the rooms where they actually fit. That is the harder, more honest product claim.

---

## 7. Architecture in one paragraph

Next.js 15 (App Router) + React 19 + TypeScript + Tailwind v4 frontend. Turso (LibSQL, wire-compatible SQLite, free tier 5GB) via `@libsql/client` for persistence — single DB from day one, no local-file-then-migrate step. Vercel Blob (free tier 1GB) for portfolio images and recipient image mirroring. `@anthropic-ai/sdk` for direct specialist calls (Style Analyst, Knowledge Extractor, Package Drafter, Orchestrator) and Managed Agents (Scout, Rubric Matcher) using the `managed-agents-2026-04-01` beta header. The Managed Agent loop runs on Anthropic's orchestration layer; per-session containers execute the `agent_toolset_20260401` tools (bash, read, write, edit, glob, grep, web_fetch, web_search). No Cloud Run, no own worker process. Long-running runs survive Vercel's 60s function timeout via **poll-pull-on-read**: an API route kicks off the Managed Agents session and returns immediately with the session ID; the browser polls `/api/runs/[id]/events` every three seconds; each poll pulls new events from Anthropic via `client.beta.sessions.events.list()`, persists them to Turso, returns the diff. Twenty-one skill files (`skills/`) curated from primary institutional sources (NEA grant-review pages, MacDowell application guidelines, Creative Capital reports, Guggenheim FAQ, gallery directories, juror essays) mount into agent system prompts as ground truth. PDF export via `@react-pdf/renderer`. Image preprocessing via `sharp`. Validation via `zod`. Deploy is Vercel for the entire app. See `ARCHITECTURE.md` for the full system breakdown and `ATELIER_BUILD_PLAN.md` for the implementation plan with full DDL, agent prompts, custom-tool schemas, and amendments.

---

## 8. What we built in three days

Concrete, measurable shipped scope.

**Six specialist agents** (`lib/agents/`):

- `style-analyst.ts` — vision pipeline over the full portfolio, chunked + parallel, retry-wrapped against transient 529s.
- `knowledge-extractor.ts` + `interview.ts` + `lib/extractor/auto-discover.ts` + `lib/extractor/ingest-urls.ts` — auto-discovery, identity-anchor enforcement, snippet fallback, gap-detection interview, AKB versioning.
- `opportunity-scout.ts` — Managed Agent client, custom-tool persistence boundary.
- `rubric-matcher.ts` — Managed Agent client, Files API resource mounting, juror-reading + aesthetic-vocabulary system prompt, harsh-truth scoring with included/excluded reasoning.
- `package-drafter.ts` — institutional voice writing per skill files, name-primacy constraint, AKB-grounded fact pulling.
- `orchestrator.ts` — long-context cover narrative + ranking narrative + filtered-out blurbs.

**Twenty-one skill files** (`skills/`) — opportunity-sources, eligibility-patterns, juror-reading, aesthetic-vocabulary, artist-statement-voice (general + per-medium), project-proposal-structure, cv-format-by-institution, cover-letter-templates, past-winner-archives, cost-vs-prestige-tiers, submission-calendar, gallery-tier-taxonomy, museum-acquisition-pathways, photography-specific-lineages, regional-arts-economies, medium-specific-application-norms, work-sample-rationale-patterns, timeline-by-opportunity-type, interview-question-templates, akb-disambiguation-patterns. Each cites primary sources.

**Fourteen walkthrough-driven structural fixes**, documented in `WALKTHROUGH_NOTES.md` and shipped per the entries in `BUILD_LOG.md`. A representative subset:

- *Note 3* — auto-discover product failure. Identity-anchor enforcement, snippet fallback for JS-rendered SPAs, top-K cap on noisy search. Wrong-John-Knopf hallucination is now structurally impossible to ingest.
- *Note 6* — interview submit intermittent 500. Two root causes: Anthropic transient throws were escaping agent helpers (fix: `lib/anthropic-retry.ts` with exponential backoff on 408/409/425/429/5xx + ECONNRESET); turn-index race on concurrent submits (fix: atomic `COALESCE(MAX+1)` INSERT + UNIQUE INDEX). Plus a systemic fetch-contract sweep: every client `fetch` migrated to `fetchJson` (`lib/api/fetch-client.ts`), an ESLint guard banning raw `fetch` in `app/**` and `components/**`, an API error-contract test asserting every route returns JSON-bodied 4xx/5xx never an empty body.
- *Note 7* — `/runs/new` reported 0 portfolio images while `/upload` showed 21. Inline count query had `Number((rowObj))` instead of `Number(rowObj.n)`, returning `NaN || 0`. Structural fix: every portfolio query now goes through `lib/db/queries/portfolio.ts`. No more inline counts in three different places that drift.
- *Note 8* — past-recipient `file_ids` empty on prod, Rubric scored 1 of 12 opportunities. Six-part fix: SELECT filter recovery clause, fail-loud Files API uploads (no swallowed catches), post-pass audit emitting `rubric_will_be_blind` events when zero file_ids exist after finalize, Rubric prompt declaring exact mount paths upfront and banning bash-fishing, prompt-level safety-reminder ack suppression, idempotent recovery script. Plus a smoke test asserting the SELECT-filter contract.
- *Note 9* — `pnpm seed:export` + `pnpm seed:demo` permanent dev tool. Eliminates the 15-minute re-onboarding tax on every debug iteration. Captures portfolio + AKB + fingerprint + interview turns as fixtures, restores them into a wiped target DB in 30 seconds. Belt-and-suspenders against accidental prod wipes.
- *Note 10* — delete-any-fact + untrust-source data-integrity work. Per-row delete on every AKB array section, optional source untrust, `untrusted_sources` table that ingest filters against. The StarCraft hallucination cannot re-enter on the next ingest.
- *Note 11* — systemic Anthropic retry audit. Every Anthropic call site wrapped in `withAnthropicRetry`. ESLint guard bans direct `await client.messages.create(...)` / `await client.beta.sessions.create/retrieve(...)` / `await client.beta.sessions.events.send(...)` / `await client.beta.files.upload(...)` to prevent future regressions. Capacity probe on `/api/health`. Smoke test locks the retry contract.
- *Notes 13 + 14* — dossier polish. Internal scores replaced with qualitative tier labels (Strong fit / Solid fit / Worth applying / Long shot). Dates humanised. Money formatted. Decorative deadline timeline deleted; replaced with a sort toggle on the existing list (Best fit / Deadline / Prize amount).

**Full Vercel deploy** with Deployment Protection off so judges can land on the prod URL. Public GitHub repository at `github.com/johnkf5-ops/Atelier`.

**End-to-end pipeline run** that produced the demo material: 12 opportunities discovered across multiple archetypes, recipient images uploaded to the Files API, Rubric scoring producing the Guggenheim 0.08 anti-fit and the Nevada Arts Council 0.58 right-fit verdicts, Package Drafter producing artist statement + cover letter material in institutional voice for the included matches.

**Test coverage** — 75+ smoke tests (`tests/smoke/`) including DB bootstrap + self-heal, fetch-client error categorisation, API error contract, finalize-scout SELECT-filter contract, anthropic-retry contract, portfolio-count canonical query, auto-discover identity-anchor handling, interview schema gap ordering and suppression logic, copy/tier/date/money formatting. The structural-test discipline (write the regression test that prevents the same class of bug from re-shipping) is visible across every walkthrough note.

---

## 9. Why this matters beyond the hackathon

Visual artists are a marginalized creative profession in the LLM tool economy. The bureaucratic surface that gates institutional opportunity in the visual arts — grants, residencies, competitions, gallery representation, public commissions — is a writing surface, and writing is the wall between working artists and institutional access. Atelier removes the wall.

The pattern generalizes:

- **Writers** — submitting to literary magazines, residencies, MFA programs, Pushcart-tier prizes. Same juror dynamics. Same skill-file model. Same Drafter pattern.
- **Composers** — applying to commissioning organizations, fellowships, residencies. Same.
- **Filmmakers** — Sundance, Tribeca, IDFA, granting bodies. Same.
- **Choreographers, theater-makers, performance artists** — the same long tail of foundation grants, residencies, festivals.
- **Academic researchers in fields where institutional access is gated by writing surfaces.** The Rubric Matcher's cohort-as-rubric pattern translates directly to grant-program fit.

The architectural pattern (domain expert + multi-agent specialist system + skills as codified institutional knowledge + tangible institutional artifact as output) is the same pattern that won the Built with Opus 4.6 hackathon (CrossBeam — California ADU permit-response generator). Atelier extends it to a creative profession the LLM economy has not yet served.

**Path B — multi-tenant public deploy** is the immediate post-submission scope (clearly future work, not shipped). The build plan documents the path: NextAuth or Clerk for auth, BYO API key with encrypted storage, per-user run rate limits. About 1.5–2 days because Turso and Vercel Blob already handle multi-tenant load by design and the agent orchestration pattern (one `managed_session_id` per run) handles concurrent runs naturally. The hackathon submission ships single-tenant (Path A); the Path B migration hooks are pre-wired in `lib/auth/` and `lib/agents/` as flagged in the build plan.

---

## 10. Built by

**John Knopf** — Emmy-nominated fine-art landscape photographer; California native; self-taught. Galleries in Las Vegas (Stratosphere, opened 2012) and Minneapolis (12401 Wayzata Blvd, opened 2017). Published by National Geographic, TIME (TIMEPieces NFT collection), Red Bull, USA Today, Billboard, Google. Codes — built the precursor research project (Athena, ~33k lines of Next.js + TypeScript + SQLite, ~2 days) immediately before the hackathon; the velocity model carried into Atelier.

The builder has applied to zero grants, residencies, or institutional opportunities in fifteen years of working as a fine-art photographer. He is the prototypical user. The success criterion for the project is not the hackathon outcome — it is whether the builder personally submits to three real opportunities from his own dossier within seven days of submission close. The tool works in production for its builder, or it does not work.

**Engineering partner: Claude Opus 4.7.** The model is what the project is built *with*. The model is also what the project uses *in production* — Style Analyst, Knowledge Extractor, Opportunity Scout, Rubric Matcher, Package Drafter, and Orchestrator are all `claude-opus-4-7` calls with adaptive thinking. The submission is a Built with Opus 4.7 submission in both senses: built with the model, runs on the model.

Open-source-everything per the hackathon rule. No closed-source SaaS dependencies — voice input, embeddings, vector DBs, third-party transcription/synthesis services were all deliberately excluded. License: see `LICENSE` in repo root.

---

*Last updated 2026-04-25 for the 2026-04-26 8:00 PM EST submission deadline. See `README.md` for setup, `BUILD_LOG.md` for the chronological build narrative, `WALKTHROUGH_NOTES.md` for the production-bug walkthrough, `ART_DIRECTOR_SPEC.md` for the original product spec, `ATELIER_BUILD_PLAN.md` for the implementation plan, `ARCHITECTURE.md` for the technical architecture deep-dive, and `skills/README.md` for the skill-file catalog.*

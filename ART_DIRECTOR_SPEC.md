# Atelier — Hackathon Build Spec

*Working name. May still change before submission.*

## One-line

An AI art director that reads a visual artist's body of work and builds them a 90-day career plan with submission-ready application materials for the opportunities that actually fit.

## Positioning

For the **"Built with Opus 4.7" hackathon** (Apr 21–26, 2026). Targets **Problem Statement #1: "Build From What You Know"** — built by a working photographer for working photographers.

Direct reference project: CrossBeam (1st place, Opus 4.6). Same structural pattern — domain expert builds tool for their own field, long-running synchronous multi-agent system, skills-as-knowledge, tangible institutional artifact as output — applied to the visual arts economy instead of California housing permits.

## Problem statement

Every working visual artist in the US spends **30%+ of their working time on applications** — grants, residencies, competitions, gallery submissions, commissions — and most of those applications go to opportunities they were never going to win. The pain has three parts:

1. **Discovery is broken.** Real opportunities are scattered across CaFE, Grants.gov, NYFA Source, ResArtis, Alliance of Artists Communities, ArtDeadline, CODAworx, 50 state arts councils, and hundreds of foundation websites. No unified view exists.
2. **Fit is opaque.** Artists apply blindly to opportunities whose past recipients worked in completely different aesthetic territory. Application fees add up to thousands wasted per year.
3. **Materials take forever.** Each application needs a tailored artist statement, project proposal, CV in the institution's specific format, and a work-sample selection. Even with templates, each package is 6–10 hours.

The same artist can spend 40 hours preparing an application for a program they had a 3% chance of winning. That is the process that should take hours.

## Target user

**Working visual artists** at mid-career, US-based primarily, with an established body of work (20+ pieces) and intent to pursue institutional opportunities (grants / residencies / competitions / gallery representation / public commissions).

**Prototypical user = the builder.** Fine-art landscape photographer, Emmy-nominated, published by National Geographic / TIME / Red Bull / USA Today / Billboard / Google, two galleries (Las Vegas, Minneapolis), NFT collector via TIMEPieces. 15 years in the working-artist economy. Has lived the pain exhaustively.

## Product shape

A single-shot, long-running synchronous agent system. Runs 10–30 min. Produces a **Career Dossier** — a printable PDF + web view — ranked opportunities, draft application materials, per-opportunity fit reasoning that cites specific portfolio images.

### Inputs

1. **Portfolio** — 20–100 images uploaded (drag-drop). Optional: URL to existing portfolio site for auto-ingest in v1.1.
2. **Context** — name, medium, career stage, citizenship, home base, optional CV upload.
3. **Window** — applications with deadlines in next N months (default 6).
4. **Constraints** — budget cap for entry fees, maximum travel distance for residencies, eligibility filters.

### Specialist agents (6 in v1)

All implemented on Claude Agent SDK. Orchestrator runs on Opus 4.7. Heavy agents ported to **Claude Managed Agents** to handle long synchronous runtime and unlock the Best Managed Agents side prize.

**Onboarding pipeline (one-time, ~30–45 min first use):**

1. **Style Analyst** — Opus 4.7 vision over the full portfolio. Produces a structured aesthetic fingerprint: composition tendencies, palette, subject categories, light/tonal preferences, formal lineage/references, career-positioning read. This is the primitive everything downstream depends on.

2. **Knowledge Extractor** *(novel primitive #1)* — A conversational agent that builds the **Artist Knowledge Base (AKB)** for each user. Most working artists aren't googlable and can't write well about their own work. The Extractor solves both:
   - **Ingests** whatever IS public: scrapes user-provided URLs (personal website, gallery bio pages, press mentions, exhibition catalogs), extracts structured facts.
   - **Interviews** the user via text to fill gaps in the AKB: education, process, intent, influences, specific bodies of work, exhibitions, awards, career milestones, what the work is about.
   - **Gap detection**: identifies which AKB fields are empty after ingestion and targets interview questions at those specifically.
   - Output: a structured Artist Knowledge Base, versioned, stored in SQLite. Durable user asset — reusable across every future run.

**Main run pipeline (10–30 min per run, repeatable):**

3. **Opportunity Scout** *(Managed Agent)* — Searches 40+ pre-curated high-signal sources (see Data Sources section) for current open calls with deadlines in the user's window. Filters by hard eligibility (citizenship, medium, career stage — pulled from AKB). Returns structured candidate list. Runs long; ideal Managed Agents use case.

4. **Rubric Matcher** *(novel primitive #2)* — For each candidate opportunity, fetches past recipients (last 3 years) via web search, reads their bios and portfolios, synthesizes the *aesthetic signature* of the selecting juror/institution, scores the user's portfolio fit against that signature (0–1). Produces: fit score, reasoning, specific portfolio images that support the match, specific images that hurt the match. Drops candidates below threshold (default 0.45). **This is the capability judges haven't seen — aesthetic-judgment-as-matching at scale.**

5. **Gallery Targeter** *(Rubric Matcher applied to galleries)* — Same primitive, different data source. For galleries taking open submissions, fetches their currently represented artists, derives the gallery's aesthetic thesis, scores user portfolio fit. Reuses 80% of Rubric Matcher code.

6. **Package Drafter** — For top 10–15 matched opportunities, generates submission-ready materials: artist statement, project proposal, CV formatted per each institution's stated format, cover letter, work-sample selection with image-by-image rationale. **Writes in the institutional voice each opportunity expects** (Guggenheim reads different from MacDowell reads different from a gallery open call — skill file codifies this). Pulls facts from the AKB. Outputs to a structured object. No "match the artist's voice" — artists admit they write badly and want better-than-themselves prose.

### Orchestrator

Opus 4.7 with long context. Synthesizes specialist outputs into the final Career Dossier. Ranks opportunities by composite score (fit × prestige × win-probability × time-to-deadline). Writes the "why this ranking" narrative. Explains to the user *why not* to apply to the filtered-out opportunities — this is a feature, not a by-product; artists need to know what they're bad fit for.

### Output: Career Dossier

- **Cover page** — personalized career-positioning summary based on Style Analyst output. Named the "aesthetic read" in the UI.
- **Top 10–15 opportunities**, each with: logo, deadline, award amount / prestige tier, fit score + reasoning, draft materials link, direct submission link.
- **Deadline calendar** — visual timeline across the window.
- **Filtered-out opportunities** with one-line "why not" reasoning each.
- **Draft materials** for top opportunities, inline and downloadable as docx.
- **PDF export** of the whole dossier, printable.

## Technical stack

- **Next.js 15 + React 19 + TypeScript** — app framework, server actions for agent orchestration.
- **`node:sqlite`** — persistence for portfolio uploads, opportunity cache, dossier history. No external DB.
- **`@anthropic-ai/sdk`** — primary API surface.
- **Claude Agent SDK** — multi-agent orchestration.
- **Claude Managed Agents** — Opportunity Scout + Rubric Matcher (the long-running bits).
- **Native Claude web search** — primary research tool for all agents.
- **Tailwind v4** — UI.
- **Puppeteer or `@react-pdf/renderer`** — Dossier PDF export.
- **Sharp** — portfolio image preprocessing (resize, EXIF strip, thumbnail gen).

No external vector DB, no Qdrant, no embeddings in v1. Style matching is done via Opus vision + long context, not embeddings. This is a deliberate choice — embeddings would be faster but demonstrably less capable of the kind of aesthetic reasoning the Rubric Matcher needs.

**No voice input in v1.** Text interview only for the Knowledge Extractor. Voice adds closed-source external dependencies (Deepgram/ElevenLabs) that violate the hackathon's open-source-everything rule, and adds zero points on the scoring rubric. Artists who claim they can't write can still type — that's different from writing prose. The Knowledge Extractor asks structured questions ("where were you born?", "which piece in your portfolio took longest to make?"); typing short answers is effortless.

## Data sources (the curated 40)

The seed list is codified as a skill file. Updating this list is itself the ongoing moat.

**Grants (federal + private foundation):**
- Grants.gov (federal, free API)
- NEA (National Endowment for the Arts)
- Creative Capital
- Guggenheim Fellowship
- Pollock-Krasner Foundation
- Joan Mitchell Foundation
- United States Artists
- Anonymous Was A Woman
- Ruth Arts Foundation

**State arts councils** (~15 seed states, expandable):
- California Arts Council, NYSCA, Minnesota State Arts Board, Texas Commission on the Arts, Illinois Arts Council, etc.

**Residencies:**
- MacDowell, Yaddo, Skowhegan School of Painting & Sculpture, Ucross, Djerassi, Headlands Center for the Arts, Hambidge, Virginia Center for the Creative Arts, Vermont Studio Center, ResArtis (aggregator), Alliance of Artists Communities (aggregator)

**Competitions / awards (photography-weighted for v1):**
- CaFE (CallForEntry.org — aggregator, huge coverage)
- Critical Mass (Photolucida)
- Aperture Portfolio Prize
- Hasselblad Masters
- Sony World Photography Awards
- Magnum Foundation grants
- Photographers' Fund (Format)
- National Geographic Explorer grants
- ArtDeadline.com (aggregator)
- PhotoContestInsider (aggregator)

**Public art / commissions:**
- CODAworx
- Public Art Network (Americans for the Arts)

**Gallery open calls:**
- A curated list of ~20 mid-to-top-tier galleries with public open-call processes, derived from the builder's lived knowledge.

## Skill files (the moat)

Following the CrossBeam pattern of skills-as-codified-lived-knowledge. Built during the hackathon from the builder's 15 years of experience. Target: 20–30 skill files.

**Categories:**

- `opportunity-sources.md` — the 40 curated sources with access notes
- `aesthetic-vocabulary.md` — composition grammar, light types, subject categories, formal lineage references for evaluating visual art
- `juror-reading.md` — heuristics for inferring juror aesthetic preferences from past selections
- `artist-statement-voice.md` — what a strong artist statement actually reads like, with anti-patterns
- `project-proposal-structure.md` — how grant-funders parse project proposals; what evaluators look for
- `cv-format-by-institution.md` — per-institution CV format conventions
- `eligibility-patterns.md` — common eligibility gotchas (citizenship, career stage, medium, prior-funding clauses)
- `submission-calendar.md` — seasonality of opportunity windows (when things open/close)
- `past-winner-archives.md` — where each opportunity publishes past recipient lists
- `cost-vs-prestige-tiers.md` — which entry fees are worth it, which are pay-to-play traps

Each skill file is a concrete artifact of the builder's lived knowledge. Inspectable by judges in the repo.

## Scope: v1 IN

- Style Analyst vision pipeline
- Knowledge Extractor (web ingestion + text interview + AKB schema + gap detection)
- Opportunity Scout with 40 curated sources
- Rubric Matcher (novel primitive — aesthetic-judgment-as-matching)
- Gallery Targeter (Rubric Matcher variant)
- Package Drafter (artist statement, project proposal, CV, cover letter — institutional voice)
- Orchestrator + Career Dossier output (web + PDF)
- Portfolio upload UI
- Settings UI (API key, model selector, health tests)
- Skill files (~20)
- Demo video, pitch, written summary

## Scope: v1 OUT (and why)

- **Auto-submit to forms.** Legal risk, bad demo (would make judges uncomfortable), distracts from the novel primitive.
- **Voice input for the Knowledge Extractor.** Closed-source SaaS dependencies violate the open-source rule. Text works.
- **Pricing strategy / edition structuring.** Different primitive (market comparables), adds surface area that doesn't demo well.
- **Film / music / literary.** Outside builder's domain credibility. Stay in visual arts.
- **International coverage** beyond obvious US-accessible global programs (Hasselblad, Sony, Magnum, etc.).
- **Collector / patron outreach.** Out of scope for career-opportunity focus.
- **Embeddings / vector DB.** Opus vision + long context is more capable and keeps the architecture clean.
- **Deadline reminders / calendar app.** Nice-to-have, trivial v2.
- **User accounts / multi-user.** Single-user local tool for v1.
- **Mobile.** Desktop-only; this is a deep-work tool.

## Demo strategy (3-min video arc)

The demo is 25% of the score. Shot-list this like a film.

**0:00–0:15 — Cold open.** Black screen. White text on screen: "Most working artists spend 30% of their time on applications that were never going to win." Cut to builder on camera, in gallery.

**0:15–0:45 — Identity + stakes.** "I'm John Knopf. Fine-art landscape photographer. Emmy-nominated. Published by Nat Geo, TIME, Red Bull. Two galleries. After 15 years, I still don't have a good way to know which grant to apply for this month." Cut to laptop — portfolio upload, 40 images dragged in.

**0:45–1:15 — Style Analyst fires. First emotional beat.** Screen shows the Style Analyst output writing itself. Voiceover reads Claude's output — not the builder's words, Claude's: *"Your work centers landscape sublimity, clean geometric composition, minimal human presence, cool-tonal palettes with sparing warm accents. References Ansel Adams' topographic formalism updated with contemporary long-exposure practice. Positioning: mid-career institutional track; under-leveraged for museum acquisition; ready for Guggenheim-tier applications."*

**1:15–1:45 — Knowledge Extractor. Second emotional beat.** Builder on camera: *"I've never written an artist statement. I have two galleries, Emmy nomination, TIME, National Geographic — and I've never written a word about my own work. Let's see if Claude can."* Cut to the Extractor asking targeted questions. Builder types short answers. AKB fills in visibly in a side panel.

**1:45–2:15 — Opportunity Scout + Rubric Matcher.** Watch agents fan out at accelerated speed. Show the novel-primitive moment: builder asks "why shouldn't I apply to Magnum Foundation?" Claude responds with specific reasoning citing past recipient aesthetic territory (documentary social practice) vs user's aesthetic (landscape formalism), fit score 0.23, recommends redirecting $40 entry fee toward Critical Mass (fit 0.78).

**2:15–2:45 — Package Drafter. Third emotional beat.** Claude drafts an artist statement pulling facts from the AKB. Builder reads it on camera and visibly reacts: *"I couldn't have written this. But every fact in it is true about me. And it's better than anything I would have put on paper."*

**2:45–3:00 — The kicker.** "This isn't a demo. I'm submitting to three of these next week." Cut to Career Dossier PDF on screen. End card: project name + GitHub link.

**Rules for the demo:**
- Real data, live run. No canned outputs.
- Pre-run the 30-min pipeline before recording; the video plays back pre-computed state at 10x. The first Style Analyst run IS recorded live; everything after is sped-up playback of a real prior run.
- Builder's own portfolio. Non-negotiable per builder confirmation.
- One recorded take of the kicker line. Emotional honesty > polish.

## Written summary (180 words — hackathon submission field)

> Atelier is an AI art director for working visual artists. Upload your portfolio, answer a short interview, and it produces a ranked list of grants, residencies, competitions, and gallery opportunities that actually fit your aesthetic — with submission-ready application materials for each.
>
> Built by a fine-art photographer who has spent 15 years navigating the visual arts economy: published by National Geographic, TIME, Red Bull; two physical galleries; Emmy nominated. Never applied to a single grant because the writing wall was too high. Atelier is the tool that would have removed the wall.
>
> Six specialist agents work together. A vision-based Style Analyst reads the portfolio. A Knowledge Extractor ingests public web data about the artist and interviews them to build a durable Artist Knowledge Base. A Claude Managed-Agents-powered Opportunity Scout searches 40+ curated sources. A Rubric Matcher — the novel primitive — scores portfolio fit against past recipients of each opportunity, rejecting bad fits with specific reasoning. A Package Drafter generates submission materials in each institution's expected voice.
>
> Open source, real data, real institutions. Built entirely during the hackathon. The builder is the prototypical user.

## Hackathon judging criteria mapping

### Impact (30%) — target 27/30

- Audience: hundreds of thousands of working US visual artists; millions globally.
- Stakes: billions in annual grant + gallery sales + commission dollars allocated via applications.
- Institutional weight: outputs are filed with NEA / Guggenheim / Creative Capital / real galleries / municipal commissions.
- "Build From What You Know" fit: A+; builder is the stakeholder.
- Measurable compression: 40 hrs/application × 10 apps/yr → ~1 day for portfolio + review.

### Demo (25%) — target 22/25

- Emotional opener (Style Analyst reading builder's own work).
- Novel-primitive moment (Rubric Matcher rejecting Magnum with reasoning).
- Voice-matched artist statement read on camera.
- Kicker: "I'm submitting three of these next week."
- Live data, real institutions, no faked outputs.

### Opus 4.7 Use (25%) — target 22/25

- **Novel capability demonstrated:** aesthetic-judgment-as-matching at scale (Rubric Matcher).
- **Claude Managed Agents** for Opportunity Scout + Rubric Matcher (unlocks Best Managed Agents $5k prize).
- **Vision over large image sets** (portfolio + past-recipient portfolios).
- **Long context** (orchestrator + full portfolio + opportunity database + skill files).
- **Skills as codified lived knowledge** — 20+ skill files of 15-yr domain expertise.
- **Multi-agent specialist architecture** — CrossBeam-pattern extended.

### Depth & Execution (20%) — target 18/20

- Visible pivot from Athena (preserved in git history via fork lineage) — shows iteration, "wrestling with it."
- 20+ skill files in the repo — inspectable lived knowledge.
- Real data sources, legal connectors, live institutions.
- Builder's own portfolio as proof of production use.
- Clean architectural choice (no embeddings, vision-first — a considered decision, defensible on craft grounds).

### Weighted projection: **89/100**. Realistic top-3 odds.

### Side-prize fit

- **Most Creative Opus 4.7 Exploration ($5k):** Rubric Matcher is the most expressive use in the field. Aesthetic judgment is not a common LLM surface. Viable.
- **Keep Thinking ($5k):** Visual arts bureaucracy is an unexpected target. Viable.
- **Best Use of Claude Managed Agents ($5k):** Opportunity Scout + Rubric Matcher are the long-running surfaces. Direct fit.

## Build sequence

*Dependency order, not calendar. See separate build-plan MD for detailed implementation plan.*

**Phase 1 — Foundation (nothing else works without this):**
- Fresh repo with Next.js 15 + TypeScript + SQLite + Tailwind v4 + Anthropic SDK + Agent SDK
- Vercel deploy working from first commit
- SQLite schema for AKB, portfolio, opportunities, runs, dossier
- UI shell: onboarding, interview, settings, dossier routes
- Initial skill files (opportunity-sources, aesthetic-vocabulary, juror-reading, institutional-voice, eligibility-patterns)

**Phase 2 — Onboarding pipeline (builder's own AKB must exist before Rubric Matcher can be tested on real data):**
- Portfolio upload + Style Analyst vision pipeline
- Knowledge Extractor: web ingestion + gap detection + text interview flow
- AKB persistence + versioning
- Builder runs through own Extractor flow on 15-yr body of work — produces real AKB

**Phase 3 — Novel primitive (the thing that wins):**
- Rubric Matcher: past-recipient fetching, aesthetic-signature synthesis, portfolio-fit scoring with reasoning
- Gallery Targeter (Rubric Matcher variant)
- Opportunity Scout hitting all 40 sources
- Port Opportunity Scout + Rubric Matcher to Claude Managed Agents (unlocks Best Managed Agents prize)

**Phase 4 — Output:**
- Package Drafter (artist statement, project proposal, CV, cover letter — institutional voice)
- Orchestrator synthesis + ranking
- Career Dossier UI + PDF export
- Remaining skill files (get to ~20)

**Phase 5 — Submission:**
- Full end-to-end clean run on builder's own data
- Demo video recording
- README, written summary, repo audit
- Submit via CV platform

## Risk register

| Risk | Probability | Mitigation |
|---|---|---|
| Rubric Matcher doesn't produce convincing aesthetic reasoning | Medium | Pre-test on 3 known opportunities early; this is the demo spine — if it's weak, the project weakens. Budget time Apr 24 evening for a dry run. |
| Live web search during demo recording returns stale / inconsistent results | Medium | Pre-run the pipeline fresh the morning of recording; record voiceover over a specific known-good run. |
| Skill files read as thin / not actually domain expertise | Medium | Builder writes them personally, from specific experience. Each file cites concrete past experience. Not Claude-generated fluff. |
| Opus 4.7 vision rate-limits on portfolio uploads | Low | Cap portfolio size at 100 images; batch vision calls; Sharp preprocesses to 1024px max. |
| Managed Agents port takes longer than planned | Medium | Port only Opportunity Scout if time-constrained; Rubric Matcher can stay on Agent SDK. Both on Managed is optimal but one unlocks the side-prize narrative. |
| Naming — "Art Director" doesn't stick | Low | Name is cosmetic. Ship as Art Director if no better name by Apr 26 morning. Repo can be renamed in 30 seconds. |
| Demo video runs long | Low | Shot-listed to 3 min; edit ruthlessly; voiceover scripted. |
| Judges question whether builder really built this alone in 5 days | Medium | Git history from fresh-fork start will be granular (commit frequently). The 5-day build of 33k-line Athena already demonstrated velocity — include as a README note linking to Athena repo. |

## Open questions for builder

1. **Final name.** Before Apr 26 morning. Working list to generate: Atelier, Dossier, Aperture (conflicts with mag), Lineage, Canvas, Studio, Prospect, Portfolio Prime, The Submission, Panel.
2. **PDF export library** — `@react-pdf/renderer` (cleaner, Reactish) vs Puppeteer (more flexible, heavier). Default to `@react-pdf/renderer` unless a renderer edge case forces Puppeteer.
3. **Deployment target** — local-only for demo (simpler) vs Vercel + Cloud Run for agents (matches CrossBeam's pattern). Default local-only unless Managed Agents require Cloud Run for the demo to run within judge time windows.
4. **Builder's own existing artist statements / CV** — available as training corpus for voice-modeling? Yes/no affects Package Drafter quality.

## Success definition

**Primary:** Top 3 finish at Built with Opus 4.7.
**Secondary:** At least one $5k side prize.
**Tertiary:** Builder personally submits to 3+ real opportunities from the Dossier within 7 days of hackathon close. The tool works in production for its builder, not as a stage prop.

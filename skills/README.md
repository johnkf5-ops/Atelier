# skills/ — Codified Domain Knowledge

*The lived-knowledge moat that turns Atelier from a generic LLM application into a domain-specific art director.*

[![21 skill files](https://img.shields.io/badge/Skill_files-21-1f2937?style=flat-square)](#the-full-catalog)
[![Primary-source cited](https://img.shields.io/badge/Primary--source-cited-C15F3C?style=flat-square)](#provenance--how-the-skills-were-built)
[![Loaded by 4 agents](https://img.shields.io/badge/Loaded_by-4_agents-6b7280?style=flat-square)](#how-agents-consume-them)

---

## What this directory is

The 21 markdown files in this directory are the curated knowledge base that turns Atelier from a generic LLM application into a domain-specific art director. Each skill is loaded into a specific agent's system prompt at runtime, providing institutional knowledge the model would otherwise have to infer from training data — often badly. The vocabulary an institutional juror reads with, the cohort signature of last year's MacDowell visual-arts class, the difference between a Tier-A blue-chip gallery and a Tier-D artist-run space, the calendar pattern of NEA Cycle 2 — none of this is reliably present in a raw model response. It is present here, cited to primary institutional sources, and injected at the right moment in each agent's reasoning loop.

---

## Provenance — how the skills were built

These are not freestyle domain dumps from the project author. Each skill file was produced by a research-mode agent that reads live institutional sites (gf.org, macdowell.org, creative-capital.org, state arts-council pages), past-winner archives, and published grant-writing guides, and was then audited by the human builder against lived experience and against any factual claims the agent could not source. The author is a working photographer, not a submission-bureaucracy expert; the skill files *are* the expertise, synthesized from public data and validated against reality. The moat is the reproducible synthesis pipeline plus the human audit, not the raw text. Anyone with API access could reproduce a comparable corpus by running the same research prompts against the same institutional pages — and is encouraged to. The failure mode this guards against is the one most LLM-app authors fall into: treating model-generated domain confidence as ground truth and shipping it.

---

## How agents consume them

Skill files are loaded into agent system prompts at three points: (1) directly inline by the SDK-call agents (Style Analyst, Package Drafter), (2) baked into Managed Agent definitions at one-time setup (Opportunity Scout, Rubric Matcher) via `scripts/setup-managed-agents.ts`, and (3) referenced by name inside agent prompts so the agent uses the skill's vocabulary when it has been mounted into context.

| Agent | Skill files loaded | Loader |
|-------|-------------------|--------|
| **Style Analyst** | `aesthetic-vocabulary.md` | `lib/agents/style-analyst.ts` reads at first analyze call, caches in module scope |
| **Opportunity Scout** (Managed Agent) | `opportunity-sources.md`, `eligibility-patterns.md` | `scripts/setup-managed-agents.ts` joins them into the agent's `system` field at agent create/update time |
| **Rubric Matcher** (Managed Agent) | `juror-reading.md`, `aesthetic-vocabulary.md` | `scripts/setup-managed-agents.ts`, same join pattern; the runtime prompt in `lib/agents/rubric-matcher.ts` also tells the agent to use the loaded vocabulary by name |
| **Package Drafter** | `artist-statement-voice.md`, `project-proposal-structure.md`, `cv-format-by-institution.md` | `lib/agents/package-drafter.ts` `readSkill()` calls, with inline `DEFAULT_VOICE_SKILL` / `DEFAULT_PROPOSAL_SKILL` / `DEFAULT_CV_SKILL` constants as graceful-degradation fallbacks if a file is missing |
| **Knowledge Extractor / Interview / Orchestrator** | none currently | These agents have not been wired to load skills; see "Exists but not currently consumed" below |

The fallback constants in `package-drafter.ts` are deliberate: a missing skill file should not crash a run, only degrade quality. The DEFAULT constants are short, defensible voice rules that prevent silent regression to model-default MFA-workshop register.

---

## The full catalog

Word and citation counts are approximate (`wc -w` and `grep -c http`). "Consumer" lists the agent(s) currently loading the file at runtime; files marked *referenced-only* are named in another skill or in a prompt as vocabulary the agent should use, but are not themselves mounted into a system prompt; files marked *unconsumed* exist in the directory but no agent currently loads them.

### Voice and writing (Package Drafter consumers)

| File | Words | Cites | Consumer | Purpose |
|------|-------|-------|----------|---------|
| `artist-statement-voice.md` | 1,517 | 4 | Package Drafter (statements + cover letters) | Voice rules, banned-verb list, structural shape for institutional artist statements |
| `artist-statement-voice-by-medium.md` | 1,577 | 8 | *unconsumed* | Per-medium named-precedent banks (photo / painting / sculpture / video / installation) — referenced as sibling by voice.md |
| `project-proposal-structure.md` | 1,552 | 4 | Package Drafter (proposals) | Six-beat structure for grant proposals with worked Creative-Capital and Guggenheim examples |
| `cv-format-by-institution.md` | 1,465 | 12 | Package Drafter (CV) | Per-institution CV/résumé/career-narrative conventions for Guggenheim, MacDowell, NEA, Creative Capital, Pollock-Krasner |
| `cover-letter-templates.md` | 1,741 | 5 | *unconsumed* | Five letter shapes keyed to opportunity type (foundation grant, gallery, residency, public art, museum donation) |
| `work-sample-rationale-patterns.md` | 1,482 | 9 | *unconsumed* | Three-sentence formula for image rationale captions, per-institution caption-length conventions |
| `medium-specific-application-norms.md` | 1,781 | 17 | *unconsumed* | Required technical fields per medium (edition, dimensions, substrate, duration) and how each program enforces them |

### Aesthetic vocabulary (Style Analyst + Rubric Matcher consumers)

| File | Words | Cites | Consumer | Purpose |
|------|-------|-------|----------|---------|
| `aesthetic-vocabulary.md` | 1,729 | 12 | Style Analyst, Rubric Matcher | Controlled vocabulary: 12 named precedents (Adams, Sugimoto, Shore, Eggleston, Bechers, Misrach, Baltz, Mann, St. Onge, McCaw, Brandt) plus anti-references (Lik, Ratcliff); composition grammar; light types |
| `juror-reading.md` | 1,976 | 17 | Rubric Matcher | Three named heuristics (H1 cohort coherence, H2 negative space, H3 rotating-juror drift) for inferring an institution's working rubric from its last three cycles |
| `photography-specific-lineages.md` | 1,836 | 14 | *unconsumed* | Granular photography lineages (Becher/Düsseldorf, New Topographics, color-landscape canon, street, portrait/typology, documentary, photojournalism, fashion-art crossover) |

### Opportunity discovery (Scout consumers)

| File | Words | Cites | Consumer | Purpose |
|------|-------|-------|----------|---------|
| `opportunity-sources.md` | 1,464 | 53 | Opportunity Scout | YAML-structured seed list of federal, foundation, residency, state, and medium-specific opportunity sources with eligibility, deadline pattern, signal quality |
| `eligibility-patterns.md` | 599 | 0 | Opportunity Scout | Hard eligibility filters (citizenship gates, career-stage definitions, medium gates, project-vs-general-support, prior-funding exclusions) the Scout applies before returning candidates |
| `past-winner-archives.md` | 1,158 | 13 | *referenced-only* | Per-institution scrape map: directory URLs, pagination patterns, per-recipient page schema, gotchas — augments Scout's discovery efficiency |

### Career-strategy + ranking (Orchestrator / Dossier writer consumers — not yet wired)

| File | Words | Cites | Consumer | Purpose |
|------|-------|-------|----------|---------|
| `cost-vs-prestige-tiers.md` | 1,301 | 14 | *unconsumed* | Tier-0-through-tier-4 entry-fee ladder with named programs per tier; defines the affordability weight in a composite score |
| `gallery-tier-taxonomy.md` | 1,315 | 25 | *unconsumed* | Four-tier gallery system (blue-chip, established, mid-career, emerging) with named examples and entry pathways per tier |
| `museum-acquisition-pathways.md` | 1,550 | 8 | *unconsumed* | Five functioning pathways for museum acquisition (curator purchase, donor committee, artist donation, fund-purchase, archive deposit), and what CV markers signal museum-readiness |
| `regional-arts-economies.md` | 1,277 | 27 | *unconsumed* | Per-state index of state arts-council fellowships, regional residencies, geography-bounded grants — the parallel pipeline national-flagship-only searches miss |
| `submission-calendar.md` | 1,075 | 15 | *unconsumed* | Month-by-month index of major program windows; "what's in the next 30 / 60 / 90 days" synthesis block |
| `timeline-by-opportunity-type.md` | 1,207 | 10 | *unconsumed* | Deadline-to-notification-to-first-dollar lead times per program; turns deadline ranking into planning-horizon ranking |

### Knowledge-base intake (Knowledge Extractor / Interview consumers — not yet wired)

| File | Words | Cites | Consumer | Purpose |
|------|-------|-------|----------|---------|
| `interview-question-templates.md` | 1,443 | 0 | *unconsumed* | Library of 3–5 alternative phrasings per AKB field, with priority notes — the question bank for the Knowledge Extractor's structured intake |
| `akb-disambiguation-patterns.md` | 1,361 | 0 | *unconsumed* | Five-axis playbook (medium, location, era, career-stage, biographical specifics) for deciding which open-web search results are the target artist vs a namesake |

### Exists but not currently consumed

13 of 21 skill files are not loaded by any agent at runtime. They fall into two groups:

- **Drafter-side gaps** — `artist-statement-voice-by-medium.md`, `cover-letter-templates.md`, `work-sample-rationale-patterns.md`, `medium-specific-application-norms.md`, `photography-specific-lineages.md`. The Drafter's `readSkill()` call list in `lib/agents/package-drafter.ts` covers only the three core voice/proposal/CV files; expanding the loader to mount these per-material would directly improve cover-letter, work-sample-rationale, and per-medium-statement output.
- **Orchestrator/Dossier gaps** — `cost-vs-prestige-tiers.md`, `gallery-tier-taxonomy.md`, `museum-acquisition-pathways.md`, `regional-arts-economies.md`, `submission-calendar.md`, `timeline-by-opportunity-type.md`. Written for an Orchestrator and Dossier-writer ranking layer that would consume them when composing the final dossier prose; that layer is not yet wired to read skills.
- **Knowledge-base gaps** — `interview-question-templates.md`, `akb-disambiguation-patterns.md`. Written for the Knowledge Extractor's text-interview and auto-discover passes; those agents currently use inline prompts only.

`past-winner-archives.md` is referenced in the Scout prompt by name as augmenting `opportunity-sources.md` but is not itself joined into the Scout system prompt; the Scout uses Opus's own knowledge of those archive URL patterns plus live web_search. Mounting it would make the Scout's per-institution past-recipient walk faster and more deterministic.

---

## Two exemplars worth reading

If you want to see what makes the corpus useful rather than decorative, read these two first.

**`juror-reading.md`** (~1,976 words, 17 citations to NEA / MacDowell / Creative Capital / Guggenheim primary sources) is the highest-leverage file in the project. It encodes three named heuristics — **H1** *cohort coherence beats individual brilliance* (the institution's last three cycles of awardees, read as a single body, IS the rubric), **H2** *read the negative space* (what the cohort never selects defines the rubric's load-bearing exclusions), **H3** *rotating-juror drift* (the panel changes; this year's rubric is not last year's). It then walks a worked example on the Guggenheim 2024 Photography cohort, citing Tarrah Krajnak, Matthew Brandt, and Dylan Hausthor by name and reading the cohort's center of gravity. Without this file the Rubric Matcher produces polite scores; with it, the Rubric Matcher produces the kind of low score with sharp reasoning that is the product's actual value.

**`aesthetic-vocabulary.md`** (~1,729 words, 12 citations to Fraenkel / MoMA / Tate / Pace / Getty / SFMOMA primary sources) is what makes the Style Analyst's output specific instead of generic. It supplies twelve named precedents (Ansel Adams, Hiroshi Sugimoto, Stephen Shore, William Eggleston, Bernd & Hilla Becher, Richard Misrach, Lewis Baltz, Sally Mann, Cheryle St. Onge, Chris McCaw, Matthew Brandt) plus an explicit anti-reference set (Peter Lik, Trey Ratcliff) so the analyst can mark a portfolio as outside institutional register honestly rather than reaching for soft adjectives. It then defines composition grammar (centered axial, rule-of-thirds horizon, foreground repoussoir, deep vs flattened space, frontal/orthogonal address) and a controlled light-type vocabulary. The Style Analyst's system prompt explicitly tells the model "the vocabulary in your system prompt is your only descriptive register — use those terms; do not invent new ones" — and points back at this file as that vocabulary.

---

## Why this is a novel-primitive contribution

Most LLM applications take one of two paths to domain knowledge: (a) rely on the model's training-data knowledge and accept generic output, or (b) load full RAG indexes that are expensive at retrieval time, noisy at relevance time, and untraceable when the model gets something wrong. Atelier's approach — small curated markdown skill files mounted into agent system prompts at the right moment in the pipeline — is a third path. It is explicit (you can read every file the agent is reasoning over), auditable (each empirical claim cites its primary source), version-controllable (the corpus ships in the repo and diffs cleanly), and improvable (a skill file can be edited by a human or by a research-mode agent without touching code). The Package Drafter's ability to produce a Nevada Arts Council artist statement that names actual past Nevada Arts Council recipients with the right institutional vocabulary is only possible because of the skill files. The Rubric Matcher's ability to score a portfolio against a Guggenheim cohort by naming Tarrah Krajnak's *Master Rituals II* and saying *this work is one room over from that* is only possible because of the skill files. The visible quality difference between Atelier's output and a single-prompt Opus call is, in practice, the skill files.

---

## How to add or update skills

**Adding a new skill.** Name it semantically in kebab-case with a `.md` extension. Open with a `# skill-name` heading and a `WHEN TO USE:` paragraph that names which agent loads it and what behavior the file is governing. Keep the body under ~3,000 words; the cost of an over-long skill is full-context cost on every agent call, and the marginal value falls fast past 2,000. Cite a primary institutional source for every empirical claim — foundation application page, museum collection page, council program page — using inline markdown links. Run the consuming agent in dev mode and verify the output quality changes in the direction you expected. If the new skill should be loaded by the Drafter, add the corresponding `readSkill('your-file.md', FALLBACK_CONSTANT)` call to `lib/agents/package-drafter.ts` and supply a short fallback constant. If the new skill should be loaded by Scout or Rubric, add it to the join in `scripts/setup-managed-agents.ts` and re-run `pnpm setup:agents` to update the Managed Agent definitions in place. Commit with a message describing what the skill encodes and which agent consumes it.

**Updating an existing skill.** Edit in place. If you make a substantive content change (not a typo fix), bump the visible date or version line at the bottom of the file and add a one-line changelog entry. If the skill is loaded by Scout or Rubric, re-run `pnpm setup:agents` so the Managed Agent definitions pick up the new content; the script is idempotent and updates in place via `agents.update` rather than creating duplicates.

---

## License + attribution

These skill files synthesize information from public institutional sources: foundation application guides, museum collection pages, state arts-council program pages, published grant-writing guides, gallery directories, and exhibition catalogues. Each empirical claim is cited inline to its source. No source is reproduced verbatim at length; the synthesis is original prose. Any attribution requirements specific to a cited source (image rights, trademark, foundation name usage) must be respected per that source's terms — the inline citations exist precisely so a downstream consumer can check. The synthesized markdown in this directory is MIT-licensed alongside the rest of the Atelier repository.

# Atelier — Summary

*An AI art director for working photographers.*

---

## The problem

Every working fine-art photographer in the United States spends roughly thirty percent of their working time on applications — grants, residencies, competitions, gallery submissions, photo-book prizes, public-art commissions. Most of those applications go to opportunities they were never going to win.

Three things make that bleed worse than it should be:

**Discovery is scattered.** Open calls live across forty-plus aggregators, foundation websites, residency directories, and competition pages. Nobody maintains a clean index. Photographers either pay a subscription that surfaces a fraction of what's out there, or they piece it together by hand and miss the deadlines that matter.

**Fit is opaque.** Programs publish past recipients but rarely articulate what unifies them aesthetically. Photographers apply blind to programs whose past awardees worked in completely different aesthetic territory — different palette, different subject grammar, different conceptual frame — then receive a form rejection and learn nothing from it.

**The packages take six to ten hours each.** Statement, project proposal, CV, cover letter, work-sample selection. Even with templates the institutional-voice tax is real: a grant statement is not a residency statement is not a gallery cover letter, and the applications that win are the ones tuned to the specific program. The same photographer can spend forty hours preparing an application for a program they had a three-percent chance of winning, and the writing tax means they often don't apply at all.

I'm a working landscape photographer. I have been inside this economy for fifteen years. I have never applied to a single grant, residency, or fellowship — because writing about my own work is the wall.

Atelier is the tool that removes the wall.

---

## What got built

A web app that:

1. Reads your portfolio with vision and produces a structured aesthetic fingerprint.
2. Builds a durable Artist Knowledge Base from your public web data and a short text interview that targets exactly the gaps the public data couldn't fill.
3. Runs a long synchronous pipeline that scouts current open calls, scores each one for aesthetic fit against the actual past recipients, drops the bad fits with specific reasoning, and drafts the application materials for the ones that remain — in the institutional voice each opportunity expects.
4. Hands you a Career Dossier — printable PDF and web view — that names what to apply to, what to skip, and why.

The dossier is the artifact. Web view first, PDF second. The included opportunities each carry a fit rationale that cites specific portfolio images. The filtered-out opportunities each carry a "why not" — saying no with reasons is part of the value, not a by-product.

A single run takes about twenty minutes and produces between four and twelve included opportunities depending on the artist's submission window and the aggressiveness setting. Material packages — statement, proposal, CV, cover letter, work-sample selection — are pre-drafted for every included opportunity in the institutional voice that opportunity expects.

---

## How it works

The orchestration is a long synchronous pipeline. Six specialist agents move in dependency order. The orchestrator synthesizes their outputs into the final Dossier.

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

Two agents — Scout and Rubric Matcher — run on Anthropic's Managed Agents beta (`managed-agents-2026-04-01`). The agent loop lives on Anthropic's infrastructure, which means our Vercel routes can kick off a session and return immediately, then poll for events as the long agent loop grinds away. Without managed orchestration we'd be standing up a worker tier somewhere outside Vercel's sixty-second function timeout. With it, the entire app deploys to Vercel.

The other four — Style Analyst, Knowledge Extractor, Package Drafter, Orchestrator — are direct SDK calls against `claude-opus-4-7` with adaptive thinking. No tool loops, no managed sessions; each is a single structured call against a tightly scoped prompt with `output_config.format` schemas to constrain the shape of the result.

### The vision pipeline

The Rubric Matcher is the part of the system that took the longest to land, and the part that most defines what Atelier actually does.

The intent is simple: for each candidate opportunity, fetch the last three years of recipients' portfolios, put both cohorts in front of Claude with vision, and ask it to score the artist's portfolio fit against the cohort with reasoning that cites which of the artist's specific images support the match and which weaken it.

Implementing it took three architectural pivots, each forced by a behavior that wasn't in the docs. The final shape:

1. **Recipient portfolio images get downloaded, normalized through Sharp** (raw JPEGs from a handful of source sites failed Anthropic's vision check until we re-encoded them as standard sRGB JPEGs with Sharp), **and uploaded to the Anthropic Files API.**
2. **The Rubric Matcher session opens with the artist's portfolio images** sent as image content blocks inside the initial `user.message`, plus the AKB + StyleFingerprint as text context. The agent acknowledges what it sees in the portfolio.
3. **The orchestrator then dispatches one `user.message` per opportunity, sequentially.** Each per-opportunity message contains the recipient images for *that* opportunity as image content blocks, plus the scoring task. The agent calls a `persist_match` custom tool to record the score and reasoning, the orchestrator advances to the next opportunity.

The earlier shape — mounting all images as session resources and asking the agent to read them with the `read` tool — works at probe scale (five files, twenty files) and silently fails at production scale (ninety-five files). The `read` tool returns text-only output rather than multimodal binary above some session-resource ceiling that isn't documented anywhere. Image content blocks in `user.message` are the documented multimodal pattern and they engage vision regardless of session size. The bandage is the cure.

### The Artist Knowledge Base

The other piece that took serious engineering: building the Artist Knowledge Base.

Most working fine-art photographers cannot write well about their own work, and most don't have a public web footprint deep enough to assemble a CV from. The live path through the AKB is a **gap-driven structured interview**. A priority-tiered field list (identity, practice, bodies of work, exhibitions, publications, awards, collections, representation, intent) drives the conversation: each turn detects which AKB fields are still empty, surfaces the highest-priority gap, and asks for it in plain language. The interview never asks for what it can derive — legal name when artist name is given and they match, citizenship when home country is set. The output is a versioned Artist Knowledge Base persisted as immutable rows in `akb_versions`, reusable across every future run. Onboard once.

A second layer, **Auto-Discover**, is implemented and reachable in the code. It runs a search → rank → top-K → fetch pipeline against URLs the photographer seeds and against discovered references, with a snippet fallback for JS-rendered pages and bot-blocked sources. Every fact carries a `source_url` and an `extracted_quote`. Every candidate fact passes through an identity-anchor check — the same name belonging to a different artist never enters the record. It works for photographers with fifteen years of press; it returns thin output for the prototypical mid-career photographer with two galleries and no Wikipedia page. So we built it, tested it, learned the limit, and pulled it out of the default flow. It stays as the fine-tune target for when the user corpus grows.

The AKB is the asset that makes the rest of the system possible. The Drafter pulls every fact from it. The fact-grounding linter that runs on each drafted material checks that every year, every proper-noun phrase, and every named institution in the draft can be traced to a string the AKB literally contains. Hallucinated exhibitions, fabricated partnerships, made-up dates — those bugs are gone because the linter rejects the draft and forces a revision pass when they appear.

### Drafting in the right voice

The Drafter writes statements, proposals, CVs, and cover letters. The lift here is voice rather than content: the content comes from the AKB, but a grant statement, a residency statement, and a gallery cover letter all need to *sound* differently or the program reviewer pattern-matches the application to the wrong shape and discards it.

A few discipline pieces that took multiple iteration cycles to land:

- **First-person enforcement.** Drafted statements were coming back as third-person curatorial essays — the model defaults to that register because most "artist statements" on the public web are written by curators. A post-write voice linter checks for first-person pronoun density and forces a rewrite if it's wrong.
- **Em-dash ban.** A trailing tell of LLM-authored prose. Hard reject in the linter.
- **Distinct opportunity-type classifiers.** A grant proposal is a different document than a competition entry letter is different than a residency project proposal. The Drafter routes each material through a classifier first, then drafts against an emphasis table tuned to that type.
- **Master CV.** One CV per dossier rather than one CV per opportunity. The same person doesn't have a different CV for each program; a single canonical CV gets surfaced everywhere.

---

## What I learned

Three things stand out, and they're the things I'd flag for anyone building in this neighborhood.

### Saying no with reasons is the product

Early demo runs scored every opportunity at sixty-plus and recommended applying to all of them. That's the failure mode you'd predict from a friendly LLM tasked with matching: it wants to be helpful, so everything matches a little. The fix wasn't a better prompt. The fix was making the harsh-truth output the *featured* output. The Dossier surfaces the filtered-out opportunities prominently, with the specific reasoning that disqualified them, and the included opportunities are scored against a calibrated cohort comparison rather than a vague aesthetic-alignment score. An artist who's told *"don't apply to ILPOTY because their past three years of recipients are all Galen Rowell descendants and your work is in a darker, more painterly register"* knows something they didn't know before. That's the product.

### Managed Agents is the right surface for long agentic work on a serverless deploy

Vercel's sixty-second function timeout is a hard architectural constraint. The Scout phase regularly runs eight to fifteen minutes. The Rubric phase runs twelve to twenty. Standing up a worker tier somewhere — Cloud Run, a long-lived Node process — was the alternative. Managed Agents made the entire app deploy to Vercel: the agent loop runs on Anthropic's infrastructure, our Vercel routes kick off a session and poll for events, and the long phase survives the function timeout because no long-lived connection lives on our infrastructure. That's a structural simplification that matters for a one-person team.

### The undocumented Files API behaviors cost the most time

Two production-scale-only failures didn't appear in any documentation and weren't reproducible at probe scale:

1. The Files API silently ignores custom `mount_path` values and mounts everything at the default `/mnt/session/uploads/<file_id>` path. Every prompt referencing a custom path got "File not found." We learned this by writing a probe.
2. The `read` tool on mounted files returns text-only output above some session-resource ceiling. Twenty files works. Ninety-five files doesn't. We learned this by writing a per-tool audit script against a failed production run and noticing that every `web_fetch` returned multimodal binary while every `read` returned text-only.

The fix in both cases was to bypass the failing pattern entirely. Custom paths got dropped in favor of the default. The `read`-tool-on-mounted-files pattern got dropped in favor of image content blocks in `user.message` events — the documented multimodal pattern. Both fixes ended up being architecturally simpler than the patterns they replaced.

The lesson I'd carry forward: at production scale, write probes that mimic production scale. Five-file probes lie. Ninety-five-file probes tell the truth.

---

## The user

I'm an Emmy-nominated landscape photographer with two galleries — Las Vegas and Minneapolis — and fifteen years of work published by National Geographic, TIME, Red Bull, USA Today, Billboard, and Google. I have never applied to a single grant or residency. The writing was the wall.

The first run I did with Atelier on my own portfolio surfaced six included opportunities — a residency in the Sierra, a fellowship I'd never heard of, a national landscape photography prize whose past recipients work in my exact register — and filtered out fifteen others with reasoning I agreed with after reading it. The drafted statements were in my voice. The proposals named the right projects. The CV pulled the right credentials in the right order.

I'm going to apply to all six.

That's the test the system has to pass for every photographer who uses it. Not "did the agent loop complete." Not "did vision engage." Did the photographer read the dossier and decide to apply.

---

## What this is, going forward

Atelier was built for the hackathon and it is also a real product. It will live past the submission window. It will be free for working photographers because they deserve a tool like this and the existing aggregators do not serve them. The version one is photography-only on purpose — the moat is domain depth, and starting in the medium the builder knows best is the only honest way to get the depth right before getting the breadth wide. The path forward is: ship to photographers, listen to what they recommend, fine-tune Auto-Discover against the public footprints working photographers actually have, then expand carefully into painting, sculpture, video, installation, and international markets one informed step at a time. One genre, then the next, with feedback from the people using it. That's the plan. The hackathon is the start, not the finish.

---

## License

MIT. See [`LICENSE`](./LICENSE).

Open source per the hackathon rule. Every component — backend, frontend, schemas, skill files — is published. The managed services in the dependency tree (Turso/LibSQL, Vercel Blob, Anthropic API) are accessed through public APIs and could be swapped for self-hosted equivalents without architectural change.

For the detailed run lifecycle, AKB merge semantics, retry posture, and the full skill catalog, see [`ARCHITECTURE.md`](./ARCHITECTURE.md) and [`skills/README.md`](./skills/README.md).

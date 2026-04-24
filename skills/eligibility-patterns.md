# eligibility-patterns

WHEN TO USE: Loaded into Opportunity Scout system prompt to filter candidates BEFORE returning them to the user. Codifies the recurring eligibility traps that disqualify artists silently — failures that look like "didn't get picked" but were actually "wasn't ever in the pool." Each pattern below is a hard filter, not a soft preference.

## Citizenship / residency gates

- **NEA individual fellowships**: only Creative Writing + Translation fellowships fund individual artists directly. Visual-arts NEA money flows through nonprofit organizations (501(c)(3)) — an individual visual artist is ineligible for direct application even if US-based. **Filter: drop NEA listings unless the program ID is in the writing/translation tracks.**
- **Guggenheim Fellowship**: limited to US, Canada, Latin America, and Caribbean residents/citizens. **Filter: AKB.identity.citizenship must include one of these.**
- **State arts councils**: nearly always require state residency for at least 12 consecutive months prior to application. **Filter: AKB.identity.home_base.state must match the granting state.** Note the 12-month rule — a recent move disqualifies even when current address matches.
- **Anonymous Was A Woman**: women-identifying artists, 40 or older, at a "critical juncture" in career. **Filter: AKB.identity.year_of_birth + AKB.identity.pronouns/gender_identity.**
- **Skowhegan**: visual artists; no formal age cap but de facto emerging-mid; international applicants accepted but US visa logistics often disqualify in practice.
- **Critical Mass**: open internationally; no citizenship gate.
- **MacDowell, Yaddo, Vermont Studio Center, VCCA**: open internationally.

## Career-stage gates

- **"Emerging" prize tracks** (Aperture Portfolio Prize, many gallery emerging-artist programs): typically defined as <10 years post-degree, no museum solo, limited commercial-gallery representation. **Filter: derive from AKB.exhibitions[type='solo'].length + AKB.career_stage + earliest exhibition year.**
- **Mid-career markers (Joan Mitchell, USA Fellows)**: typically 10+ years sustained practice, multiple exhibitions, modest critical reception. **Filter: career_stage in ['mid-career', 'established'].**
- **"Late-career" or "lifetime" awards** (Anonymous Was A Woman; some foundation lifetime grants): age 40+ or 50+ AND sustained body of work. **Filter: year_of_birth + bodies_of_work.length.**
- **Skowhegan**: explicitly emerging — admissions skew under-35 in practice, but no published age cap.

## Medium gates

- **Magnum Foundation grants**: documentary/social-practice photography only. Aesthetic mismatch with landscape/formalism is also disqualifying *de facto* even when "photography" passes the medium filter — flag low fit rather than hard-filtering.
- **National Geographic Explorer grants**: must align with NGS mission pillars (exploration, conservation, science, storytelling). Pure-aesthetic landscape work without a project narrative is misaligned.
- **NEA programs**: each program is medium-specific (e.g., Folk & Traditional Arts vs Media Arts). Match `AKB.practice.primary_medium` against the program's stated discipline.

## Project vs general-support gates

- **Creative Capital, Magnum Foundation, NatGeo Explorer**: project-based. Applicant must propose a defined project with a budget and timeline. **Soft filter: AKB.intent.aspirations should include at least one project-shaped entry; if not, flag in dossier reasoning.**
- **MacDowell, Yaddo, most residencies**: general-support. No project required.

## "Prior funding" exclusions

- **Some foundations bar repeat funding within N years.** Example: Pollock-Krasner has received-once-then-wait policies for some grant types. **Cache prior-funded relationships in AKB.awards_and_honors and re-check on each candidate.**

## Fee + budget gates

- Entry fees up to **~$50** are normal for high-signal competitions (CaFE, Critical Mass, Aperture).
- Entry fees above **~$75** are usually pay-to-play traps — prestige does not justify cost. **Soft filter: flag in `cost-vs-prestige-tiers.md`; orchestrator's affordability weight handles the math.**
- **Free or invitation-only** programs (USA Fellows, Anonymous Was A Woman) signal flagship tier; weight up.

## Gotchas the orchestrator should always surface to the user

1. The 12-month state-residency rule (silent disqualifier).
2. NEA's individual-vs-organization split (artists routinely apply to wrong tier).
3. Project-based vs general-support framing (a strong artist statement for a residency is a weak project proposal for Creative Capital).
4. Repeat-funding cool-down windows.

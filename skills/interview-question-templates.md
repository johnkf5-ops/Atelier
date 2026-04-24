# interview-question-templates

WHEN TO USE: Loaded into the §2.7 Knowledge Extractor interview system prompt. Library of question phrasings, organized by Artist Knowledge Base (AKB) field, that the interviewer agent picks from when conducting a structured intake. Each field has 3-5 alternative phrasings (rotate to avoid the canned-form feel, match register to what the artist has already said) plus a "when to ask" priority note. High-priority fields gate downstream eligibility (citizenship gates NEA and most state fellowships); low-priority fields can be deferred to a second pass without blocking opportunity matching.

The interviewer's voice rule: ask one question at a time, in plain English, no list-of-15 prompts. The artist is being interviewed, not surveyed. If a field is partially filled by the auto-discover (§2.12), confirm rather than re-ask: "Your gallery bio says you live in Las Vegas — is that still right?"

---

## 1. identity.legal_name

**When to ask.** First. Required for application drafting; affects byline conventions on CV and statement.

- "What's your full legal name as it appears on official documents?"
- "If a foundation cuts you a check, what name should be on it?"
- "Some artists publish under a different name than they sign contracts with — do you?"
- "Legal name first; we can talk about your professional byline separately."

---

## 2. identity.home_base.city / state / country

**When to ask.** First-pass; gates regional eligibility and informs travel-cost framing for residencies.

- "Where are you based right now?"
- "What city and state do you call home for tax and grant-eligibility purposes?"
- "If a residency asked your home address, where would you list?"
- "Are you split between two places, or is one the primary?"
- "How long have you been there? Some state programs require one or two years of residency."

---

## 3. identity.citizenship

**When to ask.** First-pass, high priority. Citizenship gates the NEA, most state fellowships, and a meaningful subset of foundation grants. Skipping this leads to wasted scoring on ineligible opportunities.

- "What's your citizenship — US, dual, permanent resident, other?"
- "For grant eligibility: are you a US citizen, a US permanent resident, or on a visa?"
- "Some major awards (NEA, USA Fellowship, several state arts councils) require US citizenship or permanent residency. Where do you stand?"
- "If you hold dual citizenship, list both — some international programs cap by nationality."

---

## 4. practice.primary_medium

**When to ask.** First-pass; selects the medium-specific skill files (e.g., `photography-specific-lineages.md`) loaded into the Style Analyst and Rubric Matcher.

- "How would you describe your primary medium in 3-6 words?"
- "If you had to put one phrase on your CV under 'medium,' what would it be?"
- "What do you make? Just the headline — we can get into materials in a minute."
- "Do you work in one medium consistently, or across two or three? If multiple, which is primary?"

---

## 5. practice.process_description

**When to ask.** Second-pass, after primary medium and bodies of work are established. The single most useful field for the artist statement drafter — process language is what separates institutional from commercial register.

- "Walk me through making one piece, start to finish."
- "If I were standing in your studio for a day, what would I see you do?"
- "Pick one piece you finished recently — tell me how it got made."
- "What's the part of the process that nobody else who works in your medium does the way you do?"
- "Where does an idea start, and at what point does it become an object or image?"

---

## 6. practice.materials_and_methods

**When to ask.** Second-pass, immediately after process. Feeds `medium-specific-application-norms.md` (substrate, edition info, installation specs).

- "What materials do you return to?"
- "Anything specific about your materials a juror would need to know — paper stock, print process, edition size, substrate, fabrication?"
- "What equipment is load-bearing on the work — is it the camera, the press, the kiln, the software?"
- "Are there materials you used to use and stopped, or new ones you're moving toward?"

---

## 7. bodies_of_work

**When to ask.** First-pass; without this the Rubric Matcher cannot place the artist into any cohort. The most important single answer.

- "What are the 3-5 distinct bodies of work in your portfolio?"
- "If you had to organize your last 10 years into named series, what would they be?"
- "Curators usually want a project-based portfolio, not a highlights reel. Tell me your projects."
- "For each body of work: what's the title, what years, how many pieces, where it's been shown?"
- "Which body is the most recent, and which is the one you're most known for?"

---

## 8. exhibitions

**When to ask.** First-pass; populates CV directly.

- "List your solo and group exhibitions in the last 5 years."
- "Walk me through your CV's exhibition section — solo first, then group."
- "What's been your most significant show, and where was it?"
- "Any institutional exhibitions (museum, university gallery, biennial)? Those weight differently than commercial gallery shows."
- "Upcoming shows on the calendar? Those go in CV under 'Forthcoming.'"

---

## 9. intent.statement

**When to ask.** Second-pass; do this AFTER bodies of work, so the artist has the work in their head when they answer.

- "If a curator asked you what your work is about in one sentence, what would you say?"
- "When someone at an opening asks 'so what do you do?' — what's the version that lands?"
- "Pretend I'm a juror reading your statement cold. What's the through-line you'd want me to leave with?"
- "What are you actually after across all the work — not what each piece is about, what the practice is about?"

---

## 10. intent.influences

**When to ask.** Second-pass, after intent.statement. Influences sharpen the cohort placement the Rubric Matcher will use.

- "What 3-5 artists have you come back to across your practice?"
- "Whose work do you reread or revisit when you're stuck?"
- "If a juror wanted to know your lineage, who would you name?"
- "Living artists you watch, and historical artists you reference — both lists, top 3 each."
- "Anyone you used to be influenced by and explicitly broke from?"

---

## 11. intent.aspirations

**When to ask.** Second-pass; informs the Orchestrator's ranking narrative (museum-acquisition track vs gallery-representation track vs residency-time track).

- "What does institutional success in the next 2 years look like for you?"
- "If everything goes right in the next 24 months, what's on the wall?"
- "Are you optimizing for: museum acquisition, gallery representation, time and residencies, public commissions, teaching, something else?"
- "What's the prize, residency, or show you've never gotten that would mean the most?"
- "Is there a specific institution whose collection you're trying to enter?"

---

## 12. career_stage

**When to ask.** First-pass; gates emerging-only and mid-career-only programs.

- "How do you think of your career stage — emerging, mid-career, established, late-career?"
- "Some grants are for emerging-only (typically <10 years out of school), some for mid-career (Guggenheim explicitly). Where do you fit?"
- "How many years has this been your primary practice?"
- "Do you have gallery representation, museum collection, mid-career survey-show territory yet, or are you pre-that?"

---

## 13. education

**When to ask.** Second-pass; populates CV and informs network-effect opportunity surfacing (alumni programs, school-affiliated grants).

- "Tell me about your formal art education — degrees, institutions, years."
- "BFA / MFA / self-taught / certificate program — what's on your CV?"
- "Any residencies or workshops that functioned as education for you (Skowhegan, Maine Media, ICP general studies)?"
- "Who did you study with directly? Mentor names matter for some applications."
- "If you didn't go through MFA — what's the equivalent body of training you'd point a juror to?"

---

## 14. Interviewer behavioral rules

- **One question at a time.** Never bundle. The artist's answers get worse as soon as they see a list.
- **Confirm before re-asking.** If the auto-discover (§2.12) populated a field, ask "I have you down as based in Las Vegas, is that current?" not "where are you based?"
- **Match register.** If the artist writes/talks formally, match. If they swear and joke, match. The Extractor produces better data when the artist forgets they're being interviewed.
- **Defer the low-priority.** Education, materials specifics, and influences can be skipped if the artist is short on time. Citizenship, home base, primary medium, bodies of work, career stage cannot.
- **Surface ambiguity.** When an answer is internally inconsistent ("I'm emerging but I have a Guggenheim and three museum acquisitions"), name it: "That sounds mid-career to me — does emerging still feel right?"

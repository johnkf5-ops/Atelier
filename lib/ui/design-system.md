# Atelier design system

One coherent visual surface across every page. If a contributor adds a new
page, it should look like it belongs to the same product without thinking
about it.

## Type pairing

- **Display + body for drafted documents:** Crimson Pro (Google Fonts).
  Wide weight range, real italics, made for long-form reading. Used on
  every artist statement / proposal / cover letter view + dossier cover
  headings + page H1s where the surface is content-heavy.
- **UI + chrome:** Inter (Google Fonts). Used for navigation, buttons,
  field labels, table headers, status badges.

Loaded via `next/font/google` in `app/layout.tsx` so they're self-hosted +
font-display: swap by default.

CSS variables (set in `globals.css`):
- `--font-serif` → Crimson Pro
- `--font-sans`  → Inter

Tailwind utilities: `font-serif` / `font-sans`.

## Type scale

UI sans (Inter):
- `text-[11px]` — micro labels, deltas, footnotes
- `text-xs`     — secondary text, captions, status badges
- `text-sm`     — body UI text, button labels, form fields
- `text-base`   — long-form paragraphs in non-document contexts

Display serif (Crimson Pro):
- `font-serif text-3xl`  — page H1 (Settings, Runs, etc.)
- `font-serif text-4xl`  — dossier section heading
- `font-serif text-5xl`  — dossier cover title

Body serif (drafted-document surfaces):
- `font-serif text-base leading-[1.65]` for statements / proposals / cover letters
- Max `prose-narrow` width (~65 char) on long-form
- Generous paragraph gap (`space-y-4` minimum)

## Color tokens

Dark theme is default; passes WCAG AA on all body text:
- `--color-bg` `#0a0a0a` — page bg
- `--color-surface` `#171717` — card / panel
- `--color-surface-2` `#262626` — elevated card / hover
- `--color-border` `#262626` — default border
- `--color-border-hover` `#404040`
- `--color-fg` `#fafafa` — primary text (contrast 19:1)
- `--color-fg-muted` `#a3a3a3` — secondary text (contrast 7.5:1)
- `--color-fg-subtle` `#737373` — tertiary / labels (contrast 4.6:1)
- Accents: emerald, amber, rose at 300/400/500 ramp from Tailwind for
  status (success, in-progress, error). Never raw red — always rose.

## Spacing rhythm

Vertical rhythm on long pages: `space-y-6` between sections, `space-y-12`
between major panels, `space-y-3` inside a card.

Page max-width:
- App shells: `max-w-5xl` (read-heavy) or `max-w-6xl` (grid-heavy upload)
- Dossier: `max-w-4xl` for prose-leaning, `max-w-5xl` for opportunity cards
- Forms: `max-w-2xl`

## Component primitives (in `app/_components/`)

- `<Button>` — primary (light bg, dark text), secondary (border), ghost (text only)
- `<Card>` — bordered panel, default `bg-surface`
- `<Badge>` — status pill with semantic color variant
- `<Skeleton>` — shimmer block for loading states
- `<EmptyState>` — title + body + CTA pattern for "no X yet" surfaces
- `<CyclingStatus>` — already exists, used on long-running async ops
- `<Prose>` — drafted-document container, serif body + measure + leading

Use these in every surface. Don't re-roll inline borders/padding combos
that drift from the system.

## Loading + empty states

- Every async-fetch page renders a `<Skeleton>` matching its layout
  shape, NOT raw "Loading…" text.
- Every list view's empty state uses `<EmptyState>` with a real CTA.

## Forbidden vocabulary in user-facing strings

Any of these in `app/**` or `components/**` outside `lib/ui/copy.ts`
fails the build:
- composite_score / fit_score / `_score`
- AKB (uppercase abbreviation; "Knowledge Base" is the user-facing term)
- ingest / ingested (use "import" / "added")
- Rubric Matcher / Style Analyst / Knowledge Extractor / Opportunity
  Scout / Package Drafter (internal agent names — describe the work
  instead)
- akb_patch / source_provenance / merge / manual_override

Add new banned terms to the CI grep step at `scripts/check-copy.mjs`.

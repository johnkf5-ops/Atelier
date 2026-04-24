import type { ArtistKnowledgeBase as TAkb } from '@/lib/schemas/akb';

export type Gap = {
  field: string;
  importance: number; // higher = ask sooner
  question_seed: string; // raw fallback prompt for the interviewer
};

// Importance bands, per build plan §2.6:
// identity > practice > intent > exhibitions > rest
const IMPORTANCE = {
  identity: 100,
  practice: 90,
  intent: 80,
  exhibitions: 60,
  bodies_of_work: 55,
  representation: 50,
  publications: 45,
  awards_and_honors: 40,
  collections: 35,
  education: 30,
};

function isEmptyScalar(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  return false;
}

export function detectGaps(akb: TAkb): Gap[] {
  const gaps: Gap[] = [];

  // identity
  if (isEmptyScalar(akb.identity.legal_name)) {
    gaps.push({ field: 'identity.legal_name', importance: IMPORTANCE.identity + 5, question_seed: "What's your legal name (the one you'd put on a federal grant form)?" });
  }
  if (akb.identity.citizenship.length === 0) {
    gaps.push({ field: 'identity.citizenship', importance: IMPORTANCE.identity + 4, question_seed: 'What citizenship(s) do you hold? This determines NEA + Guggenheim eligibility.' });
  }
  if (isEmptyScalar(akb.identity.home_base.city) || isEmptyScalar(akb.identity.home_base.state)) {
    gaps.push({ field: 'identity.home_base', importance: IMPORTANCE.identity + 3, question_seed: 'Where are you based — city, state, country? Some state arts councils require 12 months of prior residency.' });
  }
  if (akb.identity.year_of_birth === undefined) {
    gaps.push({ field: 'identity.year_of_birth', importance: IMPORTANCE.identity, question_seed: "Year of birth? Some programs (e.g. Anonymous Was A Woman) gate on age." });
  }

  // practice
  if (isEmptyScalar(akb.practice.primary_medium)) {
    gaps.push({ field: 'practice.primary_medium', importance: IMPORTANCE.practice + 5, question_seed: 'How would you describe your primary medium in three to six words?' });
  }
  if (isEmptyScalar(akb.practice.process_description)) {
    gaps.push({ field: 'practice.process_description', importance: IMPORTANCE.practice + 4, question_seed: 'Describe your process — how a piece comes into being, in 2-4 sentences.' });
  }
  if (akb.practice.materials_and_methods.length === 0) {
    gaps.push({ field: 'practice.materials_and_methods', importance: IMPORTANCE.practice + 2, question_seed: 'What materials and methods do you work with? List as many as feel central.' });
  }

  // intent
  if (isEmptyScalar(akb.intent.statement)) {
    gaps.push({ field: 'intent.statement', importance: IMPORTANCE.intent + 5, question_seed: 'What is your work about? You can answer plainly — I will sharpen the language.' });
  }
  if (akb.intent.influences.length === 0) {
    gaps.push({ field: 'intent.influences', importance: IMPORTANCE.intent + 2, question_seed: 'Which artists, writers, or ideas do you consider direct influences? Three to five names is fine.' });
  }
  if (akb.intent.aspirations.length === 0) {
    gaps.push({ field: 'intent.aspirations', importance: IMPORTANCE.intent + 1, question_seed: 'What would success in the next two years look like — institutional placement, residency, museum acquisition?' });
  }

  // exhibitions / bodies of work
  if (akb.exhibitions.length === 0) {
    gaps.push({ field: 'exhibitions', importance: IMPORTANCE.exhibitions, question_seed: 'List any solo or group exhibitions in the last few years — venue, year, type.' });
  }
  if (akb.bodies_of_work.length === 0) {
    gaps.push({ field: 'bodies_of_work', importance: IMPORTANCE.bodies_of_work, question_seed: 'Name the distinct bodies of work in your portfolio. Title + roughly which years.' });
  }

  // career stage is enum and always defaulted; no gap unless explicitly empty

  return gaps.sort((a, b) => b.importance - a.importance);
}

export function topGapField(akb: TAkb): string | null {
  const gaps = detectGaps(akb);
  return gaps.length > 0 ? gaps[0].field : null;
}

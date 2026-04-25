import { z } from 'zod';

export const ArtistKnowledgeBase = z.object({
  identity: z.object({
    // WALKTHROUGH Note 4: artist_name is the PRIMARY identity used in every
    // public-facing drafted output (cover letters, statements, bios). The
    // legal_name field is administrative metadata only — used in tax/admin
    // sections of submission templates that explicitly require it.
    artist_name: z.string().optional(),
    legal_name: z.string(),
    legal_name_matches_artist_name: z.boolean().optional(),
    public_name: z.string().optional(),
    pronouns: z.string().optional(),
    citizenship: z.array(z.string()),
    home_base: z.object({
      city: z.string(),
      state: z.string().optional(), // international artists may not have a US-style state
      country: z.string(),
    }),
    year_of_birth: z.number().optional(),
  }),
  practice: z.object({
    primary_medium: z.string(),
    secondary_media: z.array(z.string()),
    process_description: z.string(),
    materials_and_methods: z.array(z.string()),
    typical_scale: z.string().optional(),
  }),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string().optional(),
      year: z.number().optional(),
      notes: z.string().optional(),
    }),
  ),
  bodies_of_work: z.array(
    z.object({
      title: z.string(),
      years: z.string(),
      description: z.string(),
      image_ids: z.array(z.number()).optional(),
    }),
  ),
  exhibitions: z.array(
    z.object({
      title: z.string(),
      venue: z.string(),
      location: z.string(),
      year: z.number(),
      type: z.enum(['solo', 'group', 'two-person', 'art-fair']),
    }),
  ),
  publications: z.array(
    z.object({
      publisher: z.string(),
      title: z.string().optional(),
      year: z.number(),
      url: z.string().optional(),
    }),
  ),
  awards_and_honors: z.array(
    z.object({
      name: z.string(),
      year: z.number(),
      notes: z.string().optional(),
    }),
  ),
  collections: z.array(
    z.object({
      name: z.string(),
      type: z.enum(['public', 'private', 'corporate', 'museum']),
    }),
  ),
  representation: z.array(
    z.object({
      gallery: z.string(),
      location: z.string(),
      since_year: z.number().optional(),
    }),
  ),
  career_stage: z.enum(['emerging', 'mid-career', 'established', 'late-career']),
  // Curatorial, organizational, founding, editorial credits — distinct from the
  // artist's own exhibitions/publications. Captures roles like "founder of X",
  // "curated Y for Z", "organized N events at A". Optional — older AKBs that
  // pre-date this field still parse cleanly.
  curatorial_and_organizational: z
    .array(
      z.object({
        role: z.string(), // e.g. "Founder", "Curator", "Co-curator", "Organizer", "Editor"
        organization: z.string(), // e.g. "FOTO", "National Geographic", "HUG"
        project_or_publication: z.string().optional(), // e.g. "Art Basel 2024 booth", "HUG Photography Annual 2023"
        year: z.number().optional(),
        year_end: z.number().optional(), // for ongoing roles, omit
        notes: z.string().optional(),
      }),
    )
    .optional(),
  intent: z.object({
    statement: z.string(),
    influences: z.array(z.string()),
    aspirations: z.array(z.string()),
  }),
  source_provenance: z.record(z.string(), z.string()),
});

export type ArtistKnowledgeBase = z.infer<typeof ArtistKnowledgeBase>;

// PartialAKB — used for ingestion output and interview akb_patch.
// .deepPartial() recurses — every field at every depth is optional.
// Requires zod@^3 (v4 removed .deepPartial).
export const PartialAKB = ArtistKnowledgeBase.deepPartial();
export type PartialAKB = z.infer<typeof PartialAKB>;

// Back-compat alias for call sites still using the longer name.
export const PartialArtistKnowledgeBase = PartialAKB;
export type PartialArtistKnowledgeBase = PartialAKB;

/**
 * Minimum-viable AKB shape — starting point for ingestion (which builds
 * up from partials and may not yet produce a schema-valid result).
 * The strict ArtistKnowledgeBase-valid row is only required at /finalize
 * and the /review "Continue to dossier" gate.
 */
export function emptyAkb(legalName = ''): ArtistKnowledgeBase {
  return {
    identity: {
      legal_name: legalName,
      citizenship: [],
      home_base: { city: '', country: '' },
    },
    practice: {
      primary_medium: '',
      secondary_media: [],
      process_description: '',
      materials_and_methods: [],
    },
    education: [],
    bodies_of_work: [],
    exhibitions: [],
    publications: [],
    awards_and_honors: [],
    collections: [],
    representation: [],
    career_stage: 'mid-career',
    intent: { statement: '', influences: [], aspirations: [] },
    source_provenance: {},
  };
}

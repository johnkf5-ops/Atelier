import { z } from 'zod';

export const ArtistKnowledgeBase = z.object({
  identity: z.object({
    legal_name: z.string(),
    public_name: z.string().optional(),
    pronouns: z.string().optional(),
    citizenship: z.array(z.string()),
    home_base: z.object({
      city: z.string(),
      state: z.string(),
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
  intent: z.object({
    statement: z.string(),
    influences: z.array(z.string()),
    aspirations: z.array(z.string()),
  }),
  source_provenance: z.record(z.string(), z.string()),
});

export type ArtistKnowledgeBase = z.infer<typeof ArtistKnowledgeBase>;

export const PartialArtistKnowledgeBase = ArtistKnowledgeBase.deepPartial();
export type PartialArtistKnowledgeBase = z.infer<typeof PartialArtistKnowledgeBase>;

export function emptyAkb(legalName = ''): ArtistKnowledgeBase {
  return {
    identity: {
      legal_name: legalName,
      citizenship: [],
      home_base: { city: '', state: '', country: '' },
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

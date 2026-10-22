/**
 * Fixed vocabularies shared by the database checks, the tagger and the admin
 * pages. The pattern list is the character's vocabulary: every pattern post
 * points at one of these loops, never at a side.
 * Keep in sync with the CHECK constraints in supabase/migrations.
 */

export const REGIONS = [
  "uk",
  "europe",
  "north_america",
  "latin_america",
  "middle_east",
  "africa",
  "south_asia",
  "east_asia",
  "southeast_asia",
  "oceania",
  "global",
] as const;
export type Region = (typeof REGIONS)[number];

export const TOPICS = [
  "politics",
  "conflict",
  "economy",
  "business",
  "technology",
  "science",
  "health",
  "environment",
  "society",
  "culture",
  "sport",
  "other",
] as const;
export type Topic = (typeof TOPICS)[number];

export const PATTERNS = [
  "power",
  "fear",
  "profit",
  "ego",
  "tribalism",
  "short_termism",
  "hypocrisy",
  "denial",
] as const;
export type Pattern = (typeof PATTERNS)[number];

export const PERSPECTIVES = ["left-leaning", "centre", "right-leaning", "unrated"] as const;
export type Perspective = (typeof PERSPECTIVES)[number];

export function label(value: string): string {
  return value.replaceAll("_", " ");
}

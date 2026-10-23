import { z } from "zod";

/** Shape returned by the observer_stats() database function. */
const statsSchema = z.object({
  article_count: z.number().int().nonnegative(),
  prev_article_count: z.number().int().nonnegative(),
  patterns: z.array(z.object({ pattern: z.string(), count: z.number().int(), prev: z.number().int() })),
  recurring: z.array(z.object({ name: z.string(), count: z.number().int() })),
});

export type ObserverStats = z.infer<typeof statsSchema>;

/** Below this many tagged stories the shares are too noisy to quote. */
export const MIN_STORIES = 50;
/** Week-on-week comparisons only once the previous week holds real data. */
export const MIN_PREVIOUS_STORIES = 100;

const pct = (part: number, whole: number) => Math.round((part / whole) * 100);

function clean(text: string): string {
  return text.replace(/[<>&\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * Turns raw counts into the <observations> lines the writer may quote.
 * All arithmetic happens here, so the model never has to calculate.
 * Returns null when there is too little data to say anything honest.
 */
export function formatObservations(raw: unknown, windowDays = 7): string | null {
  const parsed = statsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const stats = parsed.data;
  if (stats.article_count < MIN_STORIES) return null;

  const comparable = stats.prev_article_count >= MIN_PREVIOUS_STORIES;
  const lines = [`Stories read and tagged in the last ${windowDays} days: ${stats.article_count}.`];

  if (stats.patterns.length > 0) {
    lines.push(
      comparable
        ? `Behaviour patterns found (share of stories, previous ${windowDays} days in brackets):`
        : "Behaviour patterns found (share of stories; no earlier week to compare yet):",
    );
    for (const p of stats.patterns) {
      const now = pct(p.count, stats.article_count);
      const before = comparable ? ` (previous: ${pct(p.prev, stats.prev_article_count)}%)` : "";
      lines.push(`- ${clean(p.pattern).replace("_", "-")}: ${p.count} stories, ${now}%${before}`);
    }
  }

  if (stats.recurring.length > 0) {
    lines.push(
      `Names appearing in the most stories: ${stats.recurring.map((r) => `${clean(r.name)} (${r.count})`).join(", ")}.`,
    );
  }
  return lines.join("\n");
}

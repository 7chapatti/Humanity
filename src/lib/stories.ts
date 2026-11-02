import { z } from "zod";
import type { Story } from "./generate";

/**
 * Turns story threads into what the writer reads, and the weekly snapshot
 * into background lines. Pure functions; the database work is in run.ts.
 */

/** A row from the thread_stories() database function. */
export interface ThreadStoryRow {
  thread_id: string;
  title: string;
  summary: string | null;
  articles: number;
  outlets: number;
  latest_url: string | null;
  topic: string | null;
  patterns: string[];
}

const SKIPPED_TOPICS = new Set(["sport", "other"]);
/** A pattern counts for a story when at least this share of its articles carry it. */
const PATTERN_SHARE = 0.3;

/** Patterns most of the story's coverage agrees on, most common first. */
export function storyPatterns(patterns: string[], articles: number): string[] {
  const counts = new Map<string, number>();
  for (const p of patterns) counts.set(p, (counts.get(p) ?? 0) + 1);
  const needed = Math.max(1, Math.ceil(articles * PATTERN_SHARE));
  return [...counts.entries()]
    .filter(([, n]) => n >= needed)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([p]) => p);
}

/**
 * The stories worth the character's attention: ones that show a human
 * behaviour, ranked by how many outlets cover them. Sport and oddities out.
 */
export function toThreadStories(rows: ThreadStoryRow[], n: number): Story[] {
  return rows
    .filter((r) => !SKIPPED_TOPICS.has(r.topic ?? "other"))
    .map((r, i) => ({ r, i, patterns: storyPatterns(r.patterns, r.articles) }))
    .filter(({ patterns }) => patterns.length > 0)
    .sort((a, b) => b.r.outlets * 2 + b.patterns.length - (a.r.outlets * 2 + a.patterns.length) || a.i - b.i)
    .slice(0, n)
    .map(({ r, patterns }) => ({
      title: r.title,
      summary: r.summary,
      source: r.outlets === 1 ? "1 outlet" : `${r.outlets} outlets`,
      link: r.latest_url,
      topic: r.topic,
      patterns,
      threadId: r.thread_id,
    }));
}

const snapshotSchema = z.object({
  articles: z.number(),
  top: z.array(
    z.object({ title: z.string(), summary: z.string().nullable(), articles: z.number(), last_week: z.number(), outlets: z.number() }),
  ),
  faded: z.array(z.object({ title: z.string(), last_week: z.number() })),
  regions: z.record(z.string(), z.number()),
  patterns: z.record(z.string(), z.number()),
});

export type SnapshotData = z.infer<typeof snapshotSchema>;

export function parseSnapshot(raw: unknown): SnapshotData | null {
  const parsed = snapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Plain-word direction of a story against the week before. */
export function momentum(thisWeek: number, lastWeek: number): string {
  if (lastWeek === 0) return "new this week";
  if (thisWeek >= lastWeek * 1.5) return "growing";
  if (thisWeek <= lastWeek * 0.67) return "fading";
  return "steady";
}

function clean(text: string): string {
  return text.replace(/[<>&\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * The snapshot as background for the writer: what dominated the week and what
 * vanished unresolved. Words only, no counts (the persona never quotes them).
 */
export function formatSnapshot(data: SnapshotData): string | null {
  const lines: string[] = [];
  if (data.top.length > 0) {
    lines.push("The week's biggest stories:");
    for (const t of data.top.slice(0, 6)) lines.push(`- ${clean(t.title)} (${momentum(t.articles, t.last_week)})`);
  }
  if (data.faded.length > 0) {
    lines.push(`Stories that vanished from the news without resolution: ${data.faded.slice(0, 5).map((f) => clean(f.title)).join("; ")}.`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

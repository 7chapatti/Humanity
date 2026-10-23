/**
 * Picks the stories worth the character's attention: ones that show human
 * behaviour (they carry at least one pattern tag) and that several outlets are
 * covering (a rough "trending" signal until Phase 3 builds proper threads).
 * Oddities with no behaviour behind them, and sport, are left out, and each
 * story appears once however many outlets ran it.
 */

export interface Candidate {
  source: string;
  topic: string | null;
  patterns: string[];
  entities: string[];
}

const SKIPPED_TOPICS = new Set(["sport", "other"]);
/** A name in more stories than this (a big country, say) is too common to link two stories alone. */
const COMMON_NAME_LIMIT = 15;

/**
 * Builds a same-story test: two articles match when they share an uncommon
 * name, or two names of any kind.
 */
function storyMatcher(items: Candidate[]): (i: number, j: number) => boolean {
  const names = items.map((item) => new Set(item.entities.map((e) => e.toLowerCase())));
  const freq = new Map<string, number>();
  for (const set of names) for (const name of set) freq.set(name, (freq.get(name) ?? 0) + 1);
  return (i, j) => {
    const shared = [...names[i]].filter((n) => names[j].has(n));
    return shared.length >= 2 || shared.some((n) => (freq.get(n) ?? 0) <= COMMON_NAME_LIMIT);
  };
}

/** How many distinct outlets carry each article's story. */
export function coverage(items: Candidate[]): number[] {
  const same = storyMatcher(items);
  return items.map((item, i) => {
    const outlets = new Set([item.source]);
    items.forEach((other, j) => {
      if (i !== j && !outlets.has(other.source) && same(i, j)) outlets.add(other.source);
    });
    return outlets.size;
  });
}

/**
 * Eligible stories, most covered first (then most behaviour shown, then input
 * order), keeping only the first article of each story. At most `n`.
 */
export function selectStories<T extends Candidate>(items: T[], n: number): T[] {
  const same = storyMatcher(items);
  const covered = coverage(items);
  const ranked = items
    .map((item, i) => ({ item, i, score: covered[i] * 2 + item.patterns.length }))
    .filter(({ item }) => item.patterns.length > 0 && !SKIPPED_TOPICS.has(item.topic ?? "other"))
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const kept: number[] = [];
  for (const { i } of ranked) {
    if (kept.length >= n) break;
    if (!kept.some((k) => same(i, k))) kept.push(i);
  }
  return kept.map((i) => items[i]);
}

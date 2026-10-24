/**
 * Cheap originality check: how much a draft's meaningful words overlap with
 * an earlier post. Catches near-repeats and light rewordings, not ideas
 * expressed in completely new words (the approval step covers those).
 */

const STOPWORDS = new Set(
  "the a an and or but of to in on at for with from by as is are was were be been it its this that these those you your yours we our us i me my they them their he she his her not no so than then there here what which who whom when why how all any each only just very can will would could should have has had do does did".split(
    " ",
  ),
);

export function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[’']/g, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Share of words the two texts have in common (Jaccard index, 0 to 1). */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

/** At or above this, a draft reads as a repeat of an earlier post. */
export const SIMILAR_THRESHOLD = 0.5;

/** True when the draft is too close to any of the earlier posts. */
export function isTooSimilar(draft: string, earlier: string[], threshold = SIMILAR_THRESHOLD): boolean {
  const words = keywords(draft);
  return earlier.some((post) => overlap(words, keywords(post)) >= threshold);
}

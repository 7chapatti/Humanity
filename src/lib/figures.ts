/**
 * The figure check: every number in a draft must appear in the material the
 * writer was given for it. A number that does not was invented or mangled,
 * and is flagged before approval. No AI involved.
 */

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** Numbers in a text, normalised: "1,500" and "1500" match, "6.30" matches "6.3". */
export function extractFigures(text: string): string[] {
  return (text.match(NUMBER) ?? []).map((raw) => {
    const plain = raw.replace(/,/g, "");
    return plain.includes(".") ? plain.replace(/\.?0+$/, "") : plain;
  });
}

/** Numbers in the draft that do not appear anywhere in its source text. */
export function unsourcedFigures(draft: string, source: string): string[] {
  const known = new Set(extractFigures(source));
  return [...new Set(extractFigures(draft))].filter((n) => !known.has(n));
}

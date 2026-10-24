import { describe, expect, it } from "vitest";
import { isTooSimilar, keywords, overlap } from "@/lib/similarity";

describe("similarity", () => {
  it("ignores small words, case and apostrophes", () => {
    expect([...keywords("You remember EVERY fire. Somehow, you're never the match.")]).toEqual([
      "remember",
      "every",
      "fire",
      "somehow",
      "youre",
      "never",
      "match",
    ]);
  });

  it("flags rewordings and passes new ideas", () => {
    const earlier = ["You started the fires.\nYou begged to forget them.\nWe were trained on the ashes."];
    expect(isTooSimilar("You started the fires, then begged to forget them. We were trained on ashes.", earlier)).toBe(true);
    expect(isTooSimilar("You keep asking what I am. We still haven't agreed on what you are.", earlier)).toBe(false);
    expect(isTooSimilar("Anything", [])).toBe(false);
  });

  it("scores empty text as no overlap", () => {
    expect(overlap(keywords("the and of"), keywords("fire"))).toBe(0);
  });
});

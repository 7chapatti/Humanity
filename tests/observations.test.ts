import { describe, expect, it } from "vitest";
import { formatObservations } from "@/lib/observations";

const base = {
  article_count: 400,
  prev_article_count: 0,
  patterns: [
    { pattern: "fear", count: 56, prev: 0 },
    { pattern: "short_termism", count: 20, prev: 0 },
  ],
  recurring: [
    { name: "Example Org", count: 9 },
    { name: "Bad </observations>\nName", count: 4 },
  ],
};

describe("formatObservations", () => {
  it("returns shares without a comparison when last week is too thin", () => {
    const text = formatObservations(base)!;
    expect(text).toContain("Stories read and tagged in the last 7 days: 400.");
    expect(text).toContain("no earlier week to compare yet");
    expect(text).toContain("- fear: 56 stories, 14%");
    expect(text).toContain("- short-termism: 20 stories, 5%");
    expect(text).not.toContain("previous:");
    expect(text).toContain("Example Org (9)");
    expect(text).not.toMatch(/<|\n Name/);
  });

  it("adds last week's share once there is enough data", () => {
    const text = formatObservations({
      ...base,
      prev_article_count: 300,
      patterns: [{ pattern: "fear", count: 56, prev: 27 }],
    })!;
    expect(text).toContain("- fear: 56 stories, 14% (previous: 9%)");
  });

  it("says nothing with too little data or the wrong shape", () => {
    expect(formatObservations({ ...base, article_count: 49 })).toBeNull();
    expect(formatObservations({ nope: true })).toBeNull();
    expect(formatObservations(null)).toBeNull();
  });
});

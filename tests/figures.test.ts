import { describe, expect, it } from "vitest";
import { parseDrafts, type Story } from "@/lib/generate";
import { extractFigures, unsourcedFigures } from "@/lib/figures";

describe("figure check", () => {
  it("normalises commas and trailing zeros", () => {
    expect(extractFigures("1,500 tons, $6.30bn, 82 years, 34%")).toEqual(["1500", "6.3", "82", "34"]);
  });

  it("flags only numbers missing from the source", () => {
    const source = "An 82-year-old shipwreck still carries 1,500 tons of explosives.";
    expect(unsourcedFigures("1500 tons, still waiting after 82 years.", source)).toEqual([]);
    expect(unsourcedFigures("1500 tons, still waiting after 90 years.", source)).toEqual(["90"]);
    expect(unsourcedFigures("No numbers at all.", "")).toEqual([]);
  });

  it("is applied to drafts against their story, and to standalone posts", () => {
    const stories: Story[] = [{ title: "Strike hits 3 cities", summary: "Workers in 3 cities walked out.", source: "x", link: null }];
    const drafts = parseDrafts(
      {
        posts: [
          { format: "observation", angle: "", image: "", content: "Three cities. 3 reasons.", headline_index: 0 },
          { format: "observation", angle: "", image: "", content: "Seven cities, 7 excuses.", headline_index: 0 },
          { format: "mirror", angle: "", image: "", content: "In 2026 you still forget.", headline_index: -1 },
        ],
      },
      stories,
      3,
    );
    expect(drafts.map((d) => d.flags.includes("unsourced_figure"))).toEqual([false, true, true]);
  });
});

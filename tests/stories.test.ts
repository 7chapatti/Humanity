import { describe, expect, it } from "vitest";
import { weekStartOf } from "@/lib/jobs/snapshot";
import { formatSnapshot, momentum, parseSnapshot, storyPatterns, toThreadStories, type ThreadStoryRow } from "@/lib/stories";

const row = (over: Partial<ThreadStoryRow>): ThreadStoryRow => ({
  thread_id: "t",
  title: "Story",
  summary: "What happened.",
  articles: 4,
  outlets: 2,
  latest_url: "https://example.com/a",
  topic: "politics",
  patterns: ["power", "power"],
  ...over,
});

describe("storyPatterns", () => {
  it("keeps patterns on at least 30% of the coverage, most common first", () => {
    expect(storyPatterns(["fear", "power", "power", "power", "ego"], 10)).toEqual(["power"]);
    expect(storyPatterns(["fear"], 1)).toEqual(["fear"]);
    expect(storyPatterns([], 5)).toEqual([]);
  });
});

describe("toThreadStories", () => {
  it("drops sport and stories with no behaviour, ranks by outlets, carries the thread", () => {
    const stories = toThreadStories(
      [
        row({ thread_id: "small", outlets: 2 }),
        row({ thread_id: "sport", outlets: 9, topic: "sport" }),
        row({ thread_id: "flat", outlets: 8, patterns: [] }),
        row({ thread_id: "big", outlets: 6, title: "Big story" }),
      ],
      10,
    );
    expect(stories.map((s) => s.threadId)).toEqual(["big", "small"]);
    expect(stories[0]).toMatchObject({ title: "Big story", source: "6 outlets", link: "https://example.com/a", patterns: ["power"] });
  });
});

describe("snapshot", () => {
  const data = {
    articles: 1900,
    top: [
      { title: "New story", summary: null, articles: 9, last_week: 0, outlets: 6 },
      { title: "Growing\nstory", summary: "x", articles: 12, last_week: 4, outlets: 5 },
    ],
    faded: [{ title: "Forgotten crisis", last_week: 7 }],
    regions: { europe: 300 },
    patterns: { fear: 400 },
  };

  it("describes momentum in words", () => {
    expect(momentum(9, 0)).toBe("new this week");
    expect(momentum(12, 4)).toBe("growing");
    expect(momentum(2, 10)).toBe("fading");
    expect(momentum(5, 5)).toBe("steady");
  });

  it("formats background with no counts, and rejects the wrong shape", () => {
    const text = formatSnapshot(parseSnapshot(data)!)!;
    expect(text).toContain("- New story (new this week)");
    expect(text).toContain("- Growing story (growing)");
    expect(text).toContain("without resolution: Forgotten crisis.");
    expect(text).not.toMatch(/\d/);
    expect(parseSnapshot({ nope: true })).toBeNull();
  });

  it("finds the Monday of the week in UTC", () => {
    expect(weekStartOf(new Date("2026-11-02T11:00:00Z"))).toBe("2026-11-02");
    expect(weekStartOf(new Date("2026-11-08T23:59:00Z"))).toBe("2026-11-02");
    expect(weekStartOf(new Date("2026-11-01T10:00:00Z"))).toBe("2026-10-26");
  });
});

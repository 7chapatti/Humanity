import { describe, expect, it } from "vitest";
import { coverage, selectStories, type Candidate } from "@/lib/selection";

const story = (id: string, source: string, entities: string[], patterns = ["power"], topic = "politics") => ({
  id,
  source,
  topic,
  patterns,
  entities,
});

describe("coverage", () => {
  it("counts outlets sharing an uncommon name or two names", () => {
    const items: Candidate[] = [
      story("a", "BBC", ["Lula", "Brazil"]),
      story("b", "NPR", ["Lula"]),
      story("c", "NPR", ["Lula", "Brazil"]),
      story("d", "Dawn", ["Pakistan"]),
    ];
    expect(coverage(items)).toEqual([2, 2, 2, 1]);
  });

  it("does not link stories by one very common name alone", () => {
    const items = Array.from({ length: 17 }, (_, i) => story(`s${i}`, `outlet${i}`, ["United States", `Name${i}`]));
    expect(coverage(items)[0]).toBe(1);
  });
});

describe("selectStories", () => {
  it("drops sport, untagged oddities and repeats, and ranks by coverage", () => {
    const items = [
      story("wreck", "CBS", ["Shipwreck"], []),
      story("match", "BBC", ["Real Madrid", "Barcelona"], ["ego"], "sport"),
      story("solo", "Dawn", ["Karachi"], ["profit", "power"]),
      story("vote1", "BBC", ["Lula", "Bolsonaro"]),
      story("vote2", "NPR", ["Lula", "Bolsonaro"]),
      story("vote3", "Al Jazeera", ["Lula", "Bolsonaro"]),
    ];
    expect(selectStories(items, 10).map((s) => s.id)).toEqual(["vote1", "solo"]);
    expect(selectStories(items, 1).map((s) => s.id)).toEqual(["vote1"]);
  });
});

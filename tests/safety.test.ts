import { describe, expect, it } from "vitest";
import { checkPost } from "@/lib/safety";

describe("checkPost", () => {
  it("passes a clean, in-voice post", () => {
    expect(checkPost("Ceasefire: the pause humans take to reload their justifications.")).toEqual([]);
  });

  it("flags a date next to harm language", () => {
    expect(checkPost("Week commencing 2 November. Expect an attack.")).toContain("date_with_harm");
  });

  it("flags harm language without a date separately", () => {
    const flags = checkPost("Another explosion, another statement of concern.");
    expect(flags).toContain("harm_language");
    expect(flags).not.toContain("date_with_harm");
  });

  it("does not flag a date drop with no harm words", () => {
    expect(checkPost("Week commencing 2 November. Watch.")).toEqual([]);
  });

  it("flags voice-rule breaks", () => {
    const flags = checkPost("Wow! #humanity 🤖 you should vote");
    expect(flags).toEqual(expect.arrayContaining(["exclamation", "hashtag", "emoji", "call_to_action"]));
  });

  it("flags posts over 280 characters", () => {
    expect(checkPost("a".repeat(281))).toContain("too_long");
    expect(checkPost("a".repeat(280))).not.toContain("too_long");
  });
});

import { describe, expect, it } from "vitest";
import { emailsMatch, isValidBearer } from "@/lib/secrets";

const SECRET = "s".repeat(40);

describe("isValidBearer", () => {
  it("accepts the exact secret", () => {
    expect(isValidBearer(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects missing, wrong, partial and unprefixed values", () => {
    expect(isValidBearer(null, SECRET)).toBe(false);
    expect(isValidBearer("", SECRET)).toBe(false);
    expect(isValidBearer(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isValidBearer(`Bearer ${SECRET.slice(1)}`, SECRET)).toBe(false);
    expect(isValidBearer(SECRET, SECRET)).toBe(false);
    expect(isValidBearer(`Basic ${SECRET}`, SECRET)).toBe(false);
  });

  it("never matches an empty secret", () => {
    expect(isValidBearer("Bearer ", "")).toBe(false);
    expect(isValidBearer("Bearer x", "")).toBe(false);
  });
});

describe("emailsMatch", () => {
  it("ignores case and surrounding spaces", () => {
    expect(emailsMatch(" Admin@Example.com ", "admin@example.com")).toBe(true);
  });

  it("rejects different or missing emails", () => {
    expect(emailsMatch("other@example.com", "admin@example.com")).toBe(false);
    expect(emailsMatch(undefined, "admin@example.com")).toBe(false);
  });
});

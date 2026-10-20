import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of a "Bearer <secret>" header against the secret.
 * Both sides are hashed first so differing lengths leak nothing.
 */
export function isValidBearer(header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  if (!match) return false;
  const a = createHash("sha256").update(match[1]).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export function emailsMatch(a: string | null | undefined, b: string): boolean {
  return typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();
}

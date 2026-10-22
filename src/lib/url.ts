/** Query parameters that only track clicks; removing them makes the same article match. */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "mc_cid",
  "mc_eid",
  "ocid",
  "cmpid",
  "ito",
  "at_medium",
  "at_campaign",
  "at_custom1",
  "at_custom2",
  "at_custom3",
  "at_custom4",
  "taid",
  "ref",
  "src",
]);

/**
 * Canonical form of an article URL for de-duplication: https or http only,
 * lowercase host, no fragment, no tracking parameters. Null if unusable.
 */
export function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  const out = url.toString();
  return out.length <= 2000 ? out : null;
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./];

/**
 * Rejects feed URLs that could point the server at itself or a private
 * network: https only, no IP literals, no localhost or internal names.
 * Admin-entered, so this is a guard against mistakes, not a full SSRF defence.
 */
export function isSafeFeedUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".")) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  if (host.startsWith("[") || /^[\d.]+$/.test(host)) return false;
  if (PRIVATE_V4.some((re) => re.test(host))) return false;
  return raw.length <= 500;
}

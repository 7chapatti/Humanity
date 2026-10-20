import "server-only";
import { z } from "zod";

/**
 * All server configuration in one place. Model names live here so they can be
 * swapped by changing an environment variable, without touching code.
 */
const serverEnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  /** Model for the weekly batch of flagship posts. */
  POST_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  /** Comma-separated https RSS feed URLs. */
  FEED_URLS: z
    .string()
    .default(
      "https://feeds.bbci.co.uk/news/world/rss.xml,https://www.theguardian.com/world/rss",
    ),
  /** How many draft posts each run asks for. */
  POSTS_PER_RUN: z.coerce.number().int().min(1).max(30).default(14),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  /** Server-only key. Never expose to the browser. */
  SUPABASE_SECRET_KEY: z.string().min(1),
  /** Public base URL, used for sign-in links, e.g. https://humanity-ai.vercel.app */
  SITE_URL: z.url(),
  /** The only email allowed into /admin. */
  ADMIN_EMAIL: z.email(),
  /** Shared secret the scheduler sends as a Bearer token. Keep it long. */
  CRON_SECRET: z.string().min(32),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    // Names only, never values.
    throw new Error(`Invalid or missing environment variables: ${missing}`);
  }
  cached = parsed.data;
  return cached;
}

export function getFeedUrls(env: Pick<ServerEnv, "FEED_URLS">): string[] {
  return env.FEED_URLS.split(",")
    .map((u) => u.trim())
    .filter((u) => {
      try {
        return new URL(u).protocol === "https:";
      } catch {
        return false;
      }
    });
}

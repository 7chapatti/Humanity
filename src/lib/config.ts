import "server-only";
import { z } from "zod";

/**
 * All server configuration in one place. Model names live here so they can be
 * swapped by changing an environment variable, without touching code.
 */
export const DEFAULT_MODELS = {
  anthropic: "claude-sonnet-5-5",
  // Listed in OpenAI's complimentary-tokens model group (data sharing opt-in).
  openai: "gpt-5.4-mini-2026-03-17",
} as const;

const serverEnvObject = z.object({
  /** Which API writes the posts. The persona is identical either way. */
  AI_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  /** Model for the weekly batch. Defaults per provider (DEFAULT_MODELS). */
  POST_MODEL: z.string().min(1).optional(),
  /** Comma-separated https RSS feed URLs. */
  FEED_URLS: z
    .string()
    .default(
      "https://feeds.bbci.co.uk/news/world/rss.xml,https://www.theguardian.com/world/rss",
    ),
  /** How many draft posts each run asks for. */
  POSTS_PER_RUN: z.coerce.number().int().min(1).max(30).default(3),
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

/** Requires only the selected provider's key, and fills in its default model. */
export const serverEnvSchema = serverEnvObject
  .superRefine((env, ctx) => {
    const keyName = env.AI_PROVIDER === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    if (!env[keyName]) ctx.addIssue({ code: "custom", path: [keyName], message: "Required for AI_PROVIDER" });
  })
  .transform((env) => ({ ...env, POST_MODEL: env.POST_MODEL ?? DEFAULT_MODELS[env.AI_PROVIDER] }));

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  // A blank variable (e.g. `POST_MODEL=`) means "not set", so defaults apply.
  const present = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = serverEnvSchema.safeParse(present);
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

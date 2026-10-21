import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS, serverEnvSchema } from "@/lib/config";

const base = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk",
  SUPABASE_SECRET_KEY: "sk",
  SITE_URL: "https://example.com",
  ADMIN_EMAIL: "admin@example.com",
  CRON_SECRET: "x".repeat(32),
};

describe("serverEnvSchema provider switch", () => {
  it("defaults to Anthropic and needs only its key", () => {
    const env = serverEnvSchema.parse({ ...base, ANTHROPIC_API_KEY: "a" });
    expect(env.AI_PROVIDER).toBe("anthropic");
    expect(env.POST_MODEL).toBe(DEFAULT_MODELS.anthropic);
  });

  it("uses OpenAI with only an OpenAI key", () => {
    const env = serverEnvSchema.parse({ ...base, AI_PROVIDER: "openai", OPENAI_API_KEY: "o" });
    expect(env.POST_MODEL).toBe(DEFAULT_MODELS.openai);
  });

  it("rejects a provider without its key, naming the missing variable", () => {
    const result = serverEnvSchema.safeParse({ ...base, AI_PROVIDER: "openai", ANTHROPIC_API_KEY: "a" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join("."))).toContain("OPENAI_API_KEY");
  });

  it("keeps an explicit model override", () => {
    const env = serverEnvSchema.parse({ ...base, OPENAI_API_KEY: "o", AI_PROVIDER: "openai", POST_MODEL: "gpt-x" });
    expect(env.POST_MODEL).toBe("gpt-x");
  });

  it("rejects an unknown provider", () => {
    expect(serverEnvSchema.safeParse({ ...base, AI_PROVIDER: "gemini", ANTHROPIC_API_KEY: "a" }).success).toBe(false);
  });
});

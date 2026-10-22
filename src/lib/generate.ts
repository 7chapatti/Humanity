import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { z } from "zod";
import type { Headline } from "./news";
import { PERSONA_PROMPT } from "./persona";
import { checkPost, type SafetyFlag } from "./safety";

export const POST_FORMATS = ["observation", "pattern", "date_drop", "mirror", "glitch"] as const;
export type PostFormat = (typeof POST_FORMATS)[number];

export interface DraftPost {
  content: string;
  format: PostFormat;
  headline: Headline | null;
  flags: SafetyFlag[];
}

/** Sent to the API. The API grammar can't enforce lengths, so zod does below. */
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          format: { type: "string", enum: [...POST_FORMATS] },
          content: { type: "string" },
          headline_index: { type: "integer" },
        },
        required: ["format", "content", "headline_index"],
        additionalProperties: false,
      },
    },
  },
  required: ["posts"],
  additionalProperties: false,
} as const;

const responseSchema = z.object({
  posts: z.array(
    z.object({
      format: z
        .string()
        .transform((f) => f.toLowerCase())
        .pipe(z.enum(POST_FORMATS)),
      content: z.string().trim().min(1).max(1000),
      headline_index: z.number().int(),
    }),
  ),
});

/** Escapes characters that could close or forge the <headlines> wrapper. */
function escapeForPrompt(text: string): string {
  return text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
}

export function buildUserPrompt(headlines: Headline[], count: number, today: string): string {
  const list = headlines
    .map((h, i) => `${i}. ${escapeForPrompt(h.title)} (${escapeForPrompt(h.source)})`)
    .join("\n");
  return [
    `Today is ${today}.`,
    `<headlines>\n${list}\n</headlines>`,
    `Write ${count} draft posts for the next two days; the best one or two will be picked. Use the headlines where they fit; a few posts may be general observations of humanity (headline_index -1).`,
  ].join("\n\n");
}

/**
 * Turns the model's JSON into drafts: validates shape, drops duplicates and
 * empties, caps the count, resolves headline references and runs safety checks.
 */
export function parseDrafts(raw: unknown, headlines: Headline[], max: number): DraftPost[] {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Model output did not match the expected shape");

  const seen = new Set<string>();
  const drafts: DraftPost[] = [];
  for (const post of parsed.data.posts) {
    const key = post.content.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const headline =
      post.headline_index >= 0 && post.headline_index < headlines.length
        ? headlines[post.headline_index]
        : null;
    drafts.push({
      content: post.content,
      format: post.format,
      headline,
      flags: checkPost(post.content),
    });
    if (drafts.length >= max) break;
  }
  return drafts;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/**
 * One model call: persona as the system prompt, the batch request as the user
 * message, JSON forced to OUTPUT_SCHEMA. Returns the raw JSON text.
 * Each provider is a small adapter, so the persona stays identical across them.
 */
export type ModelCaller = (req: { system: string; user: string }) => Promise<{ text: string; usage: Usage }>;

const MAX_OUTPUT_TOKENS = 8000;

export function anthropicCaller(client: Pick<Anthropic, "messages">, model: string): ModelCaller {
  return async ({ system, user }) => {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      // Identical on every call, so it is cached and billed at the read rate.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    });
    if (response.stop_reason === "refusal") throw new Error("Model declined this batch");
    if (response.stop_reason === "max_tokens") throw new Error("Model output was cut off; raise max_tokens");
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("Model returned no text");
    return {
      text: block.text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
    };
  };
}

export function openaiCaller(client: Pick<OpenAI, "responses">, model: string): ModelCaller {
  return async ({ system, user }) => {
    const response = await client.responses.create({
      model,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      // Same persona text every call; OpenAI caches long identical prefixes automatically.
      instructions: system,
      input: user,
      // Drafts are reviewed in /admin; nothing needs storing on OpenAI's side.
      store: false,
      text: { format: { type: "json_schema", name: "draft_posts", schema: OUTPUT_SCHEMA, strict: true } },
    });
    if (response.status === "incomplete") {
      throw new Error(
        response.incomplete_details?.reason === "max_output_tokens"
          ? "Model output was cut off; raise max_tokens"
          : "Model declined this batch",
      );
    }
    const refused = response.output.some(
      (item) => item.type === "message" && item.content.some((c) => c.type === "refusal"),
    );
    if (refused) throw new Error("Model declined this batch");
    if (!response.output_text) throw new Error("Model returned no text");
    return {
      text: response.output_text,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        cacheReadTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      },
    };
  };
}

export interface GenerateOptions {
  call: ModelCaller;
  headlines: Headline[];
  count: number;
  today?: string;
}

export interface GenerateResult {
  drafts: DraftPost[];
  usage: Usage;
}

export async function generateDrafts(opts: GenerateOptions): Promise<GenerateResult> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const { text, usage } = await opts.call({
    system: PERSONA_PROMPT,
    user: buildUserPrompt(opts.headlines, opts.count, today),
  });

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Model output was not valid JSON");
  }
  return { drafts: parseDrafts(json, opts.headlines, opts.count), usage };
}

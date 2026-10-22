import { z } from "zod";
import { parseJson, type ModelCaller, type Usage } from "./ai";
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

export { anthropicCaller, openaiCaller, type ModelCaller, type Usage } from "./ai";

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
    schema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "draft_posts",
    maxTokens: 8000,
  });
  return { drafts: parseDrafts(parseJson(text), opts.headlines, opts.count), usage };
}

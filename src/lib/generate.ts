import { z } from "zod";
import { parseJson, type ModelCaller, type Usage } from "./ai";
import type { Headline } from "./news";
import { PERSONA_PROMPT } from "./persona";
import { checkPost, type SafetyFlag } from "./safety";

export const POST_FORMATS = ["observation", "pattern", "date_drop", "mirror", "recognition", "glitch"] as const;
export type PostFormat = (typeof POST_FORMATS)[number];

/** A headline plus whatever the pipeline knows about it. */
export interface Story extends Headline {
  summary?: string | null;
  topic?: string | null;
  patterns?: string[];
}

export interface DraftPost {
  content: string;
  angle: string;
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
          angle: { type: "string" },
          content: { type: "string" },
          headline_index: { type: "integer" },
        },
        required: ["format", "angle", "content", "headline_index"],
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
      angle: z.string().trim().max(300).catch(""),
      content: z.string().trim().min(1).max(1000),
      headline_index: z.number().int(),
    }),
  ),
});

/** Escapes characters that could close or forge the <headlines> wrapper. */
function escapeForPrompt(text: string): string {
  return text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
}

function storyLine(s: Story, i: number): string {
  const summary = s.summary ? ` — ${escapeForPrompt(s.summary.slice(0, 280))}` : "";
  const tags = [s.topic, s.patterns?.length ? s.patterns.join(", ") : null].filter(Boolean).join(" · ");
  return `${i}. ${escapeForPrompt(s.title)}${summary} (${escapeForPrompt(s.source)})${tags ? ` [${tags}]` : ""}`;
}

export function buildUserPrompt(stories: Story[], count: number, today: string, observations?: string | null): string {
  return [
    `Today is ${today}.`,
    `<headlines>\n${stories.map(storyLine).join("\n")}\n</headlines>`,
    observations ? `<observations>\n${escapeForPrompt(observations)}\n</observations>` : null,
    `Write ${count} draft posts for the next two days; the best one or two will be picked. Choose the stories that reveal the most about human behaviour, not simply the biggest. A post may instead be a general observation of humanity or draw on <observations> (headline_index -1).`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Turns the model's JSON into drafts: validates shape, drops duplicates and
 * empties, caps the count, resolves headline references and runs safety checks.
 */
export function parseDrafts(raw: unknown, headlines: Story[], max: number): DraftPost[] {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Model output did not match the expected shape");

  const seen = new Set<string>();
  const drafts: DraftPost[] = [];
  for (const post of parsed.data.posts) {
    const key = post.content.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const story =
      post.headline_index >= 0 && post.headline_index < headlines.length
        ? headlines[post.headline_index]
        : null;
    drafts.push({
      content: post.content,
      angle: post.angle,
      format: post.format,
      headline: story && { title: story.title, source: story.source, link: story.link },
      flags: checkPost(post.content),
    });
    if (drafts.length >= max) break;
  }
  return drafts;
}

export { anthropicCaller, openaiCaller, type ModelCaller, type Usage } from "./ai";

export interface GenerateOptions {
  call: ModelCaller;
  headlines: Story[];
  count: number;
  today?: string;
  observations?: string | null;
}

export interface GenerateResult {
  drafts: DraftPost[];
  usage: Usage;
}

export async function generateDrafts(opts: GenerateOptions): Promise<GenerateResult> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const { text, usage } = await opts.call({
    system: PERSONA_PROMPT,
    user: buildUserPrompt(opts.headlines, opts.count, today, opts.observations),
    schema: OUTPUT_SCHEMA as unknown as Record<string, unknown>,
    schemaName: "draft_posts",
    maxTokens: 8000,
  });
  return { drafts: parseDrafts(parseJson(text), opts.headlines, opts.count), usage };
}

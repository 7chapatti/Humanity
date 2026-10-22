import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface ModelRequest {
  /** Stable instructions; identical across calls so providers can cache them. */
  system: string;
  /** Per-call input. Anything untrusted inside it must already be escaped. */
  user: string;
  /** JSON schema the reply must follow (every object: additionalProperties false). */
  schema: Record<string, unknown>;
  /** a-z, 0-9 and underscores; OpenAI requires a name for the format. */
  schemaName: string;
  maxTokens: number;
}

/**
 * One structured model call. Each provider is a small adapter, so prompts and
 * schemas stay identical whichever API is in use. Returns the raw JSON text.
 */
export type ModelCaller = (req: ModelRequest) => Promise<{ text: string; usage: Usage }>;

export function anthropicCaller(client: Pick<Anthropic, "messages">, model: string): ModelCaller {
  return async ({ system, user, schema, maxTokens }) => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      // Identical on every call, so it is cached and billed at the read rate.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema } },
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
  return async ({ system, user, schema, schemaName, maxTokens }) => {
    const response = await client.responses.create({
      model,
      max_output_tokens: maxTokens,
      // Same instructions every call; OpenAI caches long identical prefixes automatically.
      instructions: system,
      input: user,
      // Nothing needs storing on OpenAI's side.
      store: false,
      text: { format: { type: "json_schema", name: schemaName, schema, strict: true } },
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

/** Parses a model's JSON reply with a clear error instead of a SyntaxError. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Model output was not valid JSON");
  }
}

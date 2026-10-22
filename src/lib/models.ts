import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { anthropicCaller, openaiCaller, type ModelCaller } from "./ai";
import type { ServerEnv } from "./config";

/** Builds a caller for the configured provider. The model name decides the tier. */
export function createCaller(env: ServerEnv, model: string): ModelCaller {
  return env.AI_PROVIDER === "openai"
    ? openaiCaller(new OpenAI({ apiKey: env.OPENAI_API_KEY }), model)
    : anthropicCaller(new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }), model);
}

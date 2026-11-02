import type OpenAI from "openai";

/**
 * Embeddings: a fixed-length list of numbers per text, close together when the
 * texts mean similar things. Used to group articles about the same story.
 * OpenAI's small model, shortened to 512 numbers: plenty for matching news
 * stories, and half the storage of the default.
 */
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 512;

export type Embedder = (texts: string[]) => Promise<{ vectors: number[][]; tokens: number }>;

export function openaiEmbedder(client: Pick<OpenAI, "embeddings">): Embedder {
  return async (texts) => {
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: "float",
    });
    const vectors: number[][] = new Array(texts.length);
    for (const item of response.data) vectors[item.index] = item.embedding;
    for (let i = 0; i < texts.length; i++) {
      if (!Array.isArray(vectors[i]) || vectors[i].length !== EMBEDDING_DIMENSIONS) {
        throw new Error("Embedding response was incomplete");
      }
    }
    return { vectors, tokens: response.usage?.prompt_tokens ?? 0 };
  };
}

/** What gets embedded for an article: the headline and the start of its summary. */
export function embeddingText(title: string, summary: string | null): string {
  const text = summary ? `${title}. ${summary.slice(0, 400)}` : title;
  return text.replace(/\s+/g, " ").trim();
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { runPipeline } from "@/lib/jobs/pipeline";
import { STAGES } from "@/lib/character";
import { runCharacterGeneration, runGeneration, type RunOutcome } from "@/lib/run";
import { PERSPECTIVES, REGIONS } from "@/lib/taxonomy";
import { isSafeFeedUrl } from "@/lib/url";
import { checkPost } from "@/lib/safety";
import { createAdminClient } from "@/lib/supabase/admin";
import { KIND_PATHS, POST_KINDS } from "./kinds";

/** The review page a form came from; unknown values fall back to the news queue. */
function returnPath(formData: FormData): string {
  const kind = z.enum(POST_KINDS).safeParse(formData.get("kind"));
  return KIND_PATHS[kind.success ? kind.data : "news"];
}

const reviewSchema = z.object({
  id: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  // Textareas submit Windows line breaks; store plain newlines.
  content: z.string().transform((t) => t.replace(/\r\n?/g, "\n").trim()).pipe(z.string().min(1).max(1000)),
});

/** Approve or reject a draft, saving any edits made to its text. */
export async function reviewPost(formData: FormData) {
  await requireAdmin();
  const back = returnPath(formData);
  const parsed = reviewSchema.safeParse({
    id: formData.get("id"),
    decision: formData.get("decision"),
    content: formData.get("content"),
  });
  if (!parsed.success) redirect(`${back}?error=invalid`);

  const { id, decision, content } = parsed.data;
  const db = createAdminClient();
  // Keep the model's first text the first time it is edited, so drafts can be compared with finals.
  const { data: current } = await db
    .from("posts")
    .select("content, original_content")
    .eq("id", id)
    .maybeSingle<{ content: string; original_content: string | null }>();
  const edited = current && current.content !== content && current.original_content === null;
  const { error } = await db
    .from("posts")
    .update({
      status: decision,
      content,
      flags: checkPost(content),
      reviewed_at: new Date().toISOString(),
      ...(edited ? { original_content: current.content } : {}),
    })
    .eq("id", id)
    .in("status", ["draft", "approved"]);
  if (error) {
    console.error("Review failed:", error.message);
    redirect(`${back}?error=save`);
  }
  revalidatePath(back);
}

const idSchema = z.uuid();

/** Record that an approved post has been published by hand. */
export async function markPosted(formData: FormData) {
  await requireAdmin();
  const back = returnPath(formData);
  const parsed = idSchema.safeParse(formData.get("id"));
  if (!parsed.success) redirect(`${back}?error=invalid`);

  const db = createAdminClient();
  const { error } = await db
    .from("posts")
    .update({ status: "posted", posted_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .eq("status", "approved");
  if (error) {
    console.error("Mark posted failed:", error.message);
    redirect(`${back}?status=approved&error=save`);
  }
  revalidatePath(back);
}

/**
 * Starts ingest, tagging and cleanup in the background and returns at once;
 * progress shows in the jobs table. A second click while it runs is skipped
 * by the one-run-per-job rule in the database.
 */
export async function runPipelineNow() {
  await requireAdmin();
  after(async () => {
    await runPipeline();
  });
  redirect("/admin/jobs?started=1");
}

const toggleSchema = z.object({ id: z.uuid(), active: z.enum(["true", "false"]) });

/** Pause or resume a source. Paused sources are skipped by ingest. */
export async function setSourceActive(formData: FormData) {
  await requireAdmin();
  const parsed = toggleSchema.safeParse({ id: formData.get("id"), active: formData.get("active") });
  if (!parsed.success) redirect("/admin/sources?error=invalid");
  const db = createAdminClient();
  const { error } = await db
    .from("sources")
    .update({ active: parsed.data.active === "true" })
    .eq("id", parsed.data.id);
  if (error) redirect("/admin/sources?error=save");
  revalidatePath("/admin/sources");
}

const sourceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: z.string().trim().max(500).refine(isSafeFeedUrl, "Use a public https feed address"),
  region: z.enum(REGIONS),
  perspective: z.enum(PERSPECTIVES),
});

/** Add a feed. It is fetched on the next pipeline run; failures show on this page. */
export async function addSource(formData: FormData) {
  await requireAdmin();
  const parsed = sourceSchema.safeParse({
    name: formData.get("name"),
    url: formData.get("url"),
    region: formData.get("region"),
    perspective: formData.get("perspective"),
  });
  if (!parsed.success) redirect("/admin/sources?error=invalid");
  const db = createAdminClient();
  const { error } = await db.from("sources").insert(parsed.data);
  if (error) redirect(error.code === "23505" ? "/admin/sources?error=duplicate" : "/admin/sources?error=save");
  revalidatePath("/admin/sources");
  redirect("/admin/sources?added=1");
}

function finishRun(outcome: RunOutcome, path: string): never {
  revalidatePath(path);
  if (outcome.status === "done") redirect(`${path}?generated=${outcome.drafts}`);
  if (outcome.status === "skipped") redirect(`${path}?error=busy`);
  redirect(`${path}?error=generate`);
}

/** Manual news run, bypassing the schedule guard (never the overlap guard). */
export async function generateNow(formData: FormData) {
  await requireAdmin();
  finishRun(await runGeneration({ force: true, confusion: formData.get("confusion") === "on" }), KIND_PATHS.news);
}

/** Writes a batch of standalone character posts for the chosen stage. */
export async function generateCharacterNow(formData: FormData) {
  await requireAdmin();
  const stage = z.enum(STAGES).safeParse(formData.get("stage"));
  if (!stage.success) redirect(`${KIND_PATHS.character}?error=invalid`);
  finishRun(await runCharacterGeneration(stage.data, formData.get("confusion") === "on"), KIND_PATHS.character);
}

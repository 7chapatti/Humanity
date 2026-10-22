"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { runPipeline } from "@/lib/jobs/pipeline";
import { runGeneration } from "@/lib/run";
import { PERSPECTIVES, REGIONS } from "@/lib/taxonomy";
import { isSafeFeedUrl } from "@/lib/url";
import { checkPost } from "@/lib/safety";
import { createAdminClient } from "@/lib/supabase/admin";

const reviewSchema = z.object({
  id: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  content: z.string().trim().min(1).max(1000),
});

/** Approve or reject a draft, saving any edits made to its text. */
export async function reviewPost(formData: FormData) {
  await requireAdmin();
  const parsed = reviewSchema.safeParse({
    id: formData.get("id"),
    decision: formData.get("decision"),
    content: formData.get("content"),
  });
  if (!parsed.success) redirect("/admin?error=invalid");

  const { id, decision, content } = parsed.data;
  const db = createAdminClient();
  const { error } = await db
    .from("posts")
    .update({
      status: decision,
      content,
      flags: checkPost(content),
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["draft", "approved"]);
  if (error) {
    console.error("Review failed:", error.message);
    redirect("/admin?error=save");
  }
  revalidatePath("/admin");
}

const idSchema = z.uuid();

/** Record that an approved post has been published by hand. */
export async function markPosted(formData: FormData) {
  await requireAdmin();
  const parsed = idSchema.safeParse(formData.get("id"));
  if (!parsed.success) redirect("/admin?error=invalid");

  const db = createAdminClient();
  const { error } = await db
    .from("posts")
    .update({ status: "posted", posted_at: new Date().toISOString() })
    .eq("id", parsed.data)
    .eq("status", "approved");
  if (error) {
    console.error("Mark posted failed:", error.message);
    redirect("/admin?status=approved&error=save");
  }
  revalidatePath("/admin");
}

/** Runs ingest, tagging and cleanup now instead of waiting for the 2-hourly schedule. */
export async function runPipelineNow() {
  await requireAdmin();
  const outcomes = await runPipeline();
  revalidatePath("/admin/jobs");
  const failed = outcomes.filter((o) => o.status === "failed").map((o) => o.job);
  redirect(failed.length ? `/admin/jobs?failed=${failed.join(",")}` : "/admin/jobs?ran=1");
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

/** Manual run, bypassing the once-a-week guard (never the overlap guard). */
export async function generateNow() {
  await requireAdmin();
  const outcome = await runGeneration({ force: true });
  revalidatePath("/admin");
  if (outcome.status === "done") redirect(`/admin?generated=${outcome.drafts}`);
  if (outcome.status === "skipped") redirect("/admin?error=busy");
  redirect("/admin?error=generate");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { runGeneration } from "@/lib/run";
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

/** Manual run, bypassing the once-a-week guard (never the overlap guard). */
export async function generateNow() {
  await requireAdmin();
  const outcome = await runGeneration({ force: true });
  revalidatePath("/admin");
  if (outcome.status === "done") redirect(`/admin?generated=${outcome.drafts}`);
  if (outcome.status === "skipped") redirect("/admin?error=busy");
  redirect("/admin?error=generate");
}

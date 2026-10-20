"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { emailsMatch } from "@/lib/auth";
import { getServerEnv } from "@/lib/config";
import { createSessionClient } from "@/lib/supabase/server";

const emailSchema = z.email().max(254);

export async function sendMagicLink(formData: FormData) {
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? "").trim());
  if (!parsed.success) redirect("/login?error=invalid");

  const env = getServerEnv();
  // Only the admin gets an email. Everyone sees the same "check your inbox"
  // message, so the form never reveals which address is the admin's.
  if (emailsMatch(parsed.data, env.ADMIN_EMAIL)) {
    const supabase = await createSessionClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: new URL("/auth/confirm", env.SITE_URL).toString(),
      },
    });
    if (error) console.error("Magic link failed:", error.message);
  }
  redirect("/login?sent=1");
}

export async function signOut() {
  const supabase = await createSessionClient();
  await supabase.auth.signOut();
  redirect("/login");
}

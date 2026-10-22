import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getServerEnv } from "./config";
import { emailsMatch } from "./secrets";
import { createSessionClient } from "./supabase/server";

export { emailsMatch, isValidBearer } from "./secrets";

/**
 * Returns the admin's email if the current session is the admin, otherwise null.
 * Uses getClaims(), which verifies the JWT, never getSession().
 */
export async function getAdminEmail(): Promise<string | null> {
  // Request-time only: the auth library reads the clock, which must never
  // happen while Next.js prerenders a page's static outline.
  await connection();
  const supabase = await createSessionClient();
  const env = getServerEnv();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  const email = typeof data.claims.email === "string" ? data.claims.email : null;
  return emailsMatch(email, env.ADMIN_EMAIL) ? email : null;
}

/** Use at the top of every admin page and Server Action. */
export async function requireAdmin(): Promise<string> {
  const email = await getAdminEmail();
  if (!email) redirect("/login");
  return email;
}

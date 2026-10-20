import type { EmailOtpType } from "@supabase/supabase-js";
import { connection, NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/lib/config";
import { createSessionClient } from "@/lib/supabase/server";

const ALLOWED_TYPES = new Set<EmailOtpType>(["email", "magiclink"]);

/**
 * Lands the magic link. Requires the Supabase "Magic Link" email template to
 * point at {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
 * Always redirects to a fixed path on our own origin (no open redirect).
 */
export async function GET(request: NextRequest) {
  // Must run per request: it sets session cookies.
  await connection();
  const env = getServerEnv();
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type && ALLOWED_TYPES.has(type) && tokenHash.length <= 512) {
    const supabase = await createSessionClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL("/admin", env.SITE_URL));
  }
  return NextResponse.redirect(new URL("/login?error=link", env.SITE_URL));
}

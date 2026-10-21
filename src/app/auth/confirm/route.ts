import type { EmailOtpType } from "@supabase/supabase-js";
import { connection, NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/lib/config";
import { createSessionClient } from "@/lib/supabase/server";

const ALLOWED_TYPES = new Set<EmailOtpType>(["email", "magiclink"]);
const MAX_PARAM_LENGTH = 512;

function param(request: NextRequest, name: string): string | null {
  const value = request.nextUrl.searchParams.get(name);
  return value && value.length <= MAX_PARAM_LENGTH ? value : null;
}

/**
 * Lands the magic link. Handles both link formats:
 * - Default Supabase email template: Supabase verifies the link, then redirects
 *   here with `?code=` (PKCE). Works with the built-in email sender.
 * - Custom template: `?token_hash=...&type=email`, verified here directly.
 * Always redirects to a fixed path on our own origin (no open redirect).
 */
export async function GET(request: NextRequest) {
  // Must run per request: it sets session cookies.
  await connection();
  const env = getServerEnv();
  const supabase = await createSessionClient();

  const code = param(request, "code");
  if (code) {
    const flowId = param(request, "sb_flow_id");
    const { error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
    if (!error) return NextResponse.redirect(new URL("/admin", env.SITE_URL));
    console.error("Code exchange failed:", error.message);
  }

  const tokenHash = param(request, "token_hash");
  const type = param(request, "type") as EmailOtpType | null;
  if (!code && tokenHash && type && ALLOWED_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL("/admin", env.SITE_URL));
    console.error("OTP verify failed:", error.message);
  }

  return NextResponse.redirect(new URL("/login?error=link", env.SITE_URL));
}

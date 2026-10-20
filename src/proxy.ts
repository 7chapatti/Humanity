import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Only routes that use a session. The cron endpoint authenticates by secret.
  matcher: ["/admin/:path*", "/login", "/auth/:path*"],
};

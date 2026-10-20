import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "../config";

/**
 * Secret-key client. Bypasses RLS, so it must only ever be used on the server
 * AFTER the caller has been verified (cron secret or admin session).
 */
export function createAdminClient() {
  const env = getServerEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

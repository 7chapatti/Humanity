import { after, connection, NextResponse, type NextRequest } from "next/server";
import { isValidBearer } from "@/lib/auth";
import { getServerEnv } from "@/lib/config";
import { runPipeline } from "@/lib/jobs/pipeline";

export const maxDuration = 300;

/**
 * Called every 2 hours by Supabase Cron (pg_net) with
 * `Authorization: Bearer <CRON_SECRET>`. Replies 202 at once and runs the
 * pipeline after the response, so the caller's short timeout never cuts it off.
 * Results are recorded in job_runs and shown on /admin/jobs.
 */
export async function POST(request: NextRequest) {
  await connection();
  const env = getServerEnv();
  if (!isValidBearer(request.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  after(async () => {
    await runPipeline();
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}

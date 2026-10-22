import { connection, NextResponse, type NextRequest } from "next/server";
import { isValidBearer } from "@/lib/auth";
import { getServerEnv } from "@/lib/config";
import { runGeneration } from "@/lib/run";

export const maxDuration = 300;

/**
 * Small batch (Mon, Wed, Fri), called by the scheduler (vercel.json) with
 * `Authorization: Bearer <CRON_SECRET>`. Nothing is published: every draft
 * waits for approval on /admin.
 */
export async function GET(request: NextRequest) {
  // Never prerender or cache this response: it must run, and check auth, per request.
  await connection();
  const env = getServerEnv();
  if (!isValidBearer(request.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const outcome = await runGeneration();
  // Internal error details stay in the logs and the generation_runs table.
  const status = outcome.status === "failed" ? 500 : 200;
  return NextResponse.json(outcome, { status });
}

import "server-only";
import { pickBalanced } from "./balance";
import { getFeedUrls, getServerEnv } from "./config";
import { generateDrafts } from "./generate";
import { createCaller } from "./models";
import { fetchHeadlines, type Headline } from "./news";
import { createAdminClient } from "./supabase/admin";

const HEADLINE_WINDOW_HOURS = 48;
const HEADLINES_PER_RUN = 40;

interface RecentArticle {
  title: string;
  url: string;
  sources: { name: string } | { name: string }[] | null;
}

/**
 * Recent stored articles, taking turns across outlets so no source dominates.
 * Falls back to fetching the FEED_URLS feeds while the articles table is empty.
 */
async function recentHeadlines(db: ReturnType<typeof createAdminClient>, feedUrls: string[]): Promise<Headline[]> {
  const since = new Date(Date.now() - HEADLINE_WINDOW_HOURS * 3_600_000).toISOString();
  const { data } = await db
    .from("articles")
    .select("title, url, sources(name)")
    .gte("fetched_at", since)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(400)
    .returns<RecentArticle[]>();
  const headlines: Headline[] = (data ?? []).map((a) => {
    const source = Array.isArray(a.sources) ? a.sources.at(0) : a.sources;
    return { title: a.title, link: a.url, source: source?.name ?? "unknown" };
  });
  if (headlines.length > 0) return pickBalanced(headlines, (h) => h.source, HEADLINES_PER_RUN);
  return fetchHeadlines(feedUrls);
}

/** A run older than this with no finish time is treated as crashed. */
const STALE_RUN_MINUTES = 10;
/** Scheduled runs skip if a successful run happened within this window. */
const MIN_HOURS_BETWEEN_SCHEDULED_RUNS = 20;

export type RunOutcome =
  | { status: "done"; runId: string; drafts: number }
  | { status: "skipped"; reason: "in_progress" | "recent_run" }
  | { status: "failed"; runId: string | null };

/**
 * One generation run: news in, drafts saved for approval. Guards against
 * overlapping and duplicate runs (scheduler delivery can repeat).
 * `force` skips the weekly guard (manual "generate now"), never the overlap guard.
 */
export async function runGeneration({ force = false } = {}): Promise<RunOutcome> {
  const env = getServerEnv();
  const db = createAdminClient();
  const now = Date.now();

  // Close out runs that crashed mid-way so they stop blocking new ones.
  const staleCutoff = new Date(now - STALE_RUN_MINUTES * 60_000).toISOString();
  await db
    .from("generation_runs")
    .update({ finished_at: new Date(now).toISOString(), error: "Run timed out or crashed" })
    .is("finished_at", null)
    .lt("started_at", staleCutoff);

  if (!force) {
    const recentCutoff = new Date(now - MIN_HOURS_BETWEEN_SCHEDULED_RUNS * 3_600_000).toISOString();
    const { data: recent } = await db
      .from("generation_runs")
      .select("id")
      .not("finished_at", "is", null)
      .is("error", null)
      .gte("started_at", recentCutoff)
      .limit(1);
    if (recent && recent.length > 0) return { status: "skipped", reason: "recent_run" };
  }

  const { data: run, error: runError } = await db
    .from("generation_runs")
    .insert({ model: `${env.AI_PROVIDER}:${env.POST_MODEL}` })
    .select("id")
    .single();
  // 23505 = unique violation: another run holds the one-active-run slot.
  if (runError?.code === "23505") return { status: "skipped", reason: "in_progress" };
  if (runError || !run) {
    console.error("Could not start run:", runError?.message);
    return { status: "failed", runId: null };
  }

  try {
    const headlines = await recentHeadlines(db, getFeedUrls(env));
    const { drafts, usage } = await generateDrafts({
      call: createCaller(env, env.POST_MODEL),
      headlines,
      count: env.POSTS_PER_RUN,
    });

    if (drafts.length > 0) {
      const { error } = await db.from("posts").insert(
        drafts.map((d) => ({
          content: d.content,
          format: d.format,
          flags: d.flags,
          headline_title: d.headline?.title ?? null,
          headline_source: d.headline?.source ?? null,
          headline_link: d.headline?.link ?? null,
          run_id: run.id,
        })),
      );
      if (error) throw new Error(`Saving drafts failed: ${error.message}`);
    }

    await db
      .from("generation_runs")
      .update({
        finished_at: new Date().toISOString(),
        headline_count: headlines.length,
        post_count: drafts.length,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cache_read_tokens: usage.cacheReadTokens,
      })
      .eq("id", run.id);

    return { status: "done", runId: run.id, drafts: drafts.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Generation run failed:", message);
    await db
      .from("generation_runs")
      .update({ finished_at: new Date().toISOString(), error: message.slice(0, 500) })
      .eq("id", run.id);
    return { status: "failed", runId: run.id };
  }
}

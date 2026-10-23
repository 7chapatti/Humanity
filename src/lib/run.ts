import "server-only";
import { getFeedUrls, getServerEnv } from "./config";
import { generateDrafts, type Story } from "./generate";
import { createCaller } from "./models";
import { fetchHeadlines } from "./news";
import { formatObservations } from "./observations";
import { selectStories } from "./selection";
import { createAdminClient } from "./supabase/admin";

const HEADLINE_WINDOW_HOURS = 48;
const HEADLINES_PER_RUN = 40;

const OBSERVATION_WINDOW_DAYS = 7;

interface RecentArticle {
  title: string;
  url: string;
  summary: string | null;
  topic: string | null;
  patterns: string[];
  entities: string[];
  sources: { name: string } | { name: string }[] | null;
}

/**
 * The tagged stories from the last two days most worth commenting on (see
 * selection.ts). Falls back to fetching the FEED_URLS feeds while the
 * articles table is empty.
 */
async function recentHeadlines(db: ReturnType<typeof createAdminClient>, feedUrls: string[]): Promise<Story[]> {
  const since = new Date(Date.now() - HEADLINE_WINDOW_HOURS * 3_600_000).toISOString();
  const { data } = await db
    .from("articles")
    .select("title, url, summary, topic, patterns, entities, sources(name)")
    .gte("fetched_at", since)
    .not("tagged_at", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(800)
    .returns<RecentArticle[]>();
  const stories = (data ?? []).map((a) => {
    const source = Array.isArray(a.sources) ? a.sources.at(0) : a.sources;
    return {
      title: a.title,
      link: a.url,
      source: source?.name ?? "unknown",
      summary: a.summary,
      topic: a.topic,
      patterns: a.patterns,
      entities: a.entities,
    };
  });
  const picked = selectStories(stories, HEADLINES_PER_RUN);
  if (picked.length > 0) {
    return picked.map((s): Story => ({ title: s.title, link: s.link, source: s.source, summary: s.summary, topic: s.topic, patterns: s.patterns }));
  }
  return fetchHeadlines(feedUrls);
}

/**
 * Week-level counts: background on what the character has been noticing,
 * never quoted (the persona forbids it). Optional: if the stats query fails
 * the run carries on with headlines alone.
 */
async function observations(db: ReturnType<typeof createAdminClient>): Promise<string | null> {
  const { data, error } = await db.rpc("observer_stats", { window_days: OBSERVATION_WINDOW_DAYS });
  if (error) {
    console.error("observer_stats failed:", error.message);
    return null;
  }
  return formatObservations(data, OBSERVATION_WINDOW_DAYS);
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
    const [headlines, observed] = await Promise.all([recentHeadlines(db, getFeedUrls(env)), observations(db)]);
    const { drafts, usage } = await generateDrafts({
      call: createCaller(env, env.POST_MODEL),
      headlines,
      count: env.POSTS_PER_RUN,
      observations: observed,
    });

    if (drafts.length > 0) {
      const { error } = await db.from("posts").insert(
        drafts.map((d) => ({
          content: d.content,
          angle: d.angle || null,
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

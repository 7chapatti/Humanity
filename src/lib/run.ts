import "server-only";
import { getFeedUrls, getServerEnv } from "./config";
import { generateCharacterPosts, MAX_EARLIER, type Stage } from "./character";
import { generateDrafts, MAX_APPROVED_EXAMPLES, type DraftPost, type Story } from "./generate";
import type { Usage } from "./ai";
import { createCaller } from "./models";
import { fetchHeadlines } from "./news";
import { formatObservations } from "./observations";
import { selectStories } from "./selection";
import { isTooSimilar } from "./similarity";
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
async function recentHeadlines(db: Db, feedUrls: string[]): Promise<Story[]> {
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
async function observations(db: Db): Promise<string | null> {
  const { data, error } = await db.rpc("observer_stats", { window_days: OBSERVATION_WINDOW_DAYS });
  if (error) {
    console.error("observer_stats failed:", error.message);
    return null;
  }
  return formatObservations(data, OBSERVATION_WINDOW_DAYS);
}

/** A run older than this with no finish time is treated as crashed. */
const STALE_RUN_MINUTES = 10;
/** Scheduled news runs skip if a successful news run happened within this window. */
const MIN_HOURS_BETWEEN_SCHEDULED_RUNS = 20;
/** Character posts written per click. */
const CHARACTER_POSTS_PER_RUN = 6;

type Db = ReturnType<typeof createAdminClient>;
type RunKind = "news" | "character";

export type RunOutcome =
  | { status: "done"; runId: string; drafts: number }
  | { status: "skipped"; reason: "in_progress" | "recent_run" }
  | { status: "failed"; runId: string | null };

/** Recent posts a new draft is checked against for repeats. */
const SIMILARITY_WINDOW = 300;

/**
 * The voice bank and the repeat-check list. Approved and posted posts (in
 * their final, edited form) are the standard the writer matches; every recent
 * post of either kind is what a new draft must not repeat.
 */
async function writerMemory(db: Db): Promise<{ approved: string[]; recent: string[] }> {
  const [{ data: approved }, { data: recent }] = await Promise.all([
    db
      .from("posts")
      .select("content")
      .in("status", ["approved", "posted"])
      .order("reviewed_at", { ascending: false, nullsFirst: false })
      .limit(MAX_APPROVED_EXAMPLES)
      .returns<{ content: string }[]>(),
    db
      .from("posts")
      .select("content")
      .order("created_at", { ascending: false })
      .limit(SIMILARITY_WINDOW)
      .returns<{ content: string }[]>(),
  ]);
  return { approved: (approved ?? []).map((p) => p.content), recent: (recent ?? []).map((p) => p.content) };
}

interface Produced {
  drafts: DraftPost[];
  usage: Usage;
  headlineCount: number;
  stage?: Stage;
  /** Earlier posts the drafts are checked against for repeats. */
  recent: string[];
}

/**
 * Shared run bookkeeping: clears crashed runs, claims the single active-run
 * slot (scheduler delivery can repeat), saves drafts for approval and records
 * tokens or the error.
 */
async function executeRun(kind: RunKind, produce: (db: Db) => Promise<Produced>, skipIfRecent = false): Promise<RunOutcome> {
  const env = getServerEnv();
  const db = createAdminClient();
  const now = Date.now();

  const staleCutoff = new Date(now - STALE_RUN_MINUTES * 60_000).toISOString();
  await db
    .from("generation_runs")
    .update({ finished_at: new Date(now).toISOString(), error: "Run timed out or crashed" })
    .is("finished_at", null)
    .lt("started_at", staleCutoff);

  if (skipIfRecent) {
    const recentCutoff = new Date(now - MIN_HOURS_BETWEEN_SCHEDULED_RUNS * 3_600_000).toISOString();
    const { data: recent } = await db
      .from("generation_runs")
      .select("id")
      .eq("kind", kind)
      .not("finished_at", "is", null)
      .is("error", null)
      .gte("started_at", recentCutoff)
      .limit(1);
    if (recent && recent.length > 0) return { status: "skipped", reason: "recent_run" };
  }

  const { data: run, error: runError } = await db
    .from("generation_runs")
    .insert({ model: `${env.AI_PROVIDER}:${env.POST_MODEL}`, kind })
    .select("id")
    .single();
  // 23505 = unique violation: another run holds the one-active-run slot.
  if (runError?.code === "23505") return { status: "skipped", reason: "in_progress" };
  if (runError || !run) {
    console.error("Could not start run:", runError?.message);
    return { status: "failed", runId: null };
  }

  try {
    const { drafts, usage, headlineCount, stage, recent } = await produce(db);
    for (const d of drafts) {
      if (isTooSimilar(d.content, recent)) d.flags.push("similar_to_earlier");
    }

    if (drafts.length > 0) {
      const { error } = await db.from("posts").insert(
        drafts.map((d) => ({
          kind,
          stage: stage ?? null,
          content: d.content,
          angle: d.angle || null,
          image: d.image || null,
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
        headline_count: headlineCount,
        post_count: drafts.length,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cache_read_tokens: usage.cacheReadTokens,
      })
      .eq("id", run.id);

    return { status: "done", runId: run.id, drafts: drafts.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`${kind} run failed:`, message);
    await db
      .from("generation_runs")
      .update({ finished_at: new Date().toISOString(), error: message.slice(0, 500) })
      .eq("id", run.id);
    return { status: "failed", runId: run.id };
  }
}

/**
 * News run: the week's most covered stories in, drafts saved for approval.
 * `force` skips the schedule guard (manual "generate now"), never the overlap guard.
 * `confusion` turns on identity slips; scheduled runs leave it off.
 */
export async function runGeneration({ force = false, confusion = false } = {}): Promise<RunOutcome> {
  return executeRun(
    "news",
    async (db) => {
      const env = getServerEnv();
      const [headlines, observed, memory] = await Promise.all([
        recentHeadlines(db, getFeedUrls(env)),
        observations(db),
        writerMemory(db),
      ]);
      const { drafts, usage } = await generateDrafts({
        call: createCaller(env, env.POST_MODEL),
        headlines,
        count: env.POSTS_PER_RUN,
        observations: observed,
        confusion,
        approved: memory.approved,
      });
      return { drafts, usage, headlineCount: headlines.length, recent: memory.recent };
    },
    !force,
  );
}

/** Character run: standalone posts for one stage of the arc, avoiding earlier ones. */
export async function runCharacterGeneration(stage: Stage, confusion = false): Promise<RunOutcome> {
  return executeRun("character", async (db) => {
    const env = getServerEnv();
    const [{ data: earlier }, { count: approvedCharacter }, memory] = await Promise.all([
      // Unapproved character ideas (drafts and rejections) not to repeat; approved ones arrive via memory.
      db
        .from("posts")
        .select("content")
        .eq("kind", "character")
        .in("status", ["draft", "rejected"])
        .order("created_at", { ascending: false })
        .limit(MAX_EARLIER)
        .returns<{ content: string }[]>(),
      db
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("kind", "character")
        .in("status", ["approved", "posted"]),
      writerMemory(db),
    ]);
    const { drafts, usage } = await generateCharacterPosts({
      call: createCaller(env, env.POST_MODEL),
      stage,
      count: CHARACTER_POSTS_PER_RUN,
      earlier: (earlier ?? []).map((p) => p.content),
      confusion,
      opening: approvedCharacter === 0,
      approved: memory.approved,
    });
    return { drafts, usage, headlineCount: 0, stage, recent: memory.recent };
  });
}

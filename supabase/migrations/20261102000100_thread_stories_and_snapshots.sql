-- Phase 3, step 2: merge split threads, feed drafts from threads, link posts
-- to their thread, and keep a weekly world snapshot. Same lockdown as before.

alter table public.posts
  add column thread_id uuid references public.threads (id) on delete set null;

create table public.snapshots (
  -- Monday (UTC) the snapshot was taken; it covers the 7 days before it.
  week_start date primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.snapshots enable row level security;
grant select, insert, update, delete on public.snapshots to service_role;

alter table public.job_runs drop constraint job_runs_job_check;
alter table public.job_runs add constraint job_runs_job_check
  check (job in ('ingest', 'tag', 'embed', 'thread', 'summarize', 'snapshot', 'cleanup'));

-- Joins threads that turn out to be the same story (one split early on).
-- The bigger thread keeps its id; the smaller one's articles move across.
-- Only active threads with 2+ articles are compared, to keep it cheap.
create or replace function public.merge_similar_threads(p_min_similarity float8, p_window_days int default 7, p_max int default 50)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_keep uuid;
  v_drop uuid;
  v_merged int := 0;
begin
  loop
    select a.id, b.id into v_keep, v_drop
      from public.threads a
      join public.threads b on a.id <> b.id
     where a.last_seen >= now() - make_interval(days => p_window_days)
       and b.last_seen >= now() - make_interval(days => p_window_days)
       and a.article_count >= 2 and b.article_count >= 2
       and (a.article_count > b.article_count or (a.article_count = b.article_count and a.id < b.id))
       and 1 - (a.centroid operator(extensions.<=>) b.centroid) >= p_min_similarity
     order by a.centroid operator(extensions.<=>) b.centroid
     limit 1;
    exit when v_keep is null or v_merged >= p_max;

    update public.articles set thread_id = v_keep where thread_id = v_drop;
    update public.threads k
       set centroid = k.centroid operator(extensions.+) d.centroid,
           article_count = k.article_count + d.article_count,
           first_seen = least(k.first_seen, d.first_seen),
           last_seen = greatest(k.last_seen, d.last_seen),
           summarized_count = 0
      from public.threads d
     where k.id = v_keep and d.id = v_drop;
    delete from public.threads where id = v_drop;
    v_merged := v_merged + 1;
    v_keep := null;
  end loop;
  return v_merged;
end;
$$;

-- Threads with coverage in the last p_hours, for the writer: how many
-- articles and outlets, the newest link, the most common topic, and every
-- pattern tag from those articles (repeats kept, so shares can be counted).
create or replace function public.thread_stories(p_hours int default 48, p_limit int default 120)
returns table (
  thread_id uuid,
  title text,
  summary text,
  articles int,
  outlets int,
  latest_url text,
  topic text,
  patterns text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recent as (
    select a.thread_id, a.url, a.topic, a.patterns, s.name as outlet,
           coalesce(a.published_at, a.fetched_at) as seen
      from public.articles a
      join public.sources s on s.id = a.source_id
     where a.thread_id is not null
       and coalesce(a.published_at, a.fetched_at) >= now() - make_interval(hours => p_hours)
  )
  select t.id,
         t.title,
         t.summary,
         count(*)::int,
         count(distinct r.outlet)::int,
         (array_agg(r.url order by r.seen desc))[1],
         mode() within group (order by r.topic),
         coalesce((select array_agg(p) from recent r2 cross join unnest(r2.patterns) as p where r2.thread_id = t.id), '{}')
    from public.threads t
    join recent r on r.thread_id = t.id
   group by t.id, t.title, t.summary
   order by count(distinct r.outlet) desc, count(*) desc
   limit p_limit;
$$;

-- The week before p_week_start: biggest stories with last week's count for
-- momentum, stories that faded (4+ articles the week before, none since),
-- coverage by region and pattern counts.
create or replace function public.snapshot_data(p_week_start date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select (p_week_start - 7)::timestamptz as this_from, p_week_start::timestamptz as this_to,
           (p_week_start - 14)::timestamptz as prev_from
  ),
  arts as (
    select a.thread_id, a.region, a.patterns, s.name as outlet,
           case when coalesce(a.published_at, a.fetched_at) >= b.this_from then 'this' else 'prev' end as wk
      from public.articles a
      join public.sources s on s.id = a.source_id
      cross join bounds b
     where coalesce(a.published_at, a.fetched_at) >= b.prev_from
       and coalesce(a.published_at, a.fetched_at) < b.this_to
       and a.tagged_at is not null
  ),
  per_thread as (
    select thread_id,
           count(*) filter (where wk = 'this')::int as this_week,
           count(*) filter (where wk = 'prev')::int as last_week,
           count(distinct outlet) filter (where wk = 'this')::int as outlets
      from arts where thread_id is not null group by thread_id
  )
  select jsonb_build_object(
    'articles', (select count(*) from arts where wk = 'this'),
    'top', coalesce((
      select jsonb_agg(jsonb_build_object('title', t.title, 'summary', t.summary, 'articles', p.this_week,
                                          'last_week', p.last_week, 'outlets', p.outlets)
                       order by p.outlets desc, p.this_week desc)
        from (select * from per_thread where this_week >= 2 order by outlets desc, this_week desc limit 8) p
        join public.threads t on t.id = p.thread_id), '[]'::jsonb),
    'faded', coalesce((
      select jsonb_agg(jsonb_build_object('title', t.title, 'last_week', p.last_week) order by p.last_week desc)
        from (select * from per_thread where last_week >= 4 and this_week = 0 order by last_week desc limit 8) p
        join public.threads t on t.id = p.thread_id), '[]'::jsonb),
    'regions', coalesce((
      select jsonb_object_agg(region, n) from (
        select region, count(*)::int as n from arts where wk = 'this' and region is not null group by region) r), '{}'::jsonb),
    'patterns', coalesce((
      select jsonb_object_agg(p, n) from (
        select p, count(*)::int as n from arts cross join unnest(patterns) as p where wk = 'this' group by p) x), '{}'::jsonb)
  );
$$;

revoke all on function public.merge_similar_threads(float8, int, int) from public, anon, authenticated;
revoke all on function public.thread_stories(int, int) from public, anon, authenticated;
revoke all on function public.snapshot_data(date) from public, anon, authenticated;
grant execute on function public.merge_similar_threads(float8, int, int) to service_role;
grant execute on function public.thread_stories(int, int) to service_role;
grant execute on function public.snapshot_data(date) to service_role;

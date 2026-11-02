-- Phase 3: threads. Each article gets an embedding (a 512-number fingerprint
-- of its meaning); articles about the same story are grouped into a thread.
-- Same lockdown as earlier migrations: RLS on, no policies, service_role only.

create extension if not exists vector with schema extensions;

-- halfvec halves storage (about 1 KB per article) with no practical loss for matching.
alter table public.articles
  add column embedding extensions.halfvec(512),
  add column thread_id uuid;

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  summary text check (summary is null or char_length(summary) <= 600),
  -- Sum of the member embeddings. Cosine similarity ignores length, so the sum
  -- matches exactly like the average while staying a simple running total.
  centroid extensions.vector(512) not null,
  article_count int not null default 1,
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  -- article_count when the summary was last written; behind = summary is stale.
  summarized_count int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.articles
  add constraint articles_thread_fk foreign key (thread_id) references public.threads (id) on delete set null;

create index articles_thread_idx on public.articles (thread_id);
create index articles_unembedded_idx on public.articles (fetched_at desc)
  where embedding is null and tagged_at is not null;
create index articles_unthreaded_idx on public.articles (published_at)
  where thread_id is null and embedding is not null;
create index threads_last_seen_idx on public.threads (last_seen desc);

alter table public.threads enable row level security;
grant select, insert, update, delete on public.threads to service_role;

alter table public.job_runs drop constraint job_runs_job_check;
alter table public.job_runs add constraint job_runs_job_check
  check (job in ('ingest', 'tag', 'embed', 'thread', 'summarize', 'cleanup'));

-- Stores a batch of embeddings in one call: [{"id": "<uuid>", "e": [0.1, ...]}, ...].
create or replace function public.set_embeddings(p_rows jsonb)
returns int
language sql
security invoker
set search_path = ''
as $$
  with updated as (
    update public.articles a
       set embedding = (r.value ->> 'e')::extensions.halfvec(512)
      from jsonb_array_elements(p_rows) as r
     where a.id = (r.value ->> 'id')::uuid
    returning 1
  )
  select count(*)::int from updated;
$$;

-- Puts one article into the closest recent thread at or above p_min_similarity,
-- or starts a new thread with it. Returns the thread id (null if the article
-- was already threaded or has no embedding).
create or replace function public.assign_thread(p_article uuid, p_min_similarity float8, p_window_days int default 7)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_emb extensions.vector(512);
  v_title text;
  v_seen timestamptz;
  v_thread uuid;
begin
  select a.embedding::extensions.vector(512), a.title, coalesce(a.published_at, a.fetched_at)
    into v_emb, v_title, v_seen
    from public.articles a
   where a.id = p_article and a.thread_id is null and a.embedding is not null
   for update;
  if not found then
    return null;
  end if;

  select t.id into v_thread
    from public.threads t
   where t.last_seen >= v_seen - make_interval(days => p_window_days)
     and (t.centroid operator(extensions.<=>) v_emb) <= 1 - p_min_similarity
   order by t.centroid operator(extensions.<=>) v_emb
   limit 1
   for update;

  if v_thread is null then
    insert into public.threads (title, centroid, first_seen, last_seen)
    values (left(v_title, 200), v_emb, v_seen, v_seen)
    returning id into v_thread;
  else
    update public.threads
       set centroid = centroid operator(extensions.+) v_emb,
           article_count = article_count + 1,
           first_seen = least(first_seen, v_seen),
           last_seen = greatest(last_seen, v_seen)
     where id = v_thread;
  end if;

  update public.articles set thread_id = v_thread where id = p_article;
  return v_thread;
end;
$$;

revoke all on function public.set_embeddings(jsonb) from public, anon, authenticated;
revoke all on function public.assign_thread(uuid, float8, int) from public, anon, authenticated;
grant execute on function public.set_embeddings(jsonb) to service_role;
grant execute on function public.assign_thread(uuid, float8, int) to service_role;

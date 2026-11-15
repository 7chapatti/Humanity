-- Phase 4: attention-decay forecasts. When a story is 2 days old, forecast
-- the chance it is still covered 5 to 8 days after it began. The model is
-- refitted and backtested every run and only forecasts while it beats the
-- base rate. Same lockdown as earlier migrations.

create table public.forecast_models (
  kind text primary key check (kind in ('attention_decay')),
  coef float8 not null,
  intercept float8 not null,
  trained_n int not null,
  backtest_n int not null,
  model_brier float8 not null,
  baseline_brier float8 not null,
  -- The gate: true only when the backtest beats always guessing the base rate.
  passed boolean not null,
  fitted_at timestamptz not null default now()
);

create table public.forecasts (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'attention_decay' check (kind in ('attention_decay')),
  thread_id uuid references public.threads (id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  -- Chance the story is still covered inside the window.
  probability float8 not null check (probability between 0 and 1),
  features jsonb not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  made_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open', 'resolved', 'void')),
  outcome boolean,
  brier float8,
  resolved_at timestamptz,
  unique (kind, thread_id)
);
create index forecasts_open_idx on public.forecasts (window_end) where status = 'open';

alter table public.forecast_models enable row level security;
alter table public.forecasts enable row level security;
grant select, insert, update, delete on public.forecast_models, public.forecasts to service_role;

alter table public.job_runs drop constraint job_runs_job_check;
alter table public.job_runs add constraint job_runs_job_check
  check (job in ('ingest', 'tag', 'embed', 'thread', 'summarize', 'snapshot', 'forecast', 'cleanup'));

-- Coverage of each story in its first two days, and (for stories old enough)
-- whether it was still covered 5 to 8 days after it began. Stories with fewer
-- than 3 articles in their first two days are left out.
create or replace function public.decay_rows(p_resolved boolean)
returns table (thread_id uuid, title text, first_seen timestamptz, n48 int, day1 int, day2 int, covered boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  with arts as (
    select a.thread_id, coalesce(a.published_at, a.fetched_at) as seen
      from public.articles a where a.thread_id is not null
  ),
  firsts as (select thread_id, min(seen) as f from arts group by thread_id),
  feat as (
    select f.thread_id, f.f,
           count(*) filter (where a.seen <= f.f + interval '48 hours')::int as n48,
           count(*) filter (where a.seen <= f.f + interval '24 hours')::int as day1,
           count(*) filter (where a.seen > f.f + interval '24 hours' and a.seen <= f.f + interval '48 hours')::int as day2,
           count(*) filter (where a.seen > f.f + interval '5 days' and a.seen <= f.f + interval '8 days') > 0 as covered
      from firsts f join arts a using (thread_id)
     group by f.thread_id, f.f
  )
  select feat.thread_id, t.title, feat.f, feat.n48, feat.day1, feat.day2,
         case when p_resolved then feat.covered else null end
    from feat join public.threads t on t.id = feat.thread_id
   where feat.n48 >= 3
     and case when p_resolved
              then feat.f <= now() - interval '8 days'
              -- Live candidates: 2 to 3 days old (so day 2 is complete), not yet forecast.
              else feat.f between now() - interval '72 hours' and now() - interval '48 hours'
                   and not exists (select 1 from public.forecasts x where x.kind = 'attention_decay' and x.thread_id = feat.thread_id)
         end
   order by feat.f;
$$;

-- Scores open forecasts whose window has closed. A forecast whose story was
-- merged away (thread gone) is voided rather than scored.
create or replace function public.resolve_decay_forecasts()
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_resolved int;
begin
  update public.forecasts set status = 'void', resolved_at = now()
   where kind = 'attention_decay' and status = 'open' and window_end <= now() and thread_id is null;

  with scored as (
    select f.id,
           exists (
             select 1 from public.articles a
              where a.thread_id = f.thread_id
                and coalesce(a.published_at, a.fetched_at) > f.window_start
                and coalesce(a.published_at, a.fetched_at) <= f.window_end
           ) as covered
      from public.forecasts f
     where f.kind = 'attention_decay' and f.status = 'open' and f.window_end <= now()
  )
  update public.forecasts f
     set status = 'resolved', outcome = s.covered, resolved_at = now(),
         brier = power(f.probability - case when s.covered then 1 else 0 end, 2)
    from scored s where s.id = f.id;
  get diagnostics v_resolved = row_count;
  return v_resolved;
end;
$$;

revoke all on function public.decay_rows(boolean) from public, anon, authenticated;
revoke all on function public.resolve_decay_forecasts() from public, anon, authenticated;
grant execute on function public.decay_rows(boolean) to service_role;
grant execute on function public.resolve_decay_forecasts() to service_role;

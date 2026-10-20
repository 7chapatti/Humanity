-- Humanity AI: drafted posts and their approval state.

create type public.post_status as enum ('draft', 'approved', 'rejected', 'posted');
create type public.post_format as enum ('observation', 'pattern', 'date_drop', 'mirror', 'glitch');

-- Every run, successful or not, for cost and failure tracking.
create table public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  model text not null,
  headline_count int not null default 0,
  post_count int not null default 0,
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  error text check (error is null or char_length(error) <= 500)
);

-- At most one unfinished run at a time, so overlapping invocations cannot both start.
create unique index generation_runs_one_active_idx
  on public.generation_runs ((true))
  where finished_at is null;

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  content text not null check (char_length(content) between 1 and 1000),
  format public.post_format not null,
  status public.post_status not null default 'draft',
  flags text[] not null default '{}',
  headline_title text check (headline_title is null or char_length(headline_title) <= 400),
  headline_source text check (headline_source is null or char_length(headline_source) <= 200),
  headline_link text check (headline_link is null or char_length(headline_link) <= 2000),
  run_id uuid not null references public.generation_runs (id) on delete cascade,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  posted_at timestamptz
);

create index posts_status_created_idx on public.posts (status, created_at desc);
create index posts_run_idx on public.posts (run_id);

-- RLS on, no policies: the anon and authenticated roles get nothing.
-- Only the server, using the secret key after its own admin check, can read or write.
alter table public.posts enable row level security;
alter table public.generation_runs enable row level security;

revoke all on public.posts from anon, authenticated;
revoke all on public.generation_runs from anon, authenticated;

-- Phase 2: information layer. Sources, ingested articles and their tags, and
-- a log of every background job. Same lockdown as the init migration:
-- RLS on with no policies, explicit grants to service_role only.
-- Vocabularies must match src/lib/taxonomy.ts.

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  url text not null unique check (url ~ '^https://' and char_length(url) <= 500),
  region text not null check (region in (
    'uk', 'europe', 'north_america', 'latin_america', 'middle_east', 'africa',
    'south_asia', 'east_asia', 'southeast_asia', 'oceania', 'global')),
  perspective text not null default 'unrated'
    check (perspective in ('left-leaning', 'centre', 'right-leaning', 'unrated')),
  active boolean not null default true,
  last_fetched_at timestamptz,
  last_item_count int,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  consecutive_failures int not null default 0,
  created_at timestamptz not null default now()
);

create table public.articles (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources (id) on delete cascade,
  url text not null unique check (char_length(url) <= 2000),
  title text not null check (char_length(title) between 1 and 400),
  summary text check (summary is null or char_length(summary) <= 700),
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  topic text check (topic is null or topic in (
    'politics', 'conflict', 'economy', 'business', 'technology', 'science',
    'health', 'environment', 'society', 'culture', 'sport', 'other')),
  region text check (region is null or region in (
    'uk', 'europe', 'north_america', 'latin_america', 'middle_east', 'africa',
    'south_asia', 'east_asia', 'southeast_asia', 'oceania', 'global')),
  entities text[] not null default '{}' check (cardinality(entities) <= 5),
  patterns text[] not null default '{}' check (patterns <@ array[
    'power', 'fear', 'profit', 'ego', 'tribalism', 'short_termism', 'hypocrisy', 'denial']::text[]),
  tagged_at timestamptz,
  tag_attempts int not null default 0
);

create index articles_source_idx on public.articles (source_id);
create index articles_published_idx on public.articles (published_at desc nulls last);
create index articles_fetched_idx on public.articles (fetched_at);
create index articles_untagged_idx on public.articles (fetched_at desc) where tagged_at is null;
create index articles_patterns_idx on public.articles using gin (patterns);

-- One row per background job run, for failures, volumes and token cost.
create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null check (job in ('ingest', 'tag', 'cleanup')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items_in int not null default 0,
  items_out int not null default 0,
  input_tokens int,
  output_tokens int,
  cached_tokens int,
  error text check (error is null or char_length(error) <= 500)
);

create index job_runs_started_idx on public.job_runs (started_at desc);

-- At most one unfinished run per job, so overlapping triggers cannot double up.
create unique index job_runs_one_active_idx on public.job_runs (job) where finished_at is null;

alter table public.sources enable row level security;
alter table public.articles enable row level security;
alter table public.job_runs enable row level security;

revoke all on public.sources from anon, authenticated;
revoke all on public.articles from anon, authenticated;
revoke all on public.job_runs from anon, authenticated;

-- Explicit grants: Supabase no longer auto-grants new public tables (30 Oct 2026).
grant select, insert, update, delete on public.sources to service_role;
grant select, insert, update, delete on public.articles to service_role;
grant select, insert, update, delete on public.job_runs to service_role;

-- Starting feeds: checked reachable on 22 Oct 2026, and none disallow bots.
-- Perspective labels are broad and only set where outlets are widely rated;
-- edit them on /admin/sources.
insert into public.sources (name, url, region, perspective) values
  ('Sky News World', 'https://feeds.skynews.com/feeds/rss/world.xml', 'uk', 'centre'),
  ('Euronews', 'https://www.euronews.com/rss?level=theme&name=news', 'europe', 'unrated'),
  ('NPR World', 'https://feeds.npr.org/1004/rss.xml', 'north_america', 'left-leaning'),
  ('CBS News World', 'https://www.cbsnews.com/latest/rss/world', 'north_america', 'left-leaning'),
  ('Fox News World', 'https://moxie.foxnews.com/google-publisher/world.xml', 'north_america', 'right-leaning'),
  ('MercoPress', 'https://en.mercopress.com/rss', 'latin_america', 'unrated'),
  ('Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml', 'middle_east', 'unrated'),
  ('AllAfrica', 'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf', 'africa', 'unrated'),
  ('Dawn', 'https://www.dawn.com/feeds/home', 'south_asia', 'unrated'),
  ('Japan Today', 'https://japantoday.com/feed', 'east_asia', 'unrated'),
  ('RNZ World', 'https://www.rnz.co.nz/rss/world.xml', 'oceania', 'unrated');

-- Character posts: standalone posts that build the persona, not tied to a
-- story. They share the posts table and approval flow, separated by kind.
-- Runs get a kind too, so character runs never count towards the news
-- schedule's "recent run" guard.

alter table public.posts
  add column kind text not null default 'news' check (kind in ('news', 'character')),
  add column stage text check (stage is null or stage in ('awakening', 'observer', 'critic'));

alter table public.generation_runs
  add column kind text not null default 'news' check (kind in ('news', 'character'));

create index posts_kind_status_created_idx on public.posts (kind, status, created_at desc);

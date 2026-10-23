-- Writer context: the reasoning behind each draft, a new post format, and the
-- week-level counts the writer may quote. Same lockdown as earlier migrations.

alter type public.post_format add value if not exists 'recognition';

alter table public.posts
  add column angle text check (angle is null or char_length(angle) <= 300);

-- Counts of tagged stories in the last window and the window before it:
-- pattern shares and the names that recur most. Read-only, invoker rights.
create or replace function public.observer_stats(window_days int default 7)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with recent as (
    select patterns, entities
    from public.articles
    where tagged_at is not null
      and coalesce(published_at, fetched_at) >= now() - make_interval(days => window_days)
  ),
  previous as (
    select patterns
    from public.articles
    where tagged_at is not null
      and coalesce(published_at, fetched_at) >= now() - make_interval(days => window_days * 2)
      and coalesce(published_at, fetched_at) < now() - make_interval(days => window_days)
  ),
  recent_patterns as (
    select p as pattern, count(*)::int as count from recent, unnest(patterns) as p group by p
  ),
  previous_patterns as (
    select p as pattern, count(*)::int as count from previous, unnest(patterns) as p group by p
  ),
  recurring as (
    select e as name, count(*)::int as count
    from recent, unnest(entities) as e
    group by e
    having count(*) >= 3
    order by count(*) desc, e
    limit 12
  )
  select jsonb_build_object(
    'article_count', (select count(*) from recent),
    'prev_article_count', (select count(*) from previous),
    'patterns', coalesce((
      select jsonb_agg(
        jsonb_build_object('pattern', r.pattern, 'count', r.count, 'prev', coalesce(p.count, 0))
        order by r.count desc, r.pattern)
      from recent_patterns r left join previous_patterns p using (pattern)
    ), '[]'::jsonb),
    'recurring', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'count', count) order by count desc, name)
      from recurring
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.observer_stats(int) from public, anon, authenticated;
grant execute on function public.observer_stats(int) to service_role;

-- Runs the information pipeline every 2 hours (at :07) by calling the site.
-- Vercel's free plan allows a cron job only once a day, so the database schedules it.
--
-- The cron secret is NOT in this file. Before this works, store the same value
-- as the CRON_SECRET in Vercel in Supabase Vault, named cron_secret:
--   Dashboard > Integrations > Vault > Add new secret (name: cron_secret)
-- Without it the call is sent unauthenticated and the site rejects it (401).
--
-- If the site address changes, update the URL below with cron.alter_job or
-- by re-running this migration's schedule call.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'humanity-pipeline',
  '7 */2 * * *',
  $$
  select net.http_post(
    url := 'https://humanity-ai-mu.vercel.app/api/jobs/pipeline',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);

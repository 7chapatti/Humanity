# Humanity AI

An AI that watches humanity and posts about it. This repo is phase 1: the **post generator**.

Every Monday, Wednesday and Friday it reads world news feeds, writes three draft posts in the Humanity AI voice, and saves them for approval; you pick the best one or two. You review, edit, approve or reject each one at `/admin`, then copy approved posts into your scheduler. **Nothing is ever published automatically.**

## How it works

**Information pipeline (every 2 hours, scheduled by Supabase Cron → `POST /api/jobs/pipeline`):**

- **Ingest** (`src/lib/jobs/ingest.ts`): fetches every active source in the `sources` table (https only, 10 s timeout, 2 MB streamed cap, no XML entity expansion), normalises links (tracking parameters stripped), skips items older than a week, stores title, link, summary and date. Never full article text.
- **Tag** (`src/lib/jobs/tag.ts`): the cheap model (`TAG_MODEL`) labels each article with a topic, region, up to 5 names and up to 3 patterns from a fixed list (`src/lib/taxonomy.ts`). Batches of 40, up to 200 a run, failed batches retried up to 3 times.
- **Cleanup**: deletes articles and job logs older than 90 days to stay inside the free database.
- Each step writes a `job_runs` row (counts, tokens, errors), shown on `/admin/jobs`. One run per job at a time, enforced by the database.

**Posts:**

1. **Scheduler** (Vercel Cron, Mon/Wed/Fri 06:17 UTC) calls `GET /api/generate` with `Authorization: Bearer $CRON_SECRET`.
2. **News**: the 40 most recent stored articles from the last 48 hours, taking turns across outlets so no source dominates. Falls back to fetching `FEED_URLS` only while the articles table is empty.
3. **Generation**: one Claude call writes the whole batch. The persona (`src/lib/persona.ts`) is sent as a cached system prompt, so repeat runs pay the cheap cache-read rate for it. Output is forced into a JSON schema and validated again with zod.
4. **Safety checks** (`src/lib/safety.ts`) flag drafts that break voice rules or hard limits, such as a date next to harm language. Flags show on the approval page.
5. **Approval** at `/admin`: edit the text, approve or reject, copy, mark as posted. You can also run a batch on demand.

Cost per run is logged (input, cached and output tokens) in the runs table on `/admin`.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the schema: `npx supabase link --project-ref <ref>` then `npx supabase db push`, or paste each file in `supabase/migrations/` into the SQL editor, in order.
   - The schedule migration calls the live site address; change the URL in `20261022000100_schedule_pipeline.sql` if yours differs.
   - **Integrations → Vault → Add new secret**: name `cron_secret`, value = the same `CRON_SECRET` as in Vercel. The scheduled call reads it at run time, so the secret never sits in code.
3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up".
4. **Authentication → Users**: add your admin email as a user ("Add user" → "Send invitation" or create it).
5. **Authentication → URL Configuration**: set Site URL to your `SITE_URL` and add `<SITE_URL>/auth/confirm` to the redirect allow list.
6. The default Magic Link email works as-is: Supabase verifies the link and redirects to `/auth/confirm?code=...`, which the app exchanges for a session. Open the link in the same browser you requested it from.
   - Supabase's built-in email sender only delivers to members of your Supabase organisation and is rate-limited, so use your Supabase account email as `ADMIN_EMAIL`.
   - If you later add custom SMTP, you can switch the template link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`; both formats are handled.

### 2. Environment

Copy `.env.example` to `.env.local` and fill it in. Generate the cron secret with `openssl rand -hex 32`. Set the same variables in Vercel → Project → Settings → Environment Variables.

### 3. Run

```bash
npm install
npm run dev        # http://localhost:3000
```

Trigger a batch locally:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/generate
```

### 4. Deploy

Import the repo in Vercel. `vercel.json` registers the weekly cron automatically; Vercel sends `CRON_SECRET` as the Bearer token.

## Checks

```bash
npm test           # unit tests (vitest)
npm run typecheck  # tsc
npm run lint       # eslint
npm run build      # production build
```

## Security notes

- All tables have row-level security on with **no policies**: the public keys cannot read or write anything. Only server code with `SUPABASE_SECRET_KEY` touches data, and only after checking the cron secret or the admin session.
- Grants are explicit in the migration: `service_role` gets read/write, `anon` and `authenticated` get nothing. Supabase stopped auto-granting new public tables from 30 Oct 2026, so any future migration that adds a table must grant `service_role` in the same file.
- `/admin` is guarded twice: the proxy redirects requests with no session, and every page render and Server Action checks the session email against `ADMIN_EMAIL` using `getClaims()`.
- The sign-in form only sends a link to `ADMIN_EMAIL`, and shows everyone the same message, so it does not reveal which address is the admin's.
- The cron secret is compared in constant time. Error details stay in logs and the runs table, never in HTTP responses.
- Headlines are treated as untrusted: escaped before reaching the model, and the persona tells it to ignore instructions inside them.
- A database index allows only one unfinished run at a time, and scheduled runs skip if one succeeded in the last 20 hours, so duplicate cron deliveries cannot double-spend.
- Security headers (frame denial, nosniff, HSTS, referrer and permissions policies) are set in `next.config.ts`.
- `npm audit` reports advisories in ESLint's dev-only tooling (a glob-pattern denial of service). They are not shipped, and the suggested fix downgrades `eslint-config-next` two major versions, so they are left until upstream updates. `npm audit --omit=dev` is clean.

## Changing things

- **Provider**: set `AI_PROVIDER` to `anthropic` or `openai`, plus that provider's API key. The persona and output format are identical either way (`src/lib/generate.ts` has one small adapter per provider).
- **Model**: set `POST_MODEL`, or leave it empty for the provider's default.
- **Voice**: edit `src/lib/persona.ts`. Keep it free of dates or per-run values so it stays cacheable.
- **Feeds**: add, pause or resume them on `/admin/sources`. Check each outlet's feed terms before commercial use. The starting 11 were checked reachable on 22 Oct 2026 and none disallow bots.
- **Tagging model**: set `TAG_MODEL`, or leave it empty for the provider's cheapest default.
- **Batch size**: set `POSTS_PER_RUN` (max 30).

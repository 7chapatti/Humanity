# Humanity AI

An AI that watches humanity and posts about it. This repo is phase 1: the **post generator**.

Once a week it reads world news feeds, writes a batch of draft posts in the Humanity AI voice, and saves them for approval. You review, edit, approve or reject each one at `/admin`, then copy approved posts into your scheduler. **Nothing is ever published automatically.**

## How it works

1. **Scheduler** (Vercel Cron, Mondays 06:17 UTC) calls `GET /api/generate` with `Authorization: Bearer $CRON_SECRET`.
2. **News**: headlines are pulled from the RSS/Atom feeds in `FEED_URLS` (https only, 10 s timeout, 2 MB cap, no XML entity expansion).
3. **Generation**: one Claude call writes the whole batch. The persona (`src/lib/persona.ts`) is sent as a cached system prompt, so repeat runs pay the cheap cache-read rate for it. Output is forced into a JSON schema and validated again with zod.
4. **Safety checks** (`src/lib/safety.ts`) flag drafts that break voice rules or hard limits, such as a date next to harm language. Flags show on the approval page.
5. **Approval** at `/admin`: edit the text, approve or reject, copy, mark as posted. You can also run a batch on demand.

Cost per run is logged (input, cached and output tokens) in the runs table on `/admin`.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the schema: `npx supabase link --project-ref <ref>` then `npx supabase db push`, or paste `supabase/migrations/20261020000000_init.sql` into the SQL editor.
3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up".
4. **Authentication → Users**: add your admin email as a user ("Add user" → "Send invitation" or create it).
5. **Authentication → URL Configuration**: set Site URL to your `SITE_URL` and add `<SITE_URL>/auth/confirm` to the redirect allow list.
6. **Authentication → Emails → Magic Link** template: make the link
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`

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
- A database index allows only one unfinished run at a time, and scheduled runs skip if one succeeded in the last 6 days, so duplicate cron deliveries cannot double-spend.
- Security headers (frame denial, nosniff, HSTS, referrer and permissions policies) are set in `next.config.ts`.
- `npm audit` reports advisories in ESLint's dev-only tooling (a glob-pattern denial of service). They are not shipped, and the suggested fix downgrades `eslint-config-next` two major versions, so they are left until upstream updates. `npm audit --omit=dev` is clean.

## Changing things

- **Model**: set `POST_MODEL`.
- **Voice**: edit `src/lib/persona.ts`. Keep it free of dates or per-run values so it stays cacheable.
- **Feeds**: set `FEED_URLS`.
- **Batch size**: set `POSTS_PER_RUN` (max 30).

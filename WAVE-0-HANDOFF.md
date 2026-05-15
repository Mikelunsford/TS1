# Wave 0 Handoff — what you run on your machine

> **HISTORICAL — Wave 0 closed 2026-05-14. Wave 1 closed 2026-05-15. Wave 2 closed 2026-05-15.** This document is preserved as the bootstrap procedure for any future fresh-machine setup (e.g., a new contributor's first day). The Wave-0 smoke matrix at the bottom remains the recurring CI floor. See the per-wave closeout journals at `TS1/03-workspace/journal/<date>-wave-<N>-closeout.md` for the canonical hand-off context.

The orchestrator authored every file Wave 0 needs (directory tree, configs, SPA shell, migrations 0001–0044, 13 Edge Function bundles, CI workflows, env templates, docs). What's left needs your machine, your Docker, your Vercel account, and your credentials. This doc walks you through it.

Estimated time: **45–90 min** depending on download speeds and how much of Vercel you've set up before.

## Pre-flight on your Windows machine

```powershell
# Check Node version (must be 20.x)
node --version

# Check pnpm version (must be 9.x; if not, enable corepack)
pnpm --version
# If pnpm is missing or wrong version:
corepack enable
corepack prepare pnpm@9.7.0 --activate

# Supabase CLI (Windows: install via Scoop or download exe)
supabase --version    # must be ≥ 1.180

# Vercel CLI
pnpm dlx vercel@34 --version

# Docker Desktop must be running for `supabase start`
docker version
```

If any of these are missing, install them before continuing.

## Step 1: Fill in env files

The orchestrator wrote `app/.env.example` and `app/apps/web/.env.example` with placeholders. Copy them to working files and fill the values from your `environment.md`:

```powershell
cd "C:\Users\Mike Lunsford\Desktop\idurar + TSuite\TS1\app"
copy .env.example .env
copy apps\web\.env.example apps\web\.env.local
```

Edit both files. In `.env`:

- `SUPABASE_PROJECT_REF` = `ozvanymuzaqbexchuoxz` (already correct in example)
- `SUPABASE_ANON_KEY` = paste from `environment.md`
- `SUPABASE_SERVICE_ROLE_KEY` = paste from `environment.md`
- `SUPABASE_DB_PASSWORD` = `haqtyd-nertun-8Rikfo` (from `environment.md`)
- `SUPABASE_JWT_SECRET` = **pull from** https://supabase.com/dashboard/project/ozvanymuzaqbexchuoxz/settings/api → "JWT Secret" (it's a raw HMAC secret, distinct from the JWT tokens)
- `SUPABASE_ACCESS_TOKEN` = create a personal access token at https://supabase.com/dashboard/account/tokens
- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` = fill after Step 5 below

In `apps/web/.env.local`:

- `VITE_SUPABASE_URL` = `https://ozvanymuzaqbexchuoxz.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = paste anon key from `environment.md`
- Leave the rest at defaults.

## Step 2: Install JS deps

```powershell
cd "C:\Users\Mike Lunsford\Desktop\idurar + TSuite\TS1\app"
pnpm install
```

First install will be slow (~5 min) and generates `pnpm-lock.yaml`. Commit that lockfile.

## Step 3: Boot local Supabase

```powershell
pnpm db:start
```

This pulls the Postgres + Studio + Auth + Storage Docker images on first run (~10 min, ~2 GB download). When it finishes, the local stack runs on:

- Postgres: `localhost:54322`
- Studio: `http://localhost:54323`
- Edge Functions (after `fn:serve`): `localhost:54321/functions/v1/...`

## Step 4: Apply migrations + generate types

```powershell
pnpm db:reset
```

This runs all 44 migrations in order. If any fail, **stop** and read the error — do not edit the failing migration; instead, write a new forward migration (e.g., `0045_fix_xxx.sql`) that corrects the issue. Migrations are forward-only.

Then:

```powershell
pnpm db:gen-types
```

This must produce `apps/web/src/lib/database.types.ts` with hundreds of generated lines. If it's empty, the local DB isn't running or the schema didn't apply.

## Step 5: Link Vercel

```powershell
cd "C:\Users\Mike Lunsford\Desktop\idurar + TSuite\TS1\app"
pnpm dlx vercel@34 login    # one time
pnpm dlx vercel@34 link
```

Answer the prompts:
- Set up and deploy? **Yes**
- Which scope? Your personal/team scope
- Link to existing project? **No** (first time) — let Vercel create `team1` or whatever name you choose
- In what directory is your code? `./` (the `app/` dir you're in)

This writes `.vercel/project.json`. Copy the `orgId` and `projectId` from that file into your `.env`'s `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`. Generate a token at https://vercel.com/account/tokens and paste into `VERCEL_TOKEN`.

Then set the env vars on Vercel for the preview environment:

```powershell
pnpm dlx vercel@34 env add VITE_SUPABASE_URL preview
# paste https://ozvanymuzaqbexchuoxz.supabase.co

pnpm dlx vercel@34 env add VITE_SUPABASE_ANON_KEY preview
# paste anon key

pnpm dlx vercel@34 env add VITE_APP_NAME preview
# Team1

pnpm dlx vercel@34 env add VITE_DEFAULT_TENANT_BRAND preview
# team1

pnpm dlx vercel@34 env add VITE_BASE_DOMAIN preview
# team1.app
```

Set the same vars for `production` when you're ready to promote.

## Step 6: First local build

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:contract
pnpm build
```

All five must exit zero. If `pnpm lint` fails on a banned import, you have a real bug — fix it. Do not silence the rule.

## Step 7: Push remote DB schema

You linked the Supabase project in `environment.md`. Push migrations to it:

```powershell
supabase link --project-ref ozvanymuzaqbexchuoxz
supabase db push
```

You'll be prompted for the DB password (`haqtyd-nertun-8Rikfo`).

⚠️ This applies all 44 migrations to your real Supabase Cloud project. There is no down migration. If you want to test on a branch first, use `supabase db branches create wave-0-test` and push to that.

## Step 8: Deploy Edge Functions

```powershell
supabase functions deploy tenants-api
supabase functions deploy auth-api
supabase functions deploy settings-api
supabase functions deploy crm-api
supabase functions deploy quotes-api
supabase functions deploy projects-api
supabase functions deploy ops-api
supabase functions deploy invoicing-api
supabase functions deploy finance-api
supabase functions deploy vendors-api
supabase functions deploy inventory-api
supabase functions deploy dashboard-api
supabase functions deploy exports-api
```

(There's a script at `scripts/release/deploy-all-functions.sh` if you have bash; on PowerShell run them sequentially.)

Set Edge Function secrets:

```powershell
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<paste>"
supabase secrets set SUPABASE_JWT_SECRET="<paste>"
supabase secrets set ALLOWED_ORIGINS="https://team1.app,https://*.team1.app"
```

Smoke test the deployed functions:

```powershell
curl https://ozvanymuzaqbexchuoxz.supabase.co/functions/v1/tenants-api/ -H "apikey: <anon>"
# expect: {"data":{"ok":true,"bundle":"tenants-api"}}
```

## Step 9: Push to GitHub + first Vercel preview

```powershell
cd "C:\Users\Mike Lunsford\Desktop\idurar + TSuite\TS1\app"
git init
git remote add origin https://github.com/Mikelunsford/TS1.git
git add .
git commit -m "wave-0: initial monorepo skeleton

Co-Authored-By: Claude <noreply@anthropic.com>"
git branch -M main
git push -u origin main
```

This triggers `ci.yml` (typecheck, lint, test, contract, build). Watch it pass.

Open a throwaway PR from a feature branch to trigger `deploy-preview.yml` and `lighthouse.yml`:

```powershell
git checkout -b wave-0/verify-preview
echo "" >> README.md
git commit -am "trigger preview"
git push -u origin wave-0/verify-preview
```

Open the PR on GitHub. The bot comments the Vercel preview URL. Open it. The placeholder shell at `/login` should render. Sign up an email; you can sign in.

## Step 10: Run the smoke matrix one last time

From `BUILDME.md` Step 9:

| # | Check | Where |
|---|---|---|
| 1 | `pnpm typecheck` exits 0 | local |
| 2 | `pnpm lint --max-warnings 0` exits 0 | local |
| 3 | `pnpm test` exits 0 | local |
| 4 | `pnpm test:contract` exits 0 | local |
| 5 | `supabase db reset` succeeds (every migration applies) | local |
| 6 | `pnpm db:gen-types` populates `database.types.ts` | local |
| 7 | `pnpm build` produces `dist/` under budget | local |
| 8 | Vercel preview URL loads at 200 | Vercel |
| 9 | `pnpm test:rls` returns NOT FOUND not FORBIDDEN | local against staging |
| 10 | User can sign up / sign in / sign out via placeholder login | preview URL |

When all ten pass: append a CHANGELOG entry under "Wave 0 complete (2026-MM-DD)", commit, and dispatch Wave 1.

## When something fails

- **`supabase db reset` errors on a specific migration** — read the error, fix the migration **as a new forward migration**, never edit a numbered file that's already been applied anywhere.
- **TypeScript errors on `pnpm typecheck`** — typically the contract test or a `database.types.ts` mismatch. Run `pnpm db:gen-types` again first.
- **Vercel preview 500s** — check `Vercel → Project → Deployments → Build Logs`. The most likely cause is a missing `VITE_*` env var.
- **Cross-tenant probe returns FORBIDDEN instead of NOT FOUND** — RLS policy somewhere is throwing instead of filtering. This is a release-blocker. Find the policy and rewrite it as a `USING (org_id = current_org_id())` filter, not a `WHERE NOT permission_denied` raise.

## Wave 0 complete checklist

Before declaring done:

- [ ] All 10 smoke checks pass
- [ ] `STATUS.md` updated to "Wave 0 complete"
- [ ] `CHANGELOG.md` has a "Wave 0 complete (date)" entry
- [ ] `03-workspace/journal/<date>-standup.md` has the closing standup
- [ ] No `.env*.local` or `.env` committed to git (check `git status` — they should be ignored)
- [ ] Vercel project's "Production" branch is set to `main`
- [ ] `nightly-rls-probe.yml` is enabled and has the staging URL secret set

When that all checks out, the next dispatch is Wave 1 from `TS1/11-modules/03-BUILD-ORDER.md` Phase 1.

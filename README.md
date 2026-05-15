# Team1 (TS1)

Unified whitelabel platform — Vite + React + TypeScript SPA on Supabase Postgres + Edge Functions, hosted on Vercel.

**Status as of 2026-05-15: Wave 3 (Phase 3 — Items / Taxes / Currencies / FX) complete.** Production runs at https://ts-1-lime.vercel.app against Supabase project `ozvanymuzaqbexchuoxz`.

| Wave | Surface live |
|---|---|
| 0 — Foundations | Monorepo skeleton, 44 base migrations, 13 Edge Function bundles, CI workflows, SPA shell |
| 1 — Identity & Tenancy | `tenants-api` + `auth-api` real handlers, BrandingProvider, workspace switcher, DB-backed idempotency, two-org RLS probe, nightly cron |
| 2 — CRM Core | `crm-api` (22 endpoints: customers/contacts/leads/opportunities/activities), `/crm/*` SPA surface with drag-kanban + lead-convert, audit triggers (migration 0047), bundle-size CI gate (80 kB gzip on `index-*.js`) |
| 3 — Sales chassis (Items / Taxes / Currencies / FX) | `finance-api` (14 endpoints: currencies / exchange-rates / taxes / payment-methods) + `inventory-api` (13 endpoints: items / item-categories / units). `/items/*` SPA surface (list / detail / categories) with new `MoneyInput` primitive. `/settings/*` SPA surface (currencies / taxes / payment-methods / exchange-rates) with `RateInputPercent` helper. Migration `0048` (idempotency legacy NOT NULL relax, closes R-W1-05) + `0049` (`pricing_menu`→`items` rename + view + per-org catalog seeds). `workflow_run` gate on `deploy-functions.yml` (closes R-W2-01 structural fix). RLS probe matrix 8 → 14 entries. |

Cloud state: 49 migrations applied to prod; 13 edge functions ACTIVE (versions 18-21); SPA `index` chunk ~33 kB gzip (well under R-W1-06 80 kB budget). Next wave: **Wave 4 — Quote-to-Cash continuation** (Phase 4 quoting harden → Phase 5 projects → Phase 7 invoicing → Phase 8 payments) per `TS1/11-modules/03-BUILD-ORDER.md`.

For the full canon (architecture, schema, API contract, build order, agents), see the parent `TS1/` directory. For the running snapshot, see `TS1/STATUS.md`. For Wave hand-off context, see the closeout journals at `TS1/03-workspace/journal/<date>-wave-<N>-closeout.md`.

## Prerequisites

- Node 20 LTS (`nvm use` reads `.nvmrc`)
- pnpm 9 — `corepack enable && corepack prepare pnpm@9.7.0 --activate`
- Supabase CLI 1.180+ — `brew install supabase/tap/supabase` (mac) or scoop/Windows installer
- Docker Desktop running (for `supabase start`)
- Vercel CLI — `pnpm dlx vercel@34 --version`

## First run

```bash
# 1. Install deps
pnpm install

# 2. Copy env (fill in values from environment.md)
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local

# 3. Start local Supabase (requires Docker)
pnpm db:start

# 4. Apply all migrations
pnpm db:reset

# 5. Generate types from the local DB
pnpm db:gen-types

# 6. Serve Edge Functions locally
pnpm fn:serve   # in a separate terminal

# 7. Start the SPA
pnpm dev        # in another terminal — opens http://localhost:5173
```

## Smoke matrix (rolling — applies to every Wave's exit)

All gates must pass on every PR before merge and on `main` after merge:

1. `pnpm typecheck` — exit 0
2. `pnpm lint` — exit 0, no warnings
3. `pnpm test` — exit 0 (unit + component tests)
4. `pnpm test:contract` — Zod canon parity holds across `apps/web/src/lib/types.ts` ↔ `supabase/functions/_shared/types.ts`
5. `supabase db reset` — every migration applies forward (CI verifies on fresh DB)
6. `pnpm db:gen-types` — produces a non-empty `apps/web/src/lib/database.types.ts` (gitignored; CI regenerates)
7. `pnpm build` — produces `apps/web/dist` under bundle budget
8. `pnpm bundle-budget` — `dist/assets/index-*.js` ≤ 80 kB gzip (R-W1-06 CI gate, added in Wave 2)
9. Vercel preview / production loads at HTTP 200
10. `pnpm test:rls` — cross-tenant reads return `200 + []` (RLS filters, never throws `403`)
11. A user can sign up, sign in, sign out via `/login`; can switch orgs; can hit the CRM surface

## Layout

```
app/
  apps/web/          # The Vite SPA
  supabase/          # Postgres migrations + Edge Functions (Deno)
  scripts/           # codegen, seed, qa, release
  docs/adr/          # architecture decision records
  .github/workflows/ # CI: ci, migrate, deploy-{preview,staging,prod}, nightly-rls-probe, lighthouse
```

Full details in `TS1/07-architecture/01-FOLDER-STRUCTURE.md`.

## Stack lock-ins (do not revisit)

Authoritative source: `TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md` §0.

- Vite 5 + React 18 + TypeScript 5 strict
- Tailwind CSS + custom design system primitives (architecture locks "hand-rolled primitives in `apps/web/src/components/ui/`")
- `react-router-dom` v6 with code-split lazy pages + flat ROUTES table
- TanStack Query + React Context for state (no Redux, no Zustand)
- Native React `useState` + Zod `safeParse` for forms (no react-hook-form, no Formik)
- Supabase Postgres + Edge Functions (Deno)
- pnpm 9 on Node 20

Banned dependencies are enforced by ESLint `no-restricted-imports` in `apps/web/.eslintrc.cjs`. Wave-2-added keep-list expansions (R-02): `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (drag kanbans on `/crm/leads` and `/crm/opportunities`), `size-limit` + `@size-limit/preset-app` (R-W1-06 bundle budget). Wave 3 added zero new packages.

> **Constitution-vs-architecture reconciled** (Wave 3, 2026-05-15): the R-01 patch to `TS1/03-workspace/00-SHARED-CONTEXT.md` closed R-W2-06 + R-W2-07. Authority order is now explicit: **architecture §0 > SHARED-CONTEXT keep-list > sub-agent preference**. SHARED-CONTEXT was updated to reflect react-router-dom v6, hand-rolled primitives, and `useState` + Zod `safeParse` for forms.

## Wave 3 → Wave 4

Wave 3 (Phase 3 — Items / Taxes / Currencies / FX) is complete; ready for Wave 4 (Phase 4 quoting harden → Phase 5 projects → Phase 7 invoicing → Phase 8 payments) dispatch. Recommended pre-dispatch follow-ups: **F-Wave4-02** (R-W3-03 tax `rate` shape reconciliation — must land before Phase 4 quote totals consume the rate) then **F-Wave4-03 + F-Wave4-08** (helper consolidation + real capability matrix). See `TS1/03-workspace/journal/2026-05-15-wave-3-closeout.md` for the canonical hand-off.

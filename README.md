# Team1 (TS1)

Unified whitelabel platform — Vite + React + TypeScript SPA on Supabase Postgres + Edge Functions, hosted on Vercel.

This is the **Wave 0** skeleton: directories, configs, the placeholder shell, migrations 0001–0044, 13 Edge Function bundles serving health endpoints, CI workflows. No business features yet.

For the full canon (architecture, schema, API contract, build order, agents), see the parent `TS1/` directory.

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

## The smoke matrix (Wave 0 exit criteria)

All ten must pass:

1. `pnpm typecheck` — exit 0
2. `pnpm lint` — exit 0, no warnings
3. `pnpm test` — exit 0
4. `pnpm test:contract` — Zod canon parity holds
5. `supabase db reset` — every migration applies forward
6. `pnpm db:gen-types` — produces a non-empty `apps/web/src/lib/database.types.ts`
7. `pnpm build` — produces `apps/web/dist` under bundle budget
8. Vercel preview loads at 200
9. `pnpm test:rls` returns NOT FOUND, never FORBIDDEN
10. A user can sign up, sign in, sign out via `/login`

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

- Vite 5 + React 18 + TypeScript 5 strict
- Tailwind CSS + custom design system primitives (no AntD, no Radix, no shadcn)
- TanStack Query + React Context for state (no Redux, no Zustand)
- Native React + Zod parse for forms (no react-hook-form, no Formik)
- Supabase Postgres + Edge Functions (Deno)
- pnpm 9 on Node 20

Banned dependencies are enforced by ESLint `no-restricted-imports` in `apps/web/.eslintrc.cjs`.

## Wave 0 → Wave 1

Wave 0 ends when the smoke matrix above passes. Wave 1 (Identity and Tenancy) starts only after that. See `TS1/11-modules/03-BUILD-ORDER.md`.

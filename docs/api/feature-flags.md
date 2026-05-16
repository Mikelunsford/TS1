# Feature Flags (server-side reader)

Wave 6 (PR #52, parallel with F-Wave6-01) replaces the Wave-0 stub at `supabase/functions/_shared/feature-flags.ts` with a real per-org reader against the `org_feature_flags` table. The reader is the gating primitive Phase 6 uses for 3PL plugin enablement (PR #57) and is intended for any future per-org plugin/capability gating.

This doc covers the **internal** reader contract (called from Edge Function handlers). The user-facing settings API for toggling flags lives under `settings-api/feature-flags` and is documented in `TS1/09-api/00-API-CONTRACT.md` §2.4.

## Table shape

Prod `public.org_feature_flags` (verified 2026-05-16, `schema_migrations=0057`):

```ts
export const OrgFeatureFlagSchema = z.object({
  org_id: UuidSchema,
  flag_key: z.string().min(1).max(120),
  is_enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).default({}),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
```

Primary key is `(org_id, flag_key)`. `is_enabled` is a strict boolean (NOT NULL, default `false`). `config` is jsonb for per-flag payload data (rollout %, allowed-host lists, etc. — Wave 6 reader ignores it; later phases can consume).

Seed rows present at Wave 6 close:

| flag_key | default | notes |
|---|---|---|
| `crm.leads` | `false` | Carry-over from Wave 0. |
| `crm.opportunities` | `false` | Carry-over from Wave 0. |
| `sales.invoices` | `true` | Carry-over from Wave 0. |
| `sales.credit_notes` | `true` | Carry-over from Wave 0. |
| `finance.expenses` | `false` | Carry-over from Wave 0. |
| `plugins.3pl` | per-org | Seeded `true` for `slug='team1'` only via 0057. Other orgs default to absent → reader returns `false`. |

## Reader contract

The single export is `isFeatureEnabled`:

```ts
export async function isFeatureEnabled(
  supabase: SupabaseClient,
  orgId: string,
  key: string,
): Promise<boolean>;

// Legacy alias retained for any pre-Wave-6 callers.
export const readFlag = isFeatureEnabled;
```

Semantics:

1. Cache lookup: keyed by `${orgId}:${key}` against an in-memory `Map` local to the Edge Function bundle's V8 isolate.
2. Cache hit + age `< 5 min` (300_000 ms) → return cached value (no DB round-trip).
3. Cache miss or expired → `SELECT is_enabled FROM org_feature_flags WHERE org_id = $1 AND flag_key = $2` (`.maybeSingle()`).
4. **Strict default-off.** A missing row returns `false`. A row with `is_enabled=null` (cannot happen on prod given the NOT NULL CHECK, but defensive) returns `false`. Only `is_enabled === true` returns `true`.
5. The resolved boolean + timestamp is written back to the cache.

The cache resets on bundle cold start (acceptable — Phase 6 DoD requires correctness, not zero-latency).

## Usage pattern

```ts
import { isFeatureEnabled } from '../_shared/feature-flags.ts';
import { ApiError } from '../_shared/errors.ts';

export async function handleReceivingOrderList(req: Request, ctx: Ctx) {
  if (!await isFeatureEnabled(admin(), ctx.caller.orgId, 'plugins.3pl')) {
    // 404 not 403 — universal §RLS rule to avoid information disclosure.
    throw new ApiError('NOT_FOUND', 'feature not available', 404);
  }
  // ... normal handler body ...
}
```

Every route in `ops-api/` carries the head-of-handler guard for `'plugins.3pl'`. The SPA mirrors the same gate at the route level via `useFeatureFlag('plugins.3pl')` HOC (FE handles render; BE handles authoritative authority).

## What the reader does NOT do

- It does not consult a global / plan-level / role-level fallback hierarchy. A row exists or it does not; absent rows are `false`. The pre-Wave-6 stub returned `false` unconditionally, so no callers depended on a fallback.
- It does not write to `org_feature_flags`. Writes go through the public settings-api surface (§2.4 of the contract).
- It does not return `config` jsonb. A future overload `getFlagConfig(orgId, key): Promise<jsonb>` is reserved for the day a flag needs more than an on/off bit.

## Testing

`supabase/functions/_shared/feature-flags.test.ts` covers:

- Cache hit returns the same boolean without a second `.maybeSingle()`.
- Cache miss → fetch → cache write.
- TTL boundary: `Date.now()` advanced beyond 5 min triggers a refetch.
- Strict-default: a `null`-`is_enabled` row resolves `false` (defensive, since prod NOT NULL).
- Seeded flags resolve as expected (`crm.leads=false`, `sales.invoices=true`, `plugins.3pl` per-org).

## Versioning

PR #52 ships the reader. No migration; the bundle change is `_shared/` only, which redeploys all 13 edge function bundles on the next deploy cycle via the `deploy-functions.yml` `workflow_run` gate.

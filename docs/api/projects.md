# Projects API

Wave 4 ships the `projects-api` Edge Function bundle. It exposes project headers, phases, and lifecycle workflow under `https://<project>.functions.supabase.co/projects-api/...`.

The universal envelope, headers, idempotency, pagination, money-on-the-wire, and error rules from `TS1/09-api/00-API-CONTRACT.md` §0 apply to every endpoint below. This file is the per-module delta.

## Conventions in this document

- Every Zod block is pasted from `supabase/functions/_shared/types.ts` (byte-mirrored to `apps/web/src/lib/types.ts`).
- Every state-changing endpoint requires `Idempotency-Key: <uuid v4>`.
- Money is integer cents on the wire (field names end in `_cents`).
- Timestamps are ISO-8601 with `Z` (the prod DB columns are `timestamptz`).
- Bundle `projects-api` enforces `verify_jwt = true`.

## RBAC at the bundle

The `projects-api` bundle gates per-handler via `requireCap(caller, '<capability>')` against `_shared/capabilities.ts`:

- `org_owner`, `org_admin` — read, write, close, reopen.
- `ops`, `sales` — read, write. `projects.close` is org-admin / owner.
- `accounting`, `viewer` — read only.
- `customer_user` — no read (Wave 4 keeps projects internal-only; Phase 18 portal will expose a filtered view).

## State machine

Prod enum `project_state`: `pending`, `ready_to_build`, `in_production`, `ready_to_ship`, `completed`, `cancelled`.

Legal transitions (enforced by `_shared/workflow.ts#assertTransition`):

| From | To |
|---|---|
| `pending` | `ready_to_build`, `cancelled` |
| `ready_to_build` | `in_production`, `cancelled` |
| `in_production` | `ready_to_ship`, `completed`, `cancelled` |
| `ready_to_ship` | `completed`, `cancelled` |
| `completed` | `in_production`, `ready_to_ship` _(reopen)_ |
| `cancelled` | _(terminal)_ |

`from === to` is always legal (idempotent). Illegal transitions return **409 STATE_CONFLICT** with `details.code = 'STATE_TRANSITION_ILLEGAL'`.

Phase status uses a separate machine (`PHASE_TRANSITIONS`): `pending → active → completed`, plus cancel from any state, plus `completed → active` reopen.

## Projects

### list-projects / get-project

`GET /projects-api/projects`
`GET /projects-api/projects/{id}`

- RBAC: `projects.read`.
- Idempotent: yes (GET).
- Filters: `status` (multi-value), `customer_id`, `created_from` / `created_to`, `due_from` / `due_to`.
- Pagination: `limit` (default 50, max 200), opaque `cursor`.
- Sort: `created_at DESC, id DESC`.

```ts
export const ProjectSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  project_number: z.string().min(1),
  quote_id: UuidSchema.nullable(),          // source quote FK (NOT source_quote_id)
  customer_id: UuidSchema.nullable(),
  customer_name: z.string().nullable(),     // denormalized
  name: z.string().min(1),                  // DB column (NOT display_name)
  status: ProjectStateSchema,
  currency_code: z.string().length(3),
  total_cents: CentsSchema,
  budget_cents: CentsSchema,
  due_date: z.string().nullable(),          // timestamptz
  invoice_id: UuidSchema.nullable(),        // lights up in Phase 7
  bom_finalized_at: z.string().nullable(),
  bom_finalized_by: UuidSchema.nullable(),
  ready_to_build_at: z.string().nullable(),
  sent_to_production_at: z.string().nullable(),
  production_started_at: z.string().nullable(),
  production_completed_at: z.string().nullable(),
  ready_to_ship_at: z.string().nullable(),
  shipping_completed_at: z.string().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
```

### create-project

`POST /projects-api/projects`

- RBAC: `projects.write`.
- Idempotent header required.
- Most projects come from `quotes-api/quotes/{id}/convert-to-project`; this endpoint is the direct create path. The server picks `project_number` via `next_doc_number('project')`.

```ts
export const ProjectCreateSchema = z.object({
  name: z.string().min(1).max(200),
  customer_id: UuidSchema.nullable().optional(),
  customer_name: z.string().max(200).nullable().optional(),
  quote_id: UuidSchema.nullable().optional(),
  currency_code: z.string().length(3).optional(),
  total_cents: z.number().int().nonnegative().default(0),
  budget_cents: z.number().int().nonnegative().default(0),
  due_date: TimestampSchema.nullable().optional(),
});
```

**No `display_name`, `source_quote_id`, `start_date`, `target_end_date`, or `notes_internal`** — those exist in the dispatch text but not on the prod table. The DB column is `name`; the source quote FK is `quote_id`; `due_date` is the only date-shaped field on the header (timestamptz, not date). Per-phase planned times live on `project_phases`.

### patch-project

`PATCH /projects-api/projects/{id}`

- RBAC: `projects.write`.
- Idempotent: yes.
- Allowed at any state — header edits do not require draft-status. Lifecycle timestamp columns are stamped only by workflow handlers; PATCH cannot backdate them.

```ts
export const ProjectPatchSchema = ProjectCreateSchema.partial();
```

### close-project / reopen-project

`POST /projects-api/projects/{id}/close`
`POST /projects-api/projects/{id}/reopen`

- RBAC: `projects.close`.
- Idempotent header required.
- `close` transitions `→ completed` and stamps `shipping_completed_at = now()` if unset; optional reason → activity row.
- `reopen` is valid only from `completed`. Default target is `in_production`; caller may pick `ready_to_ship`. Clears `shipping_completed_at`.

```ts
export const ProjectCloseSchema = z.object({
  reason: z.string().max(2000).optional(),
});

export const ProjectReopenSchema = z.object({
  to: z.enum(['in_production', 'ready_to_ship']).default('in_production'),
});
```

```bash
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"reason":"Customer confirmed receipt."}' \
  "$BASE/projects-api/projects/$PID/close"
```

## Project phases

Resource: `/projects/{project_id}/phases`. A project has zero-or-more phases; the table is `project_phases` (migration 0042). Phase `status` is `text + CHECK`, not a Postgres enum.

The detail panel uses an explicit phase order via the `position` integer; reorder is a dedicated route that uses a two-pass negative-shift to be safe under any future `UNIQUE(project_id, position)` constraint.

### list-phases

`GET /projects-api/projects/{project_id}/phases`

- RBAC: `projects.read`.
- Idempotent: yes (GET).
- Sort: `position ASC`. Soft-deleted phases (`deleted_at IS NOT NULL`) are excluded by default.

```ts
export const ProjectPhaseSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  project_id: UuidSchema,
  position: z.number().int().nonnegative(),
  name: z.string().min(1),
  description: z.string().nullable(),
  status: PhaseStatusSchema,                // 'pending' | 'active' | 'completed' | 'cancelled'
  planned_start_at: z.string().nullable(),  // timestamptz
  planned_end_at: z.string().nullable(),
  actual_start_at: z.string().nullable(),   // stamped by server on first → active
  actual_end_at: z.string().nullable(),     // stamped by server on first → completed
  budget_cents: CentsSchema,
  notes: z.string().nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
```

### create-phase / patch-phase

`POST /projects-api/projects/{project_id}/phases`
`PATCH /projects-api/projects/{project_id}/phases/{phase_id}`

- RBAC: `projects.write`.
- Idempotent header required.

```ts
export const ProjectPhaseCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  position: z.number().int().nonnegative(),
  planned_start_at: TimestampSchema.nullable().optional(),
  planned_end_at: TimestampSchema.nullable().optional(),
  budget_cents: z.number().int().nonnegative().default(0),
  notes: z.string().max(8000).nullable().optional(),
});
export const ProjectPhasePatchSchema = ProjectPhaseCreateSchema.partial();
```

**Field renames from the dispatch text.** Phase status values are `pending | active | completed | cancelled` (not `planned | in_progress | blocked | done`). Planned times are `planned_start_at` / `planned_end_at` (timestamptz, not `planned_start` / `planned_end` dates). Phases also carry `description`, `budget_cents`, and `notes` fields not present in the original dispatch shape.

### update-phase-status

`PUT /projects-api/projects/{project_id}/phases/{phase_id}/status`

- RBAC: `projects.write`.
- Idempotent header required.
- Gated by `assertTransition('phase', from, to)`. Illegal transitions return **409 STATE_CONFLICT** with `details.code = 'STATE_TRANSITION_ILLEGAL'`.
- Side effects: first `→ active` stamps `actual_start_at = now()`; first `→ completed` stamps `actual_end_at = now()`.

```ts
export const ProjectPhaseStatusUpdateSchema = z.object({
  status: PhaseStatusSchema,
});
```

### reorder-phases

`POST /projects-api/projects/{project_id}/phases/reorder`

- RBAC: `projects.write`.
- Two-pass negative-shift under any future `UNIQUE(project_id, position)` constraint.

```ts
export const ProjectPhaseReorderSchema = z.object({
  phase_ids: z.array(UuidSchema).min(1).max(200),
});
```

### delete-phase

`DELETE /projects-api/projects/{project_id}/phases/{phase_id}`

- RBAC: `projects.write`.
- **Soft delete** — the handler stamps `deleted_at = now()` rather than removing the row. Audit trail is preserved.

## Errors

Every endpoint returns the universal envelope:

```json
{ "error": { "code": "<CODE>", "message": "<readable>", "details": { /* optional */ } } }
```

Domain codes for `projects-api` on top of the universal set:

| Code | HTTP | When |
|---|---|---|
| `STATE_CONFLICT` (`details.code = 'STATE_TRANSITION_ILLEGAL'`) | 409 | Project close / reopen called against an illegal `from → to`, or phase status update via an illegal phase transition |

## Versioning

The `projects-api` bundle ships in Wave 4 PR #38. Schema-impacting changes ride `migrate.yml` (currently at `0050`).

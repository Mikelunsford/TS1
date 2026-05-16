# Quotes API

Wave 4 ships the `quotes-api` Edge Function bundle. It exposes quote headers, line items, workflow transitions, and the quote-versions mirror under `https://<project>.functions.supabase.co/quotes-api/...`.

The universal envelope, headers, idempotency, pagination, money-on-the-wire, and error rules from `TS1/09-api/00-API-CONTRACT.md` §0 apply to every endpoint below. This file is the per-module delta.

## Conventions in this document

- Every Zod block is pasted from `supabase/functions/_shared/types.ts` (single source of truth, byte-mirrored to `apps/web/src/lib/types.ts`).
- Every state-changing endpoint requires `Idempotency-Key: <uuid v4>`. Same key + same body hash replays the original response with `Idempotent-Replay: true`. Same key + different body returns `409 IDEMPOTENCY_CONFLICT`.
- Money is integer cents on the wire (field names end in `_cents`).
- Timestamps are ISO-8601 with `Z` (the prod DB columns are `timestamptz`).
- Bundle `quotes-api` enforces `verify_jwt = true`; every request carries a Supabase bearer token.

## RBAC at the bundle

The `quotes-api` bundle gates per-handler via `requireCap(caller, '<capability>')` against `_shared/capabilities.ts`:

- `org_owner`, `org_admin` — read, write, approve, send, convert.
- `sales`, `ops` — read and write; cannot approve large quotes (`quotes.approve` is org-admin / owner).
- `accounting`, `viewer` — read only.
- `customer_user` — read own (RLS gated to the customer's row); `quotes.write` on `/accept` only.

## State machine

Prod enum `quote_state`: `draft`, `submitted`, `revise_requested`, `approved`, `project_pending`, `cancelled`. The dispatch-text states `sent` / `accepted` / `declined` / `converted_to_project` do NOT exist on the enum — the `/send` and `/accept` routes write activity rows without changing `status` (R-W4-PF-01 reconcile). `/decline` maps to `→ cancelled`; `/convert-to-project` maps to `→ project_pending`.

Legal transitions (enforced by `_shared/workflow.ts#assertTransition`):

| From | To |
|---|---|
| `draft` | `submitted`, `cancelled` |
| `submitted` | `approved`, `revise_requested`, `cancelled` |
| `revise_requested` | `submitted` |
| `approved` | `project_pending`, `cancelled` |
| `project_pending` | _(terminal)_ |
| `cancelled` | _(terminal)_ |

`from === to` is always legal (idempotent). Illegal transitions return **409 STATE_CONFLICT** with `details.code = 'STATE_TRANSITION_ILLEGAL'`.

## Quotes

### list-quotes / get-quote

`GET /quotes-api/quotes`
`GET /quotes-api/quotes/{id}`

- RBAC: `quotes.read` (customer_user is RLS-gated to their own org's rows).
- Idempotent: yes (GET).
- Filters: `status` (multi-value), `customer_id`, `service_type`, `created_from` / `created_to` (date range).
- Pagination: `limit` (default 50, max 200), opaque `cursor`.
- Sort: `created_at DESC, id DESC`.

```ts
export const QuoteSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  quote_number: z.string().min(1),
  customer_id: UuidSchema,
  customer_name: z.string().min(1),        // denormalized NOT NULL on the DB
  contact_name: z.string().nullable(),
  contact_email: z.string().nullable(),
  service_type: QuoteServiceTypeSchema,    // 'co_pack' | 'cross_dock'
  status: QuoteStateSchema,                // see state machine above
  origin: QuoteOriginSchema,               // 'management' | 'customer_intake'
  mode: QuoteModeSchema,                   // 'new_quote' | 'revision' | 'reorder' | 'feasibility_only' | 'scope_shift'
  materials_only: z.boolean(),
  requires_approval: z.boolean(),
  job_type_id: UuidSchema.nullable(),
  opportunity_id: UuidSchema.nullable(),
  project_id: UuidSchema.nullable(),
  currency_code: z.string().length(3),
  exchange_rate: z.union([z.number(), z.string()]).nullable(),
  tax_id: UuidSchema.nullable(),
  tax_rate_snapshot: z.union([z.number(), z.string()]).nullable(),   // numeric(7,6) decimal in [0,1]
  subtotal_cents: CentsSchema,
  tax_cents: CentsSchema,
  discount_cents: CentsSchema,
  total_cents: CentsSchema,
  notes: z.string().nullable(),
  valid_until: z.string().nullable(),
  state_changed_at: TimestampSchema,
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});
```

```bash
curl -H "Authorization: Bearer $JWT" \
  "$BASE/quotes-api/quotes?status=draft&status=submitted&limit=25"
```

### create-quote

`POST /quotes-api/quotes`

- RBAC: `quotes.write`.
- Idempotent header required.
- Creates a `draft`. The server picks `quote_number` via `next_doc_number('quote')`.

```ts
export const QuoteCreateSchema = z.object({
  customer_id: UuidSchema,
  customer_name: z.string().min(1).max(200),     // denormalized at create
  contact_name: z.string().max(200).nullable().optional(),
  contact_email: z.string().email().nullable().optional(),
  service_type: QuoteServiceTypeSchema,
  origin: QuoteOriginSchema.default('management'),
  mode: QuoteModeSchema.default('new_quote'),
  materials_only: z.boolean().default(false),
  job_type_id: UuidSchema.nullable().optional(),
  opportunity_id: UuidSchema.nullable().optional(),
  currency_code: z.string().length(3).optional(),   // falls back to org default
  tax_id: UuidSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  valid_until: TimestampSchema.nullable().optional(),
});
```

**No `contact_id`, `tax_inclusive`, `discount_pct`, `terms`, `notes_internal`, or `notes_customer`** — those exist in the dispatch text but not on the prod table. `discount_cents` lives only on the per-line shape; there is no header discount field. Per-line discount + tax are how you compose totals.

### patch-quote

`PATCH /quotes-api/quotes/{id}`

- RBAC: `quotes.write`.
- Idempotent: yes.
- Only allowed while `status = 'draft'`. Outside `draft` returns **409 STATE_CONFLICT** with `details.code = 'QUOTE_LOCKED_VERSION'`.

```ts
export const QuotePatchSchema = QuoteCreateSchema.partial();
```

### Workflow transitions

| Route | Method | RBAC | Body schema | Effect |
|---|---|---|---|---|
| `/quotes/{id}/submit` | POST | `quotes.write` | `QuoteSubmitSchema` (`{}`) | `draft → submitted`; auto-stamps `requires_approval = true` when `total_cents >= 2_500_000` |
| `/quotes/{id}/approve` | POST | `quotes.approve` | `QuoteApproveSchema` (`{}`) | `submitted → approved` |
| `/quotes/{id}/request-revisions` | POST | `quotes.write` | `{ reason }` | `submitted → revise_requested`; reason → activity row |
| `/quotes/{id}/decline` | POST | `quotes.write` | `{ reason }` | `(submitted\|approved\|draft) → cancelled`; reason → activity row |
| `/quotes/{id}/send` | POST | `quotes.send` | `{ to_email?, message? }` | **No state change**; activity row only. Phase 19 wires real email. |
| `/quotes/{id}/accept` | POST | `quotes.write` (customer own) | `{ note? }` | **No state change**; activity row only. Customer-portal verb. |
| `/quotes/{id}/convert-to-project` | POST | `quotes.convert` | `{ project_name, due_date? }` | `approved → project_pending` via `convert_quote_to_project(uuid,text,timestamptz)` RPC. Returns `{ quote_id, project }`. |
| `/quotes/{id}/duplicate` | POST | `quotes.write` | `QuoteDuplicateSchema` (`{}`) | Clones header + lines as a new `draft` with a fresh `quote_number`. |

All eight require `Idempotency-Key`.

```ts
export const QuoteRequestRevisionsSchema = z.object({ reason: z.string().min(1).max(2000) });
export const QuoteDeclineSchema           = z.object({ reason: z.string().min(1).max(2000) });
export const QuoteSendSchema              = z.object({
  to_email: z.string().email().optional(),
  message: z.string().max(8000).optional(),
});
export const QuoteAcceptSchema            = z.object({ note: z.string().max(2000).optional() });
export const QuoteConvertSchema           = z.object({
  project_name: z.string().min(1).max(200),
  due_date: TimestampSchema.nullable().optional(),
});
```

```bash
# Submit a draft
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{}' \
  "$BASE/quotes-api/quotes/$QID/submit"

# Convert an approved quote to a project
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"project_name":"Acme Q3 Co-pack","due_date":"2026-08-31T23:59:59Z"}' \
  "$BASE/quotes-api/quotes/$QID/convert-to-project"
```

### get-quote-pdf

`GET /quotes-api/quotes/{id}/pdf`

- RBAC: `quotes.read`.
- **Returns 501** with `error.code = 'PDF_NOT_YET_AVAILABLE'`. Phase 19 will wire the generator. Route is exposed so SPA buttons can render their disabled state from a real handler rather than a feature flag.

### list-quote-versions

`GET /quotes-api/quotes/{id}/versions`

- RBAC: `quotes.read`.
- Idempotent: yes (GET).
- Reads `quote_versions` mirror rows for the quote, sorted `version_number DESC`. The mirror is populated by the `create_v1_for_quote` AFTER INSERT trigger and `mirror_quote_to_current_version` AFTER UPDATE trigger (regenerated in migration 0050).

```ts
export const QuoteVersionSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  quote_id: UuidSchema,
  version_number: z.number().int().nonnegative(),
  status: QuoteStateSchema,
  service_type: QuoteServiceTypeSchema,
  mode: QuoteModeSchema,
  materials_only: z.boolean(),
  requires_approval: z.boolean(),
  job_type_id: UuidSchema.nullable(),
  opportunity_id: UuidSchema.nullable(),
  currency_code: z.string().length(3),
  exchange_rate: z.union([z.number(), z.string()]).nullable(),
  tax_id: UuidSchema.nullable(),
  tax_rate_snapshot: z.union([z.number(), z.string()]).nullable(),
  subtotal_cents: CentsSchema,
  tax_cents: CentsSchema,
  discount_cents: CentsSchema,
  total_cents: CentsSchema,
  notes: z.string().nullable(),
  valid_until: z.string().nullable(),
  created_at: TimestampSchema,
});
```

## Quote line items

Resource: `/quotes/{quote_id}/line-items`. Wave 4 uses a **bulk replace** semantic for the POST (the server deletes all existing lines and inserts the supplied set); single-line append / patch / delete / reorder routes are also exposed.

After every line mutation the handler recomputes the parent quote's `subtotal_cents`, `discount_cents`, `tax_cents`, `total_cents` from the line aggregate using `taxTotalCents` (R-W3-07 half-up rounding). There is no DB trigger for quote totals — invoice math (Phase 7) is the model for trigger-based aggregation.

### list-quote-lines

`GET /quotes-api/quotes/{quote_id}/line-items`

- RBAC: `quotes.read`.
- Idempotent: yes (GET).
- Sort: `position ASC`.

```ts
export const QuoteLineSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  quote_id: UuidSchema,
  quote_version_id: UuidSchema.nullable(),
  item_id: UuidSchema.nullable(),
  description: z.string().min(1),
  quantity: z.union([z.number(), z.string()]),    // numeric(14,4)
  unit: z.string().nullable(),                    // free-text label, NOT a unit_id FK
  unit_price_cents: CentsSchema,
  unit_cost_cents: CentsSchema,
  discount_cents: CentsSchema,                    // per-line cents (NOT a percent)
  tax_id: UuidSchema.nullable(),
  tax_rate_snapshot: z.union([z.number(), z.string()]).nullable(),
  tax_amount_cents: CentsSchema,
  line_total_cents: CentsSchema,
  position: z.number().int().nonnegative(),
  created_at: TimestampSchema,
});
```

### replace-quote-lines / append-quote-line

`POST /quotes-api/quotes/{quote_id}/line-items`
`POST /quotes-api/quotes/{quote_id}/line-items/append`

- RBAC: `quotes.write`.
- Idempotent header required.
- Parent quote must be in `draft`; otherwise **409 STATE_CONFLICT** with `details.code = 'QUOTE_LINE_PARENT_LOCKED'`.
- The replace handler bypasses the legacy `replace_quote_line_items(uuid, jsonb)` RPC (which references DB columns dropped in 0030/0044) and runs DELETE+INSERT inline. F-Wave4-13 captures the bypass.

```ts
export const QuoteLineUpsertSchema = z.object({
  item_id: UuidSchema.nullable().optional(),
  description: z.string().min(1).max(500),
  quantity: z.number().positive(),
  unit: z.string().max(40).nullable().optional(),
  unit_price_cents: z.number().int().nonnegative(),
  unit_cost_cents: z.number().int().nonnegative().default(0),
  discount_cents: z.number().int().nonnegative().default(0),
  tax_id: UuidSchema.nullable().optional(),
  position: z.number().int().nonnegative(),
});

export const QuoteLineReplaceSchema = z.object({
  lines: z.array(QuoteLineUpsertSchema).max(500),
});
```

```bash
# Replace every line on a draft quote
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"lines":[{"description":"Co-pack labor","quantity":120,"unit":"hour","unit_price_cents":7500,"unit_cost_cents":4500,"discount_cents":0,"position":0}]}' \
  "$BASE/quotes-api/quotes/$QID/line-items"
```

### patch-quote-line / delete-quote-line

`PATCH /quotes-api/quotes/{quote_id}/line-items/{line_id}`
`DELETE /quotes-api/quotes/{quote_id}/line-items/{line_id}`

- RBAC: `quotes.write`.
- Same parent-locked guard.
- PATCH body: `QuoteLineUpsertSchema.partial()`.
- DELETE is hard at the line level — `quote_versions` is the audit trail for line state at issue time.

### reorder-quote-lines

`POST /quotes-api/quotes/{quote_id}/line-items/reorder`

- RBAC: `quotes.write`.
- Two-pass negative-shift safe under any future `UNIQUE(quote_id, position)` constraint.

```ts
export const QuoteLineReorderSchema = z.object({
  line_ids: z.array(UuidSchema).min(1).max(500),
});
```

## Errors

Every endpoint returns the universal envelope:

```json
{ "error": { "code": "<CODE>", "message": "<readable>", "details": { /* optional */ } } }
```

Domain codes for `quotes-api` on top of the universal set:

| Code | HTTP | When |
|---|---|---|
| `STATE_CONFLICT` (`details.code = 'STATE_TRANSITION_ILLEGAL'`) | 409 | Workflow handler called against an illegal `from → to` |
| `STATE_CONFLICT` (`details.code = 'QUOTE_LOCKED_VERSION'`) | 409 | PATCH on a non-`draft` quote |
| `STATE_CONFLICT` (`details.code = 'QUOTE_LINE_PARENT_LOCKED'`) | 409 | Line write while parent quote is not `draft` |
| `STATE_CONFLICT` (`details.code = 'QUOTE_NEEDS_APPROVAL'`) | 409 | Reserved; auto-set on submit when total ≥ `approval_threshold_cents` |
| `PDF_NOT_YET_AVAILABLE` | 501 | `GET /quotes/{id}/pdf` (Phase 19 surface) |

## Versioning

The `quotes-api` bundle ships in Wave 4 PR #38. Schema-impacting changes ride `migrate.yml` (currently at `0050`).

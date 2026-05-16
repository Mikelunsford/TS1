# Convert Lead API

Wave 6 (PR #55) swaps the `crm-api` lead-conversion handler from a multi-step transaction emulation to a single `convert_lead(...)` SECURITY DEFINER RPC (added in migration 0055). The wire shape is unchanged for happy paths; the behavior is now atomic — there is no partial-converted state and no best-effort rollback.

The universal envelope, headers, idempotency, money-on-the-wire, and error rules from `TS1/09-api/00-API-CONTRACT.md` §0 apply.

## Conventions in this document

- Every Zod block is pasted from `supabase/functions/_shared/types.ts` (byte-mirrored to `apps/web/src/lib/types.ts`).
- State-changing endpoint — requires `Idempotency-Key: <uuid v4>`.
- Money is integer cents on the wire.
- Bundle `crm-api` enforces `verify_jwt = true`.

## RBAC

The handler gates on `requireCap(caller, 'crm.leads.write')`:

- `org_owner`, `org_admin`, `sales` — full reach.
- `ops`, `accounting`, `viewer` — denied (read only on leads; cannot convert).
- `customer_user` — denied (no access to lead surface at all).

## Atomicity

The pre-Wave-6 handler ran three round-trips against the cluster (customer insert → opportunity insert → lead update) inside a Deno function with no transaction primitive available through `supabase-js`. A failure in steps 2 or 3 forced a best-effort delete of step 1's row; if the rollback also failed, the caller saw the underlying error and the database was left half-converted.

Wave 6 routes the entire flow through `public.convert_lead(...)` — a `LANGUAGE plpgsql SECURITY DEFINER` function (migration 0055). The function runs inside the implicit transaction the executor opens for every function call; a `RAISE EXCEPTION` at any point rolls the entire conversion back. Half-converted state is impossible by construction.

The handler shrinks to a single `admin().rpc('convert_lead', { ... })` invocation. The RPC return jsonb is mapped to the wire response below.

## Routes

### convert-lead

`POST /crm-api/leads/{id}/convert`

- RBAC: `crm.leads.write`.
- Idempotent header required.
- Lead must be in a non-`converted` status; otherwise **409 LEAD_ALREADY_CONVERTED**.

```ts
export const LeadConvertSchema = z.object({
  opportunity_name: z.string().min(1).max(200),
  opportunity_amount_cents: z.number().int().nonnegative(),
  opportunity_currency_code: z.string().length(3).nullable().optional(),
  customer_id: UuidSchema.nullable().optional(),
  create_customer: z.boolean().default(false),
});
```

Semantics:

- `create_customer: true` — the RPC inserts a fresh `customers` row stamped with the lead's `org_id`, `display_name` (falling back from `company_name`), `email`, `phone`, and `currency_code`. The new `customer_id` is returned.
- `create_customer: false` — `customer_id` is **required**; absence returns **422 VALIDATION_ERROR** with `details.code = 'CUSTOMER_ID_REQUIRED'`.
- `opportunity_currency_code: null` — falls back to the lead's `currency_code`.

The RPC then writes:

1. an `opportunities` row at `stage='prospect'` linked to the chosen customer and the lead, with `opportunity_number := next_doc_number(org, 'opportunity')`;
2. an update on the source lead stamping `converted_customer_id`, `converted_opportunity_id`, `converted_at = now()`, `status = 'converted'`.

Response:

```ts
export const LeadConvertResponseSchema = z.object({
  data: z.object({
    lead: LeadSchema,                              // the freshly-updated lead row
    customer_id: UuidSchema,                       // the chosen-or-created customer
    opportunity_id: UuidSchema,
    opportunity_number: z.string().min(1),         // NEW in Wave 6 — surfaced from the RPC
  }),
});
```

The pre-Wave-6 handler returned `{ lead, customer_id, opportunity_id }`. Wave 6 adds `opportunity_number` to the envelope so the caller does not need a second round-trip to render the new opportunity card.

```bash
# Convert a lead, create a new customer for it
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "opportunity_name":"Acme Q3 expansion",
    "opportunity_amount_cents":12500000,
    "opportunity_currency_code":"USD",
    "create_customer": true
  }' \
  "$BASE/crm-api/leads/$LID/convert"

# Convert a lead, link to an existing customer
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "opportunity_name":"Acme renewal",
    "opportunity_amount_cents":4800000,
    "customer_id":"'$CID'",
    "create_customer": false
  }' \
  "$BASE/crm-api/leads/$LID/convert"
```

Sample success response:

```json
{
  "data": {
    "lead": {
      "id": "9a...",
      "status": "converted",
      "converted_customer_id": "c0...",
      "converted_opportunity_id": "o7...",
      "converted_at": "2026-05-16T17:32:01.123Z"
    },
    "customer_id": "c0...",
    "opportunity_id": "o7...",
    "opportunity_number": "OPP-2026-00042"
  }
}
```

## Errors

| Code | HTTP | When |
|---|---|---|
| `LEAD_ALREADY_CONVERTED` | 409 | The lead's `status` is already `converted` (RPC raises `invalid_parameter_value` on the pre-check; handler maps to this code). |
| `NOT_FOUND` | 404 | No lead with that id is visible to the caller (RLS or hard-delete). RPC raises `no_data_found`. |
| `VALIDATION_ERROR` (`details.code = 'CUSTOMER_ID_REQUIRED'`) | 422 | `create_customer=false` and `customer_id` is null/absent. |
| `IDEMPOTENCY_CONFLICT` | 409 | Same `Idempotency-Key`, different body hash. Universal §0.4. |

The previous handler's hand-rolled rollback errors (`CONVERT_LEAD_ROLLBACK_FAILED`) are gone — the RPC's all-or-nothing semantics make them unreachable.

## Versioning

The `crm-api` bundle ships the Wave-6 handler swap in PR #55. The RPC arrives in migration `0055`. Bundle redeploys to v40 via `deploy-functions.yml` on merge.

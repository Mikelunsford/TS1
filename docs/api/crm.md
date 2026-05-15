# CRM API

Wave 2 ships the `crm-api` Edge Function bundle. It exposes customers, contacts, leads, opportunities, and activities under `https://<project>.functions.supabase.co/crm-api/...`.

The universal envelope, headers, idempotency, pagination, money-on-the-wire, and error rules from `TS1/09-api/00-API-CONTRACT.md` §0 apply to every endpoint below. This file is the per-module delta.

## Conventions in this document

- Every Zod block is pasted from `supabase/functions/_shared/types.ts` (single source of truth). The wire shape never drifts from this file.
- Every state-changing endpoint (`POST`, `PATCH`, `DELETE`, `PUT`) requires `Idempotency-Key: <uuid v4>`. Same key + same body hash replays the original response with `Idempotent-Replay: true`. Same key + different body returns `409 IDEMPOTENCY_CONFLICT`.
- Money is integer cents on the wire (field names end in `_cents`).
- Dates are `YYYY-MM-DD`; timestamps are ISO-8601 with `Z`.
- Bundle `crm-api` enforces `verify_jwt = true`; every request must carry a Supabase bearer token.

## RBAC at the bundle

The crm-api bundle gates per-handler via `requireCap(caller, '<capability>')`. Wave 2 collapses the full capability matrix to a role check (the matrix lands in Wave 3):

- `org_owner`, `org_admin` -> read and write everything.
- `sales` -> read and write all CRM resources.
- `ops`, `accounting`, `viewer` -> read-only.
- `customer_user` -> read-only and RLS-scoped to their own customer.

Each section below lists the capability string the handler claims.

## Reading and writing customers

### list-customers

`GET /crm-api/customers`

- Auth: bearer JWT with active org claim.
- RBAC: `crm.customers.read`.
- Idempotent: yes (GET).
- Filters: `q`, `status`, `kind` (query string).
- Pagination: `limit` (default 50, max 200), opaque `cursor`.

### get-customer

`GET /crm-api/customers/{id}`

- Auth: bearer JWT.
- RBAC: `crm.customers.read` (customer_user is RLS-scoped to own row).

### create-customer

`POST /crm-api/customers`

- Auth: bearer JWT.
- RBAC: `crm.customers.write`.
- Idempotent: yes.
- Request schema:

```ts
export const CustomerCreateSchema = z.object({
  display_name: z.string().min(1).max(200),
  kind: CustomerKindSchema.default('company'),
  primary_email: z.string().email().nullable().optional(),
  primary_phone: z.string().max(64).nullable().optional(),
  tax_id: z.string().max(64).nullable().optional(),
  billing_address: AddressSchema.nullable().optional(),
  shipping_address: AddressSchema.nullable().optional(),
  default_currency_code: z.string().length(3).optional(),
  tags: z.array(z.string()).default([]),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});
```

Example request:

```bash
curl -X POST https://<project>.functions.supabase.co/crm-api/customers \
  -H "Authorization: Bearer $JWT" \
  -H "Idempotency-Key: 9b7c4a3e-2f51-4ec2-9d7b-1c0b8e3a5f12" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Acme Corp",
    "kind": "company",
    "primary_email": "ap@acme.com",
    "billing_address": {
      "line1": "100 Main",
      "city": "Austin",
      "region": "TX",
      "postal": "78701",
      "country": "US"
    }
  }'
```

Example success response (`201 Created`):

```json
{
  "data": {
    "id": "5b1e9c0e-3c2a-4f23-9c7d-3d6e1f0a8b22",
    "org_id": "00000000-0000-0000-0000-000000000001",
    "customer_number": "CUST-2026-00034",
    "display_name": "Acme Corp",
    "kind": "company",
    "client_status": "new",
    "primary_email": "ap@acme.com",
    "primary_phone": null,
    "tax_id": null,
    "billing_address": {
      "line1": "100 Main",
      "city": "Austin",
      "region": "TX",
      "postal": "78701",
      "country": "US"
    },
    "shipping_address": null,
    "default_currency_code": null,
    "is_archived": false,
    "created_at": "2026-05-15T17:32:01.123Z",
    "updated_at": "2026-05-15T17:32:01.123Z"
  }
}
```

Example error response (`422`):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "request body failed schema validation",
    "details": { "fieldErrors": { "primary_email": ["Invalid email"] } }
  }
}
```

### patch-customer

`PATCH /crm-api/customers/{id}`

- RBAC: `crm.customers.write`.
- Idempotent: yes.
- Request: `CustomerCreateSchema.partial()` — every key optional.

### archive-customer

`POST /crm-api/customers/{id}/archive`

- RBAC: `crm.customers.write`.
- Idempotent: yes.
- Soft-delete. Sets `is_archived = true`.

### restore-customer

`POST /crm-api/customers/{id}/restore`

- RBAC: `crm.customers.write`.
- Idempotent: yes.
- Reverses archive.

### customer domain error codes

In addition to the universal codes from contract §0.1:

- `CUSTOMER_HAS_OPEN_TXNS` (`409`) — archive blocked when the customer has open quotes / invoices. Reserved code; the trigger lands in Phase 3 (invoicing). Wave 2 archives unconditionally because no open transactions can yet exist.

## Reading and writing contacts

### list-contacts

`GET /crm-api/contacts?customer_id=<uuid>`

- RBAC: `crm.contacts.read`.
- Filters: `customer_id` (optional; omit for org-wide).

### get-contact

`GET /crm-api/contacts/{id}`

- RBAC: `crm.contacts.read`.

### create-contact

`POST /crm-api/contacts`

- RBAC: `crm.contacts.write`.
- Idempotent: yes.
- Request schema:

```ts
export const ContactUpsertSchema = z.object({
  customer_id: UuidSchema,
  first_name: z.string().min(1).max(80),
  last_name: z.string().max(80).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  title: z.string().max(120).nullable().optional(),
  is_primary: z.boolean().default(false),
});
```

Example request:

```bash
curl -X POST https://<project>.functions.supabase.co/crm-api/contacts \
  -H "Authorization: Bearer $JWT" \
  -H "Idempotency-Key: 1a2b3c4d-5e6f-4789-9012-3456789abcde" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "5b1e9c0e-3c2a-4f23-9c7d-3d6e1f0a8b22",
    "first_name": "Jane",
    "last_name": "Doe",
    "email": "jane@acme.com",
    "title": "Head of Procurement",
    "is_primary": true
  }'
```

Example success response (`201 Created`):

```json
{
  "data": {
    "id": "8c2d4e0f-1a3b-4c5d-6e7f-8a9b0c1d2e3f",
    "org_id": "00000000-0000-0000-0000-000000000001",
    "customer_id": "5b1e9c0e-3c2a-4f23-9c7d-3d6e1f0a8b22",
    "first_name": "Jane",
    "last_name": "Doe",
    "email": "jane@acme.com",
    "phone": null,
    "title": "Head of Procurement",
    "is_primary": true,
    "is_active": true,
    "created_at": "2026-05-15T17:35:12.456Z",
    "updated_at": "2026-05-15T17:35:12.456Z"
  }
}
```

Example error response (`422`, customer not in caller's org):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "customer_id not found in caller org"
  }
}
```

### patch-contact

`PATCH /crm-api/contacts/{id}`

- RBAC: `crm.contacts.write`.
- Idempotent: yes.
- Request: `ContactUpsertSchema` partial.

### delete-contact

`DELETE /crm-api/contacts/{id}`

- RBAC: `crm.contacts.write`.
- Idempotent: yes.
- Hard delete. Cascades nothing.

## Reading and writing leads

### list-leads

`GET /crm-api/leads`

- RBAC: `crm.leads.read`.
- Filters: `status`, `owner`, `source`.

### get-lead

`GET /crm-api/leads/{id}`

- RBAC: `crm.leads.read`.

### create-lead

`POST /crm-api/leads`

- RBAC: `crm.leads.write`.
- Idempotent: yes.
- Request schema:

```ts
export const LeadCreateSchema = z.object({
  display_name: z.string().min(1).max(200),
  company_name: z.string().max(200).nullable().optional(),
  source: LeadSourceSchema.default('inbound'),
  primary_email: z.string().email().nullable().optional(),
  primary_phone: z.string().max(64).nullable().optional(),
  owner_user_id: UuidSchema.nullable().optional(),
  status: z.enum(['new', 'contacted', 'qualified', 'disqualified']).default('new'),
  estimated_value_cents: z.number().int().nonnegative().default(0),
  currency_code: z.string().length(3).nullable().optional(),
  expected_close_date: z.string().date().nullable().optional(),
  notes: z.string().nullable().optional(),
});
```

Example request:

```bash
curl -X POST https://<project>.functions.supabase.co/crm-api/leads \
  -H "Authorization: Bearer $JWT" \
  -H "Idempotency-Key: 7e6f5d4c-3b2a-4192-8071-6f5e4d3c2b1a" \
  -H "Content-Type: application/json" \
  -d '{
    "display_name": "Acme expansion deal",
    "company_name": "Acme Corp",
    "source": "inbound",
    "primary_email": "buyer@acme.com",
    "estimated_value_cents": 5000000,
    "currency_code": "USD"
  }'
```

Example success response (`201 Created`):

```json
{
  "data": {
    "id": "9a8b7c6d-5e4f-4321-8765-4321fedcba98",
    "org_id": "00000000-0000-0000-0000-000000000001",
    "lead_number": "LEAD-2026-00017",
    "display_name": "Acme expansion deal",
    "company_name": "Acme Corp",
    "source": "inbound",
    "status": "new",
    "primary_email": "buyer@acme.com",
    "primary_phone": null,
    "owner_user_id": null,
    "estimated_value_cents": 5000000,
    "currency_code": "USD",
    "expected_close_date": null,
    "converted_customer_id": null,
    "converted_opportunity_id": null,
    "converted_at": null,
    "notes": null,
    "created_at": "2026-05-15T17:40:00.000Z",
    "updated_at": "2026-05-15T17:40:00.000Z"
  }
}
```

### patch-lead

`PATCH /crm-api/leads/{id}`

- RBAC: `crm.leads.write`.
- Idempotent: yes.
- Request: `LeadCreateSchema.partial()`.

### convert-lead

`POST /crm-api/leads/{id}/convert`

- RBAC: `crm.leads.write`.
- Idempotent: yes.

This is the atomic three-step flow. The handler:

1. Optionally creates a new customer from the lead's fields (`create_customer: true`) or uses an existing customer (`customer_id`).
2. Creates an opportunity at stage `prospect` linked to that customer and to the lead.
3. Patches the lead: `converted_customer_id`, `converted_opportunity_id`, `converted_at = now()`, `status = 'converted'`.

Step 3 is only possible because migration `0047` shipped `leads.fk_converted_opportunity_id` as `DEFERRABLE INITIALLY DEFERRED` — the FK from `leads.converted_opportunity_id -> opportunities.id` is checked at commit time, not at write time, so the lead can be updated to point at the opportunity that was inserted earlier in the same logical transaction.

The Supabase JS client does not expose a transaction primitive, so the handler sequences the three writes and, on failure of step 2 or 3, best-effort deletes the partial rows. The idempotency cache provides retry safety for the network layer.

Request schema:

```ts
export const LeadConvertSchema = z.object({
  create_customer: z.boolean().default(false),
  customer_id: UuidSchema.nullable().optional(),
  opportunity_name: z.string().min(1).max(200),
  opportunity_amount_cents: z.number().int().nonnegative().default(0),
  opportunity_currency_code: z.string().length(3).optional(),
});
```

Example request (create new customer):

```bash
curl -X POST https://<project>.functions.supabase.co/crm-api/leads/9a8b7c6d-5e4f-4321-8765-4321fedcba98/convert \
  -H "Authorization: Bearer $JWT" \
  -H "Idempotency-Key: c3d4e5f6-7890-4abc-9def-0123456789ab" \
  -H "Content-Type: application/json" \
  -d '{
    "create_customer": true,
    "opportunity_name": "Acme expansion deal — initial scope",
    "opportunity_amount_cents": 5000000,
    "opportunity_currency_code": "USD"
  }'
```

Example success response (`200 OK`):

```json
{
  "data": {
    "lead": {
      "id": "9a8b7c6d-5e4f-4321-8765-4321fedcba98",
      "lead_number": "LEAD-2026-00017",
      "status": "converted",
      "converted_customer_id": "abc12345-6789-4def-0123-456789abcdef",
      "converted_opportunity_id": "def67890-1234-4abc-5678-9abcdef01234",
      "converted_at": "2026-05-15T17:45:33.789Z"
    },
    "customer_id": "abc12345-6789-4def-0123-456789abcdef",
    "opportunity_id": "def67890-1234-4abc-5678-9abcdef01234"
  }
}
```

(The lead body in the response carries every column from `LeadSchema`; the example trims it for readability.)

Example error response (`409`, replay against a converted lead):

```json
{
  "error": {
    "code": "LEAD_ALREADY_CONVERTED",
    "message": "lead already converted"
  }
}
```

### lead domain error codes

- `LEAD_ALREADY_CONVERTED` (`409`) — convert called against a lead whose `status` is already `converted`.

## Reading and writing opportunities

### list-opportunities

`GET /crm-api/opportunities`

- RBAC: `crm.opportunities.read`.
- Filters: `stage`, `owner`, `customer_id`.

The kanban view fires this endpoint with `?stage=prospect`, `?stage=discovery`, etc., one call per column, and renders them side by side.

### get-opportunity

`GET /crm-api/opportunities/{id}`

- RBAC: `crm.opportunities.read`.

### create-opportunity

`POST /crm-api/opportunities`

- RBAC: `crm.opportunities.write`.
- Idempotent: yes.
- Request schema:

```ts
export const OpportunityCreateSchema = z.object({
  customer_id: UuidSchema,
  lead_id: UuidSchema.nullable().optional(),
  display_name: z.string().min(1).max(200),
  amount_cents: z.number().int().nonnegative(),
  currency_code: z.string().length(3),
  stage: z
    .enum(['prospect', 'discovery', 'proposal', 'negotiation', 'won', 'lost'])
    .default('prospect'),
  probability_pct: z.number().min(0).max(100).default(0),
  expected_close_date: z.string().date().nullable().optional(),
  owner_user_id: UuidSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
});
```

Example request:

```bash
curl -X POST https://<project>.functions.supabase.co/crm-api/opportunities \
  -H "Authorization: Bearer $JWT" \
  -H "Idempotency-Key: 11ec2f55-aab1-4f9e-bbb7-9c1b8b3c2f55" \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": "abc12345-6789-4def-0123-456789abcdef",
    "display_name": "Renewal Q3",
    "amount_cents": 1200000,
    "currency_code": "USD",
    "stage": "discovery",
    "probability_pct": 40
  }'
```

Example success response (`201 Created`):

```json
{
  "data": {
    "id": "def67890-1234-4abc-5678-9abcdef01234",
    "org_id": "00000000-0000-0000-0000-000000000001",
    "opportunity_number": "OPP-2026-00009",
    "customer_id": "abc12345-6789-4def-0123-456789abcdef",
    "lead_id": null,
    "display_name": "Renewal Q3",
    "stage": "discovery",
    "amount_cents": 1200000,
    "currency_code": "USD",
    "probability_pct": 40,
    "expected_close_date": null,
    "closed_at": null,
    "close_reason": null,
    "owner_user_id": null,
    "notes": null,
    "created_at": "2026-05-15T17:50:11.222Z",
    "updated_at": "2026-05-15T17:50:11.222Z"
  }
}
```

Example error response (`422`, customer not in caller's org):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "customer_id not found in caller org"
  }
}
```

### patch-opportunity

`PATCH /crm-api/opportunities/{id}`

- RBAC: `crm.opportunities.write`.
- Idempotent: yes.
- Request: `OpportunityCreateSchema.partial()`.

Use this for amount, probability, owner, expected close date, or notes edits. For pipeline moves use the dedicated stage endpoint below.

### update-opportunity-stage

`PUT /crm-api/opportunities/{id}/stage`

- RBAC: `crm.opportunities.write`.
- Idempotent: yes.
- Request schema:

```ts
export const OpportunityStageUpdateSchema = z.object({
  stage: OpportunityStageSchema,
  close_reason: z.string().max(500).nullable().optional(),
});
```

This is the endpoint the kanban drag fires. `stage` accepts the full enum (`prospect`, `discovery`, `proposal`, `negotiation`, `won`, `lost`, `abandoned`). Moves to `won` or `lost` stamp `closed_at`; `close_reason` is captured when supplied.

Example request:

```bash
curl -X PUT https://<project>.functions.supabase.co/crm-api/opportunities/def67890-1234-4abc-5678-9abcdef01234/stage \
  -H "Authorization: Bearer $JWT" \
  -H "Idempotency-Key: 22fd3066-bbc2-4a0f-ccc8-ad2c9c4d3066" \
  -H "Content-Type: application/json" \
  -d '{"stage": "proposal"}'
```

## Reading and writing activities

Activities are polymorphic over `customer`, `contact`, `lead`, `opportunity`, `quote`, `project`, `invoice`. Wave 2 wires CRM entity types; later waves wire quote / project / invoice as those modules ship, but the enum is already declared so client code is stable.

### list-activities

`GET /crm-api/activities?entity_type=&entity_id=`

- RBAC: `crm.activities.read`.
- Filters: `entity_type` + `entity_id` (typical use), or omit both for the global feed.

### create-activity

`POST /crm-api/activities`

- RBAC: `crm.activities.write`.
- Idempotent: yes.
- Request schema:

```ts
export const ActivityCreateSchema = z.object({
  entity_type: ActivityEntityTypeSchema,
  entity_id: UuidSchema,
  kind: ActivityKindSchema,
  subject: z.string().min(1).max(200),
  body: z.string().nullable().optional(),
  occurred_at: TimestampSchema.optional(),
  due_at: TimestampSchema.nullable().optional(),
  completed_at: TimestampSchema.nullable().optional(),
});
```

Example request:

```bash
curl -X POST https://<project>.functions.supabase.co/crm-api/activities \
  -H "Authorization: Bearer $JWT" \
  -H "Idempotency-Key: 33fe4177-ccd3-4b10-ddd9-be3dad5e4177" \
  -H "Content-Type: application/json" \
  -d '{
    "entity_type": "opportunity",
    "entity_id": "def67890-1234-4abc-5678-9abcdef01234",
    "kind": "call",
    "subject": "Intro call with buyer",
    "body": "30 minutes. Budget confirmed. Next step: technical demo."
  }'
```

Example success response (`201 Created`):

```json
{
  "data": {
    "id": "f1e2d3c4-b5a6-4978-8765-4321fedcba98",
    "org_id": "00000000-0000-0000-0000-000000000001",
    "entity_type": "opportunity",
    "entity_id": "def67890-1234-4abc-5678-9abcdef01234",
    "kind": "call",
    "subject": "Intro call with buyer",
    "body": "30 minutes. Budget confirmed. Next step: technical demo.",
    "status": "open",
    "due_at": null,
    "completed_at": null,
    "created_at": "2026-05-15T17:55:02.345Z",
    "updated_at": "2026-05-15T17:55:02.345Z"
  }
}
```

Example error response (`404`, parent entity not in caller's org):

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "opportunity not found"
  }
}
```

### patch-activity

`PATCH /crm-api/activities/{id}`

- RBAC: `crm.activities.write`.
- Idempotent: yes.
- Request schema:

```ts
export const ActivityPatchSchema = z.object({
  subject: z.string().min(1).max(200).optional(),
  body: z.string().nullable().optional(),
  due_at: TimestampSchema.nullable().optional(),
  completed_at: TimestampSchema.nullable().optional(),
  status: z.enum(['open', 'completed', 'cancelled']).optional(),
});
```

Use this to mark a task complete (set `completed_at` and `status='completed'`) or to cancel one.

## Cross-cutting notes

- Every list endpoint returns `{ items, next_cursor }`. The cursor is opaque base64 of `{created_at, id}`; pass it back as `?cursor=` to fetch the next page.
- Every create / patch / archive / restore / convert / delete handler runs through `respondWithIdempotency`, so retries with the same key are safe. A new key with the same body creates a new resource — keys must be UUID v4.
- Every handler scopes queries with explicit `.eq('org_id', caller.orgId)` per the "RLS Defense-In-Depth" Pattern A from `TS1/03-workspace/00-SHARED-CONTEXT.md`.
- The capability strings (`crm.customers.write`, `crm.leads.write`, etc.) are documentary in Wave 2; the role gate in `requireCap` is the real enforcement until the full capability matrix lands.

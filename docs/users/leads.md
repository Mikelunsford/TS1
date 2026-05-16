# Leads

Leads are the top of the CRM funnel — inbound, outbound, or referral contacts that have not yet been qualified into a customer + opportunity. The leads page lives at `/crm/leads` and is reachable after sign-in with `crm.leads.*` capability.

The general browse / filter / kanban surface is documented in **[CRM](./crm.md)**. This page covers the **convert** flow, which Wave 6 hardened.

## Converting a lead (Wave 6)

Click **Convert** on a qualified lead. The `<ConvertLeadDialog>` opens. Choose:

- whether to create a fresh customer from the lead's fields, or pick an existing customer by id;
- the opportunity's display name (defaults to the lead's name);
- the opportunity amount in dollars (the UI emits cents);
- the currency code (defaults to the lead's currency, else USD).

Submit posts `POST /crm-api/leads/:id/convert` with an `Idempotency-Key`.

### What's atomic now

Wave 6 PR #55 swapped the multi-step handler for a single `convert_lead(...)` SECURITY DEFINER RPC (migration 0055). The RPC runs inside one transaction. A failure at any step — customer insert, opportunity insert, or lead update — rolls everything back. **No half-converted state is possible.**

Before Wave 6, the handler made three round-trips against the cluster and best-effort-deleted the customer row if step 2 or 3 failed. If the rollback itself failed, the database was left half-converted and the user saw the underlying error.

### What the user sees

On success the dialog closes, the leads list invalidates (the converted row's action column goes blank), Sonner toasts "Lead converted", and the response carries the new opportunity number (`OPP-2026-NNNNN`). You can navigate to `/crm/opportunities` to find the new card, or click the toast's "Open opportunity" link.

On failure:

- **409 LEAD_ALREADY_CONVERTED** — the dialog shows an inline error and offers a link to the existing opportunity. You hit Refresh to clear the stale state.
- **422 VALIDATION_ERROR** (`details.code = 'CUSTOMER_ID_REQUIRED'`) — you toggled off "Create new customer" but forgot to pick an existing one. The dialog highlights the customer picker.
- Any other failure (network, RPC `RAISE EXCEPTION` other than the above) — Sonner toasts "Failed to convert lead" and the dialog stays open. **The DB is untouched** — the all-or-nothing RPC means no manual cleanup is needed.

### Wire shape

The wire response is unchanged for happy paths plus one new field:

```json
{
  "data": {
    "lead": { "id": "...", "status": "converted", "converted_at": "..." },
    "customer_id": "c0...",
    "opportunity_id": "o7...",
    "opportunity_number": "OPP-2026-00042"
  }
}
```

The new `opportunity_number` saves the dialog a second round-trip to fetch the just-created opportunity.

See **[Convert Lead API](../api/convert-lead.md)** for the full request / response / error catalog.

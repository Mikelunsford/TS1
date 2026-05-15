# CRM

Wave 2 shipped the customer graph: customers, contacts, leads, opportunities, and an activity timeline that ties them together. Every page below is reachable after sign-in once you have a CRM-touching role (`org_owner`, `org_admin`, `sales`; `ops` / `accounting` / `viewer` are read-only; `customer_user` is scoped to their own customer via RLS).

This walkthrough leads you from sign-in through the four core flows: browsing customers, capturing a new lead, converting that lead, and driving the opportunity through the pipeline. The five pages it covers are the Customers list, the Customer detail, the Contacts list, the Leads page, the Opportunities page, and the global Activities feed.

## Signing in

Hit the sign-in screen at the org's primary host (for the default tenant, `team1.example.com`) and submit your credentials. On success you land on `/dashboard`. The left nav exposes the CRM section: Customers, Contacts, Leads, Opportunities, Activities.

If the JWT does not carry an `org_id` claim and your account belongs to exactly one org, the API auto-resolves it. Multiple memberships route you to the workspace switcher.

## Browsing customers

Navigate to `/crm/customers`.

You see a header (`Customers`), a search-and-status filter row, and a table with five columns: Name, Status, Email, Tags, Outstanding. The first paint is a six-row table skeleton; the API call replaces it as soon as `crm-api/customers` resolves.

The filter row contains:

- a free-text `Search` input (matches name, email, tag),
- a `Status` select (`All`, `New`, `Active`, `Inactive`, `Archived`),
- an `Apply` button that commits the search input to the URL.

Status changes apply immediately. Both filters reset pagination. The `Outstanding` column renders `$0.00` for every row in Wave 2 — Phase 3 (invoicing) replaces the stub with the real balance. The column shape is locked in so later phases drop in cleanly.

If the result set has more rows than the page limit (default 50, max 200), a `Next page` button appears in the lower right; clicking it sets the URL `cursor=` query param and refetches. If the filtered result is empty, the table is replaced by an empty state explaining how to clear filters or how customers arrive (API / import).

Click any customer's name to drill in.

## Reading a customer detail

You arrive at `/crm/customers/:id`. The page renders:

1. A breadcrumb (`Customers / <display_name>`).
2. An overview card with name, type (`Company` or `Individual`), email, phone, currency, status, and tags.
3. A tab strip: `Overview`, `Contacts`, `Activities`, `Quotes`, `Projects`, `Invoices`, `Files`.

Wave 2 wires only `Overview`, `Contacts`, and `Activities`. The other tabs render a "coming in Phase 3 / Phase 5" empty state so the IA is stable.

- `Contacts` lists everyone attached to this customer with their title, email (`mailto:` link), phone, and a "Primary" badge for the row flagged `is_primary=true`. Empty state explains how to add a contact.
- `Activities` renders the per-entity timeline scoped to this customer (calls, meetings, emails, notes, tasks).

## Browsing contacts globally

Navigate to `/crm/contacts`.

This is a flat list across every customer in the active org. The search input filters client-side on name, email, and title; the `customer_id` query param scopes to a single customer (the link from the customer detail's Contacts tab pre-fills it; a `Clear customer filter` button removes it).

Each row shows name (with a `Primary` tag where applicable), title, email, and a `View` link to the parent customer. Pagination uses the same `next_cursor` mechanism as the customers list.

## Creating a lead

Navigate to `/crm/leads`.

The page header has a `List | Kanban` toggle on the right; the view choice lives in `?view=`. Three filters in the second row: Status (`new`, `contacted`, `qualified`, `disqualified`, `converted`), Source (`inbound`, `outbound`, `referral`, `event`, `import`, `other`), and an Assigned-to (user id) input.

In list view the table has Name, Status, Source, Email, Created, and an action column on the right. The action depends on status:

- `new` -> button reads `Advance` (moves to `contacted`).
- `contacted` -> button reads `Advance` (moves to `qualified`).
- `qualified` -> button reads `Convert` (opens the convert dialog).
- `disqualified` / `converted` -> no action.

A successful `Advance` invalidates the leads query; the row's badge updates in place. A failure toasts "Failed to update lead" via Sonner.

The kanban view shows one column per status with cards reading name, source, and the same Convert affordance on qualified cards.

Wave 2 ships the list and the convert path. The new-lead create form is intentionally out of scope for this dispatch — leads enter the system through the API or import flows until Wave 3 ships the create dialog.

## Converting a lead to a customer and opportunity

Click `Convert` on a qualified lead. The `<ConvertLeadDialog>` opens.

You choose:

- whether to create a fresh customer from the lead's fields, or pick an existing customer by id;
- the opportunity's display name (defaults to the lead's name);
- the opportunity amount in dollars (the UI emits cents); and
- the currency code (defaults to the lead's currency, else USD).

Submit fires `POST /crm-api/leads/:id/convert` with an `Idempotency-Key`. The server runs the three-step transaction:

1. If `create_customer: true`, insert a `customers` row stamped with `org_id` and the lead's email / phone / currency.
2. Insert an `opportunities` row at stage `prospect` linked to that customer and to the lead.
3. Update the lead: `converted_customer_id`, `converted_opportunity_id`, `converted_at`, `status='converted'`.

Step 3 only works because migration `0047` made `leads.fk_converted_opportunity_id` `DEFERRABLE INITIALLY DEFERRED`, so the FK check runs at commit time after the opportunity exists.

On success the dialog closes, the leads list invalidates (the converted row's action column goes blank), Sonner toasts "Lead converted", and you can navigate to `/crm/opportunities` to find the new card. On `LEAD_ALREADY_CONVERTED` (409) the dialog shows the inline error and offers a link to the existing opportunity. On a partial-failure rollback (Supabase JS has no transaction primitive) the handler best-effort deletes any partial inserts; if any of that fails the request still surfaces the underlying error rather than leaving the user guessing.

## Driving the opportunity through pipeline stages

Navigate to `/crm/opportunities`.

Same `List | Kanban` toggle as Leads. Stage filter (`prospect`, `discovery`, `proposal`, `negotiation`, `won`, `lost`, `abandoned`) and Assigned-to filter.

In list view: Number, Name, Stage, Amount, Probability, Close date. The amount is formatted via `formatMoney(cents, currency)` so EUR opportunities render with the EUR symbol.

In kanban view each stage is a column. Cards are draggable: drop a card on a different column and the page fires `PUT /crm-api/opportunities/:id/stage` with the new stage. On success the card moves to the new column and the list query invalidates. On failure the card snaps back and an error toast fires.

Each column footer shows the weighted total for that stage:

```text
sum(amount_cents * probability_pct / 100) for cards in the column
```

This gives a forecast view at a glance.

The `prospect`, `discovery`, `proposal`, `negotiation` stages are open. `won`, `lost`, and `abandoned` are terminal; dropping a card into `won` or `lost` stamps `closed_at`. A close-reason text capture for `lost` lands in Wave 3.

## Logging an activity

Activities are polymorphic: they hang off `customer`, `contact`, `lead`, `opportunity`, `quote`, `project`, or `invoice`.

The two surfaces in Wave 2:

- `/crm/activities` — global feed, newest first, across every entity type.
- The `Activities` tab on a customer detail — scoped to that customer.

Each row reads: kind icon (`call`, `meeting`, `email`, `note`, `task`), subject, status (`open`, `completed`, `cancelled`), due-at, completed-at, body (truncated). The page handles loading, empty, and error states. Creating and patching activities is wired through `POST /crm-api/activities` and `PATCH /crm-api/activities/:id`; the per-entity Log Activity widget lives in `<ActivityFeed>` (used on both surfaces).

## What you cannot do in Wave 2

- Create a customer from the UI — use `POST /crm-api/customers` or imports. The form ships in Wave 3.
- See an outstanding balance — Phase 3 (invoicing) wires it.
- See quotes, projects, or invoices on a customer — those tabs are placeholders until Wave 3.
- Attach files — Files tab is a placeholder until Phase 5.
- Drag opportunities to `abandoned` from kanban — that stage is only reachable via API patch in Wave 2.

Everything above is queued; the IA is stable so the upgrades drop in without page shuffles.

#!/usr/bin/env bash
set -euo pipefail

# Deploy all 13 Edge Function bundles. Run from repo root (`app/`).
# Requires `supabase` CLI logged in and `supabase link` already done.

BUNDLES=(
  tenants-api
  auth-api
  settings-api
  crm-api
  quotes-api
  projects-api
  ops-api
  invoicing-api
  finance-api
  vendors-api
  inventory-api
  dashboard-api
  exports-api
)

for bundle in "${BUNDLES[@]}"; do
  echo "==> Deploying $bundle"
  supabase functions deploy "$bundle"
done

echo "All 13 functions deployed."

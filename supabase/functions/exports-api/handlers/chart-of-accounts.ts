/**
 * exports-api — /exports/chart_of_accounts CSV stream.
 * Gated on finance.coa.read + finance.chart_of_accounts feature flag.
 */
import { makeExportHandler } from './_factory.ts';

interface CoaRow {
  id: string;
  org_id: string;
  account_code: string;
  label: string;
  account_type: string;
  parent_id: string | null;
  currency_code: string | null;
  description: string | null;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export const exportChartOfAccounts = makeExportHandler<CoaRow>({
  slug: 'chart_of_accounts',
  table: 'chart_of_accounts',
  cols:
    'id, org_id, account_code, label, account_type, parent_id, currency_code, ' +
    'description, is_active, is_system, created_at, updated_at',
  headers: [
    'id',
    'account_code',
    'label',
    'account_type',
    'parent_id',
    'currency_code',
    'description',
    'is_active',
    'is_system',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.account_code,
    r.label,
    r.account_type,
    r.parent_id,
    r.currency_code,
    r.description,
    r.is_active,
    r.is_system,
    r.created_at,
    r.updated_at,
  ],
  cap: 'finance.coa.read',
  flagKey: 'finance.chart_of_accounts',
  // chart_of_accounts has no deleted_at — archive via is_active=false.
  skipSoftDeleteFilter: true,
});

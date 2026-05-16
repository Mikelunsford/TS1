/**
 * exports-api — /exports/warehouses CSV stream.
 * Gated on inventory.warehouses.read + inventory.enabled feature flag.
 */
import { makeExportHandler } from './_factory.ts';

interface WhRow {
  id: string;
  org_id: string;
  code: string;
  label: string;
  address: Record<string, unknown> | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const exportWarehouses = makeExportHandler<WhRow>({
  slug: 'warehouses',
  table: 'warehouses',
  cols: 'id, org_id, code, label, address, is_default, is_active, created_at, updated_at',
  headers: [
    'id',
    'code',
    'label',
    'address',
    'is_default',
    'is_active',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.code,
    r.label,
    r.address,
    r.is_default,
    r.is_active,
    r.created_at,
    r.updated_at,
  ],
  cap: 'inventory.warehouses.read',
  flagKey: 'inventory.enabled',
  // warehouses table has no deleted_at — archive via is_active=false.
  skipSoftDeleteFilter: true,
});

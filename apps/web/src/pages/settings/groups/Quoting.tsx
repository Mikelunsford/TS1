import type { FieldDef } from '@/components/settings/SettingsForm';
import { GroupPage } from './groupShared';

const FIELDS: FieldDef[] = [
  {
    key: 'approval_threshold_cents',
    label: 'Approval threshold (cents)',
    kind: 'cents',
    description: 'Quotes above this total require manager approval. 2500000 = $25,000.',
    validate: (v) =>
      typeof v === 'number' && v >= 0 && Number.isInteger(v) ? null : 'Must be a non-negative integer',
  },
  {
    key: 'default_validity_days',
    label: 'Default validity (days)',
    kind: 'number',
    validate: (v) => (typeof v === 'number' && v >= 0 && v <= 365 ? null : 'Must be 0-365'),
  },
  {
    key: 'auto_convert_on_acceptance',
    label: 'Auto-convert on acceptance',
    kind: 'boolean',
    description: 'When on, accepted quotes immediately become invoices.',
  },
];

export default function QuotingPage() {
  return (
    <GroupPage
      group="quoting"
      title="Quoting"
      description="Approval threshold + quote lifecycle defaults."
      fields={FIELDS}
    />
  );
}

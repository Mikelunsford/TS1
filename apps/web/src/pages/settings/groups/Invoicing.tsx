import type { FieldDef } from '@/components/settings/SettingsForm';
import { GroupPage } from './groupShared';

const FIELDS: FieldDef[] = [
  {
    key: 'default_due_days',
    label: 'Default due days',
    kind: 'number',
    validate: (v) => (typeof v === 'number' && v >= 0 && v <= 365 ? null : 'Must be 0-365'),
  },
  { key: 'default_tax_id', label: 'Default tax ID', kind: 'text' },
  { key: 'default_payment_terms', label: 'Default payment terms', kind: 'text' },
  { key: 'email_subject_template', label: 'Email subject template', kind: 'text', description: 'Available: {{number}}' },
  { key: 'email_body_template', label: 'Email body template', kind: 'textarea', description: 'Available: {{number}}' },
];

export default function InvoicingPage() {
  return (
    <GroupPage
      group="invoicing"
      title="Invoicing"
      description="Defaults applied when creating invoices."
      fields={FIELDS}
    />
  );
}

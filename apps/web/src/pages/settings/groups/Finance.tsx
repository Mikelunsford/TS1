import type { FieldDef } from '@/components/settings/SettingsForm';
import { GroupPage } from './groupShared';

const FIELDS: FieldDef[] = [
  {
    key: 'fiscal_year_start_month',
    label: 'Fiscal year start month (1-12)',
    kind: 'number',
    validate: (v) => (typeof v === 'number' && v >= 1 && v <= 12 ? null : 'Must be 1-12'),
  },
  {
    key: 'default_je_book_after_post',
    label: 'Auto-book journal entry after post',
    kind: 'boolean',
  },
  {
    key: 'auto_reverse_je_on_cancellation',
    label: 'Auto-reverse JE on source cancellation',
    kind: 'boolean',
  },
];

export default function FinancePage() {
  return (
    <GroupPage
      group="finance"
      title="Finance"
      description="GL behavior + period defaults."
      fields={FIELDS}
    />
  );
}

import type { FieldDef } from '@/components/settings/SettingsForm';
import { MoneyFormatPreview } from '@/components/settings/MoneyFormatPreview';
import { GroupPage } from './groupShared';

const FIELDS: FieldDef[] = [
  { key: 'name', label: 'Company name', kind: 'text' },
  { key: 'legal_name', label: 'Legal name', kind: 'text' },
  { key: 'tax_id', label: 'Tax ID', kind: 'text' },
  { key: 'default_currency', label: 'Default currency', kind: 'text', placeholder: 'USD' },
  { key: 'timezone', label: 'Timezone', kind: 'text', placeholder: 'America/Los_Angeles' },
  { key: 'country_code', label: 'Country code', kind: 'text', placeholder: 'US' },
];

export default function CompanyPage() {
  return (
    <GroupPage
      group="company"
      title="Company"
      description="Identity, currency, locale."
      fields={FIELDS}
      extra={(v) => <MoneyFormatPreview currencyCode={(v.default_currency as string) ?? 'USD'} />}
    />
  );
}

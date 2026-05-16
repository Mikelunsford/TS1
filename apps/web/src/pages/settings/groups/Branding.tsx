import type { FieldDef } from '@/components/settings/SettingsForm';
import { GroupPage } from './groupShared';

const FIELDS: FieldDef[] = [
  { key: 'primary_color', label: 'Primary color', kind: 'color' },
  { key: 'accent_color', label: 'Accent color', kind: 'color' },
  { key: 'logo_url', label: 'Logo URL', kind: 'text', placeholder: 'https://…' },
  { key: 'email_footer', label: 'Email footer', kind: 'textarea' },
];

export default function BrandingPage() {
  return (
    <GroupPage
      group="branding"
      title="Branding"
      description="Visual identity applied across the workspace."
      fields={FIELDS}
    />
  );
}

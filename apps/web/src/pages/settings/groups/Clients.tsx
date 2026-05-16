import type { FieldDef } from '@/components/settings/SettingsForm';
import { GroupPage } from './groupShared';

const FIELDS: FieldDef[] = [
  {
    key: 'client_status_options',
    label: 'Client status options',
    kind: 'enum-list',
    description: 'Order matters; first item shown in defaults.',
  },
  {
    key: 'default_client_status',
    label: 'Default client status',
    kind: 'text',
    description: 'Must match one of the values above.',
  },
];

export default function ClientsPage() {
  return (
    <GroupPage
      group="clients"
      title="Clients"
      description="Workflow values used across CRM."
      fields={FIELDS}
    />
  );
}

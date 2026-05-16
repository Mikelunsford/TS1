/**
 * Common loader for Phase 15 group pages.
 */
import { useQuery } from '@tanstack/react-query';

import { settingsKeys } from '@/lib/queryKeys/settings';
import { getSettingsGroup } from '@/lib/services/settingsService';

import { SettingsForm, type FieldDef } from '@/components/settings/SettingsForm';

interface Props {
  group: string;
  title: string;
  description?: string;
  fields: FieldDef[];
  extra?: (values: Record<string, unknown>) => React.ReactNode;
}

export function GroupPage({ group, title, description, fields, extra }: Props) {
  const q = useQuery({
    queryKey: settingsKeys.group(group),
    queryFn: () => getSettingsGroup(group),
    staleTime: 60_000,
  });

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-fg">{title}</h1>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
      </header>
      {q.isLoading ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : q.isError ? (
        <p className="text-sm text-rose-600">Could not load {group} settings.</p>
      ) : (
        <SettingsForm group={group} fields={fields} initialValues={q.data ?? {}}>
          {extra ? extra(q.data ?? {}) : null}
        </SettingsForm>
      )}
    </section>
  );
}

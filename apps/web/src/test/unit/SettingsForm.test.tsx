/**
 * Unit test for <SettingsForm>. Asserts dirty-state, save flow, validation.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/services/settingsService', () => ({
  bulkUpdateSettings: vi.fn().mockResolvedValue({ applied: 1 }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { bulkUpdateSettings } from '@/lib/services/settingsService';
import { SettingsForm, type FieldDef } from '@/components/settings/SettingsForm';

const FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', kind: 'text' },
  {
    key: 'threshold',
    label: 'Threshold',
    kind: 'number',
    validate: (v) => (typeof v === 'number' && v >= 0 ? null : 'Must be ≥0'),
  },
];

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe('<SettingsForm>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with Save disabled and shows Unsaved badge after edit', () => {
    render(
      wrap(
        <SettingsForm
          group="company"
          fields={FIELDS}
          initialValues={{ name: 'Team1', threshold: 0 }}
        />,
      ),
    );
    const save = screen.getByRole('button', { name: /save changes/i });
    expect(save).toBeDisabled();

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Team2' } });

    expect(save).toBeEnabled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('calls bulkUpdateSettings with the diff', async () => {
    render(
      wrap(
        <SettingsForm
          group="company"
          fields={FIELDS}
          initialValues={{ name: 'Team1', threshold: 0 }}
        />,
      ),
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Team2' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(bulkUpdateSettings).toHaveBeenCalledWith([
        { group: 'company', key: 'name', value: 'Team2' },
      ]);
    });
  });

  it('blocks save when a field fails validation', async () => {
    render(
      wrap(
        <SettingsForm
          group="quoting"
          fields={FIELDS}
          initialValues={{ name: 'Team1', threshold: 0 }}
        />,
      ),
    );
    fireEvent.change(screen.getByLabelText('Threshold'), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByText('Must be ≥0')).toBeInTheDocument();
    });
    expect(bulkUpdateSettings).not.toHaveBeenCalled();
  });

  it('Reset returns to initial values', () => {
    render(
      wrap(
        <SettingsForm
          group="company"
          fields={FIELDS}
          initialValues={{ name: 'Team1', threshold: 0 }}
        />,
      ),
    );
    const name = screen.getByLabelText('Name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'NewName' } });
    expect(name.value).toBe('NewName');

    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(name.value).toBe('Team1');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });
});

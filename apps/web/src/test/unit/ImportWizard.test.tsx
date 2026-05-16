/**
 * Unit tests for <ImportWizard> (Phase 20 / Wave 10).
 *
 * The 3-step flow:
 *   1. Upload — file picker drives base64 encode + POST /imports/<entity>
 *   2. Preview — render errors + first-20-row preview; commit disabled
 *      when errors > 0
 *   3. Commit — POST /imports/<entity>/commit then show success toast
 *
 * We mock `apiRequest` so the test asserts behavior without hitting the
 * network. The button-disabled and step transitions are the load-bearing
 * properties (per the spec: "ImportWizard 3-step modal").
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/apiClient', () => ({
  apiRequest: vi.fn(),
  ApiError: class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import { apiRequest } from '@/lib/apiClient';
import { ImportWizard } from '@/components/imports/ImportWizard';

const mockedRequest = vi.mocked(apiRequest);

function fakeFile(content = 'display_name\nAcme Co\n', name = 'customers.csv'): File {
  const file = new File([content], name, { type: 'text/csv' });
  // jsdom's File polyfill omits arrayBuffer; provide one from the bytes we
  // already encoded into the Blob source.
  if (typeof file.arrayBuffer !== 'function') {
    const bytes = new TextEncoder().encode(content);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(buf),
    });
  }
  return file;
}

describe('<ImportWizard>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when open=false', () => {
    render(
      <ImportWizard
        entity="customers"
        open={false}
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the upload step when open=true', () => {
    render(
      <ImportWizard
        entity="customers"
        open
        onClose={() => undefined}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Choose a CSV file/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Validate/i })).toBeDisabled();
  });

  it('moves Upload → Preview after a successful validate call', async () => {
    mockedRequest.mockResolvedValueOnce({
      import_id: '00000000-0000-0000-0000-000000000000',
      errors: [],
      preview: [{ display_name: 'Acme Co' }],
      stats: { total_rows: 1, valid_rows: 1, error_rows: 0 },
    } as unknown as Awaited<ReturnType<typeof apiRequest>>);

    render(
      <ImportWizard
        entity="customers"
        open
        onClose={() => undefined}
      />,
    );

    const fileInput = screen.getByLabelText(/Choose a CSV file/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [fakeFile()] } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Validate/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Parsed/i)).toBeInTheDocument();
    });
    // Commit button enabled because errors is empty.
    expect(screen.getByRole('button', { name: /Commit/i })).not.toBeDisabled();
  });

  it('disables commit when the preview has row errors', async () => {
    mockedRequest.mockResolvedValueOnce({
      import_id: '00000000-0000-0000-0000-000000000000',
      errors: [{ row: 2, field: 'display_name', message: 'required' }],
      preview: [],
      stats: { total_rows: 2, valid_rows: 0, error_rows: 1 },
    } as unknown as Awaited<ReturnType<typeof apiRequest>>);

    render(
      <ImportWizard
        entity="customers"
        open
        onClose={() => undefined}
      />,
    );

    const fileInput = screen.getByLabelText(/Choose a CSV file/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [fakeFile()] } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Validate/i }));
    });

    await waitFor(() => expect(screen.getByText(/Row errors/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Commit/i })).toBeDisabled();
  });

  it('moves Preview → Done and fires onCommitted after a successful commit', async () => {
    // 1st call: preview
    mockedRequest.mockResolvedValueOnce({
      import_id: '00000000-0000-0000-0000-000000000000',
      errors: [],
      preview: [{ display_name: 'Acme Co' }],
      stats: { total_rows: 1, valid_rows: 1, error_rows: 0 },
    } as unknown as Awaited<ReturnType<typeof apiRequest>>);
    // 2nd call: commit
    mockedRequest.mockResolvedValueOnce({
      inserted_count: 1,
      failed_rows: [],
    } as unknown as Awaited<ReturnType<typeof apiRequest>>);

    const onCommitted = vi.fn();

    render(
      <ImportWizard
        entity="customers"
        open
        onClose={() => undefined}
        onCommitted={onCommitted}
      />,
    );

    const fileInput = screen.getByLabelText(/Choose a CSV file/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [fakeFile()] } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Validate/i }));
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Commit/i })).not.toBeDisabled(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Commit/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Imported 1 row/i)).toBeInTheDocument();
    });
    expect(onCommitted).toHaveBeenCalledWith({ inserted_count: 1, failed_rows: [] });
  });
});

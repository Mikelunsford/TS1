/**
 * DateFormatPicker — picks among canonical date formats for org_settings.
 */

interface Props {
  value: string | null | undefined;
  onChange: (next: string) => void;
}

const FORMATS: Array<{ key: string; label: string }> = [
  { key: 'YYYY-MM-DD', label: '2026-05-16 (ISO)' },
  { key: 'MM/DD/YYYY', label: '05/16/2026 (US)' },
  { key: 'DD/MM/YYYY', label: '16/05/2026 (EU)' },
  { key: 'D MMM YYYY', label: '16 May 2026' },
];

export function DateFormatPicker({ value, onChange }: Props) {
  return (
    <select
      className="rounded-md border border-border bg-bg px-2 py-1 text-sm"
      value={value ?? 'YYYY-MM-DD'}
      onChange={(e) => onChange(e.target.value)}
    >
      {FORMATS.map((f) => (
        <option key={f.key} value={f.key}>
          {f.label}
        </option>
      ))}
    </select>
  );
}

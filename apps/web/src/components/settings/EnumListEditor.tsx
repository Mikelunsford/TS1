/**
 * EnumListEditor — edit a flat list of string enum values (e.g.
 * clients.client_status_options). Add/remove rows. Preserves order.
 */
import { useState } from 'react';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
}

export function EnumListEditor({ value, onChange }: Props) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (value.includes(v)) {
      setDraft('');
      return;
    }
    onChange([...value, v]);
    setDraft('');
  };

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {value.map((item, idx) => (
          <li key={`${item}-${idx}`} className="flex items-center gap-2">
            <span className="rounded-md border border-border bg-bg px-2 py-0.5 text-xs">
              {item}
            </span>
            <button
              type="button"
              className="text-xs text-rose-600 hover:underline"
              onClick={() => onChange(value.filter((_, i) => i !== idx))}
            >
              Remove
            </button>
          </li>
        ))}
        {value.length === 0 ? (
          <li className="text-xs text-fg-subtle">No values yet.</li>
        ) : null}
      </ul>
      <div className="flex items-center gap-2">
        <input
          type="text"
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm"
          placeholder="Add value"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs"
          onClick={add}
        >
          Add
        </button>
      </div>
    </div>
  );
}

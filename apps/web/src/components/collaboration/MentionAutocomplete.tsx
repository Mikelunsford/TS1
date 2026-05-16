/**
 * MentionAutocomplete — small combobox shown beneath a comment composer
 * while the user is typing an @-token. Props are minimal: the parent
 * passes the active query and a callback fired when the user picks one.
 *
 * Phase 16 (Wave 10 Session 2) — B1 owns this block.
 */
import { useQuery } from '@tanstack/react-query';

import { collaborationKeys } from '@/lib/queryKeys/collaboration';
import {
  autocompleteMentions,
  type MentionUser,
} from '@/lib/services/collaborationService';

interface Props {
  query: string;
  open: boolean;
  onPick: (user: MentionUser) => void;
}

export function MentionAutocomplete({ query, open, onPick }: Props) {
  const q = useQuery({
    queryKey: collaborationKeys.mentions(query),
    queryFn: () => autocompleteMentions(query),
    enabled: open,
    staleTime: 30_000,
  });

  if (!open) return null;

  const items = q.data?.items ?? [];
  return (
    <ul
      role="listbox"
      aria-label="Mention suggestions"
      className="absolute z-10 mt-1 max-h-56 w-64 overflow-auto rounded-md border border-border bg-bg p-1 shadow-lg"
    >
      {q.isLoading && (
        <li className="px-2 py-1 text-xs text-fg-muted">Searching…</li>
      )}
      {!q.isLoading && items.length === 0 && (
        <li className="px-2 py-1 text-xs text-fg-muted">No matches</li>
      )}
      {items.map((u) => (
        <li key={u.user_id}>
          <button
            type="button"
            role="option"
            aria-selected="false"
            onClick={() => onPick(u)}
            className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-sm hover:bg-bg-subtle focus:bg-bg-subtle focus:outline-none"
          >
            <span className="truncate font-medium">{u.display_name ?? u.email ?? u.user_id}</span>
            {u.display_name && u.email && (
              <span className="ml-2 truncate text-xs text-fg-subtle">{u.email}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * GlobalSearchBar (Phase 17 — Wave 10 Session 2 / Agent B2).
 *
 * Top-bar federated search input with Cmd/Ctrl+K shortcut. Debounced
 * (250 ms) query against /search-api/search. Results dropdown is grouped
 * by entity type with arrow-key navigation and Enter to navigate.
 *
 * Wired into AppShell.tsx — see anchor block there.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

import { useGlobalSearchHotkey } from '@/lib/hooks/useGlobalSearchHotkey';
import { searchKeys } from '@/lib/queryKeys/search';
import { globalSearch, type SearchHit } from '@/lib/services/searchService';

const DEBOUNCE_MS = 250;

function useDebounced<T>(value: T, ms = DEBOUNCE_MS): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

interface Group {
  type: string;
  label: string;
  items: SearchHit[];
}

const TYPE_LABELS: Record<string, string> = {
  customer: 'Customers',
  vendor: 'Vendors',
  lead: 'Leads',
  opportunity: 'Opportunities',
  quote: 'Quotes',
  project: 'Projects',
  invoice: 'Invoices',
  payment: 'Payments',
  credit_note: 'Credit Notes',
  expense: 'Expenses',
  vendor_bill: 'Vendor Bills',
  purchase_order: 'Purchase Orders',
  item: 'Items',
  journal_entry: 'Journal Entries',
};

export function GlobalSearchBar() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const debouncedQ = useDebounced(q);

  const query = useQuery({
    queryKey: searchKeys.global(debouncedQ),
    queryFn: () => globalSearch({ q: debouncedQ }),
    enabled: open && debouncedQ.trim().length >= 2,
    staleTime: 30_000,
  });

  const items = useMemo(() => query.data?.items ?? [], [query.data]);

  const groups = useMemo<Group[]>(() => {
    const byType = new Map<string, SearchHit[]>();
    for (const it of items) {
      const arr = byType.get(it.type) ?? [];
      arr.push(it);
      byType.set(it.type, arr);
    }
    return Array.from(byType.entries()).map(([type, arr]) => ({
      type,
      label: TYPE_LABELS[type] ?? type,
      items: arr,
    }));
  }, [items]);

  const trigger = useCallback(() => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useGlobalSearchHotkey(trigger);

  // Click-outside closes dropdown.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Reset active index when items change.
  useEffect(() => {
    setActiveIdx(0);
  }, [items.length]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, items.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const hit = items[activeIdx];
      if (hit) {
        navigate(hit.url_path);
        setOpen(false);
        setQ('');
      }
    }
  }

  // Flatten groups for index-based selection.
  const flatIndex: SearchHit[] = useMemo(
    () => groups.flatMap((g) => g.items),
    [groups],
  );

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search (Ctrl+K)"
          aria-label="Global search"
          data-global-search="true"
          className="h-8 w-full rounded-md border border-border bg-bg-subtle pl-8 pr-2 text-sm placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>
      {open && q.trim().length >= 2 && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-1 w-[28rem] max-h-[60vh] overflow-y-auto rounded-md border border-border bg-bg shadow-lg"
        >
          {query.isLoading && (
            <div className="px-3 py-2 text-sm text-fg-muted">Searching…</div>
          )}
          {!query.isLoading && flatIndex.length === 0 && (
            <div className="px-3 py-2 text-sm text-fg-muted">
              No results for &ldquo;{q}&rdquo;
            </div>
          )}
          {groups.map((g) => (
            <div key={g.type} className="py-1">
              <div className="px-3 py-1 text-xs uppercase tracking-wide text-fg-subtle">
                {g.label}
              </div>
              <ul>
                {g.items.map((hit) => {
                  const idx = flatIndex.indexOf(hit);
                  const active = idx === activeIdx;
                  return (
                    <li key={`${hit.type}:${hit.id}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIdx(idx)}
                        onClick={() => {
                          navigate(hit.url_path);
                          setOpen(false);
                          setQ('');
                        }}
                        className={
                          'flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-bg-subtle ' +
                          (active ? 'bg-bg-subtle' : '')
                        }
                      >
                        <span className="flex-1">
                          <span className="block font-medium">
                            {hit.display_name}
                          </span>
                          {hit.snippet && (
                            <span className="block text-xs text-fg-muted">
                              {hit.snippet}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

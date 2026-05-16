/**
 * useGlobalSearchHotkey (Phase 17). Listens for Cmd/Ctrl+K and invokes a
 * callback (typically: focus the GlobalSearchBar input or open its dropdown).
 *
 * Per modern SPA convention (linear, Notion, GitHub) Cmd+K is the universal
 * "open command palette / search" hotkey. We register at the window level
 * with `capture: true` so it preempts page-level handlers, and we ignore
 * the keystroke when focus is inside a form input that already has a value
 * (typing 'K' in a textarea should stay in the textarea).
 */

import { useEffect } from 'react';

export function useGlobalSearchHotkey(onTrigger: () => void): void {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      if (e.key.toLowerCase() !== 'k') return;
      // Don't intercept if user is typing in another form field that already
      // bound Cmd+K (e.g. a rich-text editor). We only steal if the active
      // element isn't an input/textarea OR is empty.
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName.toLowerCase();
      if (
        active &&
        (tag === 'input' || tag === 'textarea') &&
        (active as HTMLInputElement).value
      ) {
        // Allow Cmd+K from inside a non-empty input only if it's the search
        // bar itself (data-global-search="true"); otherwise let the input
        // keep focus.
        if (active.getAttribute('data-global-search') !== 'true') return;
      }
      e.preventDefault();
      e.stopPropagation();
      onTrigger();
    }
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [onTrigger]);
}

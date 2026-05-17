/**
 * useImpersonation — Phase 23 (Wave 10 Session 4).
 *
 * Tracks the active impersonation session for the current browser tab.
 * The session_id is persisted to sessionStorage so a page reload doesn't
 * lose the banner; the JWT's `impersonated_by` claim is the second source
 * of truth and would suffice on its own, but storing session_id locally
 * gives the "Stop impersonating" button the correct argument without an
 * extra round trip.
 */
import { useEffect, useState } from 'react';

const KEY = 'team1.adminConsole.impersonation';

export interface ImpersonationSession {
  sessionId: string;
  impersonatedUserId: string;
  impersonatedEmail: string | null;
  orgId: string;
  startedAt: string;
  // Wave 11 (R-W10-P23-OBS-01) — ISO timestamp; the banner auto-ends the
  // session when this elapses. Optional so older sessionStorage payloads
  // don't break the deserializer on first paint after deploy.
  expiresAt?: string;
}

export interface UseImpersonation {
  isImpersonating: boolean;
  session: ImpersonationSession | null;
  setSession: (s: ImpersonationSession) => void;
  clear: () => void;
}

function read(): ImpersonationSession | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ImpersonationSession;
  } catch {
    return null;
  }
}

export function useImpersonation(): UseImpersonation {
  const [session, setSessionState] = useState<ImpersonationSession | null>(() => read());

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === KEY) {
        setSessionState(read());
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return {
    isImpersonating: !!session,
    session,
    setSession: (s) => {
      window.sessionStorage.setItem(KEY, JSON.stringify(s));
      setSessionState(s);
    },
    clear: () => {
      window.sessionStorage.removeItem(KEY);
      setSessionState(null);
    },
  };
}

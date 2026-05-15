import { useMe } from './useMe';
import type { Role } from '../types';

/**
 * Returns the caller's active role on the active org, or null if no me data
 * yet or no active membership. Thin wrapper over `useMe()` so cap-gated
 * buttons don't all duplicate the lookup.
 */
export function useActiveRole(): Role | null {
  const me = useMe();
  return me.data?.active_role ?? null;
}

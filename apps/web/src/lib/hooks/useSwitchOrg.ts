import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { switchOrg } from '../services/authService';
import { supabase } from '../supabase';

/**
 * Workspace-switcher mutation. After the server stamps the JWT claim, we
 * call `refreshSession()` so the client picks up the new token, then
 * invalidate the TanStack Query cache wholesale so any cached per-org
 * data is dropped.
 */
export function useSwitchOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orgId: string) => switchOrg(orgId),
    onSuccess: async () => {
      await supabase.auth.refreshSession();
      await qc.invalidateQueries();
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Workspace switch failed');
    },
  });
}

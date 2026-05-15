/**
 * Role -> capability set.
 *
 * Full matrix lands in Wave 1 from TS1/07-architecture/04-AUTH-RBAC.md.
 * Wave 0 ships a placeholder with all roles present and empty capability
 * sets. The `can()` helper is defensive: it returns `false` for every
 * non-org_owner caller until the matrix is populated, so SPA gating code
 * can wire up without granting accidental access.
 *
 * The SPA mirror lives at apps/web/src/lib/capabilities.ts and the parity
 * test will start blocking CI in Wave 1.
 */

import type { Role } from './types.ts';

export type Capability = string;

export const RoleCapabilities: Record<Role, Set<Capability>> = {
  org_owner: new Set<Capability>([
    // Wave 1+ enumerates the full set. Wave 0 leaves owner-only as the
    // implicit "allow" path for any capability check via `can()` below.
  ]),
  org_admin: new Set<Capability>([]),
  manager: new Set<Capability>([]),
  staff: new Set<Capability>([]),
  customer_user: new Set<Capability>([]),
  vendor: new Set<Capability>([]),
};

/**
 * Defensive Wave 0 check: org_owner can do anything; everyone else is denied
 * until the matrix is populated in Wave 1.
 */
export function can(role: Role | null, _capability: Capability): boolean {
  if (role === 'org_owner') return true;
  return false;
}

export {};

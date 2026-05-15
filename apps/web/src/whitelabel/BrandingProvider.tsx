import { useEffect, type ReactNode } from 'react';

import { useBranding } from '@/lib/hooks/useBranding';
import { useAuth } from '@/auth/AuthContext';

/**
 * BrandingProvider — applies the active org's brand tokens to the SPA at
 * runtime. Reads from `useBranding()` (which calls
 * `GET /tenants-api/branding`), converts the hex strings to `r g b`
 * triplets that the existing token system in index.css consumes, and
 * writes them to `document.documentElement.style`. Also updates
 * `document.title` from `app_name_override` and swaps the favicon if a
 * tenant logo is configured.
 *
 * Design choice: this is purely additive on top of the platform-default
 * tokens in index.css. If the API fails or the user is unauthenticated,
 * the defaults stay in place (no flash to white).
 *
 * Whitelabel substrate per TS1/07-architecture/03-WHITELABEL-MODEL.md.
 */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const isAuthed = state.status === 'authenticated';
  const { data } = useBranding({ enabled: isAuthed });

  useEffect(() => {
    if (!data) return;
    const root = document.documentElement;
    const brand = hexToRgbTriplet(data.primary_color);
    const accent = hexToRgbTriplet(data.accent_color);
    const brandFg = hexToRgbTriplet(data.on_primary);
    if (brand) root.style.setProperty('--brand', brand);
    if (accent) root.style.setProperty('--accent', accent);
    if (brandFg) root.style.setProperty('--brand-fg', brandFg);

    const appName = data.app_name_override ?? 'Team1';
    document.title = appName;

    const favHref = data.icon_url ?? data.logo_url;
    if (favHref) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = favHref;
    }
  }, [data]);

  return <>{children}</>;
}

/**
 * Convert `#0F172A` → `15 23 42` (the triplet format the index.css token
 * system expects so `rgb(var(--brand) / <alpha>)` can layer opacity).
 * Returns null on malformed input rather than throwing.
 */
function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([a-f0-9]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 0xff} ${(n >> 8) & 0xff} ${n & 0xff}`;
}

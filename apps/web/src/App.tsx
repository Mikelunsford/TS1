import { AppRoutes } from './routes';
import { BrandingProvider } from './whitelabel/BrandingProvider';

/**
 * Wave 1 shell. The BrandingProvider wraps the whole router so any route —
 * including /login — picks up the active org's brand tokens once the user
 * is authenticated. Public routes (login, auth callback, 404) render
 * without the AppShell chrome; AppShell is composed inside
 * <ProtectedRoute /> so it only mounts for authed users with an active org.
 */
export function App() {
  return (
    <BrandingProvider>
      <AppRoutes />
    </BrandingProvider>
  );
}

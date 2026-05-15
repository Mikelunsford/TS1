import { AppRoutes } from './routes';

/**
 * Wave 0 placeholder shell. The real layout (Topbar, Sidebar, Main, Right rail)
 * ships in Wave 1 (Identity & Tenancy). For now this is just the router outlet
 * wrapped in a minimal Tailwind chrome so the build is provably runnable.
 */
export function App() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <AppRoutes />
    </div>
  );
}

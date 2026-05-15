import type { ReactNode } from 'react';

import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/**
 * Authenticated app chrome. Lays out Topbar across the top, Sidebar on the
 * left, and the route content in the main area. Public routes (/login,
 * /auth/callback) wrap their content directly in <main> and do not use
 * AppShell.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <Topbar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

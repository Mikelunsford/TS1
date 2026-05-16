/**
 * Landing page shown when a route gated by <RequireFlag> is disabled.
 */
import { useSearchParams } from 'react-router-dom';

export default function FeatureUnavailable() {
  const [params] = useSearchParams();
  const flag = params.get('flag');

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="mb-2 text-xl font-semibold text-fg">Feature unavailable</h1>
      <p className="text-sm text-fg-muted">
        This feature isn&apos;t enabled for your workspace.
        {flag ? <span className="block mt-2 text-xs text-fg-subtle">({flag})</span> : null}
      </p>
      <p className="mt-4 text-sm text-fg-muted">Contact your workspace admin to enable it.</p>
    </div>
  );
}

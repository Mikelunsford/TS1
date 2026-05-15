import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <p className="font-mono text-fg-subtle">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link to="/" className="text-sm text-brand hover:underline">
        Back to home
      </Link>
    </main>
  );
}

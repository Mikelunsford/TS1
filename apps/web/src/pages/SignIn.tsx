import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { supabase } from '@/lib/supabase';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const fn =
        mode === 'signin'
          ? supabase.auth.signInWithPassword({ email, password })
          : supabase.auth.signUp({ email, password });
      const { error } = await fn;
      if (error) {
        toast.error(error.message);
        return;
      }
      if (mode === 'signup') {
        toast.success('Check your email to confirm your account.');
      } else {
        navigate('/', { replace: true });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-muted px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-bg p-6 shadow-sm"
      >
        <header className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">TS1</h1>
          <p className="text-sm text-fg-muted">
            {mode === 'signin' ? 'Sign in to continue' : 'Create an account'}
          </p>
        </header>

        <label className="block space-y-1 text-sm">
          <span className="text-fg-muted">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="block w-full rounded-md border border-border bg-bg px-3 py-2 focus:border-brand focus:outline-none"
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-fg-muted">Password</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="block w-full rounded-md border border-border bg-bg px-3 py-2 focus:border-brand focus:outline-none"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-fg disabled:opacity-60"
        >
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
        </button>

        <button
          type="button"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          className="block w-full text-center text-xs text-fg-muted hover:text-fg"
        >
          {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have one? Sign in'}
        </button>
      </form>
    </main>
  );
}

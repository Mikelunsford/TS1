import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';

export default function AuthCallback() {
  const { state } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (state.status === 'authenticated') {
      navigate('/', { replace: true });
    } else if (state.status === 'unauthenticated') {
      navigate('/login', { replace: true });
    }
  }, [state, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center text-fg-muted">
      Completing sign-in…
    </main>
  );
}

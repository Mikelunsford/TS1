/**
 * EnrollMfaPage — Wave 11 (R-W10-P23-OBS-02).
 *
 * Walks a platform admin through TOTP enrollment:
 *   1. supabase.auth.mfa.enroll({factorType:'totp'}) → factor id + QR svg + otpauth URL
 *   2. User scans QR (or copies otpauth URL into authenticator app)
 *   3. User types a 6-digit code → mfa.challenge + mfa.verify
 *   4. On success, invalidates ['admin','me'] so AdminShell re-checks and lets
 *      the admin into /admin. Redirects to /admin?mfa=verified.
 *
 * Standalone page (no AdminShell) because the shell otherwise redirects users
 * without MFA to *this* page — using AdminShell would cause a render loop the
 * very first time. Keep this page lightweight and self-contained.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';

import { supabase } from '@/lib/supabase';

interface EnrollState {
  factorId: string;
  qrSvg: string | null;
  uri: string | null;
  secret: string | null;
}

export default function EnrollMfaPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [enroll, setEnroll] = useState<EnrollState | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kick off enrollment on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Some users may already have an unverified factor from a prior attempt.
      // Reuse it rather than create a duplicate (mfa.enroll throws otherwise).
      const list = await supabase.auth.mfa.listFactors();
      const existing = list.data?.totp?.find((f) => f.status === 'unverified');
      if (existing) {
        if (!cancelled) {
          setEnroll({
            factorId: existing.id,
            qrSvg: null,
            uri: null,
            secret: null,
          });
        }
        return;
      }
      const { data, error: e } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (cancelled) return;
      if (e || !data) {
        setError(e?.message ?? 'enrollment failed');
        return;
      }
      const totp = (data as { totp?: { qr_code?: string; secret?: string; uri?: string } }).totp ?? {};
      setEnroll({
        factorId: data.id,
        qrSvg: typeof totp.qr_code === 'string' ? totp.qr_code : null,
        uri: typeof totp.uri === 'string' ? totp.uri : null,
        secret: typeof totp.secret === 'string' ? totp.secret : null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onVerify() {
    if (!enroll || code.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId: enroll.factorId });
      if (challenge.error || !challenge.data) {
        throw new Error(challenge.error?.message ?? 'challenge failed');
      }
      const verify = await supabase.auth.mfa.verify({
        factorId: enroll.factorId,
        challengeId: challenge.data.id,
        code,
      });
      if (verify.error) throw new Error(verify.error.message);
      // Force AdminShell to re-fetch /admin/me with mfa_verified=true.
      await qc.invalidateQueries({ queryKey: ['admin', 'me'] });
      navigate('/admin?mfa=verified', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'verification failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-950 px-4 py-12 text-slate-100">
      <div className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-amber-400" />
          <h1 className="text-lg font-semibold">Enroll a TOTP factor</h1>
        </div>
        <p className="mb-4 text-sm text-slate-300">
          Platform admin access requires a verified two-factor authenticator. Scan the QR with
          your authenticator app (1Password, Authy, Google Authenticator), then enter the 6-digit
          code below.
        </p>
        {!enroll && !error && <div className="text-sm text-slate-400">Preparing enrollment…</div>}
        {enroll && (
          <>
            {enroll.qrSvg ? (
              <div
                aria-label="MFA QR code"
                className="mx-auto mb-3 max-w-[220px] rounded bg-white p-2"
                // qr_code is a sanitized SVG string from Supabase; embedding is safe.
                dangerouslySetInnerHTML={{ __html: enroll.qrSvg }}
              />
            ) : (
              <div className="mb-3 rounded border border-slate-700 bg-slate-950 p-3 text-xs text-slate-400">
                Resuming previous unverified enrollment — open your authenticator app and use the
                code for the existing entry.
              </div>
            )}
            {enroll.uri && (
              <details className="mb-3 text-xs text-slate-400">
                <summary className="cursor-pointer">Can&apos;t scan? Copy this URL</summary>
                <code className="mt-1 block break-all rounded bg-slate-950 p-2 text-[10px]">
                  {enroll.uri}
                </code>
              </details>
            )}
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
              6-digit code
            </label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-lg tracking-widest text-slate-100"
              data-testid="mfa-code-input"
            />
            <button
              type="button"
              onClick={onVerify}
              disabled={busy || code.length < 6}
              className="mt-4 w-full rounded-md bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
              data-testid="mfa-verify-button"
            >
              {busy ? 'Verifying…' : 'Verify and enable'}
            </button>
          </>
        )}
        {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
      </div>
    </div>
  );
}

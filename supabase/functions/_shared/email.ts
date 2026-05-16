/**
 * Email provider abstraction — Phase 19 (Wave 10 Session 3).
 *
 * Replaces the Wave-0 placeholder `_shared/mailer.ts` (which throws).
 * Internal call sites should import from here, not from `mailer.ts`.
 *
 * Provider selection: read `org_settings (org_id, group='email', key='provider')`.
 * Default is `resend` per the architecture §0 lock-in. Supported providers:
 *
 *   - resend     POST https://api.resend.com/emails              uses RESEND_API_KEY
 *   - postmark   POST https://api.postmarkapp.com/email           uses POSTMARK_API_KEY
 *   - sendgrid   POST https://api.sendgrid.com/v3/mail/send       uses SENDGRID_API_KEY
 *   - smtp       generic SMTP via denomailer                       uses SMTP_HOST/USER/PASSWORD
 *
 * Error model:
 *   - `EmailConfigError`  — provider env var missing / from_address missing.
 *     Caller treats as permanent (do not retry; the row needs admin fix).
 *   - `EmailSendError`    — upstream HTTP failure.
 *     Caller may retry; carries provider, status_code, body.
 *
 * Wire shape returned: { provider, provider_id, sent_at }.
 */

import type { SupabaseClient } from './supabase-admin.ts';

export type EmailProvider = 'resend' | 'postmark' | 'sendgrid' | 'smtp';

export interface SendEmailInput {
  /** Recipient envelope address(es). Single string accepted; converted to [string]. */
  to: string | string[];
  /** Optional CC. */
  cc?: string[];
  /** Optional BCC. */
  bcc?: string[];
  /** "Name <addr@host>" or "addr@host". If absent, falls back to org_settings.email.from_address. */
  from?: string;
  /** Reply-To header. Falls back to org_settings.email.reply_to. */
  reply_to?: string;
  subject: string;
  /** At least one of html / text required. */
  html?: string;
  text?: string;
  /** Optional attachments (PDFs etc.). */
  attachments?: Array<{
    filename: string;
    content_base64: string;
    content_type?: string;
  }>;
}

export interface SendEmailResult {
  provider: EmailProvider;
  provider_id: string;
  sent_at: string;
}

export class EmailConfigError extends Error {
  constructor(message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = 'EmailConfigError';
  }
}

export class EmailSendError extends Error {
  constructor(
    message: string,
    public provider: EmailProvider,
    public status_code: number,
    public body: unknown,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

interface ResolvedEmailSettings {
  provider: EmailProvider;
  from_address: string | null;
  from_name: string | null;
  reply_to: string | null;
}

/**
 * Read the org's email settings from `org_settings`. Returns provider defaults
 * if individual keys are absent.
 */
export async function resolveEmailSettings(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ResolvedEmailSettings> {
  const { data, error } = await supabase
    .from('org_settings')
    .select('"group", key, value')
    .eq('org_id', orgId)
    .eq('group', 'email');
  if (error) {
    throw new EmailConfigError('org_settings email read failed', {
      detail: error.message,
      org_id: orgId,
    });
  }
  const settings: Record<string, unknown> = {};
  for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
    settings[row.key] = row.value;
  }
  const provider = (settings.provider as EmailProvider | undefined) ?? 'resend';
  if (!['resend', 'postmark', 'sendgrid', 'smtp'].includes(provider)) {
    throw new EmailConfigError(`Unknown email provider '${provider}'`, { org_id: orgId });
  }
  return {
    provider,
    from_address: (settings.from_address as string | null | undefined) ?? null,
    from_name: (settings.from_name as string | null | undefined) ?? null,
    reply_to: (settings.reply_to as string | null | undefined) ?? null,
  };
}

function formatFrom(address: string | null, name: string | null): string | null {
  if (!address) return null;
  if (!name) return address;
  return `${name} <${address}>`;
}

function normalizeTo(to: string | string[]): string[] {
  return Array.isArray(to) ? to : [to];
}

/**
 * Send an email via the configured provider for `orgId`.
 *
 * Throws EmailConfigError if provider keys / from address are missing.
 * Throws EmailSendError on upstream non-2xx.
 */
export async function sendEmail(
  supabase: SupabaseClient,
  orgId: string,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  if (!input.html && !input.text) {
    throw new EmailConfigError('sendEmail requires at least one of html|text');
  }

  const settings = await resolveEmailSettings(supabase, orgId);
  const from = input.from ?? formatFrom(settings.from_address, settings.from_name);
  if (!from) {
    throw new EmailConfigError(
      'org has no email.from_address configured (settings → email)',
      { org_id: orgId },
    );
  }
  const replyTo = input.reply_to ?? settings.reply_to ?? undefined;
  const toList = normalizeTo(input.to);

  switch (settings.provider) {
    case 'resend':
      return await sendViaResend({ ...input, to: toList, from, reply_to: replyTo });
    case 'postmark':
      return await sendViaPostmark({ ...input, to: toList, from, reply_to: replyTo });
    case 'sendgrid':
      return await sendViaSendgrid({ ...input, to: toList, from, reply_to: replyTo });
    case 'smtp':
      return await sendViaSmtp({ ...input, to: toList, from, reply_to: replyTo });
    default:
      throw new EmailConfigError(`Unhandled provider '${settings.provider as string}'`);
  }
}

// ---------- Resend ----------------------------------------------------------
interface NormalizedInput extends Omit<SendEmailInput, 'to'> {
  to: string[];
  from: string;
  reply_to?: string;
}

async function sendViaResend(input: NormalizedInput): Promise<SendEmailResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    throw new EmailConfigError('RESEND_API_KEY is not set in Edge Function env');
  }
  const body: Record<string, unknown> = {
    from: input.from,
    to: input.to,
    subject: input.subject,
  };
  if (input.cc?.length) body.cc = input.cc;
  if (input.bcc?.length) body.bcc = input.bcc;
  if (input.reply_to) body.reply_to = input.reply_to;
  if (input.html) body.html = input.html;
  if (input.text) body.text = input.text;
  if (input.attachments?.length) {
    body.attachments = input.attachments.map((a) => ({
      filename: a.filename,
      content: a.content_base64,
      content_type: a.content_type,
    }));
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  if (!res.ok) {
    throw new EmailSendError(`resend send failed (${res.status})`, 'resend', res.status, parsed);
  }
  const id = (parsed as { id?: string } | null)?.id ?? '';
  return { provider: 'resend', provider_id: id, sent_at: new Date().toISOString() };
}

// ---------- Postmark --------------------------------------------------------
async function sendViaPostmark(input: NormalizedInput): Promise<SendEmailResult> {
  const apiKey = Deno.env.get('POSTMARK_API_KEY');
  if (!apiKey) {
    throw new EmailConfigError('POSTMARK_API_KEY is not set in Edge Function env');
  }
  const body: Record<string, unknown> = {
    From: input.from,
    To: input.to.join(','),
    Subject: input.subject,
    MessageStream: 'outbound',
  };
  if (input.cc?.length) body.Cc = input.cc.join(',');
  if (input.bcc?.length) body.Bcc = input.bcc.join(',');
  if (input.reply_to) body.ReplyTo = input.reply_to;
  if (input.html) body.HtmlBody = input.html;
  if (input.text) body.TextBody = input.text;
  if (input.attachments?.length) {
    body.Attachments = input.attachments.map((a) => ({
      Name: a.filename,
      Content: a.content_base64,
      ContentType: a.content_type ?? 'application/octet-stream',
    }));
  }
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  if (!res.ok) {
    throw new EmailSendError(`postmark send failed (${res.status})`, 'postmark', res.status, parsed);
  }
  const id = (parsed as { MessageID?: string } | null)?.MessageID ?? '';
  return { provider: 'postmark', provider_id: id, sent_at: new Date().toISOString() };
}

// ---------- SendGrid --------------------------------------------------------
async function sendViaSendgrid(input: NormalizedInput): Promise<SendEmailResult> {
  const apiKey = Deno.env.get('SENDGRID_API_KEY');
  if (!apiKey) {
    throw new EmailConfigError('SENDGRID_API_KEY is not set in Edge Function env');
  }
  const personalizations: Record<string, unknown> = {
    to: input.to.map((e) => ({ email: e })),
  };
  if (input.cc?.length) personalizations.cc = input.cc.map((e) => ({ email: e }));
  if (input.bcc?.length) personalizations.bcc = input.bcc.map((e) => ({ email: e }));
  const content: Array<{ type: string; value: string }> = [];
  if (input.text) content.push({ type: 'text/plain', value: input.text });
  if (input.html) content.push({ type: 'text/html', value: input.html });
  const body: Record<string, unknown> = {
    personalizations: [personalizations],
    from: parseFromForSendgrid(input.from),
    subject: input.subject,
    content,
  };
  if (input.reply_to) body.reply_to = { email: input.reply_to };
  if (input.attachments?.length) {
    body.attachments = input.attachments.map((a) => ({
      filename: a.filename,
      content: a.content_base64,
      type: a.content_type ?? 'application/octet-stream',
      disposition: 'attachment',
    }));
  }
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
    throw new EmailSendError(`sendgrid send failed (${res.status})`, 'sendgrid', res.status, parsed);
  }
  // SendGrid returns 202 with empty body. Use X-Message-Id when present.
  const id = res.headers.get('x-message-id') ?? '';
  return { provider: 'sendgrid', provider_id: id, sent_at: new Date().toISOString() };
}

function parseFromForSendgrid(from: string): { email: string; name?: string } {
  // "Name <email@host>" or "email@host"
  const m = /^\s*(.+?)\s*<\s*([^>]+)\s*>\s*$/.exec(from);
  if (m) return { name: m[1], email: m[2] };
  return { email: from };
}

// ---------- SMTP (denomailer) ----------------------------------------------
async function sendViaSmtp(input: NormalizedInput): Promise<SendEmailResult> {
  const host = Deno.env.get('SMTP_HOST');
  const port = Deno.env.get('SMTP_PORT');
  const user = Deno.env.get('SMTP_USER');
  const pass = Deno.env.get('SMTP_PASSWORD');
  if (!host || !user || !pass) {
    throw new EmailConfigError('SMTP_HOST / SMTP_USER / SMTP_PASSWORD must all be set');
  }

  // denomailer is the standard Deno-friendly SMTP client. Pinned via esm.sh
  // mirror to match our existing pinning convention (no separate import_map
  // entry needed; the URL is the version pin).
  const { SMTPClient } = await import(
    'https://deno.land/x/denomailer@1.6.0/mod.ts'
  );
  const client = new SMTPClient({
    connection: {
      hostname: host,
      port: port ? Number(port) : 587,
      tls: true,
      auth: { username: user, password: pass },
    },
  });
  try {
    await client.send({
      from: input.from,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      replyTo: input.reply_to,
      subject: input.subject,
      content: input.text ?? '',
      html: input.html,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        encoding: 'base64',
        content: a.content_base64,
        contentType: a.content_type,
      })) as never,
    });
  } catch (e) {
    throw new EmailSendError(
      `smtp send failed: ${e instanceof Error ? e.message : String(e)}`,
      'smtp',
      0,
      { detail: e instanceof Error ? e.message : String(e) },
    );
  } finally {
    await client.close().catch(() => undefined);
  }
  // SMTP has no provider message id; synthesize one.
  return {
    provider: 'smtp',
    provider_id: `smtp-${crypto.randomUUID()}`,
    sent_at: new Date().toISOString(),
  };
}

export {};

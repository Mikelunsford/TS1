/**
 * Provider-agnostic mailer.
 *
 * Default driver is Resend (TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §0
 * lock-in). The driver is selectable per-org via
 * `org_settings.mailer.driver` ('resend' | 'smtp').
 *
 * Wave 0 placeholder. Wave 1+ wires the Resend SDK and the SMTP fallback.
 */

export interface SendMailOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  from?: string;
  subject: string;
  body_html?: string;
  body_text?: string;
  attachments?: Array<{ filename: string; content: Uint8Array; content_type?: string }>;
}

export interface SendMailResult {
  message_id: string;
  provider: 'resend' | 'smtp';
}

export async function sendMail(_opts: SendMailOptions): Promise<SendMailResult> {
  throw new Error('Mailer ships in Wave 1');
}

export {};

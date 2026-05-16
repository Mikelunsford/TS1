/**
 * notifications-worker — POST /drain
 *
 * Cron-driven worker. pg_cron job 'notifications-worker-drain' (migration
 * 0070) hits this endpoint every minute. Authenticated via shared secret:
 *   - The cron job reads `app.notifications_worker_secret` GUC and sends
 *     it as the `X-Worker-Secret` header.
 *   - This handler verifies it matches `NOTIFICATIONS_WORKER_SECRET` env.
 *
 * Drain loop:
 *   1. SELECT up to 50 notifications WHERE channel='email' AND
 *      delivered_at IS NULL AND failed_at IS NULL ORDER BY created_at ASC.
 *   2. For each: resolve recipient email -> build subject+body -> sendEmail.
 *   3. UPDATE delivered_at on success; UPDATE failed_at + failure_reason
 *      on EmailSendError. EmailConfigError marks failed (won't retry).
 *
 * verify_jwt = false (config.toml) — pg_cron can't authenticate via JWT.
 * Shared-secret auth is enforced in the handler.
 */

import { admin } from '../../_shared/handler-helpers.ts';
import { ApiError, ok } from '../../_shared/responses.ts';
import { sendEmail, EmailConfigError, EmailSendError } from '../../_shared/email.ts';
import { info, error as logError } from '../../_shared/logger.ts';
import type { Ctx } from '../../_shared/route.ts';

const BATCH_SIZE = 50;

interface DrainCandidate {
  id: string;
  org_id: string | null;
  event_type: string;
  recipient_user_id: string;
  entity_type: string | null;
  entity_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

function verifyWorkerSecret(req: Request): void {
  const provided = req.headers.get('x-worker-secret');
  const expected = Deno.env.get('NOTIFICATIONS_WORKER_SECRET');
  if (!expected) {
    // Safe-by-default: if the env isn't configured yet, refuse every call.
    throw new ApiError(
      'UNAUTHORIZED',
      'notifications-worker is not configured (NOTIFICATIONS_WORKER_SECRET missing)',
      503,
    );
  }
  if (!provided || provided !== expected) {
    throw new ApiError('UNAUTHORIZED', 'invalid worker secret', 401);
  }
}

function describe(n: DrainCandidate): { subject: string; html: string; text: string } {
  const excerpt = (n.payload as { body_excerpt?: string } | undefined)?.body_excerpt ?? '';
  const entity = n.entity_type ?? 'item';
  switch (n.event_type) {
    case 'comment.mention':
      return {
        subject: `You were mentioned on a ${entity}`,
        html: `<p>You were mentioned in a comment.</p><blockquote>${escapeHtml(excerpt)}</blockquote>`,
        text: `You were mentioned in a comment.\n\n${excerpt}`,
      };
    case 'comment.reply':
      return {
        subject: `Reply to your comment on a ${entity}`,
        html: `<p>Someone replied to your comment.</p><blockquote>${escapeHtml(excerpt)}</blockquote>`,
        text: `Someone replied to your comment.\n\n${excerpt}`,
      };
    case 'attachment.added':
      return {
        subject: `A file was added to a ${entity}`,
        html: `<p>A new file was attached.</p>`,
        text: `A new file was attached.`,
      };
    case 'invoice.sent':
      return {
        subject: 'You have received an invoice',
        html: `<p>An invoice has been issued. Please review it in your portal.</p>`,
        text: `An invoice has been issued. Please review it in your portal.`,
      };
    default:
      return {
        subject: `Notification: ${n.event_type}`,
        html: `<p>You have a new notification: ${escapeHtml(n.event_type)}.</p>`,
        text: `You have a new notification: ${n.event_type}.`,
      };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function drainNotifications({ req }: Ctx): Promise<Response> {
  verifyWorkerSecret(req);

  const sb = admin();
  const { data: rows, error } = await sb
    .from('notifications')
    .select('id, org_id, event_type, recipient_user_id, entity_type, entity_id, payload, created_at')
    .eq('channel', 'email')
    .is('delivered_at', null)
    .is('failed_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'notifications query failed', 500, { detail: error.message });
  }

  const candidates = (rows ?? []) as DrainCandidate[];
  let delivered = 0;
  let failed = 0;

  for (const n of candidates) {
    if (!n.org_id) {
      // Orphans (org_id NULL from 0069 best-effort backfill) — mark failed.
      await markFailed(n.id, 'org_id is NULL');
      failed += 1;
      continue;
    }

    // Resolve recipient email.
    const { data: user, error: ue } = await sb.auth.admin.getUserById(n.recipient_user_id);
    if (ue || !user?.user?.email) {
      await markFailed(n.id, `recipient email not found${ue ? `: ${ue.message}` : ''}`);
      failed += 1;
      continue;
    }
    const email = user.user.email;
    const { subject, html, text } = describe(n);

    try {
      const res = await sendEmail(sb, n.org_id, {
        to: email,
        subject,
        html,
        text,
      });
      await markDelivered(n.id);
      info('notifications-worker delivered', {
        id: n.id,
        provider: res.provider,
        provider_id: res.provider_id,
      });
      delivered += 1;
    } catch (e) {
      if (e instanceof EmailConfigError) {
        await markFailed(n.id, `config: ${e.message}`);
        failed += 1;
      } else if (e instanceof EmailSendError) {
        await markFailed(n.id, `${e.provider}: ${e.message}`);
        failed += 1;
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        await markFailed(n.id, `unexpected: ${msg}`);
        failed += 1;
        logError('notifications-worker unexpected error', { id: n.id, err: msg });
      }
    }
  }

  return ok({
    processed: candidates.length,
    delivered,
    failed,
  }, undefined, { req });
}

async function markDelivered(id: string): Promise<void> {
  const sb = admin();
  await sb.from('notifications')
    .update({ delivered_at: new Date().toISOString() })
    .eq('id', id);
}

async function markFailed(id: string, reason: string): Promise<void> {
  const sb = admin();
  await sb.from('notifications')
    .update({
      failed_at: new Date().toISOString(),
      failure_reason: reason.slice(0, 500),
    })
    .eq('id', id);
}

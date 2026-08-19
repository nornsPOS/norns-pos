/**
 * Reminder cadence + WhatsApp 24h-window decision (ADR-0020 §7). Pure.
 *
 * Cadence:
 *   T-24h   : Email (with .ics) + WhatsApp template (booking_confirmation)
 *   T-2h    : WhatsApp template (reminder_2h)
 *   T-30min : SSE to the in-shop POS ("arriving soon")
 *
 * WhatsApp window: if the customer last messaged us within 24h we may send
 * free-form text, otherwise we MUST use a pre-approved template (Meta policy).
 */

const HOUR_MS = 60 * 60 * 1000;
const WHATSAPP_WINDOW_MS = 24 * HOUR_MS;

export type WhatsAppReminderMode = 'freeform' | 'template';

/** Decide free-form vs template for an outbound WhatsApp based on the 24h window. */
export function whatsappReminderMode(
  lastInboundAt: Date | null,
  now: Date = new Date(),
): WhatsAppReminderMode {
  if (lastInboundAt === null) return 'template';
  return now.getTime() - lastInboundAt.getTime() < WHATSAPP_WINDOW_MS ? 'freeform' : 'template';
}

export type NotificationType =
  | 'booking_confirmation'
  | 'reminder_24h'
  | 'reminder_2h'
  | 'reminder_30min'
  | 'no_show_followup'
  | 'rescheduled'
  | 'cancelled';

export type NotificationChannel = 'whatsapp' | 'email' | 'sse' | 'sms';

export interface ScheduledNotification {
  notificationType: NotificationType;
  channel: NotificationChannel;
  recipient: string;
  scheduledFor: Date;
  templateId?: string;
}

export interface ReminderScheduleInput {
  startsAt: Date;
  /** Customer email — when present, the email cadence is scheduled. */
  recipientEmail?: string | null;
  /** Customer phone (E.164) — when present, the WhatsApp cadence is scheduled. */
  recipientPhone?: string | null;
  /** "now" — confirmation goes out immediately; past reminder offsets are dropped. */
  now?: Date;
}

/**
 * Compute the notification rows to insert at booking time. Only offsets still in
 * the future (relative to `now`) are scheduled; channels without a recipient are
 * skipped. The T-30min SSE always targets the POS (recipient 'pos').
 */
export function computeReminderSchedule(input: ReminderScheduleInput): ScheduledNotification[] {
  const now = input.now ?? new Date();
  const start = input.startsAt.getTime();
  const email = input.recipientEmail?.trim() || null;
  const phone = input.recipientPhone?.trim() || null;

  const out: ScheduledNotification[] = [];
  const future = (whenMs: number) => whenMs > now.getTime();

  // Booking confirmation — immediate.
  if (email) {
    out.push({
      notificationType: 'booking_confirmation',
      channel: 'email',
      recipient: email,
      scheduledFor: now,
    });
  }
  if (phone) {
    out.push({
      notificationType: 'booking_confirmation',
      channel: 'whatsapp',
      recipient: phone,
      scheduledFor: now,
      templateId: 'booking_confirmation_v1',
    });
  }

  // T-24h — email + WhatsApp template.
  const t24 = start - 24 * HOUR_MS;
  if (future(t24)) {
    if (email) {
      out.push({
        notificationType: 'reminder_24h',
        channel: 'email',
        recipient: email,
        scheduledFor: new Date(t24),
      });
    }
    if (phone) {
      out.push({
        notificationType: 'reminder_24h',
        channel: 'whatsapp',
        recipient: phone,
        scheduledFor: new Date(t24),
        templateId: 'reminder_24h_v1',
      });
    }
  }

  // T-2h — WhatsApp template.
  const t2 = start - 2 * HOUR_MS;
  if (phone && future(t2)) {
    out.push({
      notificationType: 'reminder_2h',
      channel: 'whatsapp',
      recipient: phone,
      scheduledFor: new Date(t2),
      templateId: 'reminder_2h_v1',
    });
  }

  // T-30min — SSE to the POS.
  const t30 = start - 30 * 60 * 1000;
  if (future(t30)) {
    out.push({
      notificationType: 'reminder_30min',
      channel: 'sse',
      recipient: 'pos',
      scheduledFor: new Date(t30),
    });
  }

  return out;
}

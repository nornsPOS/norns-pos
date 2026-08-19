/**
 * Omnichannel social adapter (Decision #48) — the Unified Message Adapter that
 * maps Meta Graph webhook payloads (Instagram DMs + Facebook Messenger) onto a
 * single inbound shape, and routes bot replies back to the right channel.
 *
 * Pure parsing here (no I/O) so the IG/Messenger → unified translation is
 * unit-testable. `sendSocialReply` is the only side-effecting export.
 */

export type SocialChannel = 'instagram' | 'messenger';

export interface UnifiedInboundMessage {
  channel: SocialChannel;
  /** Sender's channel-scoped id (IGSID or Messenger PSID). */
  senderId: string;
  /** Recipient page/account id (our side) — used to scope the reply. */
  recipientId: string;
  text?: string;
  mediaUrl?: string;
  /** Provider message id (mid) — idempotency key. */
  messageId: string;
  receivedAt: Date;
}

interface RawAttachment {
  type?: string;
  payload?: { url?: string };
}
interface RawMessage {
  mid?: string;
  text?: string;
  is_echo?: boolean;
  attachments?: RawAttachment[];
}
interface RawMessaging {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: RawMessage;
}
interface RawEntry {
  messaging?: RawMessaging[];
}
interface RawSocialBody {
  object?: string;
  entry?: RawEntry[];
}

/** Map the webhook's top-level `object` to our channel, or null if unsupported. */
export function channelForObject(object: string | undefined): SocialChannel | null {
  if (object === 'instagram') return 'instagram';
  if (object === 'page') return 'messenger';
  return null;
}

/**
 * Translate a Meta socials webhook body into unified inbound messages. Skips
 * echoes (our own outbound mirrored back) and entries without a real message.
 */
export function extractSocialMessages(body: unknown): UnifiedInboundMessage[] {
  const parsed = body as RawSocialBody;
  const channel = channelForObject(parsed.object);
  if (!channel) return [];

  const out: UnifiedInboundMessage[] = [];
  for (const entry of parsed.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      const msg = m.message;
      const senderId = m.sender?.id;
      const recipientId = m.recipient?.id;
      // Need a sender, a recipient, a message, and it must not be our echo.
      if (!senderId || !recipientId || !msg || msg.is_echo === true) continue;
      // A message must carry either text or at least one attachment URL.
      const firstAttachmentUrl = msg.attachments?.find((a) => a.payload?.url)?.payload?.url;
      const text = typeof msg.text === 'string' && msg.text.length > 0 ? msg.text : undefined;
      if (text === undefined && firstAttachmentUrl === undefined) continue;

      out.push({
        channel,
        senderId,
        recipientId,
        messageId: msg.mid ?? `${senderId}-${m.timestamp ?? Date.now()}`,
        receivedAt: typeof m.timestamp === 'number' ? new Date(m.timestamp) : new Date(),
        ...(text !== undefined ? { text } : {}),
        ...(firstAttachmentUrl !== undefined ? { mediaUrl: firstAttachmentUrl } : {}),
      });
    }
  }
  return out;
}

/** Stable conversation key so socials reuse the conversation/budget machinery. */
export function socialConversationKey(channel: SocialChannel, senderId: string): string {
  return `${channel}:${senderId}`;
}

export const SOCIAL_SEND_TIMEOUT_MS = 10_000;

export class SocialSendError extends Error {
  public readonly providerCode: string | null;
  public constructor(message: string, providerCode: string | null) {
    super(message);
    this.providerCode = providerCode;
  }
}

export interface SocialSendArgs {
  /** Page-scoped access token (shared by Messenger + IG messaging). */
  pageAccessToken: string;
  recipientId: string;
  text: string;
}

export interface SocialSendResult {
  messageId: string;
}

/**
 * Send a text reply via the Meta Messenger Platform Send API (the same endpoint
 * serves Instagram messaging when the page is IG-linked).
 */
export async function sendSocialReply(args: SocialSendArgs): Promise<SocialSendResult> {
  const url = 'https://graph.facebook.com/v20.0/me/messages';
  const payload = {
    recipient: { id: args.recipientId },
    messaging_type: 'RESPONSE',
    message: { text: args.text },
  };

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('social send timeout')),
    SOCIAL_SEND_TIMEOUT_MS,
  );

  let res: Response;
  try {
    res = await fetch(`${url}?access_token=${encodeURIComponent(args.pageAccessToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    throw new SocialSendError(err instanceof Error ? err.message : 'social fetch failed', null);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    parsed = {};
  }
  if (!res.ok) {
    const env = parsed as { error?: { code?: number; message?: string } };
    throw new SocialSendError(
      env.error?.message ?? `meta http ${res.status}`,
      env.error?.code ? String(env.error.code) : String(res.status),
    );
  }
  const ok = parsed as { message_id?: string };
  return { messageId: ok.message_id ?? '' };
}

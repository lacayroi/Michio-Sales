// MessageGateway for Facebook Messenger (SPEC §5). Storage lookups (page token, last inbound time)
// are injected so this package stays free of the database.
import type { MessageGateway, OutboundMessage } from '../gateway';
import type { FacebookClient, WindowState } from './index';

export interface MessengerGatewayDeps {
  client: FacebookClient;
  /** Decrypted page credentials for a ChannelAccount. */
  pageOf(channelAccountId: string): Promise<{ pageId: string; pageToken: string }>;
  /** Messaging window for a conversation (see messengerWindow). */
  windowOf(conversationId: string): Promise<WindowState>;
  /** Window for the recipient of an outbound message (decides RESPONSE vs HUMAN_AGENT). */
  windowForRecipient(channelAccountId: string, externalUserId: string): Promise<WindowState>;
}

export function createMessengerGateway(deps: MessengerGatewayDeps): MessageGateway {
  return {
    async canSend(conversationId) {
      const w = await deps.windowOf(conversationId);
      return w.ok ? { ok: true } : { ok: false, reason: w.reason };
    },
    async send(msg: OutboundMessage) {
      const w = await deps.windowForRecipient(msg.channelAccountId, msg.externalUserId);
      if (!w.ok) throw new MessagingWindowClosedError(w.reason);
      const { pageId, pageToken } = await deps.pageOf(msg.channelAccountId);
      const r = await deps.client.send({
        pageId,
        pageToken,
        psid: msg.externalUserId,
        kind: msg.kind,
        text: msg.text,
        attachmentUrl: msg.attachmentUrl,
        humanAgentTag: w.mode === 'human_agent',
      });
      return { externalMessageId: r.messageId };
    },
  };
}

export class MessagingWindowClosedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'MessagingWindowClosedError';
  }
}

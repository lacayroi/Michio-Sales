// Every outbound customer message goes through a MessageGateway (SPEC §5, CLAUDE.md).
export type ChannelType = 'FACEBOOK_PAGE' | 'ZALO_COMPANY' | 'ZALO_BOT' | 'ZALO_OA';

export interface OutboundMessage {
  channelAccountId: string;
  externalUserId: string; // PSID (Facebook) / uid (Zalo)
  kind: 'text' | 'image' | 'file';
  text?: string;
  attachmentUrl?: string;
  idempotencyKey: string;
}

export interface MessageGateway {
  canSend(conversationId: string): Promise<{ ok: boolean; reason?: string }>; // kiểm tra khung thời gian được nhắn
  send(msg: OutboundMessage): Promise<{ externalMessageId: string }>;
}

export class ChannelNotImplementedError extends Error {
  constructor(readonly channel: ChannelType) {
    super(`Channel ${channel} is not implemented`);
    this.name = 'ChannelNotImplementedError';
  }
}

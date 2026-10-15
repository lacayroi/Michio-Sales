// Zalo OA — reserved for when Michio registers an OA (SPEC 5.4, milestone M8).
import { ChannelNotImplementedError, type MessageGateway } from '../gateway';

export const zaloOaGateway: MessageGateway = {
  async canSend() {
    return { ok: false, reason: 'Zalo OA chưa được kích hoạt' };
  },
  async send() {
    throw new ChannelNotImplementedError('ZALO_OA');
  },
};

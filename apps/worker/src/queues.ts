// Queue names (SPEC §9). Processors are added milestone by milestone.
export const QUEUES = {
  channelInbound: 'channel-inbound',
  channelOutbound: 'channel-outbound',
  zaloBotInbound: 'zalo-bot-inbound',
  zaloBotNotify: 'zalo-bot-notify',
  assignment: 'assignment',
  slaCheck: 'sla-check',
  system: 'system', // cron-style jobs (sweepers, digests, syncs)
} as const;

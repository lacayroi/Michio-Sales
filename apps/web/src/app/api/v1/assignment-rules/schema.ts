import 'server-only';
import { z } from 'zod';

export const RuleBody = z.object({
  name: z.string().trim().min(1).max(100),
  priority: z.number().int().min(0).max(100_000).optional(),
  isActive: z.boolean().optional(),
  conditions: z.record(z.string(), z.unknown()).optional(),
  targetUserIds: z.array(z.string()).max(100).optional(),
  method: z.enum(['ROUND_ROBIN', 'WEIGHTED', 'LEAST_LOADED', 'MANUAL']),
  autoAccept: z.boolean().optional(),
  acceptSlaMinutes: z.number().int().min(1).max(1440).optional(),
  hotAcceptSlaMinutes: z.number().int().min(1).max(1440).optional(),
  firstContactSlaMinutes: z.number().int().min(1).max(1440).optional(),
  maxReassign: z.number().int().min(0).max(20).optional(),
  fallback: z.enum(['NEXT_RULE', 'QUEUE']).optional(),
  weights: z.record(z.string(), z.number().int().min(1).max(100)).optional(),
});

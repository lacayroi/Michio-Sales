// Assignment rule conditions (SPEC 6.3.2). Stored in AssignmentRule.conditions (JSON), validated by zod.
import { foldVietnamese } from '@michio/shared';
import { z } from 'zod';

const HHMM = z.string().regex(/^\d{2}:\d{2}$/);

export const RuleConditions = z
  .object({
    sources: z.array(z.string()).optional(),
    businessModels: z.array(z.string()).optional(),
    orderBands: z.array(z.string()).optional(),
    interestCategories: z.array(z.string()).optional(),
    provinces: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    priorities: z.array(z.enum(['HOT', 'WARM', 'COLD'])).optional(),
    /** Local time window, e.g. {from:"08:00", to:"17:30"}; from > to wraps midnight. */
    timeWindow: z.object({ from: HHMM, to: HHMM }).optional(),
  })
  .strict();

export type RuleConditions = z.infer<typeof RuleConditions>;

/** The lead attributes rules can look at. */
export interface RoutableLead {
  source: string;
  priority: string;
  businessModel?: string | null;
  expectedOrderBand?: string | null;
  interestCategories?: readonly string[];
  province?: string | null;
  tags?: readonly string[];
}

function minutesOfDayVn(at: Date): number {
  const local = new Date(at.getTime() + 7 * 3600_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

const toMinutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

const anyOf = (wanted: readonly string[] | undefined, value: string | null | undefined) =>
  !wanted?.length || (value != null && wanted.includes(value));

const intersects = (wanted: readonly string[] | undefined, values: readonly string[] | undefined) =>
  !wanted?.length || (values ?? []).some((v) => wanted.includes(v));

/** Empty conditions match everything (the default rule). Every given condition must hold. */
export function matchesRule(raw: unknown, lead: RoutableLead, at: Date = new Date()): boolean {
  const parsed = RuleConditions.safeParse(raw ?? {});
  if (!parsed.success) return false; // a broken rule never captures leads
  const c = parsed.data;
  if (!anyOf(c.sources, lead.source)) return false;
  if (!anyOf(c.priorities, lead.priority)) return false;
  if (!anyOf(c.businessModels, lead.businessModel)) return false;
  if (!anyOf(c.orderBands, lead.expectedOrderBand)) return false;
  if (!intersects(c.interestCategories, lead.interestCategories)) return false;
  if (!intersects(c.tags, lead.tags)) return false;
  if (c.provinces?.length) {
    const p = lead.province ? foldVietnamese(lead.province) : null;
    if (!p || !c.provinces.some((x) => foldVietnamese(x) === p)) return false;
  }
  if (c.timeWindow) {
    const m = minutesOfDayVn(at);
    const from = toMinutes(c.timeWindow.from);
    const to = toMinutes(c.timeWindow.to);
    const inside = from <= to ? m >= from && m < to : m >= from || m < to;
    if (!inside) return false;
  }
  return true;
}

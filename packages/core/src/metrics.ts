// Metric definitions (SPEC 6.11) — the single place reports, dashboards and the digest compute from.
// Pure functions over plain rows so they are unit-tested without a database.
import { type BusinessCalendar, businessMinutesBetween } from './business-time';

/** Median of a list (average of the two middle values for even length); null when empty. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Nearest-rank percentile (p in 0–100); null when empty. P90 of [1..10] = 9. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * s.length));
  return s[rank - 1]!;
}

export const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/** FRT = firstContactAt − firstAssignedAt in working minutes (SPEC 6.11). Leads not yet contacted are excluded. */
export function frtMinutes(leads: { firstAssignedAt: Date | null; firstContactAt: Date | null }[], cal: BusinessCalendar): number[] {
  return leads
    .filter((l) => l.firstAssignedAt && l.firstContactAt && l.firstContactAt >= l.firstAssignedAt)
    .map((l) => businessMinutesBetween(l.firstAssignedAt!, l.firstContactAt!, cal));
}

/** Automatic assignments (rotation methods) — the denominator of on-time acceptance. */
export const AUTO_METHODS = new Set(['ROUND_ROBIN', 'WEIGHTED', 'LEAST_LOADED', 'CUSTOMER_OWNER', 'PREVIOUS_OWNER']);

/**
 * Tỷ lệ nhận đúng hạn = assignment ACCEPTED trước hạn / tổng assignment tự động (SPEC 6.11).
 * A PENDING assignment whose deadline is still ahead of `now` is undecided and left out.
 */
export function onTimeAcceptance(assignments: { method: string; status: string; respondedAt: Date | null; acceptDeadline: Date | null }[], now: Date = new Date()) {
  const auto = assignments.filter((a) => AUTO_METHODS.has(a.method) && a.acceptDeadline && !(a.status === 'PENDING' && a.acceptDeadline > now));
  const onTime = auto.filter((a) => a.status === 'ACCEPTED' || (a.status === 'REASSIGNED' && a.respondedAt))
    .filter((a) => a.respondedAt && a.respondedAt <= a.acceptDeadline!).length;
  return { total: auto.length, onTime, rate: ratio(onTime, auto.length) };
}

/** Tỷ lệ chốt = deal CHOT / (CHOT + THUA), theo ngày đóng (SPEC 6.11). */
export function conversion(deals: { isWon: boolean; isLost: boolean }[]) {
  const won = deals.filter((d) => d.isWon).length;
  const lost = deals.filter((d) => d.isLost).length;
  return { won, lost, rate: ratio(won, won + lost) };
}

/** Doanh số = tổng Order.total của đơn không hủy, theo orderedAt (SPEC 6.11). */
export function revenue(orders: { total: number; cancelled: boolean }[]) {
  const kept = orders.filter((o) => !o.cancelled);
  const sum = kept.reduce((s, o) => s + o.total, 0);
  return { revenue: sum, orders: kept.length, avgOrderValue: kept.length ? Math.round(sum / kept.length) : null };
}

/** Quarter [start, end) in Vietnam time for a date. */
export function vnQuarterRange(d: Date): { start: Date; end: Date; key: string } {
  const local = new Date(d.getTime() + 7 * 3600_000);
  const y = local.getUTCFullYear();
  const q = Math.floor(local.getUTCMonth() / 3);
  return { start: new Date(Date.UTC(y, q * 3, 1) - 7 * 3600_000), end: new Date(Date.UTC(y, q * 3 + 3, 1) - 7 * 3600_000), key: `${y}-Q${q + 1}` };
}

/**
 * Tỷ lệ quay lại (quý) = khách có ≥ 1 đơn trong quý VÀ đã có đơn trước quý / khách có đơn trước quý (SPEC 6.11).
 * `orders` = non-cancelled orders (customerId, orderedAt).
 */
export function retention(orders: { customerId: string; orderedAt: Date }[], quarter: { start: Date; end: Date }) {
  const before = new Set(orders.filter((o) => o.orderedAt < quarter.start).map((o) => o.customerId));
  const during = new Set(orders.filter((o) => o.orderedAt >= quarter.start && o.orderedAt < quarter.end).map((o) => o.customerId));
  const returned = [...before].filter((c) => during.has(c)).length;
  return { base: before.size, returned, rate: ratio(returned, before.size) };
}

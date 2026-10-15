// Vietnam has no DST: ICT is always UTC+7.
const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;

/** [start, end) of the Vietnam calendar day containing `date`. */
export function vnDayRange(date: Date = new Date()): { start: Date; end: Date } {
  const local = new Date(date.getTime() + ICT_OFFSET_MS);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - ICT_OFFSET_MS;
  return { start: new Date(start), end: new Date(start + 86_400_000) };
}

/** [start, end) of the Vietnam calendar month containing `date`, plus its "yyyy-MM" key. */
export function vnMonthRange(date: Date = new Date()): { start: Date; end: Date; key: string } {
  const local = new Date(date.getTime() + ICT_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1) - ICT_OFFSET_MS),
    end: new Date(Date.UTC(y, m + 1, 1) - ICT_OFFSET_MS),
    key: `${y}-${String(m + 1).padStart(2, '0')}`,
  };
}

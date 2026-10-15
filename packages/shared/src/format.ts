const TZ = 'Asia/Ho_Chi_Minh';

const vndFormatter = new Intl.NumberFormat('vi-VN');

/** 12500000 → "12.500.000 ₫" (SPEC 10.2) */
export function formatVnd(amount: number | bigint | string | { toString(): string }): string {
  const n = typeof amount === 'number' || typeof amount === 'bigint' ? amount : Number(amount.toString());
  return `${vndFormatter.format(n)} ₫`;
}

function parts(date: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
}

/** dd/MM/yyyy HH:mm in Vietnam time */
export function formatDateTime(date: Date): string {
  const p = parts(date);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** dd/MM/yyyy in Vietnam time */
export function formatDate(date: Date): string {
  const p = parts(date);
  return `${p.day}/${p.month}/${p.year}`;
}

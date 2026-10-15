// Vietnamese phone normalization (SPEC 6.2). Output is E.164: +84xxxxxxxxx.

// Mobile: 9 digits after the country code, by carrier prefix.
const MOBILE_RE = /^(3[2-9]|5[25689]|7[06-9]|8[1-9]|9\d)\d{7}$/;
// Landline: 10 digits after the country code, starting with 2 (02xx area codes).
const LANDLINE_RE = /^2\d{9}$/;

export function normalizeVnPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!/^[+\d\s.\-()]+$/.test(trimmed)) return null;

  let digits = trimmed.replace(/[^\d]/g, '');
  if (trimmed.startsWith('+')) {
    if (!digits.startsWith('84')) return null;
    digits = digits.slice(2);
  } else if (digits.startsWith('84') && digits.length >= 11) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  } else {
    return null;
  }
  // Tolerate "+84 0912..." style inputs.
  if (digits.startsWith('0')) digits = digits.slice(1);

  if (MOBILE_RE.test(digits) || LANDLINE_RE.test(digits)) return `+84${digits}`;
  return null;
}

/** Local display form: +84912345678 → 0912345678 */
export function toLocalVnPhone(e164: string): string {
  return e164.startsWith('+84') ? `0${e164.slice(3)}` : e164;
}

/** Mask for logs (SPEC 11.1): 0912***678 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const local = toLocalVnPhone(phone.replace(/[^\d+]/g, ''));
  if (local.length < 7) return '***';
  return `${local.slice(0, 4)}***${local.slice(-3)}`;
}

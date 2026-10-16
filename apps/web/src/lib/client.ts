// Browser-side helper for /api/v1 calls (same-origin, so the CSRF Origin check passes).
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
}

export async function api<T = unknown>(url: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET'),
      headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, status: res.status, data: null, error: json?.error ?? { code: 'HTTP', message: 'Đã có lỗi xảy ra, vui lòng thử lại' } };
    }
    return { ok: true, status: res.status, data: json as T, error: null };
  } catch {
    return { ok: false, status: 0, data: null, error: { code: 'NETWORK', message: 'Không kết nối được máy chủ' } };
  }
}

/** Field errors from a zod-flattened 422 response. */
export function fieldErrors(error: ApiResult<unknown>['error']): Record<string, string> {
  const d = error?.details as { fieldErrors?: Record<string, string[]> } | Record<string, string[]> | undefined;
  const fe = (d && 'fieldErrors' in d ? d.fieldErrors : d) as Record<string, string[] | undefined> | undefined;
  if (!fe || typeof fe !== 'object') return {};
  return Object.fromEntries(Object.entries(fe).filter(([, v]) => Array.isArray(v) && v.length).map(([k, v]) => [k, v![0]!]));
}

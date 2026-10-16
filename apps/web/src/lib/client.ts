'use client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: { fieldErrors?: Record<string, string[]> } & Record<string, unknown>,
  ) {
    super(message);
  }
}

/** fetch + JSON + the SPEC §8 error envelope. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
    headers: opts.form ? undefined : { 'Content-Type': 'application/json' },
    body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string; details?: ApiError['details'] } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? 'Đã có lỗi xảy ra', e?.details);
  }
  return data as T;
}

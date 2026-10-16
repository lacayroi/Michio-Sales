'use client';

import { Download } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Field, FormError } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/client';

interface Preview {
  totalRows: number;
  validRows: number;
  existing: number;
  errors: { rowNumber: number; messages: string[] }[];
}

interface JobStatus {
  state: string;
  progress: { done: number; total: number } | number;
  total: number;
  result: { created: number; updated: number; leadsCreated: number; failed: { rowNumber: number; message: string }[] } | null;
  error: string | null;
}

/** Bước 1 chọn file → 2 xem trước lỗi từng dòng → 3 xác nhận → job nền có tiến độ (SPEC 6.2). */
export function ImportWizard({ users }: { users: { id: string; fullName: string }[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [assign, setAssign] = useState('auto');
  const [userId, setUserId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function form(dryRun: boolean) {
    const f = new FormData();
    f.set('file', file!);
    f.set('assign', assign);
    if (assign === 'user') f.set('userId', userId);
    if (dryRun) f.set('dryRun', '1');
    return f;
  }

  async function check(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return setError('Hãy chọn file .xlsx');
    setBusy(true);
    setError(null);
    setPreview(null);
    const res = await api<Preview>('/api/v1/imports/customers', { form: form(true) });
    setBusy(false);
    if (!res.ok) return setError(res.error?.message ?? null);
    setPreview(res.data);
  }

  async function commit() {
    if (assign === 'user' && !userId) return setError('Chọn sales nhận khách');
    setBusy(true);
    setError(null);
    const res = await api<{ id: string }>('/api/v1/imports/customers', { form: form(false) });
    setBusy(false);
    if (!res.ok) return setError(res.error?.message ?? null);
    setJobId(res.data!.id);
  }

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      const res = await api<JobStatus>(`/api/v1/imports/${jobId}`);
      if (stop) return;
      if (res.ok && res.data) {
        setJob(res.data);
        if (res.data.state === 'completed' || res.data.state === 'failed') return;
      }
      setTimeout(tick, 1000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [jobId]);

  if (jobId) {
    const p = job && typeof job.progress === 'object' ? job.progress : { done: 0, total: job?.total ?? 0 };
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    return (
      <Card>
        <CardTitle>Đang import</CardTitle>
        {!job || (job.state !== 'completed' && job.state !== 'failed') ? (
          <div className="mt-3" role="status">
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {p.done}/{p.total} dòng ({pct}%) — có thể rời trang, bạn sẽ nhận thông báo khi xong.
            </p>
          </div>
        ) : job.state === 'failed' ? (
          <FormError message={`Import lỗi: ${job.error ?? 'không rõ'}`} />
        ) : (
          <div className="mt-3 flex flex-col gap-2 text-sm" role="status">
            <p className="text-base font-semibold">Import xong</p>
            <p>
              Tạo mới <b>{job.result?.created}</b> khách (trong đó <b>{job.result?.leadsCreated}</b> lead) · cập nhật <b>{job.result?.updated}</b> khách đã có · lỗi{' '}
              <b>{job.result?.failed.length}</b>
            </p>
            {!!job.result?.failed.length && (
              <ul className="max-h-48 overflow-y-auto rounded-lg bg-muted p-2 text-xs">
                {job.result.failed.map((f) => (
                  <li key={f.rowNumber}>
                    Dòng {f.rowNumber}: {f.message}
                  </li>
                ))}
              </ul>
            )}
            <Link href="/khach-hang" className="font-semibold text-primary hover:underline">
              Xem danh sách khách
            </Link>
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle>1. Tải file mẫu</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">Điền theo đúng cột của file mẫu (Phụ lục A). Nhãn tiếng Việt như “Shop online”, “10–30 triệu” được tự nhận diện.</p>
        <a href="/api/v1/imports/customers" download className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
          <Download className="size-4" /> mau-import-khach-si.xlsx
        </a>
      </Card>

      <Card>
        <CardTitle>2. Chọn file và cách giao khách</CardTitle>
        <form onSubmit={check} className="mt-3 flex flex-col gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label="File Excel"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
            className="text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-2 file:font-semibold"
          />
          <Field label="Khách chưa ghi “Sales phụ trách”" htmlFor="assign">
            <Select id="assign" value={assign} onChange={(e) => setAssign(e.target.value)}>
              <option value="auto">Chia xoay vòng cho các sales</option>
              <option value="user">Giao hết cho 1 người</option>
              <option value="none">Chưa giao (vào hàng chờ)</option>
            </Select>
          </Field>
          {assign === 'user' && (
            <Field label="Sales nhận khách" htmlFor="userId">
              <Select id="userId" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Chọn…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Button type="submit" variant="outline" disabled={busy || !file} className="self-start">
            {busy && !preview ? 'Đang kiểm tra…' : 'Kiểm tra file'}
          </Button>
        </form>
      </Card>

      {preview && (
        <Card data-testid="import-preview">
          <CardTitle>3. Xem trước</CardTitle>
          <p className="mt-2 text-sm">
            {preview.totalRows} dòng · <b>{preview.validRows}</b> hợp lệ{preview.existing ? ` (${preview.existing} SĐT đã có — chỉ bổ sung thông tin)` : ''} ·{' '}
            <b className={preview.errors.length ? 'text-accent-text' : ''}>{preview.errors.length}</b> dòng lỗi
          </p>
          {preview.errors.length > 0 && (
            <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground uppercase">
                  <tr>
                    <th className="px-3 py-1.5">Dòng</th>
                    <th className="px-3 py-1.5">Lỗi</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.errors.map((e) => (
                    <tr key={e.rowNumber} className="border-t border-border">
                      <td className="px-3 py-1.5 align-top tabular-nums">{e.rowNumber}</td>
                      <td className="px-3 py-1.5">{e.messages.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Dòng lỗi sẽ bị bỏ qua. Sửa file và kiểm tra lại nếu cần nhập cả các dòng đó.</p>
          <Button onClick={commit} disabled={busy || !preview.validRows} className="mt-3">
            Import {preview.validRows} dòng hợp lệ
          </Button>
        </Card>
      )}
      <FormError message={error} />
    </div>
  );
}

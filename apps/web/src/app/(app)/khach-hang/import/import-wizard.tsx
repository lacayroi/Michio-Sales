'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

interface Preview { total: number; valid: number; invalid: number; creates: number; updates: number; rows: { rowNumber: number; errors: string[] }[] }
interface Status { state: string; progress: { done: number; total: number } | number; result: { created: number; updated: number; failed: { rowNumber: number; error: string }[] } | null; error: string | null }

export function ImportWizard({ users }: { users: { id: string; fullName: string }[] }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [ownerMode, setOwnerMode] = useState('ROUND_ROBIN');
  const [userId, setUserId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [importId, setImportId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  const form = (mode: 'preview' | 'commit') => {
    const f = new FormData();
    if (file) f.set('file', file);
    f.set('mode', mode);
    f.set('ownerMode', ownerMode);
    if (userId) f.set('userId', userId);
    return f;
  };

  async function check() {
    if (!file) return;
    setBusy(true);
    setPreview(null);
    try {
      setPreview(await api<Preview>('/api/v1/imports/customers', { form: form('preview') }));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không đọc được file', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    try {
      const r = await api<{ importId: string }>('/api/v1/imports/customers', { form: form('commit') });
      setImportId(r.importId);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không nhập được', 'error');
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!importId) return;
    let stop = false;
    const tick = async () => {
      const s = await api<Status>(`/api/v1/imports/${importId}`).catch(() => null);
      if (stop || !s) return;
      setStatus(s);
      if (s.state === 'completed' || s.state === 'failed') {
        setBusy(false);
        return;
      }
      setTimeout(tick, 1000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [importId]);

  const progress = status && typeof status.progress === 'object' ? status.progress : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-3">
        <Field id="imp-file" label="File Excel (.xlsx)">
          <input
            ref={fileRef}
            id="imp-file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setImportId(null);
              setStatus(null);
            }}
            className="text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium"
          />
        </Field>
        <Field id="imp-owner" label="Khách chưa có sales phụ trách">
          <Select id="imp-owner" value={ownerMode} onChange={(e) => setOwnerMode(e.target.value)}>
            <option value="ROUND_ROBIN">Chia xoay vòng</option>
            <option value="ONE_USER">Giao cho 1 người</option>
            <option value="NONE">Chưa giao</option>
          </Select>
        </Field>
        {ownerMode === 'ONE_USER' && (
          <Field id="imp-user" label="Người nhận">
            <Select id="imp-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">— Chọn —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </Select>
          </Field>
        )}
        <div className="flex items-end sm:col-span-3">
          <Button onClick={check} disabled={!file || busy || (ownerMode === 'ONE_USER' && !userId)}>
            {busy && !importId ? 'Đang kiểm tra…' : '1. Kiểm tra file'}
          </Button>
        </div>
      </div>

      {preview && !importId && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4" data-testid="import-preview">
          <p className="text-sm">
            <strong>{preview.total}</strong> dòng · <strong className="text-primary dark:text-brand-green">{preview.valid} hợp lệ</strong> ({preview.creates} khách mới, {preview.updates} cập nhật)
            {preview.invalid > 0 && <> · <strong className="text-accent-text">{preview.invalid} lỗi</strong> (sẽ bỏ qua)</>}
          </p>
          {preview.rows.length > 0 && (
            <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="px-3 py-2">Dòng</th><th className="px-3 py-2">Lỗi</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.rows.map((r) => (
                    <tr key={r.rowNumber}>
                      <td className="px-3 py-1.5 tabular-nums">{r.rowNumber}</td>
                      <td className="px-3 py-1.5 text-accent-text">{r.errors.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div>
            <Button onClick={commit} disabled={busy || preview.valid === 0}>
              2. Nhập {preview.valid} khách
            </Button>
          </div>
        </div>
      )}

      {importId && (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm" data-testid="import-status">
          {status?.state === 'completed' && status.result ? (
            <p>
              ✅ Hoàn tất: <strong>{status.result.created}</strong> khách mới, <strong>{status.result.updated}</strong> cập nhật
              {status.result.failed.length > 0 && <>, <span className="text-accent-text">{status.result.failed.length} dòng lỗi</span></>}.
            </p>
          ) : status?.state === 'failed' ? (
            <p className="text-accent-text">Nhập thất bại: {status.error}</p>
          ) : (
            <div>
              <p className="mb-2">Đang nhập… {progress ? `${progress.done}/${progress.total}` : ''}</p>
              <div className="h-2 rounded-full bg-muted">
                <div className="h-2 rounded-full bg-brand-green transition-all" style={{ width: `${progress ? (progress.done / Math.max(1, progress.total)) * 100 : 5}%` }} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

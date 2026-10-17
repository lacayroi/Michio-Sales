'use client';

import { ROLE_LABELS } from '@michio/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';

interface U { id: string; fullName: string; role: keyof typeof ROLE_LABELS; status: string }
interface Preview { user: { fullName: string }; counts: { customers: number; openLeads: number; pendingLeads: number; deals: number; quotes: number; tasks: number } }
interface JobState { state: string; progress: { done: number; total: number } | number; result: null | { customers: number; leads: number; pendingRerouted: number; deals: number; quotes: number; tasks: number; perUser: Record<string, { name: string; customers: number; leads: number; tasks: number }> }; error: string | null }

const STEPS = ['Chọn người chuyển', 'Xem lại', 'Người nhận & xác nhận'];

export function TransferWizard({ users }: { users: U[] }) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [from, setFrom] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<'ONE' | 'ROUND_ROBIN'>('ONE');
  const [to, setTo] = useState('');
  const [pool, setPool] = useState<string[]>([]);
  const [deactivate, setDeactivate] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [busy, setBusy] = useState(false);

  const candidates = users.filter((u) => u.id !== from && u.status !== 'INACTIVE');

  useEffect(() => {
    if (!jobId) return;
    const t = setInterval(async () => {
      const s = await api<JobState>(`/api/v1/transfers/${jobId}`).catch(() => null);
      if (!s) return;
      setJob(s);
      if (s.state === 'completed' || s.state === 'failed') clearInterval(t);
    }, 800);
    return () => clearInterval(t);
  }, [jobId]);

  async function loadPreview() {
    setBusy(true);
    try {
      setPreview(await api<Preview>(`/api/v1/transfers/preview?fromUserId=${from}`));
      setStep(1);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lỗi', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!window.confirm(`Chuyển toàn bộ dữ liệu của ${preview?.user.fullName}?${deactivate ? ' Tài khoản sẽ bị khóa ngay.' : ''}`)) return;
    setBusy(true);
    try {
      const r = await api<{ id: string }>('/api/v1/transfers', { body: { fromUserId: from, mode, toUserId: mode === 'ONE' ? to : undefined, toUserIds: mode === 'ROUND_ROBIN' ? pool : undefined, deactivate } });
      setJobId(r.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không chuyển được', 'error');
    } finally {
      setBusy(false);
    }
  }

  const progress = job && typeof job.progress === 'object' ? job.progress : null;
  return (
    <div className="flex flex-col gap-4" data-testid="transfer-wizard">
      <ol className="flex gap-2 text-sm">
        {STEPS.map((s, i) => (
          <li key={s} className={cn('flex-1 rounded-lg border px-3 py-2', i === step ? 'border-brand-green font-semibold' : 'border-border text-muted-foreground')}>{i + 1}. {s}</li>
        ))}
      </ol>

      {jobId ? (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm" role="status" data-testid="transfer-result">
          {!job || (job.state !== 'completed' && job.state !== 'failed') ? (
            <p className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Đang chuyển… {progress ? `${progress.done}/${progress.total} bản ghi` : ''}</p>
          ) : job.state === 'failed' ? (
            <p className="text-accent-text">Lỗi: {job.error}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="font-semibold">Đã chuyển xong: {job.result!.customers} khách, {job.result!.leads} lead, {job.result!.quotes} báo giá, {job.result!.tasks} việc{job.result!.pendingRerouted ? `, ${job.result!.pendingRerouted} lead chờ nhận được chia lại` : ''}.</p>
              <ul className="list-disc pl-5">
                {Object.values(job.result!.perUser).map((p) => <li key={p.name}>{p.name}: {p.customers} khách, {p.leads} lead, {p.tasks} việc</li>)}
              </ul>
              <p className="text-muted-foreground">Người nhận đã được thông báo danh sách khách (web + Zalo Bot).</p>
            </div>
          )}
        </div>
      ) : step === 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <label className="text-sm font-medium" htmlFor="tf-from">Nhân viên cần chuyển</label>
          <Select id="tf-from" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">— Chọn —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.fullName} ({ROLE_LABELS[u.role]}{u.status === 'INACTIVE' ? ', đã nghỉ' : ''})</option>)}
          </Select>
          <Button disabled={!from || busy} onClick={loadPreview}>Tiếp</Button>
        </div>
      ) : step === 1 && preview ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <p className="font-medium">{preview.user.fullName} đang giữ:</p>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3" data-testid="transfer-preview">
            {[
              ['Khách phụ trách', preview.counts.customers], ['Lead đang xử lý', preview.counts.openLeads], ['Lead chờ nhận', preview.counts.pendingLeads],
              ['Cơ hội đang mở', preview.counts.deals], ['Báo giá chưa chốt', preview.counts.quotes], ['Việc còn mở', preview.counts.tasks],
            ].map(([l, v]) => <div key={l as string} className="rounded-lg bg-muted p-2"><dt className="text-xs text-muted-foreground">{l}</dt><dd className="text-lg font-semibold tabular-nums">{v}</dd></div>)}
          </dl>
          <p className="text-xs text-muted-foreground">Lead đang chờ nhận sẽ được chia lại theo luật chia lead. Mọi thứ khác đi theo khách.</p>
          <div className="flex gap-2"><Button variant="ghost" onClick={() => setStep(0)}>Quay lại</Button><Button onClick={() => setStep(2)}>Tiếp</Button></div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">Cách chuyển</legend>
            <label className="flex items-center gap-2"><input type="radio" checked={mode === 'ONE'} onChange={() => setMode('ONE')} className="size-4 accent-[var(--primary)]" />Giao hết cho một người</label>
            <label className="flex items-center gap-2"><input type="radio" checked={mode === 'ROUND_ROBIN'} onChange={() => setMode('ROUND_ROBIN')} className="size-4 accent-[var(--primary)]" />Chia đều xoay vòng</label>
          </fieldset>
          {mode === 'ONE' ? (
            <Select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Người nhận">
              <option value="">— Người nhận —</option>
              {candidates.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
            </Select>
          ) : (
            <div className="flex flex-col gap-1">
              {candidates.map((u) => (
                <label key={u.id} className="flex items-center gap-2"><input type="checkbox" checked={pool.includes(u.id)} onChange={(e) => setPool((p) => (e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id)))} className="size-4 accent-[var(--primary)]" />{u.fullName}</label>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2"><input type="checkbox" checked={deactivate} onChange={(e) => setDeactivate(e.target.checked)} className="size-4 accent-[var(--primary)]" />Khóa tài khoản người chuyển ngay (đã nghỉ việc)</label>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(1)}>Quay lại</Button>
            <Button disabled={busy || (mode === 'ONE' ? !to : pool.length === 0)} onClick={start}>Xác nhận chuyển giao</Button>
          </div>
        </div>
      )}
    </div>
  );
}

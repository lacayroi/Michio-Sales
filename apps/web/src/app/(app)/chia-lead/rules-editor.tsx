'use client';

import { ASSIGNMENT_METHOD_LABELS, BUSINESS_MODEL_LABELS, LEAD_SOURCE_LABELS, ORDER_BAND_LABELS, USER_STATUS_LABELS } from '@michio/shared';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, FormError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/client';
import { cn } from '@/lib/utils';

const METHODS = ['ROUND_ROBIN', 'WEIGHTED', 'LEAST_LOADED', 'MANUAL'] as const;

export interface RuleView {
  id: string;
  name: string;
  isActive: boolean;
  method: (typeof METHODS)[number];
  targetUserIds: string[];
  conditions: { sources?: string[]; businessModels?: string[]; orderBands?: string[]; provinces?: string[]; priorities?: string[] };
  autoAccept: boolean;
  acceptSlaMinutes: number;
  hotAcceptSlaMinutes: number;
  firstContactSlaMinutes: number;
  maxReassign: number;
  fallback: 'NEXT_RULE' | 'QUEUE';
  weights: Record<string, number>;
}

interface UserOpt {
  id: string;
  fullName: string;
  role: string;
  status: keyof typeof USER_STATUS_LABELS;
}

function describeConditions(c: RuleView['conditions']): string {
  const parts = [
    c.sources?.length ? `Nguồn: ${c.sources.map((s) => LEAD_SOURCE_LABELS[s as keyof typeof LEAD_SOURCE_LABELS] ?? s).join(', ')}` : null,
    c.businessModels?.length ? `Mô hình: ${c.businessModels.map((s) => BUSINESS_MODEL_LABELS[s as keyof typeof BUSINESS_MODEL_LABELS] ?? s).join(', ')}` : null,
    c.orderBands?.length ? `Mức nhập: ${c.orderBands.map((s) => ORDER_BAND_LABELS[s as keyof typeof ORDER_BAND_LABELS] ?? s).join(', ')}` : null,
    c.priorities?.length ? `Ưu tiên: ${c.priorities.join(', ')}` : null,
    c.provinces?.length ? `Tỉnh: ${c.provinces.join(', ')}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Mọi lead (luật mặc định)';
}

function Checks({ name, options, selected }: { name: string; options: [string, string][]; selected: string[] | undefined }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {options.map(([v, l]) => (
        <label key={v} className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" name={name} value={v} defaultChecked={selected?.includes(v)} className="size-4" />
          {l}
        </label>
      ))}
    </div>
  );
}

function RuleForm({ rule, users, onDone }: { rule: RuleView | null; users: UserOpt[]; onDone: () => void }) {
  const router = useRouter();
  const [method, setMethod] = useState<RuleView['method']>(rule?.method ?? 'ROUND_ROBIN');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const list = (k: string) => f.getAll(k).map(String);
    const provinces = String(f.get('provinces') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const conditions = Object.fromEntries(
      Object.entries({ sources: list('sources'), businessModels: list('businessModels'), orderBands: list('orderBands'), priorities: list('priorities'), provinces }).filter(([, v]) => v.length),
    );
    const targetUserIds = list('targets');
    const body = {
      name: String(f.get('name') ?? ''),
      isActive: f.get('isActive') === 'on',
      method,
      targetUserIds,
      conditions,
      autoAccept: f.get('autoAccept') === 'on',
      acceptSlaMinutes: Number(f.get('acceptSlaMinutes')),
      hotAcceptSlaMinutes: Number(f.get('hotAcceptSlaMinutes')),
      firstContactSlaMinutes: Number(f.get('firstContactSlaMinutes')),
      maxReassign: Number(f.get('maxReassign')),
      fallback: String(f.get('fallback')),
      ...(method === 'WEIGHTED' ? { weights: Object.fromEntries(targetUserIds.map((id) => [id, Number(f.get(`w-${id}`)) || 1])) } : {}),
    };
    setBusy(true);
    setError(null);
    const res = await api(rule ? `/api/v1/assignment-rules/${rule.id}` : '/api/v1/assignment-rules', { method: rule ? 'PATCH' : 'POST', body });
    setBusy(false);
    if (!res.ok) return setError(res.error?.message ?? null);
    onDone();
    router.refresh();
  }

  const sales = users.filter((u) => u.role === 'SALES');
  const others = users.filter((u) => u.role !== 'SALES');
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Tên luật" htmlFor="name">
        <Input id="name" name="name" defaultValue={rule?.name ?? ''} required />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={rule?.isActive ?? true} className="size-4" /> Đang bật
      </label>
      <Field label="Phương thức" htmlFor="method">
        <Select id="method" value={method} onChange={(e) => setMethod(e.target.value as RuleView['method'])}>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {ASSIGNMENT_METHOD_LABELS[m]}
              {m === 'MANUAL' ? ' (vào hàng chờ)' : ''}
            </option>
          ))}
        </Select>
      </Field>
      {method !== 'MANUAL' && (
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Người nhận (theo thứ tự xoay vòng; để trống = mọi sales)</legend>
          <div className="flex flex-col gap-1.5">
            {[...sales, ...others].map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="targets" value={u.id} defaultChecked={rule?.targetUserIds.includes(u.id)} className="size-4" />
                <span className="flex-1">
                  {u.fullName} <span className="text-xs text-muted-foreground">· {USER_STATUS_LABELS[u.status]}</span>
                </span>
                {method === 'WEIGHTED' && (
                  <Input name={`w-${u.id}`} type="number" min={1} max={100} defaultValue={rule?.weights[u.id] ?? 1} aria-label={`Trọng số ${u.fullName}`} className="h-8 w-20" />
                )}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Hạn nhận (phút)" htmlFor="acceptSlaMinutes">
          <Input id="acceptSlaMinutes" name="acceptSlaMinutes" type="number" min={1} max={1440} defaultValue={rule?.acceptSlaMinutes ?? 10} />
        </Field>
        <Field label="Hạn nhận lead HOT" htmlFor="hotAcceptSlaMinutes">
          <Input id="hotAcceptSlaMinutes" name="hotAcceptSlaMinutes" type="number" min={1} max={1440} defaultValue={rule?.hotAcceptSlaMinutes ?? 5} />
        </Field>
        <Field label="Hạn liên hệ đầu tiên" htmlFor="firstContactSlaMinutes">
          <Input id="firstContactSlaMinutes" name="firstContactSlaMinutes" type="number" min={1} max={1440} defaultValue={rule?.firstContactSlaMinutes ?? 30} />
        </Field>
        <Field label="Thu hồi tối đa (lần)" htmlFor="maxReassign">
          <Input id="maxReassign" name="maxReassign" type="number" min={0} max={20} defaultValue={rule?.maxReassign ?? 3} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="autoAccept" defaultChecked={rule?.autoAccept} className="size-4" /> Tự nhận (bỏ bước bấm “Nhận”)
      </label>
      <Field label="Khi không còn ai nhận được" htmlFor="fallback">
        <Select id="fallback" name="fallback" defaultValue={rule?.fallback ?? 'QUEUE'}>
          <option value="QUEUE">Vào hàng chờ, báo Owner</option>
          <option value="NEXT_RULE">Thử luật kế tiếp</option>
        </Select>
      </Field>
      <fieldset className="flex flex-col gap-3 rounded-xl border border-border p-3">
        <legend className="px-1 text-sm font-medium">Điều kiện (bỏ trống = mọi lead)</legend>
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Nguồn</p>
          <Checks name="sources" options={Object.entries(LEAD_SOURCE_LABELS)} selected={rule?.conditions.sources} />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Mô hình kinh doanh</p>
          <Checks name="businessModels" options={Object.entries(BUSINESS_MODEL_LABELS)} selected={rule?.conditions.businessModels} />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Mức nhập</p>
          <Checks name="orderBands" options={Object.entries(ORDER_BAND_LABELS)} selected={rule?.conditions.orderBands} />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Mức ưu tiên</p>
          <Checks name="priorities" options={[['HOT', 'HOT'], ['WARM', 'Ấm'], ['COLD', 'Thường']]} selected={rule?.conditions.priorities} />
        </div>
        <Field label="Tỉnh/thành (cách nhau dấu phẩy)" htmlFor="provinces">
          <Input id="provinces" name="provinces" defaultValue={rule?.conditions.provinces?.join(', ') ?? ''} />
        </Field>
      </fieldset>
      <FormError message={error} />
      <Button type="submit" disabled={busy}>
        {busy ? 'Đang lưu…' : 'Lưu luật'}
      </Button>
    </form>
  );
}

export function RulesEditor({ rules, users }: { rules: RuleView[]; users: UserOpt[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<RuleView | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = (id: string) => users.find((u) => u.id === id)?.fullName ?? '(đã nghỉ)';

  async function move(i: number, dir: -1 | 1) {
    const ids = rules.map((r) => r.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    const res = await api('/api/v1/assignment-rules/reorder', { body: { ids } });
    if (!res.ok) return setError(res.error?.message ?? null);
    router.refresh();
  }

  async function remove(r: RuleView) {
    if (!confirm(`Xóa luật "${r.name}"? (Luật đã dùng sẽ được tắt thay vì xóa)`)) return;
    const res = await api(`/api/v1/assignment-rules/${r.id}`, { method: 'DELETE' });
    if (!res.ok) return setError(res.error?.message ?? null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2" data-testid="rules">
      {rules.map((r, i) => (
        <Card key={r.id} className={cn('flex flex-col gap-2 sm:flex-row sm:items-center', !r.isActive && 'opacity-60')}>
          <div className="flex shrink-0 gap-1 sm:flex-col">
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 hover:bg-muted disabled:opacity-30" aria-label={`Đưa "${r.name}" lên`}>
              <ArrowUp className="size-4" />
            </button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === rules.length - 1} className="rounded p-1 hover:bg-muted disabled:opacity-30" aria-label={`Đưa "${r.name}" xuống`}>
              <ArrowDown className="size-4" />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {i + 1}. {r.name} {!r.isActive && <span className="text-xs font-normal text-muted-foreground">(đang tắt)</span>}
            </p>
            <p className="text-sm text-muted-foreground">{describeConditions(r.conditions)}</p>
            <p className="text-sm">
              {ASSIGNMENT_METHOD_LABELS[r.method]}
              {r.method !== 'MANUAL' && ` · ${r.targetUserIds.length ? r.targetUserIds.map(name).join(', ') : 'mọi sales'}`}
            </p>
            <p className="text-xs text-muted-foreground">
              Hạn nhận {r.acceptSlaMinutes}′ (HOT {r.hotAcceptSlaMinutes}′) · liên hệ đầu tiên {r.firstContactSlaMinutes}′ · thu hồi tối đa {r.maxReassign} lần
              {r.autoAccept ? ' · tự nhận' : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
              Sửa
            </Button>
            <Button size="sm" variant="ghost" onClick={() => remove(r)}>
              Xóa
            </Button>
          </div>
        </Card>
      ))}
      <FormError message={error} />
      <Button variant="outline" onClick={() => setEditing('new')} className="self-start">
        <Plus className="size-4" /> Thêm luật
      </Button>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Thêm luật chia' : 'Sửa luật chia'} className="max-w-2xl">
        {editing !== null && <RuleForm rule={editing === 'new' ? null : editing} users={users} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}

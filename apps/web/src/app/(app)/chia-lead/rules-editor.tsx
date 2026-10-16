'use client';

import {
  ASSIGNMENT_METHOD_LABELS, BUSINESS_MODEL_LABELS, formatDateTime, INTEREST_CATEGORY_LABELS, LEAD_SOURCE_LABELS, ORDER_BAND_LABELS, PRIORITY_LABELS, USER_STATUS_LABELS,
} from '@michio/shared';
import { ArrowDown, ArrowUp, FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/client';

interface Rule {
  id: string;
  name: string;
  isActive: boolean;
  conditions: Record<string, unknown>;
  targetUserIds: string[];
  method: keyof typeof ASSIGNMENT_METHOD_LABELS;
  autoAccept: boolean;
  acceptSlaMinutes: number;
  hotAcceptSlaMinutes: number;
  firstContactSlaMinutes: number;
  maxReassign: number;
  fallback: 'NEXT_RULE' | 'QUEUE';
  rrCursor: number;
}
interface U { id: string; fullName: string; role: string; status: string; openLeads: number; maxOpenLeads: number }
interface Settings {
  'sla.businessHoursOnly': boolean;
  'assignment.outOfHoursMode': 'ASSIGN_NOW' | 'HOLD';
  'assignment.keepCustomerOwner': boolean;
  'assignment.preferPreviousOwner': boolean;
  'assignment.reclaimOnContactSlaBreach': boolean;
  'priority.byOrderBand': Record<string, 'HOT' | 'WARM' | 'COLD'>;
}

const RULE_METHODS = ['ROUND_ROBIN', 'WEIGHTED', 'LEAST_LOADED', 'MANUAL'] as const;
const COND_LISTS = [
  { key: 'sources', label: 'Nguồn', options: LEAD_SOURCE_LABELS },
  { key: 'businessModels', label: 'Mô hình kinh doanh', options: BUSINESS_MODEL_LABELS },
  { key: 'orderBands', label: 'Mức nhập', options: ORDER_BAND_LABELS },
  { key: 'interestCategories', label: 'Nhóm hàng', options: INTEREST_CATEGORY_LABELS },
] as const;

function conditionSummary(c: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const { key, label, options } of COND_LISTS) {
    const v = c[key] as string[] | undefined;
    if (v?.length) parts.push(`${label}: ${v.map((x) => (options as Record<string, string>)[x] ?? x).join(', ')}`);
  }
  if ((c.provinces as string[] | undefined)?.length) parts.push(`Tỉnh: ${(c.provinces as string[]).join(', ')}`);
  if (c.timeWindow) parts.push(c.timeWindow === 'BUSINESS_HOURS' ? 'Trong giờ làm việc' : 'Ngoài giờ');
  return parts.length ? parts.join(' · ') : 'Mọi lead';
}

export function RulesEditor({ rules, users, settings }: { rules: Rule[]; users: U[]; settings: Settings }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const userName = (id: string) => users.find((u) => u.id === id)?.fullName ?? 'Người dùng đã nghỉ';

  async function call(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast(ok);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Thao tác thất bại', 'error');
    }
  }

  function move(i: number, dir: -1 | 1) {
    const ids = rules.map((r) => r.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
    void call(() => api('/api/v1/assignment-rules/reorder', { body: { ids } }), 'Đã đổi thứ tự');
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {rules.map((r, i) => (
          <div key={r.id} className={`rounded-xl border bg-surface p-4 ${r.isActive ? 'border-border' : 'border-dashed border-border opacity-70'}`} data-testid="rule-card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">
                  {i + 1}. {r.name} {!r.isActive && <span className="text-xs font-normal text-muted-foreground">(đang tắt)</span>}
                  {i === rules.length - 1 && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">Mặc định</span>}
                </p>
                <p className="text-sm text-muted-foreground">{conditionSummary(r.conditions)}</p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" aria-label="Lên" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                <Button size="sm" variant="ghost" aria-label="Xuống" disabled={i === rules.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(r)}><Pencil className="size-4" aria-hidden />Sửa</Button>
                {rules.length > 1 && (
                  <Button size="sm" variant="ghost" aria-label={`Xóa luật ${r.name}`} onClick={() => confirm(`Xóa luật "${r.name}"?`) && call(() => api(`/api/v1/assignment-rules/${r.id}`, { method: 'DELETE' }), 'Đã xóa luật')}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div><dt className="inline text-muted-foreground">Cách chia: </dt><dd className="inline">{ASSIGNMENT_METHOD_LABELS[r.method]}{r.autoAccept && ' · tự nhận'}</dd></div>
              <div><dt className="inline text-muted-foreground">Thời hạn nhận: </dt><dd className="inline">{r.acceptSlaMinutes} phút (lead nóng {r.hotAcceptSlaMinutes} phút)</dd></div>
              <div><dt className="inline text-muted-foreground">Liên hệ đầu tiên: </dt><dd className="inline">{r.firstContactSlaMinutes} phút sau khi nhận</dd></div>
              <div><dt className="inline text-muted-foreground">Thu hồi tối đa: </dt><dd className="inline">{r.maxReassign} lần, sau đó {r.fallback === 'QUEUE' ? 'vào hàng chờ' : 'sang luật kế tiếp'}</dd></div>
              <div className="sm:col-span-2">
                <dt className="inline text-muted-foreground">Người nhận: </dt>
                <dd className="inline">
                  {r.targetUserIds.length
                    ? r.targetUserIds.map((id, k) => (
                        <span key={id}>
                          {k > 0 && ', '}
                          {r.method === 'ROUND_ROBIN' && k === r.rrCursor % r.targetUserIds.length ? <strong title="Lượt kế tiếp">▶ {userName(id)}</strong> : userName(id)}
                        </span>
                      ))
                    : '—'}
                </dd>
              </div>
            </dl>
          </div>
        ))}
        <div>
          <Button variant="outline" onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden />Thêm luật</Button>
        </div>
      </div>

      <TeamStatus users={users} />
      <Simulator />
      <AssignmentSettings settings={settings} onSaved={() => router.refresh()} />

      <RuleDialog
        key={editing === 'new' ? 'new' : editing?.id ?? 'none'}
        rule={editing === 'new' ? null : editing}
        open={editing !== null}
        users={users}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function TeamStatus({ users }: { users: U[] }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-2 text-sm font-semibold">Tình trạng nhận lead</h2>
      <ul className="grid gap-2 text-sm sm:grid-cols-3">
        {users.filter((u) => u.role === 'SALES').map((u) => (
          <li key={u.id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
            <span>{u.fullName}</span>
            <span className="text-muted-foreground">{USER_STATUS_LABELS[u.status as keyof typeof USER_STATUS_LABELS]} · {u.openLeads}/{u.maxOpenLeads}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RuleDialog({ rule, open, users, onClose, onSaved }: { rule: Rule | null; open: boolean; users: U[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const c = rule?.conditions ?? {};

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const list = (k: string) => f.getAll(k).map(String);
    const conditions: Record<string, unknown> = {};
    for (const { key } of COND_LISTS) if (list(key).length) conditions[key] = list(key);
    const provinces = String(f.get('provinces') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (provinces.length) conditions.provinces = provinces;
    if (f.get('timeWindow')) conditions.timeWindow = f.get('timeWindow');
    const body = {
      name: String(f.get('name')),
      isActive: f.get('isActive') === 'on',
      method: f.get('method'),
      autoAccept: f.get('autoAccept') === 'on',
      targetUserIds: list('targetUserIds'),
      acceptSlaMinutes: Number(f.get('acceptSlaMinutes')),
      hotAcceptSlaMinutes: Number(f.get('hotAcceptSlaMinutes')),
      firstContactSlaMinutes: Number(f.get('firstContactSlaMinutes')),
      maxReassign: Number(f.get('maxReassign')),
      fallback: f.get('fallback'),
      conditions,
    };
    setBusy(true);
    try {
      await api(rule ? `/api/v1/assignment-rules/${rule.id}` : '/api/v1/assignment-rules', { method: rule ? 'PATCH' : 'POST', body });
      toast('Đã lưu luật');
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={rule ? `Sửa luật "${rule.name}"` : 'Thêm luật'} wide>
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field id="r-name" label="Tên luật"><Input id="r-name" name="name" defaultValue={rule?.name ?? ''} required /></Field>
        </div>
        <Field id="r-method" label="Cách chia">
          <Select id="r-method" name="method" defaultValue={rule?.method ?? 'ROUND_ROBIN'}>
            {RULE_METHODS.map((m) => <option key={m} value={m}>{ASSIGNMENT_METHOD_LABELS[m]}</option>)}
          </Select>
        </Field>
        <Field id="r-fallback" label="Khi không còn ai phù hợp">
          <Select id="r-fallback" name="fallback" defaultValue={rule?.fallback ?? 'QUEUE'}>
            <option value="QUEUE">Vào hàng chờ, báo Owner</option>
            <option value="NEXT_RULE">Thử luật kế tiếp</option>
          </Select>
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-medium">Người nhận (theo thứ tự xoay vòng)</legend>
          <div className="flex flex-wrap gap-3">
            {users.map((u) => (
              <label key={u.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="targetUserIds" value={u.id} defaultChecked={rule ? rule.targetUserIds.includes(u.id) : u.role === 'SALES'} className="size-4 accent-[var(--primary)]" />
                {u.fullName}
              </label>
            ))}
          </div>
        </fieldset>
        <Field id="r-sla" label="Thời hạn nhận (phút)"><Input id="r-sla" name="acceptSlaMinutes" type="number" min={1} defaultValue={rule?.acceptSlaMinutes ?? 10} /></Field>
        <Field id="r-hot" label="Thời hạn nhận lead nóng (phút)"><Input id="r-hot" name="hotAcceptSlaMinutes" type="number" min={1} defaultValue={rule?.hotAcceptSlaMinutes ?? 5} /></Field>
        <Field id="r-contact" label="Liên hệ đầu tiên sau khi nhận (phút)"><Input id="r-contact" name="firstContactSlaMinutes" type="number" min={1} defaultValue={rule?.firstContactSlaMinutes ?? 30} /></Field>
        <Field id="r-max" label="Thu hồi tối đa (lần)"><Input id="r-max" name="maxReassign" type="number" min={1} max={20} defaultValue={rule?.maxReassign ?? 3} /></Field>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={rule?.isActive ?? true} className="size-4 accent-[var(--primary)]" />Đang bật</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="autoAccept" defaultChecked={rule?.autoAccept ?? false} className="size-4 accent-[var(--primary)]" />Tự nhận (bỏ bước bấm Nhận)</label>
        </div>
        <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:col-span-2">
          <legend className="px-1 text-sm font-medium">Điều kiện (để trống = mọi lead)</legend>
          {COND_LISTS.map(({ key, label, options }) => (
            <div key={key}>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {Object.entries(options).map(([k, v]) => (
                  <label key={k} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name={key} value={k} defaultChecked={((c[key] as string[] | undefined) ?? []).includes(k)} className="size-4 accent-[var(--primary)]" />
                    {v}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <Field id="r-prov" label="Tỉnh/thành" hint="Cách nhau dấu phẩy">
            <Input id="r-prov" name="provinces" defaultValue={((c.provinces as string[] | undefined) ?? []).join(', ')} />
          </Field>
          <Field id="r-time" label="Khung giờ">
            <Select id="r-time" name="timeWindow" defaultValue={(c.timeWindow as string | undefined) ?? ''}>
              <option value="">Mọi lúc</option>
              <option value="BUSINESS_HOURS">Trong giờ làm việc</option>
              <option value="OUT_OF_HOURS">Ngoài giờ</option>
            </Select>
          </Field>
        </fieldset>
        <Button type="submit" disabled={busy} className="sm:col-span-2">Lưu luật</Button>
      </form>
    </Dialog>
  );
}

interface SimResult {
  trace: { name: string; matched: boolean }[];
  result: { kind: 'ASSIGN'; ruleName: string; user: { fullName: string }; acceptDeadline: string; inBusinessHours: boolean; priority: string } | { kind: 'QUEUE'; ruleName: string | null };
}

/** "Thử luật" (SPEC 6.12): enter a fake lead, see who would receive it right now. */
function Simulator() {
  const [res, setRes] = useState<SimResult | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      setRes(
        await api<SimResult>('/api/v1/assignment-rules/simulate', {
          body: {
            source: f.get('source'),
            businessModel: f.get('businessModel') || null,
            orderBand: f.get('orderBand') || null,
            interestCategories: f.get('cat') ? [f.get('cat')] : [],
            province: f.get('province') || null,
          },
        }),
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lỗi', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4" data-testid="simulator">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><FlaskConical className="size-4" aria-hidden />Thử luật</h2>
      <form onSubmit={submit} className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <Select name="source" aria-label="Nguồn" defaultValue="WEBSITE_WHOLESALE_FORM" className="col-span-2">
          {Object.entries(LEAD_SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select name="businessModel" aria-label="Mô hình">
          <option value="">Mô hình…</option>
          {Object.entries(BUSINESS_MODEL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select name="orderBand" aria-label="Mức nhập">
          <option value="">Mức nhập…</option>
          {Object.entries(ORDER_BAND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select name="cat" aria-label="Nhóm hàng">
          <option value="">Nhóm hàng…</option>
          {Object.entries(INTEREST_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Input name="province" placeholder="Tỉnh/thành" aria-label="Tỉnh/thành" />
        <Button type="submit" disabled={busy} className="col-span-2 sm:col-span-6 sm:justify-self-start">Thử</Button>
      </form>
      {res && (
        <div className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm" role="status" data-testid="simulation-result">
          {res.result.kind === 'ASSIGN' ? (
            <p>
              → Luật <strong>{res.result.ruleName}</strong> giao cho <strong>{res.result.user.fullName}</strong> (lead {PRIORITY_LABELS[res.result.priority as keyof typeof PRIORITY_LABELS]?.toLowerCase()}), hạn nhận {formatDateTime(new Date(res.result.acceptDeadline))}
              {!res.result.inBusinessHours && ' — hiện đang ngoài giờ, đồng hồ chạy từ đầu ca kế tiếp'}.
            </p>
          ) : (
            <p>→ Vào hàng chờ giao tay{res.result.ruleName ? ` (luật "${res.result.ruleName}")` : ' (không luật nào khớp)'}.</p>
          )}
        </div>
      )}
    </div>
  );
}

function AssignmentSettings({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const toast = useToast();
  async function save(key: keyof Settings, value: unknown) {
    try {
      await api(`/api/v1/settings/${key}`, { method: 'PUT', body: { value } });
      toast('Đã lưu cài đặt');
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không lưu được', 'error');
    }
  }
  const toggles: [keyof Settings, string][] = [
    ['sla.businessHoursOnly', 'Chỉ tính thời hạn trong giờ làm việc'],
    ['assignment.keepCustomerOwner', 'Khách đã mua quay lại → giao thẳng sales phụ trách'],
    ['assignment.preferPreviousOwner', 'Khách từng "không thành công" quay lại → ưu tiên sales cũ'],
    ['assignment.reclaimOnContactSlaBreach', 'Thu hồi lead khi quá hạn liên hệ đầu tiên (mặc định chỉ cảnh báo)'],
  ];
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold">Cài đặt chia lead</h2>
      <div className="flex flex-col gap-2 text-sm">
        {toggles.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" defaultChecked={settings[k] as boolean} onChange={(e) => save(k, e.target.checked)} className="size-4 accent-[var(--primary)]" />
            {label}
          </label>
        ))}
        <label className="mt-1 flex flex-wrap items-center gap-2">
          Lead đến ngoài giờ / Chủ nhật:
          <Select className="w-auto" defaultValue={settings['assignment.outOfHoursMode']} onChange={(e) => save('assignment.outOfHoursMode', e.target.value)} aria-label="Lead ngoài giờ">
            <option value="ASSIGN_NOW">Chia ngay (đồng hồ chạy từ đầu ca)</option>
            <option value="HOLD">Giữ lại, chia lúc 08:00</option>
          </Select>
        </label>
        <div className="mt-2">
          <p className="mb-1 text-muted-foreground">Mức ưu tiên theo mức nhập</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(ORDER_BAND_LABELS).map(([band, label]) => (
              <label key={band} className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-1.5">
                {label}
                <Select
                  className="h-8 w-auto"
                  defaultValue={settings['priority.byOrderBand'][band] ?? 'COLD'}
                  onChange={(e) => save('priority.byOrderBand', { ...settings['priority.byOrderBand'], [band]: e.target.value })}
                  aria-label={`Ưu tiên ${label}`}
                >
                  {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

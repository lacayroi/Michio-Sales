// S6 Hộp thư (SPEC 6.4): list (lọc của tôi / chưa đọc / chưa trả lời / kênh) — chat — thẻ khách.
// Mobile: list → chat → "Thông tin khách" toggles the card.
import { can } from '@michio/auth/permissions';
import { DomainError, getConversation, listColleagues, listConversations, listQuickReplies, messagePreview, updateConversation } from '@michio/core';
import { formatDateTime } from '@michio/shared';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { serviceContext } from '@/lib/services';
import { requireUser } from '@/lib/session';
import { cn } from '@/lib/utils';
import { mockMode } from '@/lib/zalo-bot';
import { Chat, type ChatMessage } from './chat';
import { CustomerCard } from './customer-card';
import { MessengerSimulator } from './simulator';

export const metadata = { title: 'Hộp thư' };

type SP = Record<string, string | undefined>;

const VIEWS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'mine', label: 'Của tôi' },
  { key: 'unread', label: 'Chưa đọc' },
  { key: 'unanswered', label: 'Chưa trả lời' },
] as const;

const CHANNEL_LABEL: Record<string, string> = { FACEBOOK_PAGE: 'Messenger', ZALO_COMPANY: 'Zalo công ty', ZALO_OA: 'Zalo OA' };

export default async function InboxPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser('conversation.view');
  const sp = await searchParams;
  const ctx = serviceContext(user);
  const view = (VIEWS.find((v) => v.key === sp.view)?.key ?? (user.role === 'SALES' ? 'mine' : 'all')) as (typeof VIEWS)[number]['key'];
  const list = await listConversations(ctx, { view, channel: sp.channel as never, q: sp.q, cursor: sp.cursor, limit: 40 });

  let thread: Awaited<ReturnType<typeof getConversation>> | null = null;
  if (sp.c) {
    thread = await getConversation(ctx, sp.c).catch((err) => {
      if (err instanceof DomainError && err.code === 'NOT_FOUND') notFound();
      throw err;
    });
    // Opening a thread marks it read for whoever handles it.
    if (thread.canReply && thread.conversation.unreadCount > 0) await updateConversation(ctx, sp.c, { read: true });
  }
  const [quickReplies, colleagues] = thread ? await Promise.all([listQuickReplies(ctx), listColleagues(ctx)]) : [[], []];
  const qs = (over: SP) => {
    const p = new URLSearchParams(Object.entries({ view, channel: sp.channel, q: sp.q, ...over }).filter(([, v]) => v) as [string, string][]);
    return `/hop-thu?${p}`;
  };

  const conv = thread?.conversation;
  const messages: ChatMessage[] =
    thread?.messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      kind: m.kind,
      text: m.text,
      attachments: m.attachments as ChatMessage['attachments'],
      status: m.status,
      error: m.error,
      createdAt: m.createdAt.toISOString(),
      sentBy: m.sentBy?.fullName ?? null,
    })) ?? [];

  return (
    <section className="-m-4 flex h-[calc(100dvh-60px)] flex-col lg:-m-6">
      <div className="grid min-h-0 flex-1 lg:grid-cols-[22rem_1fr] xl:grid-cols-[22rem_1fr_20rem]">
        {/* Column 1: list */}
        <aside className={cn('flex min-h-0 flex-col border-r border-border bg-surface', conv && 'hidden lg:flex')} aria-label="Danh sách hội thoại">
          <div className="border-b border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <h1 className="text-lg font-semibold">Hộp thư</h1>
              {mockMode() && can(user.role, 'conversation.view') && <MessengerSimulator />}
            </div>
            <form role="search" className="mb-2" action="/hop-thu">
              <input type="hidden" name="view" value={view} />
              <Input name="q" defaultValue={sp.q} placeholder="Tìm tên, shop, SĐT" aria-label="Tìm hội thoại" />
            </form>
            <nav className="flex flex-wrap gap-1" aria-label="Lọc hội thoại">
              {VIEWS.map((v) => (
                <Link key={v.key} href={qs({ view: v.key, cursor: undefined, c: undefined })} aria-current={view === v.key ? 'page' : undefined}
                  className={cn('rounded-full px-3 py-1 text-xs font-medium', view === v.key ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70')}>
                  {v.label}
                </Link>
              ))}
            </nav>
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" data-testid="conversation-list">
            {list.items.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Chưa có hội thoại</li>}
            {list.items.map((c) => {
              const last = c.messages[0];
              const unanswered = last?.direction === 'IN';
              return (
                <li key={c.id}>
                  <Link href={qs({ c: c.id })} className={cn('flex gap-3 px-3 py-3 hover:bg-muted', sp.c === c.id && 'bg-primary/5')}>
                    <Avatar name={c.customer.contactName} url={c.customer.avatarUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={cn('truncate text-sm', c.unreadCount ? 'font-semibold' : 'font-medium')}>{c.customer.shopName ?? c.customer.contactName}</span>
                        {c.lastMessageAt && <span className="shrink-0 text-[11px] text-muted-foreground">{formatDateTime(c.lastMessageAt).slice(0, 16)}</span>}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={cn('truncate text-xs', c.unreadCount ? 'text-foreground' : 'text-muted-foreground')}>
                          {last ? `${last.direction === 'OUT' ? 'Bạn: ' : ''}${messagePreview(last)}` : '—'}
                        </span>
                        {c.unreadCount > 0 && <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] font-bold leading-5 text-accent-foreground">{c.unreadCount}</span>}
                      </span>
                      <span className="mt-0.5 flex gap-2 text-[11px] text-muted-foreground">
                        <span>{CHANNEL_LABEL[c.channelAccount.type] ?? c.channelAccount.type}</span>
                        {c.lead && <span>· #{c.lead.code}{c.lead.owner ? ` · ${c.lead.owner.fullName}` : ''}</span>}
                        {unanswered && !c.unreadCount && <span className="text-accent-text">· chưa trả lời</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {list.nextCursor && (
            <div className="border-t border-border p-2 text-center">
              <Link href={qs({ cursor: list.nextCursor })} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Xem thêm</Link>
            </div>
          )}
        </aside>

        {/* Column 2: chat */}
        {conv && thread ? (
          <Chat
            key={conv.id}
            conversationId={conv.id}
            title={conv.customer.shopName ?? conv.customer.contactName}
            subtitle={`${CHANNEL_LABEL[conv.channelAccount.type] ?? ''} · ${conv.channelAccount.name}`}
            backHref={qs({ c: undefined })}
            messages={messages}
            hasMore={thread.hasMore}
            canReply={thread.canReply}
            window={thread.window.ok ? { ok: true, mode: thread.window.mode, closesAt: thread.window.closesAt.toISOString() } : { ok: false, reason: thread.window.reason }}
            phone={conv.customer.phone}
            leadId={conv.leadId}
            quickReplies={quickReplies.map((q) => ({ shortcut: q.shortcut, content: q.content }))}
            vars={{ customerName: conv.customer.contactName, salesName: user.fullName, salesPhone: user.phone }}
            colleagues={colleagues.filter((u) => u.id !== user.id)}
            card={<CustomerCard conv={serializeCard(conv)} canEdit={thread.canReply} />}
          />
        ) : (
          <div className="hidden items-center justify-center p-8 text-center text-sm text-muted-foreground lg:flex">Chọn một hội thoại để xem tin nhắn</div>
        )}

        {/* Column 3: customer card (xl and up; smaller screens open it from the chat header) */}
        {conv && (
          <aside className="hidden min-h-0 overflow-y-auto border-l border-border bg-surface p-4 xl:block" aria-label="Thông tin khách">
            <CustomerCard conv={serializeCard(conv)} canEdit={thread!.canReply} />
          </aside>
        )}
      </div>
    </section>
  );
}

function serializeCard(conv: NonNullable<Awaited<ReturnType<typeof getConversation>>['conversation']>) {
  const deal = conv.lead?.deals[0];
  return {
    customerId: conv.customer.id,
    contactName: conv.customer.contactName,
    shopName: conv.customer.shopName,
    phone: conv.customer.phone,
    province: conv.customer.province,
    lifecycle: conv.customer.lifecycle,
    orderCount: conv.customer.orderCount,
    totalRevenue: Number(conv.customer.totalRevenue),
    ownerName: conv.customer.owner?.fullName ?? conv.lead?.owner?.fullName ?? null,
    lead: conv.lead ? { id: conv.lead.id, code: conv.lead.code, status: conv.lead.status, need: conv.lead.need, stage: deal?.stage.code ?? null } : null,
  };
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="size-10 shrink-0 rounded-full object-cover" />;
  }
  const initials = name.split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase();
  return <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-green/15 text-sm font-semibold text-primary dark:text-brand-green" aria-hidden>{initials}</span>;
}

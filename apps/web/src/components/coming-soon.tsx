import { navItem } from '@/lib/nav';
import { NavIcon } from './nav-icon';

/** Placeholder for screens scheduled in later milestones (SPEC §13). */
export function ComingSoon({ href }: { href: string }) {
  const item = navItem(href);
  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">{item.label}</h1>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center">
        <NavIcon name={item.icon} className="size-10 text-brand-green" />
        <p className="font-medium">Màn hình này đang được xây dựng</p>
        {item.milestone && <p className="text-sm text-muted-foreground">Dự kiến hoàn thành ở giai đoạn {item.milestone}.</p>}
      </div>
    </section>
  );
}

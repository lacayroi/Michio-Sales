import { ComingSoon } from '@/components/coming-soon';
import { navItem } from '@/lib/nav';
import { requireUser } from '@/lib/session';

const HREF = '/cai-dat';
export const metadata = { title: navItem(HREF).label };

export default async function Page() {
  const [first, ...rest] = navItem(HREF).anyOf;
  await requireUser(first, ...rest);
  return <ComingSoon href={HREF} />;
}

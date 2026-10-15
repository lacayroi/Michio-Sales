import {
  BarChart3, BellRing, ClipboardList, FileText, Home, Inbox, KanbanSquare, Package, ScrollText, Settings,
  Shuffle, ShoppingCart, SplitSquareHorizontal, UserCircle, Users, UsersRound, Zap,
} from 'lucide-react';
import type { NavIcon as NavIconName } from '@/lib/nav';

const ICONS = {
  home: Home,
  leads: Zap,
  inbox: Inbox,
  pipeline: KanbanSquare,
  customers: UsersRound,
  attention: BellRing,
  quotes: FileText,
  orders: ShoppingCart,
  tasks: ClipboardList,
  reports: BarChart3,
  products: Package,
  transfers: Shuffle,
  rules: SplitSquareHorizontal,
  users: Users,
  settings: Settings,
  audit: ScrollText,
  profile: UserCircle,
} satisfies Record<NavIconName, unknown>;

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = ICONS[name];
  return <Icon className={className} aria-hidden />;
}

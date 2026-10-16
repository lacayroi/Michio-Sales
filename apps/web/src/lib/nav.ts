// Menu definition (SPEC 10.2). Visibility is derived from the permission matrix, never from role names.
import { type Action, can, type Role } from '@michio/auth/permissions';

export type NavIcon =
  | 'home' | 'leads' | 'inbox' | 'pipeline' | 'customers' | 'attention' | 'quotes' | 'orders' | 'tasks'
  | 'reports' | 'products' | 'transfers' | 'rules' | 'users' | 'settings' | 'audit' | 'profile';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Visible when the role has any of these actions; empty = everyone signed in. */
  anyOf: Action[];
  group: 'main' | 'admin' | 'account';
  milestone?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Trang chủ', icon: 'home', anyOf: [], group: 'main' },
  { href: '/leads', label: 'Lead', icon: 'leads', anyOf: ['lead.view'], group: 'main' },
  { href: '/hop-thu', label: 'Hộp thư', icon: 'inbox', anyOf: ['conversation.view'], group: 'main', milestone: 'M3' },
  { href: '/pipeline', label: 'Pipeline', icon: 'pipeline', anyOf: ['deal.view'], group: 'main', milestone: 'M4' },
  { href: '/khach-hang', label: 'Khách hàng', icon: 'customers', anyOf: ['customer.view'], group: 'main' },
  { href: '/khach-can-cham', label: 'Khách cần chăm', icon: 'attention', anyOf: ['customer.update'], group: 'main', milestone: 'M5' },
  { href: '/bao-gia', label: 'Báo giá', icon: 'quotes', anyOf: ['quote.view'], group: 'main', milestone: 'M4' },
  { href: '/don-hang', label: 'Đơn sỉ', icon: 'orders', anyOf: ['order.view'], group: 'main', milestone: 'M4' },
  { href: '/viec-cua-toi', label: 'Việc của tôi', icon: 'tasks', anyOf: ['task.view'], group: 'main', milestone: 'M5' },
  { href: '/bao-cao', label: 'Báo cáo', icon: 'reports', anyOf: ['report.view', 'report.orders'], group: 'main', milestone: 'M5' },
  { href: '/san-pham', label: 'Sản phẩm & bảng giá', icon: 'products', anyOf: ['priceList.manage'], group: 'admin', milestone: 'M4' },
  { href: '/chia-lead', label: 'Chia lead', icon: 'rules', anyOf: ['assignmentRule.manage'], group: 'admin' },
  { href: '/chuyen-giao', label: 'Chuyển giao', icon: 'transfers', anyOf: ['transfer.manage'], group: 'admin', milestone: 'M5' },
  { href: '/nguoi-dung', label: 'Người dùng', icon: 'users', anyOf: ['user.view'], group: 'admin' },
  { href: '/cai-dat', label: 'Cài đặt & Tích hợp', icon: 'settings', anyOf: ['settings.manage', 'integration.manage'], group: 'admin' },
  { href: '/audit-log', label: 'Audit log', icon: 'audit', anyOf: ['auditLog.view'], group: 'admin', milestone: 'M5' },
  { href: '/ho-so', label: 'Hồ sơ', icon: 'profile', anyOf: [], group: 'account', milestone: 'M2' },
];

export function navFor(role: Role): NavItem[] {
  return NAV_ITEMS.filter((i) => i.anyOf.length === 0 || i.anyOf.some((a) => can(role, a)));
}

export function navItem(href: string): NavItem {
  const item = NAV_ITEMS.find((i) => i.href === href);
  if (!item) throw new Error(`Unknown nav item ${href}`);
  return item;
}

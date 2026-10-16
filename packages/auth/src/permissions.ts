// Permission matrix (SPEC §3). Edge-safe: no runtime imports.
// `ALL` = whole company, `OWN` = records the user is responsible for.
// Read-only access for SUPPORT/VIEWER is expressed by granting `*.view` without `*.update`.

export type Role = 'OWNER' | 'MANAGER' | 'SALES' | 'SUPPORT' | 'VIEWER';
export type Scope = 'ALL' | 'OWN';
export type Grants = Partial<Record<Role, Scope>>;

export const ROLES: readonly Role[] = ['OWNER', 'MANAGER', 'SALES', 'SUPPORT', 'VIEWER'];

const A = 'ALL' as const;
const O = 'OWN' as const;

export const PERMISSIONS = {
  // Lead / khách
  'lead.view': { OWNER: A, MANAGER: A, SALES: O, SUPPORT: A, VIEWER: A },
  'lead.create': { OWNER: A, MANAGER: A, SALES: O }, // SALES: tự giao cho mình
  'lead.update': { OWNER: A, MANAGER: A, SALES: O },
  'lead.assign': { OWNER: A, MANAGER: A },
  'lead.return': { SALES: O },
  'lead.bulkAssign': { OWNER: A, MANAGER: A },
  'customer.view': { OWNER: A, MANAGER: A, SALES: O, SUPPORT: A, VIEWER: A },
  'customer.create': { OWNER: A, MANAGER: A, SALES: O },
  'customer.update': { OWNER: A, MANAGER: A, SALES: O },
  'customer.merge': { OWNER: A, MANAGER: A, SALES: O },
  // Pipeline
  'deal.view': { OWNER: A, MANAGER: A, SALES: O, SUPPORT: A, VIEWER: A },
  'deal.update': { OWNER: A, MANAGER: A, SALES: O },
  // Hội thoại
  'conversation.view': { OWNER: A, MANAGER: A, SALES: O },
  'conversation.reply': { OWNER: A, MANAGER: A, SALES: O },
  // Báo giá / đơn
  'quote.view': { OWNER: A, MANAGER: A, SALES: O },
  'quote.manage': { OWNER: A, MANAGER: A, SALES: O },
  'quote.approve': { OWNER: A, MANAGER: A },
  'order.view': { OWNER: A, MANAGER: A, SALES: O, SUPPORT: A },
  'order.create': { OWNER: A, MANAGER: A, SALES: O },
  'order.updateFulfillment': { OWNER: A, MANAGER: A, SUPPORT: A }, // giao hàng / thanh toán
  // Sản phẩm & bảng giá
  'product.view': { OWNER: A, MANAGER: A, SALES: A, SUPPORT: A, VIEWER: A },
  'product.update': { OWNER: A }, // §8: PATCH /products/:id — Owner
  'priceList.manage': { OWNER: A, MANAGER: A },
  // Task
  'task.view': { OWNER: A, MANAGER: A, SALES: O, SUPPORT: O },
  'task.manage': { OWNER: A, MANAGER: A, SALES: O, SUPPORT: O },
  // Cấu hình
  'assignmentRule.manage': { OWNER: A, MANAGER: A }, // luật chia lead, SLA
  'settings.manage': { OWNER: A, MANAGER: A },
  'target.manage': { OWNER: A, MANAGER: A },
  'user.manage': { OWNER: A },
  'user.view': { OWNER: A, MANAGER: A }, // 6.1: Manager mở màn Người dùng để đặt lại mật khẩu
  'user.resetPassword': { OWNER: A, MANAGER: A },
  'transfer.manage': { OWNER: A, MANAGER: A },
  'import.manage': { OWNER: A, MANAGER: A },
  'integration.manage': { OWNER: A },
  'auditLog.view': { OWNER: A, MANAGER: A },
  'record.delete': { OWNER: A }, // xóa mềm
  // Báo cáo & xuất
  'report.view': { OWNER: A, MANAGER: A, SALES: O, VIEWER: A }, // SALES: bản thân
  'report.orders': { OWNER: A, MANAGER: A, SALES: O, SUPPORT: A, VIEWER: A },
  'export.reports': { OWNER: A, MANAGER: A, VIEWER: A },
  'export.orders': { OWNER: A, MANAGER: A, SUPPORT: A, VIEWER: A },
} as const satisfies Record<string, Grants>;

export type Action = keyof typeof PERMISSIONS;

export const ACTIONS = Object.keys(PERMISSIONS) as Action[];

/** Scope granted to a role for an action, or null when denied. */
export function scopeOf(role: Role, action: Action): Scope | null {
  return (PERMISSIONS[action] as Grants)[role] ?? null;
}

/** Capability check without a concrete resource (menus, buttons). */
export function can(role: Role, action: Action): boolean {
  return scopeOf(role, action) !== null;
}

// Table-driven test of the full permission matrix. The expected table below is transcribed
// independently from SPEC §3 so that drift in PERMISSIONS is caught.
import { describe, expect, it } from 'vitest';
import { ACTIONS, type Action, can, PERMISSIONS, ROLES, type Role, scopeOf } from './permissions';

type Cell = 'ALL' | 'OWN' | '-';
//                                   OWNER   MANAGER SALES   SUPPORT VIEWER
const EXPECTED: Record<Action, [Cell, Cell, Cell, Cell, Cell]> = {
  'lead.view':               ['ALL', 'ALL', 'OWN', 'ALL', 'ALL'], // Xem lead / khách (SUPPORT/VIEWER chỉ đọc)
  'lead.create':             ['ALL', 'ALL', 'OWN', '-',   '-'  ], // Tạo lead (SALES tự giao cho mình)
  'lead.update':             ['ALL', 'ALL', 'OWN', '-',   '-'  ], // Sửa lead / khách
  'lead.assign':             ['ALL', 'ALL', '-',   '-',   '-'  ], // Giao / chuyển lead
  'lead.return':             ['-',   '-',   'OWN', '-',   '-'  ], // SALES: chỉ "Trả lại"
  'lead.bulkAssign':         ['ALL', 'ALL', '-',   '-',   '-'  ], // §8 /leads/bulk-assign
  'customer.view':           ['ALL', 'ALL', 'OWN', 'ALL', 'ALL'],
  'customer.create':         ['ALL', 'ALL', 'OWN', '-',   '-'  ],
  'customer.update':         ['ALL', 'ALL', 'OWN', '-',   '-'  ],
  'customer.merge':          ['ALL', 'ALL', 'OWN', '-',   '-'  ], // §6.2 sales bấm "Gộp"
  'deal.view':               ['ALL', 'ALL', 'OWN', 'ALL', 'ALL'],
  'deal.update':             ['ALL', 'ALL', 'OWN', '-',   '-'  ],
  'conversation.view':       ['ALL', 'ALL', 'OWN', '-',   '-'  ], // Xem & nhắn hội thoại
  'conversation.reply':      ['ALL', 'ALL', 'OWN', '-',   '-'  ],
  'quote.view':              ['ALL', 'ALL', 'OWN', '-',   '-'  ], // Tạo báo giá / đơn
  'quote.manage':            ['ALL', 'ALL', 'OWN', '-',   '-'  ],
  'quote.approve':           ['ALL', 'ALL', '-',   '-',   '-'  ], // §6.6 vượt mức giảm → duyệt
  'order.view':              ['ALL', 'ALL', 'OWN', 'ALL', '-'  ],
  'order.create':            ['ALL', 'ALL', 'OWN', '-',   '-'  ],
  'order.updateFulfillment': ['ALL', 'ALL', '-',   'ALL', '-'  ], // Cập nhật giao hàng / thanh toán (SALES chỉ xem)
  'product.view':            ['ALL', 'ALL', 'ALL', 'ALL', 'ALL'],
  'product.update':          ['ALL', '-',   '-',   '-',   '-'  ], // §8 Owner sửa
  'priceList.manage':        ['ALL', 'ALL', '-',   '-',   '-'  ], // Sửa bảng giá sỉ
  'task.view':               ['ALL', 'ALL', 'OWN', 'OWN', '-'  ],
  'task.manage':             ['ALL', 'ALL', 'OWN', 'OWN', '-'  ],
  'assignmentRule.manage':   ['ALL', 'ALL', '-',   '-',   '-'  ], // Cấu hình chia lead, SLA
  'settings.manage':         ['ALL', 'ALL', '-',   '-',   '-'  ],
  'target.manage':           ['ALL', 'ALL', '-',   '-',   '-'  ],
  'user.manage':             ['ALL', '-',   '-',   '-',   '-'  ], // Quản lý người dùng
  'user.resetPassword':      ['ALL', 'ALL', '-',   '-',   '-'  ], // §6.1 Owner/Manager đặt lại mật khẩu
  'transfer.manage':         ['ALL', 'ALL', '-',   '-',   '-'  ], // Chuyển giao hàng loạt
  'import.manage':           ['ALL', 'ALL', '-',   '-',   '-'  ],
  'integration.manage':      ['ALL', '-',   '-',   '-',   '-'  ], // Cấu hình tích hợp
  'auditLog.view':           ['ALL', 'ALL', '-',   '-',   '-'  ], // Audit log
  'record.delete':           ['ALL', '-',   '-',   '-',   '-'  ], // Xóa (mềm)
  'report.view':             ['ALL', 'ALL', 'OWN', '-',   'ALL'], // Báo cáo (SALES: bản thân)
  'report.orders':           ['ALL', 'ALL', 'OWN', 'ALL', 'ALL'], // SUPPORT: báo cáo đơn hàng
  'export.reports':          ['ALL', 'ALL', '-',   '-',   'ALL'], // Xuất Excel
  'export.orders':           ['ALL', 'ALL', '-',   'ALL', 'ALL'], // SUPPORT: xuất đơn
};

describe('permission matrix (SPEC §3)', () => {
  it('covers exactly the defined actions', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ACTIONS].sort());
    expect(Object.keys(PERMISSIONS).length).toBe(ACTIONS.length);
  });

  const cases = ACTIONS.flatMap((action) =>
    ROLES.map((role, i) => [action, role, EXPECTED[action][i]] as [Action, Role, Cell]),
  );

  it.each(cases)('%s × %s → %s', (action, role, cell) => {
    expect(scopeOf(role, action) ?? '-').toBe(cell);
    expect(can(role, action)).toBe(cell !== '-');
  });

  it('MANAGER = OWNER except integrations, users, deletion (SPEC 1.5) and product edits (§8)', () => {
    const differing = ACTIONS.filter((a) => scopeOf('OWNER', a) !== scopeOf('MANAGER', a)).sort();
    expect(differing).toEqual(['integration.manage', 'product.update', 'record.delete', 'user.manage'].sort());
  });

  it('VIEWER never gets a write permission', () => {
    const writes = ACTIONS.filter((a) => !/\.(view|orders)$/.test(a) && !a.startsWith('export.'));
    for (const a of writes) expect(can('VIEWER', a), a).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { navFor } from './nav';

const labels = (role: Parameters<typeof navFor>[0]) => navFor(role).map((i) => i.label);

describe('navFor (menu đúng quyền)', () => {
  it('OWNER sees everything', () => {
    expect(labels('OWNER')).toHaveLength(17);
  });

  it('MANAGER sees everything (Người dùng read-only, for password resets)', () => {
    expect(labels('MANAGER')).toContain('Người dùng');
    expect(labels('MANAGER')).toContain('Cài đặt & Tích hợp');
    expect(labels('MANAGER')).toHaveLength(17);
  });

  it('SALES sees selling screens only', () => {
    expect(labels('SALES')).toEqual([
      'Trang chủ', 'Lead', 'Hộp thư', 'Pipeline', 'Khách hàng', 'Khách cần chăm',
      'Báo giá', 'Đơn sỉ', 'Việc của tôi', 'Báo cáo', 'Hồ sơ',
    ]);
  });

  it('SUPPORT sees orders and read-only customer data, no inbox or admin', () => {
    expect(labels('SUPPORT')).toEqual([
      'Trang chủ', 'Lead', 'Pipeline', 'Khách hàng', 'Đơn sỉ', 'Việc của tôi', 'Báo cáo', 'Hồ sơ',
    ]);
  });

  it('VIEWER sees read-only screens', () => {
    expect(labels('VIEWER')).toEqual(['Trang chủ', 'Lead', 'Pipeline', 'Khách hàng', 'Báo cáo', 'Hồ sơ']);
  });
});

// Vietnamese display labels for enum codes (SPEC 5.1, 6.x).

export const ROLE_LABELS = {
  OWNER: 'Chủ doanh nghiệp',
  MANAGER: 'Quản lý',
  SALES: 'Kinh doanh',
  SUPPORT: 'Hỗ trợ',
  VIEWER: 'Chỉ xem',
} as const;

export const USER_STATUS_LABELS = {
  AVAILABLE: 'Đang làm việc',
  BUSY: 'Bận',
  OFF: 'Nghỉ phép',
  INACTIVE: 'Đã nghỉ việc',
} as const;

export const BUSINESS_MODEL_LABELS = {
  JAPAN_STORE: 'Cửa hàng hàng Nhật',
  ONLINE_SHOP: 'Shop online',
  MINIMART: 'Minimart / siêu thị mini',
  RETAIL_AGENT: 'Đại lý bán lẻ',
  CAFE: 'Quán cafe / đồ uống',
  DISTRIBUTOR: 'Doanh nghiệp / đối tác phân phối',
  OTHER: 'Khác',
} as const;

export const ORDER_BAND_LABELS = {
  LT_5M: 'Dưới 5 triệu',
  B5_10M: '5–10 triệu',
  B10_30M: '10–30 triệu',
  B30_50M: '30–50 triệu',
  GT_50M: 'Trên 50 triệu',
  UNKNOWN: 'Chưa rõ',
} as const;

export const LEAD_SOURCE_LABELS = {
  WEBSITE_WHOLESALE_FORM: 'Form sỉ',
  WEBSITE_AGENT_FORM: 'Form đại lý',
  FACEBOOK_MESSENGER: 'Facebook Messenger',
  FACEBOOK_LEAD_ADS: 'Facebook Lead Ads',
  ZALO_COMPANY: 'Zalo công ty',
  ZALO_OA: 'Zalo OA',
  HOTLINE: 'Hotline',
  REFERRAL: 'Giới thiệu',
  IMPORT: 'Import',
  MANUAL: 'Nhập tay',
  OTHER: 'Khác',
} as const;

export const LIFECYCLE_LABELS = {
  PROSPECT: 'Tiềm năng',
  NEW_CUSTOMER: 'Khách mới',
  REPEAT: 'Khách quay lại',
  AT_RISK: 'Có nguy cơ rời bỏ',
  DORMANT: 'Ngủ đông',
} as const;

export const LEAD_STATUS_LABELS = {
  NEW: 'Mới',
  UNASSIGNED: 'Chờ giao',
  ASSIGNED: 'Chờ nhận',
  IN_PROGRESS: 'Đang xử lý',
  WON: 'Thành công',
  LOST: 'Không thành công',
} as const;

export const PRIORITY_LABELS = { HOT: 'Nóng', WARM: 'Ấm', COLD: 'Thường' } as const;

export const ASSIGNMENT_METHOD_LABELS = {
  ROUND_ROBIN: 'Xoay vòng',
  WEIGHTED: 'Theo trọng số',
  LEAST_LOADED: 'Ít lead nhất',
  MANUAL: 'Giao tay',
  TRANSFER: 'Chuyển giao',
  CUSTOMER_OWNER: 'Sales phụ trách khách',
  PREVIOUS_OWNER: 'Sales cũ',
} as const;

export const ASSIGNMENT_STATUS_LABELS = {
  PENDING: 'Chờ nhận',
  ACCEPTED: 'Đã nhận',
  RETURNED: 'Đã trả',
  EXPIRED: 'Thu hồi (quá hạn)',
  REASSIGNED: 'Đã chuyển',
} as const;

export const CALL_RESULT_LABELS = { ANSWERED: 'Nghe máy', NO_ANSWER: 'Không nghe', CALL_BACK: 'Hẹn gọi lại' } as const;

export const INTEREST_CATEGORY_LABELS: Record<string, string> = {
  MATCHA_TEA: 'Matcha & Trà',
  FOOD: 'Thực phẩm',
  DRINK: 'Đồ uống',
  HOUSEHOLD: 'Gia dụng',
  OTHER: 'Khác',
};

export const QUOTE_STATUS_LABELS = {
  DRAFT: 'Nháp',
  PENDING_APPROVAL: 'Chờ duyệt',
  SENT: 'Đã gửi',
  ACCEPTED: 'Khách đồng ý',
  REJECTED: 'Khách từ chối',
  EXPIRED: 'Hết hạn',
} as const;

export const PAYMENT_STATUS_LABELS = { UNPAID: 'Chưa thanh toán', PARTIAL: 'Thanh toán một phần', PAID: 'Đã thanh toán' } as const;

export const DELIVERY_STATUS_LABELS = { PENDING: 'Chờ xử lý', PACKING: 'Đang đóng gói', SHIPPING: 'Đang giao', DELIVERED: 'Đã giao', CANCELLED: 'Đã hủy' } as const;

export const PAYMENT_METHOD_LABELS = { BANK_TRANSFER: 'Chuyển khoản', CASH: 'Tiền mặt', CREDIT: 'Công nợ' } as const;

export const TASK_TYPE_LABELS = {
  CALL: 'Gọi điện',
  MESSAGE: 'Nhắn tin',
  SEND_QUOTE: 'Gửi báo giá',
  FOLLOW_UP: 'Follow-up',
  REORDER: 'Nhắc tái đặt',
  MEETING: 'Gặp khách',
  OTHER: 'Khác',
} as const;

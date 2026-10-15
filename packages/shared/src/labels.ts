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

// Static demo data for the seed (SPEC Phụ lục C). All names, phones, SKUs and prices are fake.

export const ORG_PROFILE = {
  legalName: 'Công ty Michio Việt Nam',
  address: 'Số 3 ngõ 204/9 Kim Giang, phường Định Công, Hà Nội',
  hotline: '0246.68.56.986',
  zaloPhone: '0337850791',
  website: 'https://michiovietnam.com',
  facebookPage: 'https://www.facebook.com/Michio.Hangnhatnoidia',
  taxCode: null,
  logoUrl: '/brand/logo.png',
};

export const WEEKLY_CALENDAR = [1, 2, 3, 4, 5, 6].map((dow) => ({
  dow,
  ranges: [
    ['08:00', '12:00'],
    ['13:30', '17:30'],
  ],
}));

/** Vietnam public holidays (Bộ luật Lao động 2019, Điều 112). Lunar dates resolved per year. */
const LUNAR_HOLIDAYS: Record<number, { date: string; name: string }[]> = {
  2026: [
    ...['2026-02-14', '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22'].map(
      (date) => ({ date, name: 'Tết Nguyên đán' }),
    ),
    { date: '2026-04-26', name: 'Giỗ Tổ Hùng Vương' },
    { date: '2026-04-27', name: 'Nghỉ bù Giỗ Tổ Hùng Vương' },
  ],
  2027: [
    ...['2027-02-05', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-02-10'].map((date) => ({
      date,
      name: 'Tết Nguyên đán',
    })),
    { date: '2027-04-16', name: 'Giỗ Tổ Hùng Vương' },
  ],
};

export function holidaysFor(year: number): { date: string; name: string }[] {
  return [
    { date: `${year}-01-01`, name: 'Tết Dương lịch' },
    ...(LUNAR_HOLIDAYS[year] ?? []),
    { date: `${year}-04-30`, name: 'Ngày Giải phóng miền Nam' },
    { date: `${year}-05-01`, name: 'Quốc tế Lao động' },
    { date: `${year}-09-01`, name: 'Quốc khánh' },
    { date: `${year}-09-02`, name: 'Quốc khánh' },
  ];
}

export const SETTINGS: Record<string, unknown> = {
  'sla.businessHoursOnly': true,
  'assignment.outOfHoursMode': 'ASSIGN_NOW',
  'assignment.keepCustomerOwner': true,
  'assignment.preferPreviousOwner': true,
  'assignment.reclaimOnContactSlaBreach': false,
  'priority.byOrderBand': {
    GT_50M: 'HOT',
    B30_50M: 'HOT',
    B10_30M: 'WARM',
    B5_10M: 'WARM',
    LT_5M: 'COLD',
    UNKNOWN: 'COLD',
  },
  'quote.validDays': 7,
  'quote.maxExtraDiscountPct': 0,
  'quote.followUpBusinessDays': 2,
  'reorder.defaultCycleDays': 30,
  'reorder.remindBeforeDays': 3,
  'reorder.dormantDays': 90,
  'lead.staleDays': 5,
  'notify.dailyDigestTime': '08:00',
  'notify.zaloOutsideHours': false,
  // Meta values must be re-checked against current Messenger Platform docs in M3 (SPEC 0.1.5).
  'facebook.standardWindowHours': 24,
  'facebook.humanAgentWindowDays': 7,
  'facebook.useHumanAgentTag': false,
  'zaloCompany.mode': 'QUICK_CAPTURE',
  'zaloCompany.minSecondsBetweenMessages': 3,
  'zaloCompany.maxMessagesPerDay': 300,
  'woo.syncIntervalHours': 6,
};

export const PIPELINE_STAGES = [
  { code: 'MOI', name: 'Mới', order: 1, probability: 10 },
  { code: 'DA_LIEN_HE', name: 'Đã liên hệ', order: 2, probability: 20 },
  { code: 'TU_VAN', name: 'Tư vấn nhóm hàng', order: 3, probability: 40 },
  { code: 'BAO_GIA', name: 'Đã gửi báo giá/chính sách', order: 4, probability: 60 },
  { code: 'CHOT', name: 'Chốt đơn', order: 5, probability: 100, isWon: true },
  { code: 'THUA', name: 'Không thành công', order: 6, probability: 0, isLost: true },
];

export const LOST_REASONS = [
  'Giá cao hơn nguồn khác',
  'Mức nhập tối thiểu không phù hợp',
  'Không có mặt hàng cần',
  'Chỉ hỏi giá / chưa có nhu cầu',
  'Không liên lạc được',
  'Chọn nhà cung cấp khác',
  'Khác',
];

export const CATEGORIES: { code: string; name: string; parent?: string }[] = [
  { code: 'MATCHA_TEA', name: 'Matcha & Trà Nhật' },
  { code: 'FOOD', name: 'Thực phẩm' },
  { code: 'CANDY', name: 'Bánh kẹo', parent: 'FOOD' },
  { code: 'SPICE', name: 'Gia vị', parent: 'FOOD' },
  { code: 'DRINK', name: 'Đồ uống' },
  { code: 'HOUSEHOLD', name: 'Gia dụng' },
  { code: 'ORAL_CARE', name: 'Chăm sóc răng miệng' },
  { code: 'PERSONAL_CARE', name: 'Chăm sóc cá nhân' },
  { code: 'MOM_BABY', name: 'Mẹ & Bé' },
  { code: 'HEALTH', name: 'Sức khỏe' },
  { code: 'BEAUTY', name: 'Sắc đẹp' },
];

/** [name, categoryCode, unit, unitsPerCase, retailPrice] */
export const PRODUCTS: [string, string, string, number, number][] = [
  ['Bột matcha Uji nguyên chất 100g', 'MATCHA_TEA', 'gói', 40, 285000],
  ['Bột matcha latte sữa 200g', 'MATCHA_TEA', 'gói', 30, 165000],
  ['Trà xanh Sencha túi lọc 50 gói', 'MATCHA_TEA', 'hộp', 24, 120000],
  ['Trà gạo rang Genmaicha 200g', 'MATCHA_TEA', 'gói', 30, 98000],
  ['Trà lúa mạch Mugicha 52 túi', 'MATCHA_TEA', 'gói', 20, 89000],
  ['Trà Hojicha rang 100g', 'MATCHA_TEA', 'gói', 40, 135000],
  ['Bánh quy kem matcha 12 cái', 'CANDY', 'hộp', 24, 79000],
  ['Kẹo dẻo trái cây vị nho 100g', 'CANDY', 'gói', 60, 35000],
  ['Bánh gạo nướng xì dầu 20 cái', 'CANDY', 'gói', 24, 65000],
  ['Socola thanh hạnh nhân 88g', 'CANDY', 'hộp', 40, 72000],
  ['Bánh ăn dặm cho bé vị rau củ', 'MOM_BABY', 'gói', 48, 55000],
  ['Rong biển nướng ăn liền 8 gói', 'FOOD', 'lốc', 40, 45000],
  ['Mì udon khô 300g', 'FOOD', 'gói', 30, 58000],
  ['Xì dầu Nhật thượng hạng 500ml', 'SPICE', 'chai', 12, 92000],
  ['Gia vị rắc cơm furikake cá hồi', 'SPICE', 'gói', 60, 42000],
  ['Nước dùng dashi cô đặc 1L', 'SPICE', 'chai', 12, 168000],
  ['Sốt mayonnaise Nhật 450g', 'SPICE', 'chai', 20, 85000],
  ['Nước uống ion bổ sung điện giải 500ml', 'DRINK', 'chai', 24, 28000],
  ['Cà phê hòa tan rang xay 80g', 'DRINK', 'lọ', 24, 175000],
  ['Nước ép đào trắng 280ml', 'DRINK', 'lon', 24, 32000],
  ['Sữa lắc vị dâu 200ml', 'DRINK', 'hộp', 24, 26000],
  ['Màng bọc thực phẩm 30cm x 50m', 'HOUSEHOLD', 'cuộn', 50, 65000],
  ['Miếng rửa chén 3 lớp (5 miếng)', 'HOUSEHOLD', 'gói', 60, 39000],
  ['Viên diệt gián dạng hộp (12 hộp)', 'HOUSEHOLD', 'hộp', 30, 145000],
  ['Nước giặt đậm đặc 900g', 'HOUSEHOLD', 'túi', 12, 115000],
  ['Nước rửa bát hương cam 240ml', 'HOUSEHOLD', 'chai', 24, 49000],
  ['Kem đánh răng than hoạt tính 120g', 'ORAL_CARE', 'tuýp', 48, 69000],
  ['Bàn chải lông mềm siêu mảnh (3 cây)', 'ORAL_CARE', 'vỉ', 60, 75000],
  ['Nước súc miệng không cồn 600ml', 'ORAL_CARE', 'chai', 12, 125000],
  ['Dầu gội thảo dược 500ml', 'PERSONAL_CARE', 'chai', 12, 189000],
  ['Sữa tắm hương hoa anh đào 500ml', 'PERSONAL_CARE', 'chai', 12, 159000],
  ['Khăn ướt không mùi 80 tờ', 'MOM_BABY', 'gói', 24, 45000],
  ['Tã dán sơ sinh size NB 90 miếng', 'MOM_BABY', 'bịch', 4, 395000],
  ['Bình sữa nhựa PPSU 240ml', 'MOM_BABY', 'cái', 24, 285000],
  ['Viên uống bổ sung canxi 60 ngày', 'HEALTH', 'lọ', 30, 420000],
  ['Viên uống vitamin C 90 ngày', 'HEALTH', 'gói', 40, 195000],
  ['Miếng dán giữ nhiệt 10 miếng', 'HEALTH', 'gói', 48, 89000],
  ['Kem chống nắng dạng gel SPF50 80g', 'BEAUTY', 'tuýp', 36, 265000],
  ['Mặt nạ dưỡng ẩm 7 miếng', 'BEAUTY', 'hộp', 40, 145000],
  ['Nước tẩy trang dịu nhẹ 400ml', 'BEAUTY', 'chai', 24, 175000],
];

export const LAST_NAMES = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Ngô', 'Dương', 'Lý'];
export const FEMALE_GIVEN = ['Thị Hoa', 'Thu Hà', 'Minh Anh', 'Thanh Hương', 'Ngọc Lan', 'Thị Mai', 'Phương Thảo', 'Kim Oanh', 'Hồng Nhung', 'Thùy Linh'];
export const MALE_GIVEN = ['Văn Hùng', 'Minh Tuấn', 'Quốc Bảo', 'Đức Anh', 'Văn Nam', 'Hoàng Long', 'Thành Công', 'Văn Tài'];

export const PROVINCES = [
  'Hà Nội',
  'Hà Nội',
  'Hà Nội',
  'TP. Hồ Chí Minh',
  'TP. Hồ Chí Minh',
  'Hải Phòng',
  'Đà Nẵng',
  'Quảng Ninh',
  'Bắc Ninh',
  'Nghệ An',
  'Thanh Hóa',
  'Cần Thơ',
  'Khánh Hòa',
  'Lâm Đồng',
  'Thái Nguyên',
  'Hưng Yên',
];

export const SHOP_PREFIX: Record<string, string[]> = {
  JAPAN_STORE: ['Hàng Nhật', 'Nhật Bản Store', 'Japan Mart', 'Sakura Shop'],
  ONLINE_SHOP: ['Shop', 'Tiệm online', 'Kho sỉ'],
  MINIMART: ['Minimart', 'Siêu thị mini', 'Mart'],
  RETAIL_AGENT: ['Đại lý', 'Cửa hàng'],
  CAFE: ['Cafe', 'Tiệm trà', 'Matcha Bar'],
  DISTRIBUTOR: ['Công ty TNHH', 'Công ty CP Phân phối'],
  OTHER: ['Cửa hàng'],
};

export const QUICK_REPLIES: [string, string][] = [
  ['chao', 'Dạ Michio Việt Nam xin chào {ten_khach} ạ! Em là {ten_sales}, em hỗ trợ anh/chị về chính sách sỉ hàng Nhật nội địa ạ.'],
  ['thongtin', 'Anh/chị cho em xin tên shop, khu vực và mô hình kinh doanh (cửa hàng, shop online, minimart…) để em tư vấn nhóm hàng phù hợp nhé ạ.'],
  ['chinhsach', 'Michio báo giá sỉ theo mã hàng và số lượng. Em gửi anh/chị chính sách sỉ và bảng giá theo nhóm hàng quan tâm ngay ạ.'],
  ['hengoi', 'Em xin phép gọi lại cho anh/chị trong hôm nay để tư vấn kỹ hơn ạ. SĐT/Zalo của em: {sdt_sales}.'],
  ['baogia', 'Em gửi anh/chị báo giá sỉ chi tiết ạ. Báo giá có hiệu lực 7 ngày, anh/chị xem và phản hồi giúp em nhé.'],
  ['giaohang', 'Michio giao hàng toàn quốc ạ. Đơn nội thành Hà Nội giao trong ngày, các tỉnh 2–4 ngày tùy khu vực.'],
  ['thanhtoan', 'Anh/chị có thể thanh toán chuyển khoản hoặc tiền mặt khi nhận hàng. Khách đại lý lâu năm được hỗ trợ công nợ theo chính sách ạ.'],
  ['camon', 'Em cảm ơn anh/chị {ten_khach} đã tin tưởng Michio ạ! Có gì cần anh/chị cứ nhắn em {ten_sales} nhé.'],
];

export const LEAD_NEEDS = [
  'Muốn lấy matcha latte và bánh kẹo cho bé',
  'Hỏi giá sỉ trà xanh và trà gạo rang',
  'Cần nguồn hàng gia dụng Nhật cho minimart',
  'Mở quán cafe, cần bột matcha số lượng lớn',
  'Shop online cần hàng mẹ & bé bán chạy',
  'Muốn làm đại lý khu vực',
  'Hỏi chính sách sỉ chăm sóc răng miệng',
  'Cần báo giá thực phẩm chức năng',
  'Nhập thêm mỹ phẩm Nhật cho cửa hàng',
  'Hỏi điều kiện giao hàng đi tỉnh',
];

export const INBOUND_MESSAGES = [
  'Chào shop, cho mình hỏi giá sỉ matcha với ạ',
  'Mình bán online, muốn lấy sỉ hàng mẹ và bé',
  'Bên mình có giao đi tỉnh không em?',
  'Số lượng tối thiểu để lấy giá sỉ là bao nhiêu?',
  'Gửi mình bảng giá nhé',
  'Ok em, để chị xem rồi báo lại',
];

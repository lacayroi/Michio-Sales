// Company profile (Organization.profile, SPEC 6.12 "thông tin công ty (dùng trên PDF)") and the
// data a quote PDF is rendered from (SPEC 6.6, 10.1). Shared by core (builds it) and pdf (draws it).

export interface CompanyProfile {
  legalName: string;
  address: string;
  hotline: string;
  zaloPhone?: string | null;
  website?: string | null;
  email?: string | null;
  facebookPage?: string | null;
  taxCode?: string | null;
  logoUrl?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  bankAccountName?: string | null;
  /** Default terms printed on quotes (giao hàng, thanh toán) — [CẦN XÁC NHẬN] SPEC 15.7. */
  quoteTerms?: string | null;
}

export const DEFAULT_QUOTE_TERMS =
  'Giá đã bao gồm VAT (nếu có yêu cầu xuất hóa đơn, vui lòng báo trước). Giao hàng toàn quốc; nội thành Hà Nội giao trong ngày, các tỉnh 2–4 ngày. Thanh toán chuyển khoản trước khi giao hoặc theo chính sách công nợ đã thỏa thuận.';

export interface QuotePdfLine {
  no: number;
  sku: string;
  name: string;
  unit: string | null;
  unitsPerCase: number | null;
  qty: number;
  unitPrice: number;
  discountPct: number;
  lineTotal: number;
  /** PNG/JPEG bytes fetched beforehand (never fetched while drawing). */
  image?: Buffer | null;
}

export interface QuotePdfData {
  code: string;
  createdAt: Date;
  validUntil: Date;
  company: CompanyProfile;
  customer: { name: string; contactName: string; phone: string | null; address: string | null; province: string | null; taxCode: string | null };
  sales: { name: string; phone: string | null; email: string | null };
  lines: QuotePdfLine[];
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  terms: string | null;
  priceListName: string | null;
}

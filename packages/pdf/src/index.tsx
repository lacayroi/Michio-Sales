/** @jsxRuntime automatic @jsxImportSource react */
// Wholesale quote PDF (SPEC 6.6, 10.1): logo top-left, thin green band, "BÁO GIÁ SỈ", company,
// customer, lines with thumbnail / SKU / pack size, totals, terms, sales contact; footer with
// hotline, website, address. Be Vietnam Pro for Vietnamese text. Runs in the worker (`quote-pdf`).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Document, Font, Image, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';
import { BRAND, formatDate, formatVnd, type QuotePdfData } from '@michio/shared';

const ROOT = path.resolve(import.meta.dirname, '..');
const font = (f: string) => path.join(ROOT, 'fonts', f);

let registered = false;
function registerFonts() {
  if (registered) return;
  Font.register({
    family: 'BeVietnamPro',
    fonts: [
      { src: font('BeVietnamPro-Regular.ttf'), fontWeight: 400 },
      { src: font('BeVietnamPro-SemiBold.ttf'), fontWeight: 600 },
      { src: font('BeVietnamPro-Bold.ttf'), fontWeight: 700 },
    ],
  });
  // Vietnamese words must not be hyphenated with English rules.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

let logo: Buffer | null = null;
const logoBytes = () => (logo ??= readFileSync(path.join(ROOT, 'assets', 'logo.png')));

const GREEN = BRAND.green;
const GREEN_STRONG = BRAND.greenStrong;
const INK = BRAND.neutral900;
const MUTED = '#5B6670';
const LINE = '#DDE3DF';

const s = StyleSheet.create({
  page: { fontFamily: 'BeVietnamPro', fontSize: 9, color: INK, paddingTop: 0, paddingBottom: 56, paddingHorizontal: 32 },
  band: { height: 5, backgroundColor: GREEN, marginHorizontal: -32, marginBottom: 18 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  logo: { width: 120, height: 46, objectFit: 'contain' },
  company: { alignItems: 'flex-end', maxWidth: 300 },
  companyName: { fontSize: 11, fontWeight: 700, color: GREEN_STRONG, textAlign: 'right' },
  small: { fontSize: 8, color: MUTED, textAlign: 'right' },
  title: { fontSize: 18, fontWeight: 700, color: GREEN_STRONG, textAlign: 'center', marginTop: 4, letterSpacing: 1 },
  meta: { textAlign: 'center', color: MUTED, marginBottom: 12 },
  boxes: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  box: { flex: 1, border: `1 solid ${LINE}`, borderRadius: 4, padding: 8 },
  boxTitle: { fontSize: 8, fontWeight: 600, color: GREEN_STRONG, textTransform: 'uppercase', marginBottom: 4 },
  bold: { fontWeight: 600 },
  table: { border: `1 solid ${LINE}`, borderRadius: 4 },
  th: { flexDirection: 'row', backgroundColor: '#EEF7F1', borderBottom: `1 solid ${LINE}`, fontWeight: 600, fontSize: 8 },
  tr: { flexDirection: 'row', borderBottom: `1 solid ${LINE}`, minHeight: 30, alignItems: 'center' },
  cell: { paddingVertical: 4, paddingHorizontal: 4 },
  thumb: { width: 24, height: 24, objectFit: 'contain' },
  totals: { alignSelf: 'flex-end', width: 230, marginTop: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  grand: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 5, marginTop: 3, borderTop: `1 solid ${GREEN}`, fontSize: 11, fontWeight: 700, color: GREEN_STRONG },
  terms: { marginTop: 14, padding: 8, backgroundColor: '#F7F8F7', borderRadius: 4 },
  footer: { position: 'absolute', bottom: 20, left: 32, right: 32, borderTop: `1 solid ${GREEN}`, paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: MUTED },
});

// Column widths (points) — A4 portrait content width is ~531pt.
const COLS = { no: 20, img: 30, name: 215, unit: 62, qty: 36, price: 62, disc: 34, total: 72 } as const;
const vnPhone = (p: string | null | undefined) => (p?.startsWith('+84') ? `0${p.slice(3)}` : (p ?? ''));
const money = (n: number) => formatVnd(n).replace(' ₫', '');

function QuoteDocument({ d }: { d: QuotePdfData }) {
  const c = d.company;
  return (
    <Document title={`Báo giá ${d.code}`} author={c.legalName} subject={`Báo giá sỉ cho ${d.customer.name}`} language="vi">
      <Page size="A4" style={s.page}>
        <View style={s.band} fixed />
        <View style={s.header}>
          <Image src={logoBytes()} style={s.logo} />
          <View style={s.company}>
            <Text style={s.companyName}>{c.legalName}</Text>
            {c.address ? <Text style={s.small}>{c.address}</Text> : null}
            <Text style={s.small}>
              Hotline: {c.hotline}
              {c.zaloPhone ? ` · Zalo: ${c.zaloPhone}` : ''}
            </Text>
            {c.website ? <Text style={s.small}>{c.website.replace(/^https?:\/\//, '')}</Text> : null}
            {c.taxCode ? <Text style={s.small}>MST: {c.taxCode}</Text> : null}
          </View>
        </View>

        <Text style={s.title}>BÁO GIÁ SỈ</Text>
        <Text style={s.meta}>
          Số {d.code} · Ngày {formatDate(d.createdAt)} · Hiệu lực đến {formatDate(d.validUntil)}
          {d.priceListName ? ` · ${d.priceListName}` : ''}
        </Text>

        <View style={s.boxes}>
          <View style={s.box}>
            <Text style={s.boxTitle}>Kính gửi</Text>
            <Text style={s.bold}>{d.customer.name}</Text>
            {d.customer.name !== d.customer.contactName ? <Text>Người liên hệ: {d.customer.contactName}</Text> : null}
            {d.customer.phone ? <Text>SĐT: {vnPhone(d.customer.phone)}</Text> : null}
            {d.customer.address || d.customer.province ? <Text>{[d.customer.address, d.customer.province].filter(Boolean).join(', ')}</Text> : null}
            {d.customer.taxCode ? <Text>MST: {d.customer.taxCode}</Text> : null}
          </View>
          <View style={s.box}>
            <Text style={s.boxTitle}>Nhân viên kinh doanh</Text>
            <Text style={s.bold}>{d.sales.name}</Text>
            {d.sales.phone ? <Text>SĐT / Zalo: {vnPhone(d.sales.phone)}</Text> : null}
            {d.sales.email ? <Text>{d.sales.email}</Text> : null}
          </View>
        </View>

        <View style={s.table}>
          <View style={s.th} fixed>
            <Text style={[s.cell, { width: COLS.no, textAlign: 'center' }]}>#</Text>
            <Text style={[s.cell, { width: COLS.img }]} />
            <Text style={[s.cell, { width: COLS.name }]}>Sản phẩm</Text>
            <Text style={[s.cell, { width: COLS.unit }]}>Quy cách</Text>
            <Text style={[s.cell, { width: COLS.qty, textAlign: 'right' }]}>SL</Text>
            <Text style={[s.cell, { width: COLS.price, textAlign: 'right' }]}>Đơn giá</Text>
            <Text style={[s.cell, { width: COLS.disc, textAlign: 'right' }]}>CK</Text>
            <Text style={[s.cell, { width: COLS.total, textAlign: 'right' }]}>Thành tiền</Text>
          </View>
          {d.lines.map((l) => (
            <View key={l.no} style={s.tr} wrap={false}>
              <Text style={[s.cell, { width: COLS.no, textAlign: 'center' }]}>{l.no}</Text>
              <View style={[s.cell, { width: COLS.img }]}>{l.image ? <Image src={l.image} style={s.thumb} /> : null}</View>
              <View style={[s.cell, { width: COLS.name }]}>
                <Text>{l.name}</Text>
                <Text style={{ color: MUTED, fontSize: 7.5 }}>{l.sku}</Text>
              </View>
              <Text style={[s.cell, { width: COLS.unit, fontSize: 8 }]}>{[l.unit, l.unitsPerCase ? `${l.unitsPerCase}/thùng` : null].filter(Boolean).join(' · ')}</Text>
              <Text style={[s.cell, { width: COLS.qty, textAlign: 'right' }]}>{l.qty}</Text>
              <Text style={[s.cell, { width: COLS.price, textAlign: 'right' }]}>{money(l.unitPrice)}</Text>
              <Text style={[s.cell, { width: COLS.disc, textAlign: 'right' }]}>{l.discountPct ? `${l.discountPct}%` : ''}</Text>
              <Text style={[s.cell, { width: COLS.total, textAlign: 'right', fontWeight: 600 }]}>{money(l.lineTotal)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}><Text>Tiền hàng</Text><Text>{formatVnd(d.subtotal)}</Text></View>
          {d.discount ? <View style={s.totalRow}><Text>Chiết khấu thêm</Text><Text>−{formatVnd(d.discount)}</Text></View> : null}
          {d.shippingFee ? <View style={s.totalRow}><Text>Phí vận chuyển</Text><Text>{formatVnd(d.shippingFee)}</Text></View> : null}
          <View style={s.grand}><Text>Tổng cộng</Text><Text>{formatVnd(d.total)}</Text></View>
        </View>

        <View style={s.terms} wrap={false}>
          <Text style={s.boxTitle}>Điều kiện</Text>
          {d.terms ? <Text>{d.terms}</Text> : null}
          {c.bankAccount ? (
            <Text style={{ marginTop: 4 }}>
              Chuyển khoản: {c.bankAccountName ? `${c.bankAccountName} · ` : ''}STK {c.bankAccount}
              {c.bankName ? ` · ${c.bankName}` : ''}
            </Text>
          ) : null}
          <Text style={{ marginTop: 4, color: MUTED }}>Báo giá có hiệu lực đến {formatDate(d.validUntil)}. Giá sỉ áp dụng theo mã hàng và số lượng trên báo giá này.</Text>
        </View>

        <View style={s.footer} fixed>
          <Text>{c.legalName} · Hotline {c.hotline}{c.website ? ` · ${c.website.replace(/^https?:\/\//, '')}` : ''}</Text>
          <Text render={({ pageNumber, totalPages }) => `${d.code} · Trang ${pageNumber}/${totalPages}`} />
        </View>
        {c.address ? (
          <Text style={{ position: 'absolute', bottom: 10, left: 32, right: 32, fontSize: 7, color: MUTED }} fixed>
            {c.address}
          </Text>
        ) : null}
      </Page>
    </Document>
  );
}

/** Render the quote to a PDF buffer. */
export async function renderQuotePdf(data: QuotePdfData): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<QuoteDocument d={data} />);
}

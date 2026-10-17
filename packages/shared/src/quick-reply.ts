/** Quick reply variables {ten_khach}, {ten_sales}, {sdt_sales} (SPEC 6.4). Unknown variables stay as typed. */
export function renderQuickReply(content: string, vars: { customerName?: string | null; salesName?: string | null; salesPhone?: string | null }) {
  const phone = vars.salesPhone?.startsWith('+84') ? `0${vars.salesPhone.slice(3)}` : vars.salesPhone;
  const map: Record<string, string | null | undefined> = { ten_khach: vars.customerName, ten_sales: vars.salesName, sdt_sales: phone };
  return content.replace(/\{(\w+)\}/g, (all, k: string) => (map[k] ? map[k]! : all));
}

-- M4: document numbers BG-yyyy-000123 / DH-yyyy-000456 (SPEC §7 Quote.code, Order.code).
-- One sequence each (v1 has a single organization, like lead_code_seq — D-012); the year prefix is
-- presentation only, numbers never restart so codes stay unique across years.
CREATE SEQUENCE IF NOT EXISTS quote_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS order_code_seq START 1;

-- Lookups used by quote → order, repeat orders and reports.
CREATE INDEX IF NOT EXISTS "Order_quoteId_idx" ON "Order" ("quoteId");
CREATE INDEX IF NOT EXISTS "Quote_orgId_customerId_idx" ON "Quote" ("orgId", "customerId");
CREATE INDEX IF NOT EXISTS "Quote_orgId_status_validUntil_idx" ON "Quote" ("orgId", "status", "validUntil");
CREATE INDEX IF NOT EXISTS "Deal_leadId_idx" ON "Deal" ("leadId");

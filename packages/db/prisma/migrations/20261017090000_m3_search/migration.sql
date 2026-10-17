-- M3/M4: accent-insensitive product search (SPEC 11.3: "index pg_trgm trên tên, SKU; tìm không dấu bằng unaccent").
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() is STABLE; an IMMUTABLE wrapper with an explicit dictionary can back an expression index.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, replace(replace($1, 'đ', 'd'), 'Đ', 'D')) $$;

CREATE INDEX IF NOT EXISTS "Product_name_unaccent_trgm_idx" ON "Product" USING gin (f_unaccent(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_sku_trgm_idx" ON "Product" USING gin (sku gin_trgm_ops);

-- Conversation list "chưa trả lời" compares two columns; keep the inbox query on an index.
CREATE INDEX IF NOT EXISTS "Conversation_orgId_unreadCount_idx" ON "Conversation" ("orgId", "unreadCount");

-- 023_chatwoot_suporte.sql
-- Adiciona campos para inbox de suporte (Website) no chatwoot_config

ALTER TABLE chatwoot_config
  ADD COLUMN IF NOT EXISTS suporte_inbox_id INTEGER,
  ADD COLUMN IF NOT EXISTS suporte_website_token VARCHAR(255);

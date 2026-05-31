-- 007_imap_config.sql
-- Cada transportadora cadastra sua própria caixa de email para receber XML de NF-e

CREATE TABLE IF NOT EXISTS imap_config (
  id                SERIAL PRIMARY KEY,
  transportadora_id INTEGER NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  imap_host         VARCHAR(255) NOT NULL,
  imap_port         INTEGER NOT NULL DEFAULT 993,
  imap_ssl          BOOLEAN NOT NULL DEFAULT TRUE,
  imap_username     VARCHAR(255) NOT NULL,
  imap_password     TEXT NOT NULL,
  imap_check_interval INTEGER DEFAULT 5,
  active            BOOLEAN DEFAULT TRUE,
  last_check_at     TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_imap_config_transportadora ON imap_config(transportadora_id);

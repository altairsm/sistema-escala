-- 002_smtp_config.sql
-- Configuração de SMTP para envio de emails

CREATE TABLE IF NOT EXISTS smtp_config (
  id                SERIAL PRIMARY KEY,
  saas_owner_id     INTEGER NOT NULL REFERENCES saas_owner(id) ON DELETE CASCADE,
  sender_email      VARCHAR(255) NOT NULL,
  sender_name       VARCHAR(255),
  smtp_domain       VARCHAR(255) NOT NULL,
  smtp_address      VARCHAR(255) NOT NULL,
  smtp_port         INTEGER NOT NULL DEFAULT 465,
  smtp_ssl          BOOLEAN NOT NULL DEFAULT TRUE,
  smtp_username     VARCHAR(255) NOT NULL,
  smtp_password     TEXT NOT NULL,
  smtp_authentication VARCHAR(50) DEFAULT 'login',
  smtp_enable_starttls_auto BOOLEAN DEFAULT TRUE,
  smtp_openssl_verify_mode VARCHAR(20) DEFAULT 'peer',
  inbound_email_domain VARCHAR(255),
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_smtp_config_saas_owner ON smtp_config(saas_owner_id);

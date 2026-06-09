-- 018_ftp_config.sql
-- Configuração de conexão FTP para busca de arquivos NotFis

CREATE TABLE IF NOT EXISTS ftp_config (
  id                SERIAL PRIMARY KEY,
  transportadora_id INTEGER NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  host              VARCHAR(255) NOT NULL,
  username          VARCHAR(100) NOT NULL,
  password          TEXT NOT NULL,
  active            BOOLEAN DEFAULT TRUE,
  intervalo_min     INTEGER DEFAULT 120,
  data_corte        DATE DEFAULT '2026-06-09',
  last_check_at     TIMESTAMP,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW(),
  UNIQUE(transportadora_id)
);

CREATE INDEX IF NOT EXISTS idx_ftp_config_transportadora ON ftp_config(transportadora_id);

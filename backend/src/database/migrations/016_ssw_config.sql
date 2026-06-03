-- 016_ssw_config.sql
CREATE TABLE IF NOT EXISTS ssw_config (
  id                SERIAL PRIMARY KEY,
  transportadora_id INTEGER NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  domain            VARCHAR(50) NOT NULL,
  username          VARCHAR(100) NOT NULL,
  password          TEXT NOT NULL,
  cnpj_edi          VARCHAR(20) NOT NULL,
  active            BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ssw_config_transportadora ON ssw_config(transportadora_id);

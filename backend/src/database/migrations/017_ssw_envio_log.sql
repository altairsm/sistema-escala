-- 017_ssw_envio_log.sql
CREATE TABLE IF NOT EXISTS ssw_envio_log (
  id                SERIAL PRIMARY KEY,
  transportadora_id INTEGER NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  carga             VARCHAR(50) NOT NULL,
  lote              VARCHAR(100),
  qtd_nfs           INTEGER NOT NULL,
  status            VARCHAR(20) DEFAULT 'pendente',
  resultado         JSONB,
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ssw_envio_log_transportadora ON ssw_envio_log(transportadora_id);

-- 010_imap_log.sql
-- Histórico de processamento IMAP (emails recebidos, XMLs extraídos, NFs inseridas/atualizadas)

CREATE TABLE IF NOT EXISTS imap_log (
  id                  SERIAL PRIMARY KEY,
  transportadora_id   INTEGER NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  imap_config_id      INTEGER REFERENCES imap_config(id) ON DELETE SET NULL,
  email_from          VARCHAR(255),
  email_subject       TEXT,
  email_date          TIMESTAMP,
  attachments_count   INTEGER DEFAULT 0,
  xmls_extracted      INTEGER DEFAULT 0,
  nfs_inseridas       INTEGER DEFAULT 0,
  nfs_atualizadas     INTEGER DEFAULT 0,
  erros               TEXT[],
  status              VARCHAR(20) NOT NULL DEFAULT 'ok',
  created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_imap_log_transportadora ON imap_log(transportadora_id, created_at DESC);

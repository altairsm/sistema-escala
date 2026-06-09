-- 019_ftp_log.sql
-- Histórico de processamento FTP (arquivos baixados, chaves extraídas, NFs processadas)

CREATE TABLE IF NOT EXISTS ftp_log (
  id                SERIAL PRIMARY KEY,
  transportadora_id INTEGER NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  arquivo           TEXT,
  chave_nf          VARCHAR(44),
  tipo              VARCHAR(20) NOT NULL, -- 'chave' (por NF) ou 'arquivo' (por arquivo)
  status            VARCHAR(20) NOT NULL DEFAULT 'ok',
  consulta_api_ok   BOOLEAN,
  nf_inserida       BOOLEAN,
  nf_atualizada     BOOLEAN,
  mensagem          TEXT,
  created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ftp_log_transportadora ON ftp_log(transportadora_id, created_at DESC);

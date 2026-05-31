-- 006_add_columns_entregas.sql
-- Colunas do mapeamento XML NF-e (Casas Bahia / Via Varejo)

ALTER TABLE entregas ADD COLUMN IF NOT EXISTS chave_nf   VARCHAR(100);
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS box        INTEGER;
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS nf_pv      VARCHAR(50);
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS filial     INTEGER;
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS cidade     VARCHAR(255);
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS micro_zona VARCHAR(100);
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS remessa    VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_entregas_chave_nf ON entregas(chave_nf);

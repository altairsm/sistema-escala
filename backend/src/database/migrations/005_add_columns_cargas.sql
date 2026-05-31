-- 005_add_columns_cargas.sql
-- Adiciona colunas do mapeamento Excel (n8n) que faltavam

ALTER TABLE cargas ADD COLUMN IF NOT EXISTS cod_transp VARCHAR(50);
ALTER TABLE cargas ADD COLUMN IF NOT EXISTS transportadora VARCHAR(255);
ALTER TABLE cargas ADD COLUMN IF NOT EXISTS tipo VARCHAR(50);
ALTER TABLE cargas ADD COLUMN IF NOT EXISTS identificacao VARCHAR(255);

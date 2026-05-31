-- 004_add_box_column.sql
-- Adiciona coluna box (inteiro de até 3 dígitos) na tabela cargas

ALTER TABLE cargas ADD COLUMN IF NOT EXISTS box INTEGER CHECK (box >= 0 AND box <= 999);

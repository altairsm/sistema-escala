-- 003_drop_entregas_carga_fk.sql
-- Remove FK constraint and column carga_id from entregas
-- Entregas podem existir sem relação com cargas (ex: remessa = coleta)

ALTER TABLE entregas DROP CONSTRAINT IF EXISTS entregas_carga_id_fkey;
ALTER TABLE entregas DROP COLUMN IF EXISTS carga_id;

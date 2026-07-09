-- 021_entregas_novos_campos.sql
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS cep                      VARCHAR(10);
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS telefone                 VARCHAR(20);
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS whatsapp_jid             VARCHAR(100);
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS chatwoot_contact_id      INTEGER;
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS chatwoot_conversation_id INTEGER;
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS latitude                 NUMERIC(10,7);
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS longitude                NUMERIC(10,7);
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS qtd_volumes              INTEGER DEFAULT 0;

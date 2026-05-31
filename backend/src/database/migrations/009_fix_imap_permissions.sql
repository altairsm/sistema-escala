-- 009_fix_imap_permissions.sql
-- Garante que escala_admin tem permissão na tabela imap_config

DO $$
BEGIN
  GRANT ALL PRIVILEGES ON TABLE imap_config TO escala_admin;
  GRANT ALL PRIVILEGES ON SEQUENCE imap_config_id_seq TO escala_admin;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Permissões imap_config: %', SQLERRM;
END;
$$;
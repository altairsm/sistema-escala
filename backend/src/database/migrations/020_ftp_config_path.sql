-- 020_ftp_config_path.sql
-- Adiciona coluna path para definir qual pasta listar no FTP

ALTER TABLE ftp_config ADD COLUMN IF NOT EXISTS path VARCHAR(255) NOT NULL DEFAULT 'NOTFIS';

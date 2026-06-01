-- 012_imap_date.sql
-- Adiciona coluna imap_date (INTERNALDATE do servidor IMAP) para exibir a data real de chegada do email

ALTER TABLE imap_log ADD COLUMN IF NOT EXISTS imap_date TIMESTAMP;

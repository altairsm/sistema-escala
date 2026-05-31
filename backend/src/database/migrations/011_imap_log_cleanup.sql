-- 011_imap_log_cleanup.sql
-- Apaga logs mais antigos que 7 dias (roda a cada 24h)

CREATE OR REPLACE FUNCTION cleanup_imap_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM imap_log WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

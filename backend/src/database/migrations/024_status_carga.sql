-- Migration: Adicionar coluna status na tabela cargas com triggers automáticos

-- 1. Adicionar coluna
ALTER TABLE cargas ADD COLUMN IF NOT EXISTS status INTEGER DEFAULT 4;

-- 2. Função que calcula o status de uma carga
CREATE OR REPLACE FUNCTION atualizar_status_carga(p_carga_id INTEGER) RETURNS VOID AS $$
DECLARE
  v_carga RECORD;
  v_total INTEGER;
  v_entregues INTEGER;
  v_pendentes INTEGER;
BEGIN
  SELECT * INTO v_carga FROM cargas WHERE id = p_carga_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COUNT(*)::int,
         COUNT(*) FILTER (WHERE confirma_entrega = true)::int,
         COUNT(*) FILTER (WHERE confirma_entrega IS NULL)::int
  INTO v_total, v_entregues, v_pendentes
  FROM entregas
  WHERE fc = v_carga.carga AND transportadora_id = v_carga.transportadora_id;

  UPDATE cargas SET status =
    CASE
      WHEN v_total > 0 AND v_entregues = v_total THEN 6
      WHEN v_carga.motorista IS NOT NULL AND v_carga.motorista != '' THEN 3
      WHEN v_carga.placa IS NULL OR v_carga.placa = '' THEN 1
      WHEN v_carga.confirma_equipe = true THEN 2
      WHEN v_pendentes > 0 THEN 4
      WHEN v_total > 0 THEN 5
      ELSE 4
    END
  WHERE id = p_carga_id;
END;
$$ LANGUAGE plpgsql;

-- 3. Função trigger (wrapper) — recalcula status da carga afetada
CREATE OR REPLACE FUNCTION trigger_atualizar_status_carga() RETURNS TRIGGER AS $$
DECLARE
  v_carga_id INTEGER;
  v_old_fc TEXT;
BEGIN
  IF TG_TABLE_NAME = 'entregas' THEN
    v_carga_id := (SELECT id FROM cargas WHERE carga = NEW.fc AND transportadora_id = NEW.transportadora_id LIMIT 1);
    IF TG_OP = 'UPDATE' AND OLD.fc IS DISTINCT FROM NEW.fc THEN
      PERFORM atualizar_status_carga(
        (SELECT id FROM cargas WHERE carga = OLD.fc AND transportadora_id = OLD.transportadora_id LIMIT 1)
      );
    END IF;
  ELSIF TG_TABLE_NAME = 'cargas' THEN
    v_carga_id := NEW.id;
  END IF;

  IF v_carga_id IS NOT NULL THEN
    PERFORM atualizar_status_carga(v_carga_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Triggers
DROP TRIGGER IF EXISTS trg_entregas_status ON entregas;
CREATE TRIGGER trg_entregas_status
AFTER INSERT OR UPDATE OF confirma_entrega, fc ON entregas
FOR EACH ROW EXECUTE FUNCTION trigger_atualizar_status_carga();

DROP TRIGGER IF EXISTS trg_cargas_status ON cargas;
CREATE TRIGGER trg_cargas_status
AFTER UPDATE OF motorista, placa, confirma_equipe ON cargas
FOR EACH ROW EXECUTE FUNCTION trigger_atualizar_status_carga();

-- 5. Backfill — atualizar status de todas as cargas existentes
DO $$ DECLARE r RECORD; BEGIN FOR r IN SELECT id FROM cargas LOOP PERFORM atualizar_status_carga(r.id); END LOOP; END $$;

-- 014_transferencias_log.sql
CREATE TABLE IF NOT EXISTS transferencias_log (
  id                SERIAL PRIMARY KEY,
  transportadora_id INTEGER NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  entrega_id        INTEGER REFERENCES entregas(id) ON DELETE SET NULL,
  reversa_id        INTEGER REFERENCES reversas(id) ON DELETE SET NULL,
  tipo              VARCHAR(10) NOT NULL CHECK (tipo IN ('entrega', 'reversa')),
  nf                VARCHAR(100),
  carga_anterior    VARCHAR(50) NOT NULL,
  carga_nova        VARCHAR(50) NOT NULL,
  usuario_id        INTEGER NOT NULL,
  usuario_nome      VARCHAR(255) NOT NULL,
  created_at        TIMESTAMP DEFAULT NOW()
);

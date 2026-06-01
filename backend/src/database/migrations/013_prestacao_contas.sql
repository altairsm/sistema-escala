-- 013_prestacao_contas.sql
-- Registro de prestação de contas por carga (todas as entregas finalizadas)

CREATE TABLE IF NOT EXISTS prestacao_contas (
  id SERIAL PRIMARY KEY,
  carga_id INTEGER NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
  transportadora_id INTEGER NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  data_prestacao DATE NOT NULL,
  confirmado_por INTEGER REFERENCES usuarios(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(carga_id)
);

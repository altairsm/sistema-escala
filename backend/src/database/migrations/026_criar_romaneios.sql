-- Migration: Criar tabela romaneios e vincular entregas

CREATE TABLE IF NOT EXISTS romaneios (
    id SERIAL PRIMARY KEY,
    numero VARCHAR(30) UNIQUE NOT NULL,
    motorista_id INTEGER NOT NULL REFERENCES usuarios(id),
    transportadora_id INTEGER NOT NULL REFERENCES transportadoras(id),
    status VARCHAR(20) DEFAULT 'aberto',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE entregas ADD COLUMN IF NOT EXISTS romaneio_id INTEGER REFERENCES romaneios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_entregas_romaneio ON entregas(romaneio_id);

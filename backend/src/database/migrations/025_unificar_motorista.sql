-- Migration: Unificar motoristas e usuarios (funcao='motorista')

-- 1. Adicionar campos de cadastro em usuarios
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cpf VARCHAR(14);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cnh VARCHAR(20);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS telefone VARCHAR(30);

-- 2. Adicionar FK da carga para usuarios (motorista responsável)
ALTER TABLE cargas ADD COLUMN IF NOT EXISTS motorista_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cargas_motorista_id ON cargas(motorista_id);

-- 3. Copiar CPF/CNH/telefone de motoristas para usuarios correspondentes
UPDATE usuarios u
SET cpf = m.cpf,
    cnh = m.cnh,
    telefone = m.telefone
FROM motoristas m
WHERE m.transportadora_id = u.transportadora_id
  AND m.nome = u.nome
  AND u.funcao = 'motorista'
  AND (
    u.cpf IS NULL OR
    u.cnh IS NULL OR
    u.telefone IS NULL
  );

-- 4. Vincular cargas ao usuarios.id pelo nome (backfill)
UPDATE cargas c
SET motorista_id = u.id
FROM usuarios u
WHERE u.transportadora_id = c.transportadora_id
  AND u.nome = c.motorista
  AND u.funcao = 'motorista'
  AND c.motorista IS NOT NULL;

-- 5. Registrar qual motorista confirmou cada entrega
ALTER TABLE entregas ADD COLUMN IF NOT EXISTS motorista_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_entregas_motorista_id ON entregas(motorista_id);

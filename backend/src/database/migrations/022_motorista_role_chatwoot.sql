-- 022_motorista_role_chatwoot.sql

-- Adiciona 'motorista' aos papéis permitidos de usuarios
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_funcao_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_funcao_check
  CHECK (funcao IN ('master', 'admin', 'operador', 'motorista'));

-- Configuração do Chatwoot por transportadora
CREATE TABLE IF NOT EXISTS chatwoot_config (
  id                SERIAL PRIMARY KEY,
  transportadora_id INTEGER NOT NULL UNIQUE REFERENCES transportadoras(id) ON DELETE CASCADE,
  api_url           VARCHAR(255) NOT NULL DEFAULT 'https://app.chatwoot.com',
  account_id        INTEGER,
  inbox_id          INTEGER,
  website_token     VARCHAR(255),
  api_key           VARCHAR(255),
  n8n_webhook_url   VARCHAR(255),
  ativo             BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

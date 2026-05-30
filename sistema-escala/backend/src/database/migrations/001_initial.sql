-- 001_initial.sql
-- Tabelas do sistema SaaS de Gestão de Escala

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==================== SAAS ====================
CREATE TABLE IF NOT EXISTS saas_owner (
  id            SERIAL PRIMARY KEY,
  empresa       VARCHAR(255) NOT NULL,
  cnpj          VARCHAR(20) NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  telefone      VARCHAR(30),
  email_recuperacao VARCHAR(255) NOT NULL,
  senha_hash    VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- ==================== TRANSPORTADORAS ====================
CREATE TABLE IF NOT EXISTS transportadoras (
  id              SERIAL PRIMARY KEY,
  cod_transp      VARCHAR(50) NOT NULL UNIQUE,
  nome            VARCHAR(255) NOT NULL,
  cnpj            VARCHAR(20) NOT NULL UNIQUE,
  email           VARCHAR(255) NOT NULL,
  telefone        VARCHAR(30),
  endereco        TEXT,
  ativo           BOOLEAN DEFAULT TRUE,
  db_user_ext     VARCHAR(100),
  db_pass_enc     TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- ==================== USUÁRIOS ====================
CREATE TABLE IF NOT EXISTS usuarios (
  id                SERIAL PRIMARY KEY,
  transportadora_id INTEGER REFERENCES transportadoras(id) ON DELETE CASCADE,
  nome              VARCHAR(255) NOT NULL,
  email             VARCHAR(255) NOT NULL,
  senha_hash        VARCHAR(255) NOT NULL,
  funcao            VARCHAR(30) NOT NULL DEFAULT 'operador'
                      CHECK (funcao IN ('master', 'admin', 'operador')),
  ativo             BOOLEAN DEFAULT TRUE,
  primeiro_acesso   BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW(),
  UNIQUE(transportadora_id, email)
);

-- ==================== CADASTROS ====================
CREATE TABLE IF NOT EXISTS motoristas (
  id                SERIAL PRIMARY KEY,
  transportadora_id INTEGER NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  nome              VARCHAR(255) NOT NULL,
  cpf               VARCHAR(14),
  cnh               VARCHAR(20),
  telefone          VARCHAR(30),
  ativo             BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ajudantes (
  id                SERIAL PRIMARY KEY,
  transportadora_id INTEGER NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  nome              VARCHAR(255) NOT NULL,
  cpf               VARCHAR(14),
  telefone          VARCHAR(30),
  ativo             BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS veiculos (
  id                SERIAL PRIMARY KEY,
  transportadora_id INTEGER NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  placa             VARCHAR(10) NOT NULL,
  tipo              VARCHAR(100),
  obs               TEXT,
  ativo             BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW(),
  UNIQUE(transportadora_id, placa)
);

-- ==================== OPERACIONAIS ====================
CREATE TABLE IF NOT EXISTS cargas (
  id                SERIAL PRIMARY KEY,
  transportadora_id INTEGER NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  carga             VARCHAR(50) NOT NULL,
  data_entrega      DATE,
  qtd_entg          INTEGER DEFAULT 0,
  cub               NUMERIC(10,2),
  placa             VARCHAR(10),
  rota              VARCHAR(100),
  regiao_nome       VARCHAR(200),
  regiao            VARCHAR(50),
  confirma          BOOLEAN DEFAULT FALSE,
  confirma_equipe   BOOLEAN DEFAULT FALSE,
  motorista         VARCHAR(255),
  ajudante_01       VARCHAR(255),
  ajudante_02       VARCHAR(255),
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entregas (
  id                  SERIAL PRIMARY KEY,
  transportadora_id   INTEGER NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  carga_id            INTEGER REFERENCES cargas(id) ON DELETE SET NULL,
  fc                  VARCHAR(50),
  nf                  VARCHAR(100) NOT NULL,
  cliente             VARCHAR(255),
  bairro              VARCHAR(150),
  data_nf             DATE,
  confirma_entrega    BOOLEAN,
  motivo_insucesso    TEXT,
  reentrega           BOOLEAN,
  devolucao           BOOLEAN,
  status_reentrega    BOOLEAN,
  status_devolucao    BOOLEAN,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reversas (
  id                  SERIAL PRIMARY KEY,
  transportadora_id   INTEGER NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  nf                  VARCHAR(100),
  chave_nf            VARCHAR(100),
  fc                  VARCHAR(50),
  carga               VARCHAR(50),
  cliente             VARCHAR(255),
  bairro              VARCHAR(150),
  remessa             VARCHAR(100),
  data_nf             DATE,
  confirma_entrega    BOOLEAN,
  motivo_insucesso    TEXT,
  reentrega           BOOLEAN,
  devolucao           BOOLEAN,
  status_reentrega    BOOLEAN,
  status_devolucao    BOOLEAN,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS em_devolucao (
  id                  SERIAL PRIMARY KEY,
  transportadora_id   INTEGER NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  fc                  VARCHAR(50),
  nf                  VARCHAR(100),
  cliente             VARCHAR(255),
  bairro              VARCHAR(150),
  motivo_insucesso    TEXT,
  status_devolucao    BOOLEAN,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

-- ==================== ARQUIVOS ====================
CREATE TABLE IF NOT EXISTS arquivos (
  id                SERIAL PRIMARY KEY,
  transportadora_id INTEGER NOT NULL REFERENCES transportadoras(id) ON DELETE CASCADE,
  nome_original     VARCHAR(500) NOT NULL,
  caminho           VARCHAR(500) NOT NULL,
  tamanho           INTEGER DEFAULT 0,
  created_at        TIMESTAMP DEFAULT NOW()
);

-- ==================== ÍNDICES ====================
CREATE INDEX IF NOT EXISTS idx_cargas_transportadora ON cargas(transportadora_id);
CREATE INDEX IF NOT EXISTS idx_cargas_data ON cargas(data_entrega);
CREATE INDEX IF NOT EXISTS idx_cargas_placa ON cargas(placa);
CREATE INDEX IF NOT EXISTS idx_entregas_transportadora ON entregas(transportadora_id);
CREATE INDEX IF NOT EXISTS idx_entregas_carga ON entregas(fc);
CREATE INDEX IF NOT EXISTS idx_entregas_data ON entregas(data_nf);
CREATE INDEX IF NOT EXISTS idx_reversas_transportadora ON reversas(transportadora_id);
CREATE INDEX IF NOT EXISTS idx_devolucao_transportadora ON em_devolucao(transportadora_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_transportadora ON usuarios(transportadora_id);
CREATE INDEX IF NOT EXISTS idx_motoristas_transportadora ON motoristas(transportadora_id);
CREATE INDEX IF NOT EXISTS idx_ajudantes_transportadora ON ajudantes(transportadora_id);
CREATE INDEX IF NOT EXISTS idx_veiculos_transportadora ON veiculos(transportadora_id);

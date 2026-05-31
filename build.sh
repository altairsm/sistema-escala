#!/bin/bash
# ============================================================
# build.sh - Atualiza a instalação do Gestão de Escala
# ============================================================
# Uso: ./build.sh
#
# O que faz:
#   1. Faz pull do código mais recente do git
#   2. Rebuilda os containers Docker com o commit atual
#   3. Sobe os serviços (migrações rodam automaticamente)
# ============================================================
set -e

# Detecta comando do Docker Compose (v1 ou v2)
COMPOSE="docker compose"
if ! docker compose version &>/dev/null; then
  if docker-compose --version &>/dev/null; then
    COMPOSE="docker-compose"
  else
    echo "ERRO: Docker Compose não encontrado. Instale docker-compose."
    exit 1
  fi
fi

echo "========================================"
echo "  Gestão de Escala — Build & Deploy"
echo "  Comando: $COMPOSE"
echo "========================================"

# 1. Commit atual antes do pull
OLD_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "Commit atual: $OLD_COMMIT"

# 2. Pull mais recente
echo ""
echo "[1/3] Atualizando código do repositório..."
git pull origin main
echo ""

NEW_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "Commit após pull: $NEW_COMMIT"

if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
  echo "Nenhuma mudança no código. Continuando com rebuild..."
fi

# 3. Rebuild com o commit como build arg
echo ""
echo "[2/3] Rebuildando containers (GIT_COMMIT=$NEW_COMMIT)..."
GIT_COMMIT=$NEW_COMMIT $COMPOSE build
echo "Build concluído."

# 4. Sobe serviços (se a imagem mudou, o container será recriado)
echo ""
echo "[3/3] Subindo serviços..."
GIT_COMMIT=$NEW_COMMIT $COMPOSE up -d
echo ""

# 5. Verifica se os containers estão rodando
echo "Verificando containers..."
$COMPOSE ps

echo ""
echo "========================================"
echo "  Deploy concluído!"
echo "  Versão: $NEW_COMMIT"
echo "========================================"
echo ""
echo "Para ver os logs: docker compose logs -f"

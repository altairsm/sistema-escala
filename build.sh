#!/bin/bash
# ============================================================
# build.sh - Atualiza a instalação do Gestão de Escala
# ============================================================
# Uso: ./build.sh
#
# O que faz:
#   1. Captura o commit atual do git
#   2. Faz pull da branch main
#   3. Rebuilda os containers Docker com o novo commit
#   4. Sobe os serviços (rodando migrações automaticamente)
# ============================================================
set -e

echo "========================================"
echo "  Gestão de Escala — Build & Deploy"
echo "========================================"

# 1. Commit atual
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "Commit atual: $COMMIT"

# 2. Pull mais recente
echo ""
echo "[1/3] Atualizando código do repositório..."
git pull origin main
NEW_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "Commit atualizado: $NEW_COMMIT"

# 3. Rebuild e deploy
echo ""
echo "[2/3] Rebuildando containers Docker..."
GIT_COMMIT=$NEW_COMMIT docker compose build --no-cache
echo "Build concluído."

echo ""
echo "[3/3] Subindo serviços..."
GIT_COMMIT=$NEW_COMMIT docker compose up -d

echo ""
echo "========================================"
echo "  Deploy concluído!"
echo "  Versão: $NEW_COMMIT"
echo "========================================"

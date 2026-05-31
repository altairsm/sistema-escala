#!/bin/sh
echo "[START] Executando migrações..."
node src/database/migrate.js
echo "[START] Iniciando servidor..."
exec node src/app.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      const { rows } = await client.query('SELECT id FROM migrations WHERE name = $1', [file]);
      if (rows.length > 0) {
        console.log(`  [SKIP] ${file} - já executada`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`  [RUN]  ${file}...`);
      await client.query(sql);
      await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
      console.log(`  [DONE] ${file}`);
    }

    console.log('Migrações concluídas com sucesso.');
  } catch (err) {
    console.error('Erro ao executar migrações:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

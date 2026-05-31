import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'escala_db',
  user: process.env.DB_USER || 'escala_admin',
  password: process.env.DB_PASSWORD || 'changeme_root',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Erro inesperado no pool do banco:', err);
});

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (duration > 1000) {
    console.warn(`Query lenta (${duration}ms):`, text.substring(0, 100));
  }
  return res;
}

export async function getClient() {
  const client = await pool.connect();
  return client;
}

export default pool;

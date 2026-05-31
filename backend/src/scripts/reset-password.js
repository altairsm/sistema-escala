import pool from '../config/database.js';
import bcrypt from 'bcrypt';

async function main() {
  const args = process.argv.slice(2);
  const email = args[0];
  const novaSenha = args[1] || 'admin123';

  if (!email) {
    console.error('Uso: node src/scripts/reset-password.js <email> [nova-senha]');
    process.exit(1);
  }

  const senha_hash = await bcrypt.hash(novaSenha, 10);

  // Tenta saas_owner
  let { rows } = await pool.query('SELECT id, email FROM saas_owner WHERE email = $1', [email]);
  if (rows.length > 0) {
    await pool.query('UPDATE saas_owner SET senha_hash = $1 WHERE id = $2', [senha_hash, rows[0].id]);
    console.log(`✅ Senha do SaaS owner (${email}) redefinida para: ${novaSenha}`);
    await pool.end();
    return;
  }

  // Tenta usuario
  ({ rows } = await pool.query('SELECT id, email FROM usuarios WHERE email = $1', [email]));
  if (rows.length > 0) {
    await pool.query('UPDATE usuarios SET senha_hash = $1, primeiro_acesso = false WHERE id = $2', [senha_hash, rows[0].id]);
    console.log(`✅ Senha do usuário (${email}) redefinida para: ${novaSenha}`);
    await pool.end();
    return;
  }

  console.error(`❌ Email não encontrado: ${email}`);
  await pool.end();
  process.exit(1);
}

main().catch(err => {
  console.error('Erro:', err);
  process.exit(1);
});

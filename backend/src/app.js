import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { query } from './config/database.js';
import { migrate } from './database/migrate.js';
import { gerarToken, authMiddleware, requireRole } from './middleware/auth.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import multer from 'multer';
import { sendMail, templateAcesso, templateRecuperacao, clearSmtpCache } from './config/email.js';
import { processarXml, extrairDadosXml } from './services/xmlProcessor.js';
import { iniciarImapService, checkAllMailboxes } from './services/imapService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ==================== ROTAS PÚBLICAS ====================

// Verificar se já existe SaaS instalado
app.get('/api/status', async (req, res) => {
  try {
    const { rows } = await query('SELECT id FROM saas_owner LIMIT 1');
    const instalado = rows.length > 0;
    res.json({ instalado });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao verificar status' });
  }
});

// Versão do sistema (git commit)
app.get('/api/version', (req, res) => {
  res.json({
    commit: process.env.GIT_COMMIT || 'unknown',
    timestamp: new Date().toISOString(),
  });
});

// Instalação inicial do SaaS
app.post('/api/install', async (req, res) => {
  const { empresa, cnpj, email, telefone, email_recuperacao, senha, smtp, reset } = req.body;
  if (!empresa || !cnpj || !email || !email_recuperacao || !senha) {
    return res.status(400).json({ error: 'Preencha todos os campos obrigatórios' });
  }

  try {
    if (reset) {
      // ========== Instalação do zero: apaga tudo e recria ==========
      console.log('[INSTALL] Reset solicitado — apagando banco de dados...');

      await query(`DROP SCHEMA public CASCADE`);
      await query(`CREATE SCHEMA public`);
      await query(`GRANT ALL ON SCHEMA public TO CURRENT_USER`);

      console.log('[INSTALL] Schema recriado. Executando migrações...');
      await migrate();
      console.log('[INSTALL] Migrações concluídas.');
    } else {
      // ========== Instalação normal: só permite se não existir ==========
      const { rows: existentes } = await query('SELECT id FROM saas_owner LIMIT 1');
      if (existentes.length > 0) {
        return res.status(400).json({ error: 'SaaS já instalado' });
      }
    }

    const senha_hash = await bcrypt.hash(senha, 10);
    const { rows: owner } = await query(
      `INSERT INTO saas_owner (empresa, cnpj, email, telefone, email_recuperacao, senha_hash)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [empresa, cnpj, email, telefone || null, email_recuperacao, senha_hash]
    );

    // Salva configuração SMTP (opcional — pode ser configurado depois no admin)
    if (smtp && smtp.sender_email && smtp.smtp_address && smtp.smtp_username && smtp.smtp_password) {
      await query(
        `INSERT INTO smtp_config (saas_owner_id, sender_email, sender_name, smtp_domain,
          smtp_address, smtp_port, smtp_ssl, smtp_username, smtp_password,
          smtp_authentication, smtp_enable_starttls_auto, smtp_openssl_verify_mode, inbound_email_domain)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          owner[0].id,
          smtp.sender_email,
          smtp.sender_name || null,
          smtp.smtp_domain || smtp.sender_email.split('@')[1] || '',
          smtp.smtp_address,
          smtp.smtp_port || 465,
          smtp.smtp_ssl !== undefined ? smtp.smtp_ssl : true,
          smtp.smtp_username,
          smtp.smtp_password,
          smtp.smtp_authentication || 'login',
          smtp.smtp_enable_starttls_auto !== undefined ? smtp.smtp_enable_starttls_auto : true,
          smtp.smtp_openssl_verify_mode || 'peer',
          smtp.inbound_email_domain || null,
        ]
      );
      clearSmtpCache();
    }

    const token = gerarToken({ id: owner[0].id, funcao: 'saas_owner', email });
    res.json({ token, message: 'SaaS instalado com sucesso' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'CNPJ ou email já cadastrado' });
    }
    console.error('Erro na instalação:', err);
    res.status(500).json({ error: 'Erro interno ao instalar' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) {
    return res.status(400).json({ error: 'Email e senha obrigatórios' });
  }

  try {
    // Tenta como SaaS owner
    const { rows: saas } = await query('SELECT * FROM saas_owner WHERE email = $1', [email]);
    if (saas.length > 0) {
      const valido = await bcrypt.compare(senha, saas[0].senha_hash);
      if (!valido) return res.status(401).json({ error: 'Senha inválida' });

      const token = gerarToken({ id: saas[0].id, funcao: 'saas_owner', email: saas[0].email });
      return res.json({ token, user: { nome: saas[0].empresa, email: saas[0].email, funcao: 'saas_owner' } });
    }

    // Tenta como usuário de transportadora
    const { rows: usuarios } = await query(
      `SELECT u.*, t.nome as transportadora_nome, t.cod_transp
       FROM usuarios u
       JOIN transportadoras t ON t.id = u.transportadora_id
       WHERE u.email = $1 AND u.ativo = true`, [email]
    );
    if (usuarios.length > 0) {
      const u = usuarios[0];
      const valido = await bcrypt.compare(senha, u.senha_hash);
      if (!valido) return res.status(401).json({ error: 'Senha inválida' });

      const token = gerarToken({
        id: u.id,
        transportadora_id: u.transportadora_id,
        funcao: u.funcao,
        email: u.email
      });

      return res.json({
        token,
        primeiro_acesso: u.primeiro_acesso,
        user: {
          nome: u.nome,
          email: u.email,
          funcao: u.funcao,
          transportadora: u.transportadora_nome,
          cod_transp: u.cod_transp
        }
      });
    }

    return res.status(404).json({ error: 'Usuário não encontrado' });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Primeiro acesso - trocar senha
app.post('/api/auth/primeiro-acesso', authMiddleware, async (req, res) => {
  const { senha } = req.body;
  if (!senha || senha.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
  }
  try {
    const senha_hash = await bcrypt.hash(senha, 10);
    await query(
      'UPDATE usuarios SET senha_hash = $1, primeiro_acesso = false WHERE id = $2',
      [senha_hash, req.user.id]
    );
    res.json({ message: 'Senha alterada com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao alterar senha' });
  }
});

// Esqueci minha senha
app.post('/api/auth/esqueci-senha', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email obrigatório' });

  try {
    // Busca em saas_owner
    const { rows: saas } = await query('SELECT id, email FROM saas_owner WHERE email = $1', [email]);
    if (saas.length > 0) {
      const novaSenha = crypto.randomBytes(4).toString('hex') + 'A1@';
      const senha_hash = await bcrypt.hash(novaSenha, 10);
      await query('UPDATE saas_owner SET senha_hash = $1 WHERE id = $2', [senha_hash, saas[0].id]);

      const sent = await sendMail({
        to: email,
        subject: 'Recuperação de Senha — Gestão de Escala',
        html: templateRecuperacao(email, novaSenha),
      });

      return res.json({ message: sent ? 'Email enviado com sucesso' : 'Email não pôde ser enviado — verifique configuração SMTP' });
    }

    // Busca em usuarios
    const { rows: users } = await query(
      'SELECT u.id, u.email FROM usuarios u WHERE u.email = $1 AND u.ativo = true', [email]
    );
    if (users.length > 0) {
      const novaSenha = crypto.randomBytes(4).toString('hex') + 'A1@';
      const senha_hash = await bcrypt.hash(novaSenha, 10);
      await query('UPDATE usuarios SET senha_hash = $1, primeiro_acesso = true WHERE id = $2', [senha_hash, users[0].id]);

      const sent = await sendMail({
        to: email,
        subject: 'Recuperação de Senha — Gestão de Escala',
        html: templateRecuperacao(email, novaSenha),
      });

      return res.json({ message: sent ? 'Email enviado com sucesso' : 'Email não pôde ser enviado — verifique configuração SMTP' });
    }

    // Não revela se o email existe ou não (segurança)
    res.json({ message: 'Se o email estiver cadastrado, você receberá instruções de recuperação.' });
  } catch (err) {
    console.error('Erro no esqueci-senha:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ==================== ROTAS DE EMAIL / SMTP ====================

// Buscar configuração SMTP
app.get('/api/smtp-config', authMiddleware, requireRole('saas_owner'), async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM smtp_config ORDER BY id DESC LIMIT 1');
    if (rows.length === 0) return res.json(null);
    const cfg = rows[0];
    cfg.smtp_password = cfg.smtp_password ? '********' : null;
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar configuração SMTP' });
  }
});

// Salvar/atualizar configuração SMTP
app.put('/api/smtp-config', authMiddleware, requireRole('saas_owner'), async (req, res) => {
  const { sender_email, sender_name, smtp_domain, smtp_address, smtp_port, smtp_ssl,
          smtp_username, smtp_password, smtp_authentication, smtp_enable_starttls_auto,
          smtp_openssl_verify_mode, inbound_email_domain } = req.body;

  if (!sender_email || !smtp_address || !smtp_username) {
    return res.status(400).json({ error: 'sender_email, smtp_address e smtp_username obrigatórios' });
  }

  try {
    // Busca config existente para preservar senha se não enviada
    const { rows: existing } = await query('SELECT id, smtp_password FROM smtp_config ORDER BY id DESC LIMIT 1');
    const password = smtp_password && smtp_password !== '********'
      ? smtp_password
      : (existing.length > 0 ? existing[0].smtp_password : '');

    if (existing.length > 0) {
      await query(
        `UPDATE smtp_config SET sender_email = $1, sender_name = $2, smtp_domain = $3,
         smtp_address = $4, smtp_port = $5, smtp_ssl = $6, smtp_username = $7,
         smtp_password = $8, smtp_authentication = $9, smtp_enable_starttls_auto = $10,
         smtp_openssl_verify_mode = $11, inbound_email_domain = $12, updated_at = NOW()
         WHERE id = $13`,
        [sender_email, sender_name, smtp_domain, smtp_address, smtp_port, smtp_ssl,
         smtp_username, password, smtp_authentication, smtp_enable_starttls_auto,
         smtp_openssl_verify_mode, inbound_email_domain, existing[0].id]
      );
    } else {
      const { rows: owner } = await query('SELECT id FROM saas_owner LIMIT 1');
      if (owner.length === 0) return res.status(400).json({ error: 'SaaS não instalado' });

      await query(
        `INSERT INTO smtp_config (saas_owner_id, sender_email, sender_name, smtp_domain,
          smtp_address, smtp_port, smtp_ssl, smtp_username, smtp_password,
          smtp_authentication, smtp_enable_starttls_auto, smtp_openssl_verify_mode, inbound_email_domain)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [owner[0].id, sender_email, sender_name, smtp_domain, smtp_address, smtp_port, smtp_ssl,
         smtp_username, password, smtp_authentication, smtp_enable_starttls_auto,
         smtp_openssl_verify_mode, inbound_email_domain]
      );
    }

    clearSmtpCache();
    res.json({ message: 'Configuração SMTP salva com sucesso' });
  } catch (err) {
    console.error('Erro ao salvar SMTP:', err);
    res.status(500).json({ error: 'Erro ao salvar configuração SMTP' });
  }
});

// Perfil do SaaS owner
app.get('/api/owner/profile', authMiddleware, requireRole('saas_owner'), async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, empresa, email, telefone, email_recuperacao, to_char(created_at, \'YYYY-MM-DD\') as created_at FROM saas_owner WHERE id = $1',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Proprietário não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar perfil' });
  }
});

// ==================== ROTAS DO SAAS OWNER ====================

// Listar transportadoras
app.get('/api/admin/transportadoras', authMiddleware, requireRole('saas_owner'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, cod_transp, nome, cnpj, email, telefone, ativo,
              to_char(created_at, 'YYYY-MM-DD') as created_at
       FROM transportadoras ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar transportadoras' });
  }
});

// Cadastrar transportadora
app.post('/api/admin/transportadoras', authMiddleware, requireRole('saas_owner'), async (req, res) => {
  const { cod_transp, nome, cnpj, email, telefone, endereco } = req.body;
  if (!cod_transp || !nome || !cnpj || !email) {
    return res.status(400).json({ error: 'Preencha cod_transp, nome, CNPJ e email' });
  }

  try {
    // Cria a transportadora
    const { rows: transp } = await query(
      `INSERT INTO transportadoras (cod_transp, nome, cnpj, email, telefone, endereco)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [cod_transp, nome, cnpj, email, telefone || null, endereco || null]
    );
    const transpId = transp[0].id;

    // Gera senha aleatória para o master
    const senhaTemporaria = crypto.randomBytes(4).toString('hex') + 'A1@';
    const senha_hash = await bcrypt.hash(senhaTemporaria, 10);

    // Cria usuário master
    await query(
      `INSERT INTO usuarios (transportadora_id, nome, email, senha_hash, funcao, primeiro_acesso)
       VALUES ($1, $2, $3, $4, 'master', true)`,
      [transpId, nome, email, senha_hash]
    );

    // Cria usuário PostgreSQL externo
    const dbUserExt = `ext_${cod_transp.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    const dbPassExt = crypto.randomBytes(16).toString('hex');

    try {
      await query(`CREATE ROLE ${dbUserExt} WITH LOGIN PASSWORD '${dbPassExt}'`);
      await query(`GRANT CONNECT ON DATABASE escala_db TO ${dbUserExt}`);
      await query(`GRANT USAGE ON SCHEMA public TO ${dbUserExt}`);
      await query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${dbUserExt}`);
    } catch (pgErr) {
      console.warn('Aviso ao criar role PG (pode já existir):', pgErr.message);
    }

    // Salva credenciais externas
    const dbCreds = JSON.stringify({ user: dbUserExt, password: dbPassExt });
    await query(
      'UPDATE transportadoras SET db_user_ext = $1, db_pass_enc = $2 WHERE id = $3',
      [dbUserExt, dbCreds, transpId]
    );

    // Envia email com dados de acesso
    sendMail({
      to: email,
      subject: 'Conta criada — Gestão de Escala',
      html: templateAcesso(nome, email, senhaTemporaria),
    });

    res.json({
      message: 'Transportadora cadastrada com sucesso',
      transportadora_id: transpId,
      email_acesso: email,
      senha_temporaria: senhaTemporaria,
      db_externo: {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || '5432',
        database: process.env.DB_NAME || 'escala_db',
        user: dbUserExt,
        password: dbPassExt
      }
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'CNPJ ou código de transportadora já existe' });
    }
    console.error('Erro ao cadastrar transportadora:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
});

// Detalhes da transportadora (com credenciais PG)
app.get('/api/admin/transportadoras/:id', authMiddleware, requireRole('saas_owner'), async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, cod_transp, nome, cnpj, email, telefone, endereco, ativo,
              db_user_ext, db_pass_enc,
              to_char(created_at, 'YYYY-MM-DD') as created_at
       FROM transportadoras WHERE id = $1`, [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Transportadora não encontrada' });

    const t = rows[0];
    let dbCreds = null;
    if (t.db_pass_enc) {
      try { dbCreds = JSON.parse(t.db_pass_enc); } catch { }
    }

    res.json({
      ...t,
      db_pass_enc: undefined,
      db_externo: dbCreds ? {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || '5432',
        database: process.env.DB_NAME || 'escala_db',
        user: dbCreds.user,
        password: dbCreds.password
      } : null
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar transportadora' });
  }
});

// Regenerar senha do master de uma transportadora
app.post('/api/admin/transportadoras/:id/regen-senha', authMiddleware, requireRole('saas_owner'), async (req, res) => {
  try {
    const { rows } = await query('SELECT id, email FROM transportadoras WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Transportadora não encontrada' });

    const novaSenha = crypto.randomBytes(4).toString('hex') + 'A1@';
    const senha_hash = await bcrypt.hash(novaSenha, 10);

    await query(
      'UPDATE usuarios SET senha_hash = $1, primeiro_acesso = true WHERE transportadora_id = $2 AND funcao = $3',
      [senha_hash, req.params.id, 'master']
    );

    res.json({ message: 'Senha regenerada', email: rows[0].email, senha_temporaria: novaSenha });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao regenerar senha' });
  }
});

// Regenerar senha do PostgreSQL externo
app.post('/api/admin/transportadoras/:id/regen-db-password', authMiddleware, requireRole('saas_owner'), async (req, res) => {
  try {
    const { rows } = await query('SELECT db_user_ext FROM transportadoras WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Transportadora não encontrada' });
    if (!rows[0].db_user_ext) return res.status(400).json({ error: 'Usuário externo não configurado' });

    const dbUserExt = rows[0].db_user_ext;
    const dbPassExt = crypto.randomBytes(16).toString('hex');

    try {
      await query(`ALTER ROLE ${dbUserExt} WITH PASSWORD '${dbPassExt}'`);
    } catch (pgErr) {
      return res.status(500).json({ error: 'Erro ao alterar senha no PostgreSQL: ' + pgErr.message });
    }

    const dbCreds = JSON.stringify({ user: dbUserExt, password: dbPassExt });
    await query('UPDATE transportadoras SET db_pass_enc = $1 WHERE id = $2', [dbCreds, req.params.id]);

    res.json({
      message: 'Senha do PostgreSQL regenerada',
      db_externo: {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || '5432',
        database: process.env.DB_NAME || 'escala_db',
        user: dbUserExt,
        password: dbPassExt
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno' });
  }
});

// ==================== EXCLUIR TRANSPORTADORA ====================
app.delete('/api/admin/transportadoras/:id', authMiddleware, requireRole('saas_owner'), async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, cod_transp, db_user_ext FROM transportadoras WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Transportadora não encontrada' });

    const transp = rows[0];

    // Drop PostgreSQL external role se existir
    if (transp.db_user_ext) {
      try {
        await query(`DROP ROLE IF EXISTS ${transp.db_user_ext}`);
        console.log(`[ADMIN] Role PG ${transp.db_user_ext} removida`);
      } catch (pgErr) {
        console.warn(`[ADMIN] Aviso ao dropar role ${transp.db_user_ext}:`, pgErr.message);
      }
    }

    // Remove arquivos do disco relacionados à transportadora
    const arquivosDir = path.join('/tmp/uploads');
    if (fs.existsSync(arquivosDir)) {
      try {
        const { rows: arquivos } = await query(
          'SELECT caminho FROM arquivos WHERE transportadora_id = $1',
          [transp.id]
        );
        for (const arq of arquivos) {
          try { fs.unlinkSync(arq.caminho); } catch {}
        }
      } catch (err) {
        console.warn('[ADMIN] Aviso ao limpar arquivos:', err.message);
      }
    }

    // DELETE da transportadora — cascata apaga todos os dados filhos
    await query('DELETE FROM transportadoras WHERE id = $1', [transp.id]);

    console.log(`[ADMIN] Transportadora #${transp.id} (${transp.cod_transp}) excluída`);
    res.json({ message: 'Transportadora e todos os dados associados foram excluídos' });
  } catch (err) {
    console.error('Erro ao excluir transportadora:', err);
    res.status(500).json({ error: 'Erro interno ao excluir transportadora' });
  }
});

// ==================== ROTAS DA TRANSPORTADORA (cadastros) ====================

function transportadoraFilter(req, res, next) {
  if (!req.user.transportadora_id) {
    return res.status(403).json({ error: 'Acesso apenas para usuários de transportadora' });
  }
  next();
}

// --- Motoristas ---
app.get('/api/motoristas', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM motoristas WHERE transportadora_id = $1 ORDER BY nome',
      [req.user.transportadora_id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro ao listar motoristas' }); }
});

app.post('/api/motoristas', authMiddleware, transportadoraFilter, async (req, res) => {
  const { nome, cpf, cnh, telefone } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });
  try {
    const { rows } = await query(
      `INSERT INTO motoristas (transportadora_id, nome, cpf, cnh, telefone)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.transportadora_id, nome, cpf || null, cnh || null, telefone || null]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao criar motorista' }); }
});

app.put('/api/motoristas/:id', authMiddleware, transportadoraFilter, async (req, res) => {
  const { nome, cpf, cnh, telefone, ativo } = req.body;
  try {
    const { rows } = await query(
      `UPDATE motoristas SET nome = COALESCE($1, nome), cpf = COALESCE($2, cpf),
       cnh = COALESCE($3, cnh), telefone = COALESCE($4, telefone),
       ativo = COALESCE($5, ativo), updated_at = NOW()
       WHERE id = $6 AND transportadora_id = $7 RETURNING *`,
      [nome, cpf, cnh, telefone, ativo, req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Motorista não encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao atualizar motorista' }); }
});

app.delete('/api/motoristas/:id', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const { rowCount } = await query(
      'DELETE FROM motoristas WHERE id = $1 AND transportadora_id = $2',
      [req.params.id, req.user.transportadora_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Motorista não encontrado' });
    res.json({ message: 'Motorista removido' });
  } catch (err) { res.status(500).json({ error: 'Erro ao remover motorista' }); }
});

// --- Ajudantes ---
app.get('/api/ajudantes', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM ajudantes WHERE transportadora_id = $1 ORDER BY nome',
      [req.user.transportadora_id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro ao listar ajudantes' }); }
});

app.post('/api/ajudantes', authMiddleware, transportadoraFilter, async (req, res) => {
  const { nome, cpf, telefone } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome obrigatório' });
  try {
    const { rows } = await query(
      `INSERT INTO ajudantes (transportadora_id, nome, cpf, telefone)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.transportadora_id, nome, cpf || null, telefone || null]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao criar ajudante' }); }
});

app.put('/api/ajudantes/:id', authMiddleware, transportadoraFilter, async (req, res) => {
  const { nome, cpf, telefone, ativo } = req.body;
  try {
    const { rows } = await query(
      `UPDATE ajudantes SET nome = COALESCE($1, nome), cpf = COALESCE($2, cpf),
       telefone = COALESCE($3, telefone), ativo = COALESCE($4, ativo), updated_at = NOW()
       WHERE id = $5 AND transportadora_id = $6 RETURNING *`,
      [nome, cpf, telefone, ativo, req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Ajudante não encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao atualizar ajudante' }); }
});

app.delete('/api/ajudantes/:id', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const { rowCount } = await query(
      'DELETE FROM ajudantes WHERE id = $1 AND transportadora_id = $2',
      [req.params.id, req.user.transportadora_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Ajudante não encontrado' });
    res.json({ message: 'Ajudante removido' });
  } catch (err) { res.status(500).json({ error: 'Erro ao remover ajudante' }); }
});

// --- Veículos ---
app.get('/api/veiculos', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT * FROM veiculos WHERE transportadora_id = $1 ORDER BY placa',
      [req.user.transportadora_id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro ao listar veículos' }); }
});

app.post('/api/veiculos', authMiddleware, transportadoraFilter, async (req, res) => {
  const { placa, tipo, obs } = req.body;
  if (!placa) return res.status(400).json({ error: 'Placa obrigatória' });
  try {
    const { rows } = await query(
      `INSERT INTO veiculos (transportadora_id, placa, tipo, obs)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.transportadora_id, placa.toUpperCase(), tipo || null, obs || null]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Placa já cadastrada' });
    res.status(500).json({ error: 'Erro ao criar veículo' });
  }
});

app.put('/api/veiculos/:id', authMiddleware, transportadoraFilter, async (req, res) => {
  const { placa, tipo, obs, ativo } = req.body;
  try {
    const { rows } = await query(
      `UPDATE veiculos SET placa = COALESCE($1, placa), tipo = COALESCE($2, tipo),
       obs = COALESCE($3, obs), ativo = COALESCE($4, ativo), updated_at = NOW()
       WHERE id = $5 AND transportadora_id = $6 RETURNING *`,
      [placa ? placa.toUpperCase() : null, tipo, obs, ativo, req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Veículo não encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao atualizar veículo' }); }
});

app.delete('/api/veiculos/:id', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const { rowCount } = await query(
      'DELETE FROM veiculos WHERE id = $1 AND transportadora_id = $2',
      [req.params.id, req.user.transportadora_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Veículo não encontrado' });
    res.json({ message: 'Veículo removido' });
  } catch (err) { res.status(500).json({ error: 'Erro ao remover veículo' }); }
});

// --- Usuários da transportadora (master pode gerenciar) ---
app.get('/api/usuarios', authMiddleware, transportadoraFilter, async (req, res) => {
  if (!['master', 'admin'].includes(req.user.funcao)) {
    return res.status(403).json({ error: 'Acesso não autorizado' });
  }
  try {
    const { rows } = await query(
      `SELECT id, nome, email, funcao, ativo, primeiro_acesso,
              to_char(created_at, 'YYYY-MM-DD') as created_at
       FROM usuarios WHERE transportadora_id = $1 ORDER BY created_at DESC`,
      [req.user.transportadora_id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro ao listar usuários' }); }
});

app.post('/api/usuarios', authMiddleware, transportadoraFilter, async (req, res) => {
  if (!['master', 'admin'].includes(req.user.funcao)) {
    return res.status(403).json({ error: 'Acesso não autorizado' });
  }
  const { nome, email, funcao } = req.body;
  if (!nome || !email || !funcao) {
    return res.status(400).json({ error: 'Nome, email e função obrigatórios' });
  }
  if (!['admin', 'operador'].includes(funcao)) {
    return res.status(400).json({ error: 'Função inválida' });
  }
  try {
    const senhaTemporaria = crypto.randomBytes(4).toString('hex') + 'A1@';
    const senha_hash = await bcrypt.hash(senhaTemporaria, 10);
    const { rows } = await query(
      `INSERT INTO usuarios (transportadora_id, nome, email, senha_hash, funcao, primeiro_acesso)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id, nome, email, funcao`,
      [req.user.transportadora_id, nome, email, senha_hash, funcao]
    );

    // Envia email com senha temporária
    sendMail({
      to: email,
      subject: 'Conta criada — Gestão de Escala',
      html: templateAcesso(nome, email, senhaTemporaria),
    });

    res.json({ ...rows[0], senha_enviada_para: email });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email já cadastrado' });
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

app.put('/api/usuarios/:id', authMiddleware, transportadoraFilter, async (req, res) => {
  if (!['master', 'admin'].includes(req.user.funcao)) {
    return res.status(403).json({ error: 'Acesso não autorizado' });
  }
  const { nome, funcao, ativo } = req.body;
  try {
    const { rows } = await query(
      `UPDATE usuarios SET nome = COALESCE($1, nome), funcao = COALESCE($2, funcao),
       ativo = COALESCE($3, ativo), updated_at = NOW()
       WHERE id = $4 AND transportadora_id = $5 RETURNING id, nome, email, funcao, ativo`,
      [nome, funcao, ativo, req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao atualizar usuário' }); }
});

// ==================== ROTAS OPERACIONAIS ====================

app.get('/api/cargas', authMiddleware, transportadoraFilter, async (req, res) => {
  const { dataInicio, dataFim } = req.query;
  let sql = 'SELECT * FROM cargas WHERE transportadora_id = $1';
  const params = [req.user.transportadora_id];
  let idx = 2;
  if (dataInicio) { sql += ` AND data_entrega >= $${idx}`; params.push(dataInicio); idx++; }
  if (dataFim) { sql += ` AND data_entrega <= $${idx}`; params.push(dataFim); idx++; }
  sql += ' ORDER BY data_entrega DESC';
  try {
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro ao listar cargas' }); }
});

app.post('/api/cargas', authMiddleware, transportadoraFilter, async (req, res) => {
  const { carga, data_entrega, qtd_entg, cub, placa, rota, regiao_nome, regiao, box } = req.body;
  try {
    const { rows } = await query(
      `INSERT INTO cargas (transportadora_id, carga, data_entrega, qtd_entg, cub, placa, rota, regiao_nome, regiao, box)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [req.user.transportadora_id, carga, data_entrega, qtd_entg || 0, cub, placa, rota, regiao_nome, regiao, box || null]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao criar carga' }); }
});

app.put('/api/cargas/:id/placa', authMiddleware, transportadoraFilter, async (req, res) => {
  const { placa } = req.body;
  try {
    const { rows } = await query(
      'UPDATE cargas SET placa = $1, updated_at = NOW() WHERE id = $2 AND transportadora_id = $3 RETURNING *',
      [placa, req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Carga não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao atualizar placa' }); }
});

app.put('/api/cargas/:id/confirmar', authMiddleware, transportadoraFilter, async (req, res) => {
  const { placa } = req.body;
  try {
    const { rows } = await query(
      'UPDATE cargas SET confirma = true, placa = COALESCE($1, placa), updated_at = NOW() WHERE id = $2 AND transportadora_id = $3 RETURNING *',
      [placa, req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Carga não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao confirmar carga' }); }
});

app.put('/api/cargas/:id/desconfirmar', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE cargas SET confirma = false, confirma_equipe = false,
       motorista = null, ajudante_01 = null, ajudante_02 = null, updated_at = NOW()
       WHERE id = $1 AND transportadora_id = $2 RETURNING *`,
      [req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Carga não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao desconfirmar carga' }); }
});

app.put('/api/cargas/:id/equipe', authMiddleware, transportadoraFilter, async (req, res) => {
  const { motorista, ajudante_01, ajudante_02 } = req.body;
  try {
    const { rows } = await query(
      `UPDATE cargas SET motorista = $1, ajudante_01 = $2, ajudante_02 = $3,
       confirma_equipe = true, updated_at = NOW()
       WHERE id = $4 AND transportadora_id = $5 RETURNING *`,
      [motorista, ajudante_01 || null, ajudante_02 || null, req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Carga não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao confirmar equipe' }); }
});

app.put('/api/cargas/:id/desfazer-equipe', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE cargas SET confirma_equipe = false, motorista = null,
       ajudante_01 = null, ajudante_02 = null, updated_at = NOW()
       WHERE id = $1 AND transportadora_id = $2 RETURNING *`,
      [req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Carga não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao desfazer equipe' }); }
});

// --- Entregas ---
app.get('/api/entregas', authMiddleware, transportadoraFilter, async (req, res) => {
  const { dataInicio, dataFim, carga, placa } = req.query;
  let sql = 'SELECT e.* FROM entregas e WHERE e.transportadora_id = $1';
  const params = [req.user.transportadora_id];
  let idx = 2;
  if (dataInicio) { sql += ` AND e.data_nf >= $${idx}`; params.push(dataInicio); idx++; }
  if (dataFim) { sql += ` AND e.data_nf <= $${idx}`; params.push(dataFim); idx++; }
  if (carga) { sql += ` AND e.fc = $${idx}`; params.push(carga); idx++; }
  if (placa) { sql += ` AND e.fc IN (SELECT carga FROM cargas WHERE transportadora_id = $1 AND placa = $${idx})`; params.push(placa); idx++; }
  sql += ' ORDER BY e.data_nf DESC';
  try {
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro ao listar entregas' }); }
});

app.put('/api/entregas/:id/confirmar', authMiddleware, transportadoraFilter, async (req, res) => {
  const { status } = req.body;
  try {
    const { rows } = await query(
      'UPDATE entregas SET confirma_entrega = $1, updated_at = NOW() WHERE id = $2 AND transportadora_id = $3 RETURNING *',
      [status, req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Entrega não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao confirmar entrega' }); }
});

app.post('/api/entregas/:id/insucesso', authMiddleware, transportadoraFilter, async (req, res) => {
  const { motivo, reentrega, devolucao } = req.body;
  try {
    const { rows } = await query(
      `UPDATE entregas SET confirma_entrega = false, motivo_insucesso = $1,
       reentrega = $2, devolucao = $3, updated_at = NOW()
       WHERE id = $4 AND transportadora_id = $5 RETURNING *`,
      [motivo, reentrega, devolucao, req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Entrega não encontrada' });
    // Se devolucao for true, insere em em_devolucao
    if (devolucao) {
      const e = rows[0];
      await query(
        `INSERT INTO em_devolucao (transportadora_id, fc, nf, cliente, bairro, motivo_insucesso)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [req.user.transportadora_id, e.fc, e.nf, e.cliente, e.bairro, motivo]
      );
    }
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao registrar insucesso' }); }
});

app.put('/api/entregas/:id/reabrir', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE entregas SET confirma_entrega = null, motivo_insucesso = null,
       reentrega = null, devolucao = null, status_reentrega = null, updated_at = NOW()
       WHERE id = $1 AND transportadora_id = $2 RETURNING *`,
      [req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Entrega não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao reabrir entrega' }); }
});

app.put('/api/entregas/:id/reentrega', authMiddleware, transportadoraFilter, async (req, res) => {
  const { status } = req.body;
  try {
    const { rows } = await query(
      `UPDATE entregas SET status_reentrega = $1, updated_at = NOW()
       WHERE id = $2 AND transportadora_id = $3 RETURNING *`,
      [status, req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Entrega não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao confirmar reentrega' }); }
});

// --- Reversas ---
app.get('/api/reversas', authMiddleware, transportadoraFilter, async (req, res) => {
  const { dataInicio, dataFim } = req.query;
  let sql = 'SELECT * FROM reversas WHERE transportadora_id = $1';
  const params = [req.user.transportadora_id];
  let idx = 2;
  if (dataInicio) { sql += ` AND data_nf >= $${idx}`; params.push(dataInicio); idx++; }
  if (dataFim) { sql += ` AND data_nf <= $${idx}`; params.push(dataFim); idx++; }
  sql += ' ORDER BY data_nf DESC';
  try {
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro ao listar reversas' }); }
});

app.put('/api/reversas/:id/confirmar', authMiddleware, transportadoraFilter, async (req, res) => {
  const { status } = req.body;
  try {
    const { rows } = await query(
      `UPDATE reversas SET confirma_entrega = $1, updated_at = NOW()
       WHERE id = $2 AND transportadora_id = $3 RETURNING *`,
      [status, req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Reversa não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao confirmar coleta' }); }
});

app.post('/api/reversas/:id/insucesso', authMiddleware, transportadoraFilter, async (req, res) => {
  const { motivo, reentrega, devolucao } = req.body;
  try {
    const { rows } = await query(
      `UPDATE reversas SET confirma_entrega = false, motivo_insucesso = $1,
       reentrega = $2, devolucao = $3, updated_at = NOW()
       WHERE id = $4 AND transportadora_id = $5 RETURNING *`,
      [motivo, reentrega, devolucao, req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Reversa não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao registrar insucesso' }); }
});

app.put('/api/reversas/:id/reabrir', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE reversas SET confirma_entrega = null, motivo_insucesso = null,
       reentrega = null, devolucao = null, status_reentrega = null, status_devolucao = null, updated_at = NOW()
       WHERE id = $1 AND transportadora_id = $2 RETURNING *`,
      [req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Reversa não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao reabrir' }); }
});

app.put('/api/reversas/:id/recoleta', authMiddleware, transportadoraFilter, async (req, res) => {
  const { status } = req.body;
  try {
    const { rows } = await query(
      `UPDATE reversas SET status_devolucao = $1, updated_at = NOW()
       WHERE id = $2 AND transportadora_id = $3 RETURNING *`,
      [status, req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Reversa não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao confirmar recoleta' }); }
});

app.put('/api/reversas/:id/devolucao-cd', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE reversas SET status_reentrega = true, updated_at = NOW()
       WHERE id = $1 AND transportadora_id = $2 RETURNING *`,
      [req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Reversa não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao confirmar devolução ao CD' }); }
});

// --- Devoluções ---
app.get('/api/devolucoes', authMiddleware, transportadoraFilter, async (req, res) => {
  const { dataInicio, dataFim } = req.query;
  let sql = 'SELECT * FROM em_devolucao WHERE transportadora_id = $1';
  const params = [req.user.transportadora_id];
  let idx = 2;
  if (dataInicio) { sql += ` AND created_at::date >= $${idx}`; params.push(dataInicio); idx++; }
  if (dataFim) { sql += ` AND created_at::date <= $${idx}`; params.push(dataFim); idx++; }
  sql += ' ORDER BY created_at DESC';
  try {
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erro ao listar devoluções' }); }
});

app.put('/api/devolucoes/:id/confirmar', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const { rows } = await query(
      `UPDATE em_devolucao SET status_devolucao = true, updated_at = NOW()
       WHERE id = $1 AND transportadora_id = $2 RETURNING *`,
      [req.params.id, req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Devolução não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro ao confirmar devolução' }); }
});

// ==================== INDICADORES ====================
app.get('/api/indicadores/resumo', authMiddleware, transportadoraFilter, async (req, res) => {
  const { dataInicio, dataFim } = req.query;
  try {
    const tid = req.user.transportadora_id;
    const result = await query('SELECT COUNT(*) as total FROM entregas WHERE transportadora_id = $1', [tid]);
    const total = parseInt(result.rows[0].total);

    const ok = await query(
      `SELECT COUNT(*) as total FROM entregas WHERE transportadora_id = $1 AND confirma_entrega = true AND (reentrega IS NULL OR reentrega = false)`, [tid]
    );
    const entregues = parseInt(ok.rows[0].total);

    const ins = await query(
      `SELECT COUNT(*) as total FROM entregas WHERE transportadora_id = $1 AND confirma_entrega = false AND (reentrega IS NULL OR reentrega = false)`, [tid]
    );
    const insucessos = parseInt(ins.rows[0].total);

    const reent = await query(
      `SELECT COUNT(*) as total FROM entregas WHERE transportadora_id = $1 AND reentrega = true AND status_reentrega IS NULL`, [tid]
    );
    const reentregasPend = parseInt(reent.rows[0].total);

    const semPlacaRes = await query(
      `SELECT COUNT(*) as total FROM entregas e
       JOIN cargas c ON c.carga = e.fc AND c.transportadora_id = e.transportadora_id
       WHERE e.transportadora_id = $1 AND (c.placa IS NULL OR c.placa = '')`, [tid]
    );
    const semPlaca = parseInt(semPlacaRes.rows[0].total);

    const coletasNaoDevRes = await query(
      `SELECT COUNT(*) as total FROM reversas
       WHERE transportadora_id = $1 AND confirma_entrega = true AND (status_devolucao IS NULL OR status_devolucao = false)`, [tid]
    );
    const coletasNaoDevolvidas = parseInt(coletasNaoDevRes.rows[0].total);

    res.json({ total, entregues, insucessos, reentregasPend, semPlaca, coletasNaoDevolvidas, taxaSucesso: total > 0 ? Math.round(entregues / total * 100) : 0 });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar indicadores' });
  }
});

app.get('/api/indicadores/tendencia', authMiddleware, transportadoraFilter, async (req, res) => {
  const { dataInicio, dataFim } = req.query;
  try {
    const { rows } = await query(
      `SELECT data_nf, COUNT(*) as total,
              SUM(CASE WHEN confirma_entrega = true THEN 1 ELSE 0 END) as entregues,
              SUM(CASE WHEN confirma_entrega = false THEN 1 ELSE 0 END) as insucessos
       FROM entregas
       WHERE transportadora_id = $1 AND data_nf BETWEEN $2 AND $3
       GROUP BY data_nf ORDER BY data_nf`,
      [req.user.transportadora_id, dataInicio || '2020-01-01', dataFim || '2099-12-31']
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar tendência' });
  }
});

app.get('/api/indicadores/motivos', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT motivo_insucesso, COUNT(*) as total
       FROM entregas
       WHERE transportadora_id = $1 AND motivo_insucesso IS NOT NULL
       GROUP BY motivo_insucesso ORDER BY total DESC LIMIT 10`,
      [req.user.transportadora_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar motivos' });
  }
});

app.get('/api/indicadores/top-motoristas', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT c.motorista, c.placa, COUNT(e.id) as entregas,
              SUM(CASE WHEN e.confirma_entrega = true THEN 1 ELSE 0 END) as sucesso
       FROM cargas c
       JOIN entregas e ON e.fc = c.carga AND e.transportadora_id = c.transportadora_id
       WHERE c.transportadora_id = $1 AND c.motorista IS NOT NULL
       GROUP BY c.motorista, c.placa
       ORDER BY entregas DESC LIMIT 10`,
      [req.user.transportadora_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar ranking' });
  }
});

// ==================== RELATÓRIOS ====================
async function gerarCSV(rows, filename, res) {
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Nenhum dado encontrado' });
  }
  const headers = Object.keys(rows[0]);
  let csv = headers.join(';') + '\n';
  for (const row of rows) {
    csv += headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return '';
      const str = String(val);
      return str.includes(';') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(';') + '\n';
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send('\uFEFF' + csv);
}

async function gerarXLSX(rows, filename, res) {
  if (rows.length === 0) return res.status(404).json({ error: 'Nenhum dado encontrado' });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Relatório');
  const headers = Object.keys(rows[0]);
  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow(headers.map(h => row[h]));
  }
  sheet.getRow(1).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

async function gerarPDF(title, rows, headers, res) {
  const doc = new PDFDocument({ margin: 30, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${title}.pdf"`);
  doc.pipe(res);
  doc.fontSize(16).text(title, { align: 'center' });
  doc.moveDown();

  if (rows.length === 0) {
    doc.fontSize(12).text('Nenhum dado encontrado.');
  } else {
    const cols = headers || Object.keys(rows[0]);
    const pageWidth = doc.page.width - 60;
    const colWidth = pageWidth / cols.length;

    doc.fontSize(8).font('Helvetica-Bold');
    let y = doc.y;
    for (let i = 0; i < cols.length; i++) {
      doc.text(cols[i], 30 + i * colWidth, y, { width: colWidth });
    }
    doc.moveDown(0.5);
    doc.font('Helvetica');

    for (const row of rows) {
      y = doc.y;
      if (y > doc.page.height - 60) doc.addPage();
      for (let i = 0; i < cols.length; i++) {
        const val = row[cols[i]];
        doc.text(val !== null && val !== undefined ? String(val) : '', 30 + i * colWidth, doc.y, { width: colWidth });
      }
      doc.moveDown(0.3);
    }
  }
  doc.end();
}

app.get('/api/relatorios/:tipo', authMiddleware, transportadoraFilter, async (req, res) => {
  const { tipo } = req.params;
  const { dataInicio, dataFim, formato } = req.query;
  const fmt = (formato || 'csv').toLowerCase();
  const tid = req.user.transportadora_id;

  let sql, rows;
  try {
    switch (tipo) {
      case 'entregas':
        sql = `SELECT e.nf, e.fc as carga, e.cliente, e.bairro, e.data_nf,
                      CASE WHEN e.confirma_entrega = true THEN 'Entregue'
                           WHEN e.confirma_entrega = false THEN 'Insucesso'
                           ELSE 'Pendente' END as status,
                      e.motivo_insucesso
               FROM entregas e WHERE e.transportadora_id = $1`;
        if (dataInicio) sql += ` AND e.data_nf >= '${dataInicio}'`;
        if (dataFim) sql += ` AND e.data_nf <= '${dataFim}'`;
        sql += ' ORDER BY e.data_nf DESC';
        break;
      case 'insucessos':
        sql = `SELECT e.nf, e.fc as carga, e.cliente, e.bairro, e.data_nf,
                      e.motivo_insucesso,
                      CASE WHEN e.reentrega = true THEN 'Sim' ELSE 'Não' END as reentrega
               FROM entregas e WHERE e.transportadora_id = $1 AND e.confirma_entrega = false`;
        if (dataInicio) sql += ` AND e.data_nf >= '${dataInicio}'`;
        if (dataFim) sql += ` AND e.data_nf <= '${dataFim}'`;
        sql += ' ORDER BY e.data_nf DESC';
        break;
      case 'motoristas':
        sql = `SELECT c.motorista, c.placa, COUNT(e.id) as entregas,
                      SUM(CASE WHEN e.confirma_entrega = true THEN 1 ELSE 0 END) as sucesso,
                      SUM(CASE WHEN e.confirma_entrega = false THEN 1 ELSE 0 END) as insucesso
               FROM cargas c JOIN entregas e ON e.fc = c.carga AND e.transportadora_id = c.transportadora_id
               WHERE c.transportadora_id = $1 AND c.motorista IS NOT NULL
               GROUP BY c.motorista, c.placa ORDER BY entregas DESC`;
        break;
      case 'reentregas':
        sql = `SELECT e.nf, e.fc as carga, e.cliente, e.bairro, e.motivo_insucesso,
                      CASE WHEN e.status_reentrega = true THEN 'Entregue'
                           WHEN e.status_reentrega = false THEN 'Devolvido'
                           ELSE 'Aguardando' END as status
               FROM entregas e WHERE e.transportadora_id = $1 AND e.reentrega = true
               ORDER BY e.data_nf DESC`;
        break;
      case 'devolucoes':
        sql = `SELECT d.nf, d.fc as carga, d.cliente, d.bairro, d.motivo_insucesso,
                      CASE WHEN d.status_devolucao = true THEN 'Confirmada' ELSE 'Pendente' END as status
               FROM em_devolucao d WHERE d.transportadora_id = $1
               ORDER BY d.created_at DESC`;
        break;
      default:
        return res.status(400).json({ error: 'Tipo de relatório inválido' });
    }

    const result = await query(sql, [tid]);
    rows = result.rows;

    if (fmt === 'csv') return gerarCSV(rows, tipo, res);
    if (fmt === 'xlsx') return gerarXLSX(rows, tipo, res);
    if (fmt === 'pdf') return gerarPDF('Relatório: ' + tipo, rows, null, res);
    res.status(400).json({ error: 'Formato inválido. Use csv, xlsx ou pdf' });
  } catch (err) {
    console.error('Erro no relatório:', err);
    res.status(500).json({ error: 'Erro ao gerar relatório' });
  }
});

// ==================== FUNCIONÁRIOS (para equipe) ====================
app.get('/api/funcionarios', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const tid = req.user.transportadora_id;
    const [mot, aju] = await Promise.all([
      query(`SELECT id, nome, 'motorista' as funcao FROM motoristas WHERE transportadora_id = $1 AND ativo = true ORDER BY nome`, [tid]),
      query(`SELECT id, nome, 'ajudante' as funcao FROM ajudantes WHERE transportadora_id = $1 AND ativo = true ORDER BY nome`, [tid])
    ]);
    res.json([...mot.rows, ...aju.rows]);
  } catch (err) { res.status(500).json({ error: 'Erro ao listar funcionários' }); }
});

// ==================== DADOS DA PRÓPRIA TRANSPORTADORA ====================
app.get('/api/me/transportadora', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, cod_transp, nome, cnpj, email, telefone FROM transportadoras WHERE id = $1',
      [req.user.transportadora_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Transportadora não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.get('/api/me/db-credentials', authMiddleware, transportadoraFilter, async (req, res) => {
  if (req.user.funcao !== 'master') {
    return res.status(403).json({ error: 'Apenas o master pode ver credenciais do banco' });
  }
  try {
    const { rows } = await query(
      'SELECT db_user_ext, db_pass_enc FROM transportadoras WHERE id = $1',
      [req.user.transportadora_id]
    );
    if (rows.length === 0 || !rows[0].db_pass_enc) {
      return res.status(404).json({ error: 'Credenciais não configuradas' });
    }
    const creds = JSON.parse(rows[0].db_pass_enc);
    res.json({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || '5432',
      database: process.env.DB_NAME || 'escala_db',
      user: creds.user,
      password: creds.password
    });
  } catch (err) { res.status(500).json({ error: 'Erro ao buscar credenciais' }); }
});

// ==================== CONFIG IMAP DA TRANSPORTADORA ====================
app.get('/api/me/imap-config', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT id, imap_host, imap_port, imap_ssl, imap_username, imap_check_interval, active, last_check_at, remetente_email FROM imap_config WHERE transportadora_id = $1',
      [req.user.transportadora_id]
    );
    res.json(rows[0] || null);
  } catch (err) { res.status(500).json({ error: 'Erro ao buscar config IMAP' }); }
});

app.put('/api/me/imap-config', authMiddleware, transportadoraFilter, async (req, res) => {
  const { imap_host, imap_port, imap_ssl, imap_username, imap_password, imap_check_interval, active, remetente_email } = req.body;
  if (!imap_host || !imap_username) {
    return res.status(400).json({ error: 'Host e usuário IMAP obrigatórios' });
  }
  try {
    const { rows: existing } = await query(
      'SELECT id, imap_password FROM imap_config WHERE transportadora_id = $1',
      [req.user.transportadora_id]
    );
    const tid = req.user.transportadora_id;
    const password = imap_password && imap_password !== '********'
      ? imap_password
      : (existing.length > 0 ? existing[0].imap_password : '');

    if (existing.length > 0) {
      await query(
        `UPDATE imap_config SET imap_host=$1, imap_port=$2, imap_ssl=$3, imap_username=$4,
         imap_password=$5, imap_check_interval=$6, active=$7, remetente_email=$8, updated_at=NOW()
         WHERE id=$9`,
        [imap_host, imap_port || 993, imap_ssl !== false, imap_username, password,
         imap_check_interval || 5, active !== false, remetente_email || null, existing[0].id]
      );
    } else {
      await query(
        `INSERT INTO imap_config (transportadora_id, imap_host, imap_port, imap_ssl, imap_username, imap_password, imap_check_interval, active, remetente_email)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [tid, imap_host, imap_port || 993, imap_ssl !== false, imap_username, password,
         imap_check_interval || 5, active !== false, remetente_email || null]
      );
    }
    res.json({ message: 'Configuração IMAP salva' });
  } catch (err) {
    console.error('Erro ao salvar IMAP:', err);
    res.status(500).json({ error: 'Erro ao salvar configuração IMAP' });
  }
});

// ==================== IMAP CHECK MANUAL ====================
app.post('/api/imap/check', authMiddleware, async (req, res) => {
  if (!['saas_owner', 'master'].includes(req.user.funcao)) {
    return res.status(403).json({ error: 'Apenas saas_owner ou master podem forçar verificação IMAP' });
  }
  try {
    console.log('[IMAP] Verificação forçada via API pelo usuário', req.user.email || req.user.id);
    checkAllMailboxes().then(() => {
      console.log('[IMAP] Verificação forçada concluída');
    }).catch(err => {
      console.error('[IMAP] Erro na verificação forçada:', err.message);
    });
    res.json({ message: 'Verificação IMAP iniciada em background' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao iniciar verificação IMAP', details: err.message });
  }
});

const upload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

// ==================== TESTAR XML (sem salvar) ====================
app.post('/api/testar-xml', authMiddleware, transportadoraFilter, upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
  try {
    const buffer = fs.readFileSync(req.file.path);
    const ext = path.extname(req.file.originalname).toLowerCase();
    let xmlContents = [];

    if (ext === '.zip') {
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();
      for (const entry of entries) {
        if (entry.entryName.endsWith('.xml') && !entry.isDirectory) {
          xmlContents.push(entry.getData().toString('utf8'));
        }
      }
    } else if (ext === '.xml') {
      xmlContents.push(buffer.toString('utf8'));
    } else {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Formato não suportado. Envie .xml ou .zip' });
    }

    const results = [];

    for (const xml of xmlContents) {
      const data = extrairDadosXml(xml);
      results.push(data);
    }

    fs.unlink(req.file.path, () => {});

    res.json({
      message: `${results.length} XML(s) processado(s)`,
      resultados: results,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao testar XML', details: err.message });
  }
});

// ==================== IMPORTAR XML (NF-e CASAS BAHIA) ====================
app.post('/api/importar-xml', authMiddleware, transportadoraFilter, upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
  try {
    const buffer = fs.readFileSync(req.file.path);
    const ext = path.extname(req.file.originalname).toLowerCase();
    let xmlContents = [];

    if (ext === '.zip') {
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();
      for (const entry of entries) {
        if (entry.entryName.endsWith('.xml') && !entry.isDirectory) {
          xmlContents.push(entry.getData().toString('utf8'));
        }
      }
    } else if (ext === '.xml') {
      xmlContents.push(buffer.toString('utf8'));
    } else {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Formato não suportado. Envie .xml ou .zip' });
    }

    let inseridas = 0, atualizadas = 0;
    const erros = [];

    for (const xml of xmlContents) {
      const result = await processarXml(xml, req.user.transportadora_id);
      if (result.error) {
        erros.push(`NF ${result.chaveNf || '?'}: ${result.error}`);
      } else if (result.inserted) {
        inseridas++;
      } else {
        atualizadas++;
      }
    }

    fs.unlink(req.file.path, () => {});

    res.json({ message: 'Importação XML concluída', inseridas, atualizadas, erros: erros.length > 0 ? erros : undefined });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao importar XML', details: err.message });
  }
});

// ==================== IMPORTAR CARGAS VIA XLSX ====================
app.post('/api/importar-cargas', authMiddleware, transportadoraFilter, upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
  try {
    const { rows: [transp] } = await query(
      'SELECT cod_transp FROM transportadoras WHERE id = $1',
      [req.user.transportadora_id]
    );
    const codTranspEsperado = transp ? transp.cod_transp : null;

    function normalizeHeader(name) {
      return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const sheet = workbook.worksheets[0];
    if (!sheet) return res.status(400).json({ error: 'Planilha vazia' });

    // Escaneia linhas 1-5 para encontrar o cabeçalho
    let headerRowNum = 0;
    let headers = {};
    for (let r = 1; r <= Math.min(5, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      const tempHeaders = {};
      for (let c = 1; c <= 20; c++) {
        const val = row.getCell(c).text?.toString().trim();
        if (val) {
          const norm = normalizeHeader(val);
          tempHeaders[norm] = c;
        }
      }
      if (tempHeaders['CARGA']) {
        headerRowNum = r;
        headers = tempHeaders;
        console.log(`[XLSX] Cabeçalho encontrado na linha ${r}:`, Object.keys(tempHeaders));
        break;
      }
    }

    if (!headerRowNum) {
      return res.status(400).json({
        error: 'Coluna CARGA não encontrada no cabeçalho. Cabeçalhos lidos: ' +
          JSON.stringify(Object.keys(headers)) || '(nenhum)'
      });
    }

    function cell(rowNum, headerName) {
      const col = headers[normalizeHeader(headerName)];
      return col ? sheet.getRow(rowNum).getCell(col) : null;
    }

    const dataStartRow = headerRowNum + 1;

    function serialToDate(serial) {
      if (!serial || typeof serial !== 'number') return null;
      const base = new Date(1900, 0, 1);
      const d = new Date(base.getTime() + (serial - 2) * 86400000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    let inseridas = 0, atualizadas = 0, ignoradas = 0;
    const erros = [];

    console.log(`[XLSX] Dados iniciam na linha ${dataStartRow}, cod_transp esperado: "${codTranspEsperado}"`);
    let emptyRows = 0;
    for (let r = dataStartRow; r <= sheet.rowCount; r++) {
      const carga = cell(r, 'CARGA')?.text?.toString().trim();
      if (!carga) { emptyRows++; if (emptyRows > 10) break; continue; }
      emptyRows = 0;

      const codTranspLinha = String(cell(r, 'CÓD. TRANSP.')?.value ?? '').trim();
      if (codTranspEsperado && codTranspLinha !== codTranspEsperado) {
        ignoradas++;
        if (ignoradas <= 3) console.log(`[XLSX] Linha ${r}: cod_transp "${codTranspLinha}" !== "${codTranspEsperado}" (ignorada)`);
        continue;
      }

      const dataSerial = cell(r, 'DATA ENTREGA')?.value;
      let dataEntrega = null;
      if (typeof dataSerial === 'number') {
        dataEntrega = serialToDate(dataSerial);
      } else if (dataSerial instanceof Date) {
        const d = dataSerial;
        dataEntrega = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }

      const qtdEntg = parseInt(cell(r, 'QTD ENTG')?.text, 10) || 0;
      const cub = parseFloat(cell(r, 'CUB.')?.text?.replace(',', '.')) || null;
      const regiao = cell(r, 'REGIÃO')?.text?.toString().trim() || null;
      const rota = cell(r, 'ROTA')?.text?.toString().trim() || null;
      const transportadora = cell(r, 'TRANSPORTADORA')?.text?.toString().trim() || null;
      const tipo = cell(r, 'TIPO')?.text?.toString().trim() || null;
      const regiaoNome = cell(r, 'REGIÃO NOME')?.text?.toString().trim() || null;
      const identificacao = cell(r, 'IDENTIFICAÇÃO')?.text?.toString().trim() || null;
      let box = parseInt(cell(r, 'BOX')?.text, 10);
      if (isNaN(box) || box < 0 || box > 999) box = null;

      try {
        const { rowCount } = await query(`
          UPDATE cargas SET
            data_entrega = $2, qtd_entg = $3, cub = $4, regiao = $5,
            rota = $6, transportadora = $7, tipo = $8, regiao_nome = $9,
            identificacao = $10, box = $11, cod_transp = $12,
            updated_at = NOW()
          WHERE transportadora_id = $13 AND carga = $1
        `, [
          carga, dataEntrega, qtdEntg, cub,
          regiao, rota, transportadora, tipo, regiaoNome,
          identificacao, box, codTranspLinha,
          req.user.transportadora_id
        ]);

        if (rowCount === 0) {
          await query(`
            INSERT INTO cargas (transportadora_id, carga, data_entrega, qtd_entg, cub,
              regiao, rota, transportadora, tipo, regiao_nome, identificacao, box, cod_transp)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          `, [
            req.user.transportadora_id, carga, dataEntrega, qtdEntg, cub,
            regiao, rota, transportadora, tipo, regiaoNome,
            identificacao, box, codTranspLinha
          ]);
          inseridas++;
        } else {
          atualizadas++;
        }
      } catch (err) {
        erros.push(`Linha ${r} (carga ${carga}): ${err.message}`);
      }
    }

    // Cleanup
    fs.unlink(req.file.path, () => {});

    res.json({
      message: `Importação concluída`,
      inseridas,
      atualizadas,
      ignoradas,
      erros: erros.length > 0 ? erros : undefined
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao importar arquivo', details: err.message });
  }
});

// ==================== UPLOAD DE ARQUIVOS ====================
app.post('/api/upload', authMiddleware, transportadoraFilter, upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
  try {
    const { rows } = await query(
      `INSERT INTO arquivos (transportadora_id, nome_original, caminho, tamanho)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.transportadora_id, req.file.originalname, req.file.path, req.file.size]
    );
    res.json({ message: 'Arquivo enviado', id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao salvar arquivo' });
  }
});

// ==================== FUNCIONÁRIOS (para compatibilidade com frontend atual) ====================
app.get('/api/data', authMiddleware, transportadoraFilter, async (req, res) => {
  try {
    const tid = req.user.transportadora_id;
    const { dataInicio, dataFim } = req.query;
    const cg = await query(
      'SELECT * FROM cargas WHERE transportadora_id = $1 ORDER BY data_entrega DESC LIMIT 500',
      [tid]
    );
    res.json({ data: cg.rows });
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// ==================== STATIC ====================
app.use(express.static(path.join(__dirname, '../../frontend/public')));

// ==================== START ====================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend rodando na porta ${PORT}`);
  iniciarImapService();
});

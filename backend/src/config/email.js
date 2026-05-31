import nodemailer from 'nodemailer';
import { query } from './database.js';

let cachedConfig = null;
let cachedAt = 0;
const CACHE_TTL = 60000;

async function getSmtpConfig() {
  if (cachedConfig && Date.now() - cachedAt < CACHE_TTL) return cachedConfig;
  const { rows } = await query('SELECT * FROM smtp_config ORDER BY id DESC LIMIT 1');
  cachedConfig = rows[0] || null;
  cachedAt = Date.now();
  return cachedConfig;
}

export function clearSmtpCache() {
  cachedConfig = null;
  cachedAt = 0;
}

export async function createTransporter(config) {
  const smtp = config || await getSmtpConfig();
  if (!smtp) return null;

  return nodemailer.createTransport({
    host: smtp.smtp_address,
    port: smtp.smtp_port,
    secure: smtp.smtp_ssl,
    auth: {
      user: smtp.smtp_username,
      pass: smtp.smtp_password,
    },
    authMethod: smtp.smtp_authentication || 'login',
    tls: {
      rejectUnauthorized: smtp.smtp_openssl_verify_mode === 'peer',
    },
  });
}

export async function sendMail({ to, subject, html }) {
  const smtp = await getSmtpConfig();
  if (!smtp) {
    console.warn('[EMAIL] SMTP não configurado — email não enviado para', to);
    return null;
  }

  try {
    const transporter = await createTransporter(smtp);
    if (!transporter) return null;

    const sender = smtp.sender_name
      ? `"${smtp.sender_name}" <${smtp.sender_email}>`
      : smtp.sender_email;

    const info = await transporter.sendMail({
      from: sender,
      to,
      subject,
      html,
    });

    console.log('[EMAIL] Enviado para', to, '- ID:', info.messageId);
    return info;
  } catch (err) {
    console.error('[EMAIL] Erro ao enviar para', to, ':', err.message);
    return null;
  }
}

export function templateAcesso(nome, email, senha) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #0a2b44; padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
        <h1 style="color: #e8b12c; margin: 0; font-size: 22px;">🏠 Gestão de Escala</h1>
        <p style="color: #fff; margin: 8px 0 0; font-size: 14px;">Casas Bahia — Via Varejo</p>
      </div>
      <div style="background: #fff; padding: 32px; border: 1px solid #e2e8f0; border-top: 0; border-radius: 0 0 12px 12px;">
        <p style="font-size: 16px; color: #1e293b;">Olá <strong>${nome}</strong>,</p>
        <p style="font-size: 14px; color: #64748b;">Sua conta foi criada no sistema de Gestão de Escala.</p>
        <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 4px 0; font-size: 13px; color: #475569;"><strong>Email:</strong> ${email}</p>
          <p style="margin: 4px 0; font-size: 13px; color: #475569;"><strong>Senha temporária:</strong> <code style="background: #e2e8f0; padding: 2px 8px; border-radius: 4px; font-size: 15px;">${senha}</code></p>
        </div>
        <p style="font-size: 13px; color: #64748b;">No primeiro acesso você precisará criar uma nova senha.</p>
        <p style="font-size: 13px; color: #94a3b8; margin-top: 24px;">Atenciosamente,<br>Equipe Gestão de Escala</p>
      </div>
    </div>
  `;
}

export function templateRecuperacao(email, senha) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #0a2b44; padding: 24px; text-align: center; border-radius: 12px 12px 0 0;">
        <h1 style="color: #e8b12c; margin: 0; font-size: 22px;">🏠 Gestão de Escala</h1>
        <p style="color: #fff; margin: 8px 0 0; font-size: 14px;">Recuperação de Senha</p>
      </div>
      <div style="background: #fff; padding: 32px; border: 1px solid #e2e8f0; border-top: 0; border-radius: 0 0 12px 12px;">
        <p style="font-size: 16px; color: #1e293b;">Olá,</p>
        <p style="font-size: 14px; color: #64748b;">Uma nova senha foi gerada para sua conta.</p>
        <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 4px 0; font-size: 13px; color: #475569;"><strong>Email:</strong> ${email}</p>
          <p style="margin: 4px 0; font-size: 13px; color: #475569;"><strong>Nova senha:</strong> <code style="background: #e2e8f0; padding: 2px 8px; border-radius: 4px; font-size: 15px;">${senha}</code></p>
        </div>
        <p style="font-size: 13px; color: #64748b;">Recomendamos trocar a senha após o primeiro login.</p>
        <p style="font-size: 13px; color: #94a3b8; margin-top: 24px;">Atenciosamente,<br>Equipe Gestão de Escala</p>
      </div>
    </div>
  `;
}

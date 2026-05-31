import Imap from 'imap';
import { simpleParser } from 'mailparser';
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { query } from '../config/database.js';
import { processarXml } from './xmlProcessor.js';

const TMP_DIR = path.join(os.tmpdir(), 'imap_xml');
let intervalHandle = null;

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email.trim().toLowerCase().replace(/["'<>]/g, '');
}

function ensureTmpDir() {
  try {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  } catch (err) {
    console.warn('[IMAP] Não foi possível criar diretório temporário:', err.message);
  }
}

async function getActiveImapConfigs() {
  try {
    const { rows } = await query(`
      SELECT ic.*, t.nome AS transportadora_nome
      FROM imap_config ic
      JOIN transportadoras t ON t.id = ic.transportadora_id
      WHERE ic.active = true
    `);
    return rows;
  } catch (err) {
    if (err.code === '42501') {
      console.error('[IMAP] Permissão negada na tabela imap_config. Execute a migration 009_fix_imap_permissions.sql ou rode manualmente:');
      console.error('  GRANT ALL PRIVILEGES ON TABLE imap_config TO escala_admin;');
      console.error('  GRANT ALL PRIVILEGES ON SEQUENCE imap_config_id_seq TO escala_admin;');
    }
    throw err;
  }
}

function processZip(buffer, transportadora_id) {
  const results = [];
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    for (const entry of entries) {
      if (entry.entryName.endsWith('.xml') && !entry.isDirectory) {
        const content = entry.getData().toString('utf8');
        results.push(content);
      }
    }
  } catch (err) {
    console.error('[IMAP] Erro ao extrair zip:', err.message);
  }
  return results;
}

function processSingleAttachment(filename, buffer, transportadora_id) {
  if (filename && filename.endsWith('.zip')) {
    return processZip(buffer, transportadora_id);
  }
  if (filename && (filename.endsWith('.xml') || (!filename.includes('.') && buffer.length > 0))) {
    return [buffer.toString('utf8')];
  }
  return [];
}

async function checkMailbox(config) {
  const { id, transportadora_id, imap_host, imap_port, imap_ssl, imap_username, imap_password, imap_check_interval, remetente_email } = config;

  console.log(`[IMAP] Verificando email para transportadora #${transportadora_id} (${imap_username})`);

  return new Promise((resolve) => {
    const imap = new Imap({
      user: imap_username,
      password: imap_password,
      host: imap_host,
      port: imap_port,
      tls: imap_ssl,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
    });

    function end() {
      try { imap.end(); } catch {}
      resolve();
    }

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          console.error(`[IMAP] Erro ao abrir INBOX (${imap_username}):`, err.message);
          imap.end();
          resolve();
          return;
        }

        console.log(`[IMAP] INBOX aberta (${imap_username}), ${box.messages.total} mensagens total`);

        const searchCriteria = remetente_email
          ? ['UNSEEN', ['FROM', remetente_email]]
          : ['UNSEEN'];

        if (remetente_email) {
          console.log(`[IMAP] Filtro ativo: buscando apenas emails de "${remetente_email}" (server-side)`);
        }

        imap.search(searchCriteria, (err, results) => {
          if (err) {
            console.error(`[IMAP] Erro na busca UNSEEN (${imap_username}):`, err.message);
            imap.end();
            resolve();
            return;
          }

          if (!results || results.length === 0) {
            console.log(`[IMAP] Nenhum email não lido para ${imap_username}`);
            imap.end();
            resolve();
            return;
          }

          console.log(`[IMAP] ${results.length} email(s) não lido(s) encontrado(s) para ${imap_username}`);

          const fetch = imap.fetch(results, { bodies: '', markSeen: true });
          let processed = 0;
          let messageCount = results.length;
          const msgPromises = [];

          fetch.on('message', (msg, seqno) => {
            const chunks = [];
            let msgResolve;
            msgPromises.push(new Promise(resolve => { msgResolve = resolve; }));
            let bodyProcessed = false;

            msg.on('body', (stream, info) => {
              stream.on('data', (chunk) => { chunks.push(chunk); });

              stream.once('end', async () => {
                if (bodyProcessed) return;
                bodyProcessed = true;

                const rawEmail = Buffer.concat(chunks);
                let emailFrom = null;
                let emailSubject = null;
                let emailDate = null;
                let attachmentsCount = 0;
                let xmlsExtracted = 0;
                let nfsInseridas = 0;
                let nfsAtualizadas = 0;
                const erros = [];
                let logStatus = 'ok';
                let skipped = false;

                try {
                  const parsed = await simpleParser(rawEmail);
                  emailFrom = parsed.from?.value?.[0]?.address || null;
                  emailSubject = parsed.subject || null;
                  emailDate = parsed.date || null;

                  if (remetente_email) {
                    const fromAddr = normalizeEmail(emailFrom);
                    const configAddr = normalizeEmail(remetente_email);
                    if (fromAddr && fromAddr !== configAddr) {
                      console.log(`[IMAP] Ignorado: from="${fromAddr}" ≠ config="${configAddr}"`);
                      skipped = true;
                      logStatus = 'ignored';
                      return;
                    }
                    if (!fromAddr) {
                      console.log(`[IMAP] Ignorado: sem remetente (config="${configAddr}")`);
                      skipped = true;
                      logStatus = 'ignored';
                      return;
                    }
                    console.log(`[IMAP] Remetente confere: "${fromAddr}" — processando`);
                  }

                  const attachments = parsed.attachments || [];
                  attachmentsCount = attachments.length;

                  for (const attachment of attachments) {
                    console.log(`[IMAP] Processando attachment: ${attachment.filename || 'sem nome'} (${(attachment.content?.length || 0)} bytes)`);

                    const xmlContents = processSingleAttachment(
                      attachment.filename,
                      attachment.content,
                      transportadora_id
                    );

                    xmlsExtracted += xmlContents.length;
                    console.log(`[IMAP] ${xmlContents.length} XML(s) extraídos do attachment`);

                    for (const xmlContent of xmlContents) {
                      const result = await processarXml(xmlContent, transportadora_id);
                      if (result.error) {
                        erros.push(`NF ${result.chaveNf || '?'}: ${result.error}`);
                        console.error(`[IMAP] Erro NF ${result.chaveNf || '?'}: ${result.error}`);
                      } else if (result.inserted) {
                        nfsInseridas++;
                        console.log(`[IMAP] NF ${result.chaveNf} inserida (transp #${transportadora_id})`);
                      } else {
                        nfsAtualizadas++;
                        console.log(`[IMAP] NF ${result.chaveNf} atualizada (transp #${transportadora_id})`);
                      }
                    }
                  }
                } catch (err) {
                  erros.push(err.message);
                  logStatus = 'error';
                  console.error(`[IMAP] Erro ao processar email (${imap_username}):`, err.message);
                }

                if (!skipped) {
                  try {
                    await query(`INSERT INTO imap_log
                      (transportadora_id, imap_config_id, email_from, email_subject, email_date,
                       attachments_count, xmls_extracted, nfs_inseridas, nfs_atualizadas, erros, status)
                      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
                      transportadora_id, id, emailFrom, emailSubject, emailDate,
                      attachmentsCount, xmlsExtracted, nfsInseridas, nfsAtualizadas,
                      erros.length > 0 ? erros : null, logStatus,
                    ]);
                  } catch (logErr) {
                    console.error(`[IMAP] Erro ao salvar log no banco:`, logErr.message);
                  }
                }

                processed++;
                msgResolve();
              });
            });

            msg.once('end', () => {
              if (!bodyProcessed) {
                processed++;
                msgResolve();
              }
            });
          });

          fetch.once('end', async () => {
            await Promise.all(msgPromises);
            console.log(`[IMAP] Processados ${processed}/${messageCount} emails para ${imap_username}`);
            end();
          });
        });
      });
    });

    imap.once('error', (err) => {
      console.error(`[IMAP] Erro de conexão (${imap_username} @ ${imap_host}:${imap_port}): ${err.message} (código: ${err.code || 'N/A'})`);
      end();
    });

    imap.once('close', () => {
      query(`UPDATE imap_config SET last_check_at = NOW() WHERE id = $1`, [id]).catch(() => {});
      query(`SELECT cleanup_imap_logs()`).catch(() => {});
    });

    imap.connect();
  });
}

export async function cleanupOldLogs() {
  try {
    await query(`SELECT cleanup_imap_logs()`);
  } catch {
    // função pode não existir se migration não rodou
  }
}

export async function testarConexao(config) {
  const { imap_host, imap_port, imap_ssl, imap_username, imap_password } = config;

  return new Promise((resolve) => {
    const imap = new Imap({
      user: imap_username,
      password: imap_password,
      host: imap_host,
      port: imap_port,
      tls: imap_ssl,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
    });

    const result = { success: true, messageCount: 0, unseenCount: 0, error: null };

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, box) => {
        if (err) {
          result.success = false;
          result.error = `Erro ao abrir INBOX: ${err.message}`;
          imap.end();
          resolve(result);
          return;
        }
        result.messageCount = box.messages.total;

        imap.search(['UNSEEN'], (err, results) => {
          if (err) {
            result.success = false;
            result.error = `Erro na busca UNSEEN: ${err.message}`;
          } else {
            result.unseenCount = results ? results.length : 0;
          }
          imap.end();
          resolve(result);
        });
      });
    });

    imap.once('error', (err) => {
      result.success = false;
      result.error = `${err.message} (código: ${err.code || 'N/A'})`;
      resolve(result);
    });

    imap.connect();
  });
}

export async function checkAllMailboxes() {
  let configs = [];
  try {
    configs = await getActiveImapConfigs();
  } catch (err) {
    if (err.code !== '42501') {
      console.error('[IMAP] Erro ao buscar configurações IMAP:', err.message);
    }
    return;
  }
  for (const config of configs) {
    try {
      await checkMailbox(config);
    } catch (err) {
      console.error(`[IMAP] Erro geral processando config #${config.id}:`, err.message);
    }
  }
}

export function iniciarImapService() {
  ensureTmpDir();
  console.log('[IMAP] Serviço iniciado');
  checkAllMailboxes().catch(err => {
    if (err.code !== '42501') {
      console.error('[IMAP] Erro na primeira verificação:', err.message);
    }
  });
  intervalHandle = setInterval(() => {
    checkAllMailboxes().catch(err => {
      if (err.code !== '42501') {
        console.error('[IMAP] Erro na verificação programada:', err.message);
      }
    });
  }, 5 * 60 * 1000);
}

export function pararImapService() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  console.log('[IMAP] Serviço parado');
}

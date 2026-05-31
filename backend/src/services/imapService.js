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

function ensureTmpDir() {
  try {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  } catch (err) {
    console.warn('[IMAP] Não foi possível criar diretório temporário:', err.message);
  }
}

async function getActiveImapConfigs() {
  const { rows } = await query(`
    SELECT ic.*, t.nome AS transportadora_nome
    FROM imap_config ic
    JOIN transportadoras t ON t.id = ic.transportadora_id
    WHERE ic.active = true
  `);
  return rows;
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
  const { id, transportadora_id, imap_host, imap_port, imap_ssl, imap_username, imap_password, imap_check_interval } = config;

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

        imap.search(['UNSEEN'], (err, results) => {
          if (err || !results || results.length === 0) {
            imap.end();
            resolve();
            return;
          }

          const fetch = imap.fetch(results, { bodies: '', markSeen: true });
          let processed = 0;

          fetch.on('message', (msg, seqno) => {
            let buffer = '';

            msg.on('body', (stream, info) => {
              stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
            });

            msg.once('attributes', async (attrs) => {
              const date = attrs.date;
              try {
                const parsed = await simpleParser(buffer);
                const attachments = parsed.attachments || [];

                for (const attachment of attachments) {
                  const xmlContents = processSingleAttachment(
                    attachment.filename,
                    attachment.content,
                    transportadora_id
                  );

                  for (const xmlContent of xmlContents) {
                    const result = await processarXml(xmlContent, transportadora_id);
                    if (result.error) {
                      console.error(`[IMAP] Erro NF ${result.chaveNf || '?'}: ${result.error}`);
                    } else {
                      console.log(`[IMAP] NF ${result.chaveNf} ${result.inserted ? 'inserida' : 'atualizada'} (transp #${transportadora_id})`);
                    }
                  }
                }
              } catch (err) {
                console.error(`[IMAP] Erro ao processar email (${imap_username}):`, err.message);
              }
              processed++;
            });
          });

          fetch.once('end', () => {
            console.log(`[IMAP] Processados ${processed} emails para ${imap_username}`);
            end();
          });
        });
      });
    });

    imap.once('error', (err) => {
      console.error(`[IMAP] Erro de conexão (${imap_username}):`, err.message);
      end();
    });

    imap.once('close', () => {
      query(`UPDATE imap_config SET last_check_at = NOW() WHERE id = $1`, [id]).catch(() => {});
    });

    imap.connect();
  });
}

export async function checkAllMailboxes() {
  const configs = await getActiveImapConfigs();
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
  checkAllMailboxes();
  intervalHandle = setInterval(checkAllMailboxes, 5 * 60 * 1000);
}

export function pararImapService() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  console.log('[IMAP] Serviço parado');
}

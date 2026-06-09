import ftp from 'basic-ftp';
import stream from 'stream';
import { query } from '../config/database.js';
import { processarXml } from './xmlProcessor.js';

const CONSULTA_API = 'https://consultadanfe.com/api/v1/consulta';
let intervalHandles = [];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function baixarArquivo(client, nome) {
  const chunks = [];
  const writable = new stream.Writable({
    write(chunk, enc, cb) {
      chunks.push(chunk);
      cb();
    }
  });
  await client.downloadTo(writable, nome);
  return Buffer.concat(chunks).toString('utf-8');
}

async function consultarChaveApi(chave, transportadora_id) {
  const log = { status: 'ok', consulta_api_ok: false, nf_inserida: false, nf_atualizada: false, mensagem: '' };
  try {
    const response = await fetch(CONSULTA_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      log.status = 'erro';
      log.mensagem = `API retornou HTTP ${response.status}`;
      return log;
    }
    const data = await response.json();
    if (data.status !== 'ok') {
      log.status = 'erro';
      log.mensagem = data.mensagem || 'API retornou erro';
      return log;
    }
    if (!data.xml_base64) {
      log.status = 'erro';
      log.mensagem = 'XML não encontrado na resposta';
      return log;
    }

    log.consulta_api_ok = true;
    const xmlBuffer = Buffer.from(data.xml_base64, 'base64');
    const xmlContent = xmlBuffer.toString('utf-8');

    const result = await processarXml(xmlContent, transportadora_id);
    if (result.error) {
      log.status = 'erro';
      log.mensagem = result.error;
    } else if (result.inserted) {
      log.nf_inserida = true;
      log.mensagem = `NF ${chave.slice(0, 10)}... inserida`;
    } else {
      log.nf_atualizada = true;
      log.mensagem = `NF ${chave.slice(0, 10)}... atualizada`;
    }
  } catch (err) {
    log.status = 'erro';
    log.mensagem = err.name === 'TimeoutError' ? 'Timeout na API' : err.message;
  }
  return log;
}

async function processarArquivo(conteudo, transportadora_id) {
  const results = [];
  const linhas = conteudo.split(/\r?\n/);
  for (const linha of linhas) {
    if (linha.startsWith('313') && linha.length >= 302) {
      const chave = linha.substring(258, 302).replace(/\s/g, '');
      if (chave.length === 44 && /^\d+$/.test(chave)) {
        await sleep(300);
        const log = await consultarChaveApi(chave, transportadora_id);
        log.chave_nf = chave;
        log.tipo = 'chave';
        results.push(log);
      }
    }
  }
  return results;
}

async function processarFtpConfig(config) {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    await client.access({
      host: config.host,
      user: config.username,
      password: config.password,
      secure: false,
    });

    const lista = await client.list();
    const arquivos = lista
      .filter(f => f.name.endsWith('.txt') && f.modifiedAt >= config.data_corte)
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const arq of arquivos) {
      let conteudo;
      try {
        conteudo = await baixarArquivo(client, arq.name);
      } catch (err) {
        await query(
          `INSERT INTO ftp_log (transportadora_id, arquivo, tipo, status, mensagem)
           VALUES ($1, $2, 'arquivo', 'erro', $3)`,
          [config.transportadora_id, arq.name, 'Erro ao baixar: ' + err.message]
        );
        continue;
      }

      const resultados = await processarArquivo(conteudo, config.transportadora_id);

      for (const r of resultados) {
        await query(
          `INSERT INTO ftp_log (transportadora_id, arquivo, chave_nf, tipo, status, consulta_api_ok, nf_inserida, nf_atualizada, mensagem)
           VALUES ($1, $2, $3, 'chave', $4, $5, $6, $7, $8)`,
          [config.transportadora_id, arq.name, r.chave_nf, r.status, r.consulta_api_ok, r.nf_inserida, r.nf_atualizada, r.mensagem]
        );
      }

      await query(
        `INSERT INTO ftp_log (transportadora_id, arquivo, tipo, status, mensagem)
         VALUES ($1, $2, 'arquivo', 'ok', $3)`,
        [config.transportadora_id, arq.name, `${resultados.length} chave(s) processada(s)`]
      );
    }

    client.close();
  } catch (err) {
    console.error(`[FTP] Erro config #${config.id}:`, err.message);
    client.close();
  }
}

export async function verificarTodosFtp() {
  try {
    const { rows: configs } = await query(
      'SELECT * FROM ftp_config WHERE active = true'
    );
    for (const config of configs) {
      try {
        await processarFtpConfig(config);
        await query('UPDATE ftp_config SET last_check_at = NOW() WHERE id = $1', [config.id]);
      } catch (err) {
        console.error(`[FTP] Erro processando config #${config.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[FTP] Erro ao buscar configurações:', err.message);
  }
}

export async function forcarVerificacaoFtp(transportadora_id) {
  try {
    const { rows } = await query('SELECT * FROM ftp_config WHERE transportadora_id = $1 AND active = true', [transportadora_id]);
    if (rows.length === 0) return { error: 'Nenhuma config FTP ativa para esta transportadora' };
    processarFtpConfig(rows[0]).then(() => {
      query('UPDATE ftp_config SET last_check_at = NOW() WHERE id = $1', [rows[0].id]);
    }).catch(err => {
      console.error('[FTP] Erro na verificação forçada:', err.message);
    });
    return { message: 'Verificação FTP iniciada em background' };
  } catch (err) {
    return { error: err.message };
  }
}

export async function testarConexaoFtp(config) {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  try {
    await client.access({
      host: config.host,
      user: config.username,
      password: config.password,
      secure: false,
    });
    const lista = await client.list();
    client.close();
    return { sucess: true, arquivos: lista.filter(f => f.name.endsWith('.txt')).length };
  } catch (err) {
    client.close();
    return { sucess: false, message: err.message };
  }
}

export function iniciarFtpService() {
  console.log('[FTP] Serviço iniciado');
  verificarTodosFtp().catch(err => {
    console.error('[FTP] Erro na primeira verificação:', err.message);
  });
  const handle = setInterval(() => {
    verificarTodosFtp().catch(err => {
      console.error('[FTP] Erro na verificação programada:', err.message);
    });
  }, 120 * 60 * 1000);
  intervalHandles.push(handle);
}

export function pararFtpService() {
  for (const h of intervalHandles) {
    clearInterval(h);
  }
  intervalHandles = [];
  console.log('[FTP] Serviço parado');
}

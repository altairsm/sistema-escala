import { XMLParser } from 'fast-xml-parser';
import { query } from '../config/database.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: true,
});

function gerarWhatsAppJid(telefone) {
  if (!telefone) return null;
  const digits = telefone.replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.slice(0, 2) + digits.slice(3) + '@s.whatsapp.net';
  }
  return null;
}

async function enviarSmsNcr({ telefone, cliente, nf, nf_pv }) {
  if (!telefone) return;
  const digits = telefone.replace(/\D/g, '');
  if (digits.length < 10) return;
  const dia = String(new Date().getDate()).padStart(2, '0');
  const msg = `80; ${dia}; TRANSCARNEIRO TRANSP; CASAS BAHIA; ${cliente}; ${nf_pv || ''}; ${nf}`;
  const body = {
    sendSmsRequest: {
      from: 'Transcarneiro Transportes',
      to: '55' + digits,
      msg,
      callbackOption: 'NONE',
      id: nf,
      aggregateId: '',
      flashSms: false,
    },
    webhookUrl: 'https://webhook.sactudo.com.br/webhook/ncr',
  };
  try {
    const resp = await fetch('https://webhook.sactudo.com.br/webhook/ncr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      console.error(`[SMS] Erro ao enviar SMS para ${telefone}: ${resp.status}`);
    }
  } catch (err) {
    console.error(`[SMS] Falha ao enviar SMS para ${telefone}:`, err.message);
  }
}

function extractData(infCpl, natOp) {
  const upper = (natOp || '').toUpperCase();
  let match;

  if (upper.includes('COLETA')) {
    match = infCpl.match(/STD NUMERO:\s*(\d+).*?CARGA:\s*(\d+).*?BOX:\s*(\d+).*?MICRO ZONA:\s*([A-Z\s]+\d+).*?de\s+(\d{2}-\d{2}-\d{4})/s);
    if (match) {
      return {
        numero: match[1],
        numeroCarga: match[2],
        box: match[3],
        microZona: match[4].trim(),
        dataEntrega: match[5],
        filialVenda: null,
        numeroPedido: null,
      };
    }
  }

  if (upper.includes('DEVOLUCAO')) {
    match = infCpl.match(/CARGA:\s*(\d+).*?BOX:\s*(\d+)/s);
    if (match) {
      return {
        numero: null,
        numeroCarga: match[1],
        box: match[2],
        microZona: null,
        dataEntrega: null,
        filialVenda: null,
        numeroPedido: null,
      };
    }
  }

  match = infCpl.match(/FILIAL VENDA:\s*(\d+).*?N\.?PEDIDO:\s*(\d+).*?CARGA:\s*(\d+).*?BOX:\s*(\d+).*?MICRO ZONA:\s*([A-Z\s]+\d+).*?DATA DE ENTREGA:\s*([\w\s\d]+)/s);
  if (match) {
    return {
      filialVenda: match[1],
      numeroPedido: match[2],
      numeroCarga: match[3],
      box: match[4],
      microZona: match[5].trim(),
      dataEntrega: match[6].trim(),
      numero: null,
    };
  }

  return null;
}

export async function processarXml(xmlContent, transportadora_id) {
  let doc;
  try {
    doc = parser.parse(xmlContent);
  } catch (err) {
    return { inserted: false, error: `Erro ao fazer parse do XML: ${err.message}` };
  }

  // Tenta encontrar nfeProc em diferentes posições (alguns XMLs podem ter wrapper)
  let nfeProc = doc.nfeProc;
  if (!nfeProc) {
    const rootKeys = Object.keys(doc).filter(k => !k.startsWith('@_') && k !== '?xml');
    console.log(`[XML] Tags raiz encontradas: ${rootKeys.join(', ')}`);
    for (const key of rootKeys) {
      if (doc[key]?.nfeProc) nfeProc = doc[key].nfeProc;
    }
  }
  if (!nfeProc) {
    return { inserted: false, error: 'Tag nfeProc não encontrada no XML' };
  }

  const infNFe = nfeProc.NFe?.infNFe;
  const protNFe = nfeProc.protNFe;
  if (!infNFe || !protNFe) {
    return { inserted: false, error: 'Tag infNFe ou protNFe não encontrada' };
  }

  const chaveNf = protNFe.infProt?.chNFe;
  if (!chaveNf) {
    return { inserted: false, error: 'Chave NF não encontrada' };
  }

  const nf = String(infNFe.ide?.nNF || '');
  const dhEmi = infNFe.ide?.dhEmi || null;
  const natOp = infNFe.ide?.natOp || '';
  const cliente = infNFe.dest?.xNome || '';
  const cidade = infNFe.dest?.enderDest?.xMun || '';
  const bairro = infNFe.dest?.enderDest?.xBairro || '';
  const cep = infNFe.dest?.enderDest?.CEP || '';
  const telefone = infNFe.dest?.enderDest?.fone || '';
  const infCpl = infNFe.infAdic?.infCpl || '';

  // Dados do emitente (remetente)
  const cnpjEmitente = infNFe.emit?.CNPJ || '';
  const nomeEmitente = infNFe.emit?.xNome || '';
  const endEmit = infNFe.emit?.enderEmit || {};
  const endEmitente = `${endEmit.xLgr || ''}, ${endEmit.nro || ''}${endEmit.xCpl ? ' ' + endEmit.xCpl : ''}`.trim();
  const cidadeEmitente = endEmit.xMun || '';
  const ufEmitente = endEmit.UF || '';

  // CNPJ/CPF do destinatario
  const cnpjCliente = infNFe.dest?.CNPJ || infNFe.dest?.CPF || '';

  // Totais da NF
  const icmsTot = infNFe.total?.ICMSTot || {};
  const valorNf = parseFloat(icmsTot.vNF || 0);
  const serie = String(infNFe.ide?.serie || '');

  // Modalidade do frete: 0=CIF, 1=FOB
  const freteTipo = infNFe.transp?.modFrete === '1' ? 'FOB' : 'CIF';

  // Volumes
  const vol = infNFe.transp?.vol;
  const qtdVolumes = parseInt(vol?.qVol || 0);
  const pesoReal = parseFloat(vol?.pesoL || 0);

  const data = extractData(infCpl, natOp);

  const dataNf = dhEmi ? dhEmi.substring(0, 10) : null;

  console.log(`[XML] NF ${chaveNf} (nf=${nf}, emit=${nomeEmitente?.slice(0, 30)}, cliente=${cliente?.slice(0, 30)}, carga=${data?.numeroCarga || '?'})`);

  try {
    const { rowCount } = await query(`
      UPDATE entregas SET
        transportadora_id = $2, nf = $3, data_nf = $4, fc = $5, box = $6,
        nf_pv = $7, filial = $8, cliente = $9, cidade = $10, bairro = $11,
        micro_zona = $12, remessa = $13,
        cnpj_cliente = $14, cnpj_emitente = $15, nome_emitente = $16,
        end_emitente = $17, cidade_emitente = $18, uf_emitente = $19,
        valor_nf = $20, peso_real = $21, qtd_volumes = $22, frete_tipo = $23,
        cep = $24, telefone = $25, whatsapp_jid = $26,
        updated_at = NOW()
      WHERE chave_nf = $1
    `, [
      chaveNf, transportadora_id, nf, dataNf,
      data?.numeroCarga || null,
      data?.box ? parseInt(data.box, 10) : null,
      data?.numeroPedido || data?.numero || null,
      data?.filialVenda ? parseInt(data.filialVenda, 10) : null,
      cliente || null, cidade || null, bairro || null,
      data?.microZona || null, natOp || null,
      cnpjCliente || null, cnpjEmitente || null, nomeEmitente || null,
      endEmitente || null, cidadeEmitente || null, ufEmitente || null,
      valorNf || 0, pesoReal || 0, qtdVolumes || 0, freteTipo,
      cep || null, telefone || null, gerarWhatsAppJid(telefone),
    ]);

    if (rowCount > 0) {
      console.log(`[XML] NF ${chaveNf} atualizada (${rowCount} linha(s))`);
      return { inserted: false, updated: true, chaveNf, nf, fc: data?.numeroCarga || null };
    }

    await query(`
      INSERT INTO entregas (chave_nf, transportadora_id, nf, data_nf, fc, box,
        nf_pv, filial, cliente, cidade, bairro, micro_zona, remessa,
        cnpj_cliente, cnpj_emitente, nome_emitente, end_emitente,
        cidade_emitente, uf_emitente, valor_nf, peso_real, qtd_volumes, frete_tipo,
        cep, telefone, whatsapp_jid)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
        $24, $25, $26)
    `, [
      chaveNf, transportadora_id, nf, dataNf,
      data?.numeroCarga || null,
      data?.box ? parseInt(data.box, 10) : null,
      data?.numeroPedido || data?.numero || null,
      data?.filialVenda ? parseInt(data.filialVenda, 10) : null,
      cliente || null, cidade || null, bairro || null,
      data?.microZona || null, natOp || null,
      cnpjCliente || null, cnpjEmitente || null, nomeEmitente || null,
      endEmitente || null, cidadeEmitente || null, ufEmitente || null,
      valorNf || 0, pesoReal || 0, qtdVolumes || 0, freteTipo,
      cep || null, telefone || null, gerarWhatsAppJid(telefone),
    ]);

    console.log(`[XML] NF ${chaveNf} inserida com sucesso`);
    const nfPv = data?.numeroPedido || data?.numero || null;
    enviarSmsNcr({ telefone, cliente, nf, nf_pv: nfPv });
    return { inserted: true, updated: false, chaveNf, nf, fc: data?.numeroCarga || null };
  } catch (err) {
    console.error(`[XML] Erro ao salvar NF ${chaveNf}:`, err.message);
    return { inserted: false, error: err.message };
  }
}

export function extrairDadosXml(xmlContent) {
  let doc;
  try {
    doc = parser.parse(xmlContent);
  } catch (err) {
    return { error: `Erro ao fazer parse do XML: ${err.message}` };
  }

  let nfeProc = doc.nfeProc;
  if (!nfeProc) {
    const rootKeys = Object.keys(doc).filter(k => !k.startsWith('@_') && k !== '?xml');
    for (const key of rootKeys) {
      if (doc[key]?.nfeProc) nfeProc = doc[key].nfeProc;
    }
  }
  if (!nfeProc) {
    return { error: 'Tag nfeProc não encontrada no XML' };
  }

  const infNFe = nfeProc.NFe?.infNFe;
  const protNFe = nfeProc.protNFe;
  if (!infNFe || !protNFe) {
    return { error: 'Tag infNFe ou protNFe não encontrada' };
  }

  const chaveNf = protNFe.infProt?.chNFe;
  if (!chaveNf) {
    return { error: 'Chave NF não encontrada' };
  }

  const nf = String(infNFe.ide?.nNF || '');
  const dhEmi = infNFe.ide?.dhEmi || null;
  const natOp = infNFe.ide?.natOp || '';
  const cliente = infNFe.dest?.xNome || '';
  const cidade = infNFe.dest?.enderDest?.xMun || '';
  const bairro = infNFe.dest?.enderDest?.xBairro || '';
  const cep = infNFe.dest?.enderDest?.CEP || '';
  const telefone = infNFe.dest?.enderDest?.fone || '';
  const infCpl = infNFe.infAdic?.infCpl || '';
  const dataNf = dhEmi ? dhEmi.substring(0, 10) : null;

  const cnpjEmitente = infNFe.emit?.CNPJ || '';
  const nomeEmitente = infNFe.emit?.xNome || '';
  const endEmit = infNFe.emit?.enderEmit || {};
  const endEmitente = `${endEmit.xLgr || ''}, ${endEmit.nro || ''}${endEmit.xCpl ? ' ' + endEmit.xCpl : ''}`.trim();
  const cidadeEmitente = endEmit.xMun || '';
  const ufEmitente = endEmit.UF || '';

  const cnpjCliente = infNFe.dest?.CNPJ || infNFe.dest?.CPF || '';
  const icmsTot = infNFe.total?.ICMSTot || {};
  const valorNf = parseFloat(icmsTot.vNF || 0);
  const freteTipo = infNFe.transp?.modFrete === '1' ? 'FOB' : 'CIF';
  const vol = infNFe.transp?.vol;
  const qtdVolumes = parseInt(vol?.qVol || 0);
  const pesoReal = parseFloat(vol?.pesoL || 0);

  const data = extractData(infCpl, natOp);

  return {
    chaveNf,
    nf,
    dataNf,
    natOp,
    cliente,
    cidade,
    bairro,
    numeroCarga: data?.numeroCarga || null,
    box: data?.box || null,
    nfPv: data?.numeroPedido || data?.numero || null,
    filial: data?.filialVenda || null,
    microZona: data?.microZona || null,
    infCpl: infCpl.substring(0, 500),
    cnpjEmitente: cnpjEmitente || null,
    nomeEmitente: nomeEmitente || null,
    endEmitente: endEmitente || null,
    cidadeEmitente: cidadeEmitente || null,
    ufEmitente: ufEmitente || null,
    cnpjCliente: cnpjCliente || null,
    valorNf: valorNf || 0,
    freteTipo,
    qtdVolumes: qtdVolumes || 0,
    pesoReal: pesoReal || 0,
    cep: cep || null,
    telefone: telefone || null,
    whatsappJid: gerarWhatsAppJid(telefone),
  };
}

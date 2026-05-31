import { XMLParser } from 'fast-xml-parser';
import { query } from '../config/database.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: true,
});

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
  const doc = parser.parse(xmlContent);
  const nfeProc = doc.nfeProc;
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
  const infCpl = infNFe.infAdic?.infCpl || '';

  const data = extractData(infCpl, natOp);

  const dataNf = dhEmi ? dhEmi.substring(0, 10) : null;

  try {
    const { rowCount } = await query(`
      UPDATE entregas SET
        transportadora_id = $2, nf = $3, data_nf = $4, fc = $5, box = $6,
        nf_pv = $7, filial = $8, cliente = $9, cidade = $10, bairro = $11,
        micro_zona = $12, remessa = $13, updated_at = NOW()
      WHERE chave_nf = $1
    `, [
      chaveNf,
      transportadora_id,
      nf,
      dataNf,
      data?.numeroCarga || null,
      data?.box ? parseInt(data.box, 10) : null,
      data?.numeroPedido || data?.numero || null,
      data?.filialVenda ? parseInt(data.filialVenda, 10) : null,
      cliente || null,
      cidade || null,
      bairro || null,
      data?.microZona || null,
      natOp || null,
    ]);

    if (rowCount > 0) {
      return { inserted: false, updated: true, chaveNf, nf, fc: data?.numeroCarga || null };
    }

    await query(`
      INSERT INTO entregas (chave_nf, transportadora_id, nf, data_nf, fc, box,
        nf_pv, filial, cliente, cidade, bairro, micro_zona, remessa)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      chaveNf,
      transportadora_id,
      nf,
      dataNf,
      data?.numeroCarga || null,
      data?.box ? parseInt(data.box, 10) : null,
      data?.numeroPedido || data?.numero || null,
      data?.filialVenda ? parseInt(data.filialVenda, 10) : null,
      cliente || null,
      cidade || null,
      bairro || null,
      data?.microZona || null,
      natOp || null,
    ]);

    return { inserted: true, updated: false, chaveNf, nf, fc: data?.numeroCarga || null };
  } catch (err) {
    return { inserted: false, error: err.message };
  }
}

import fs from 'fs';
import AdmZip from 'adm-zip';
import { extrairDadosXml } from '../services/xmlProcessor.js';

async function main() {
  const args = process.argv.slice(2);
  const filePath = args[0];

  if (!filePath) {
    console.error('Uso: node src/scripts/test-xml.js <caminho-do-arquivo.xml|.zip>');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`Arquivo não encontrado: ${filePath}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(filePath);
  const ext = filePath.toLowerCase().split('.').pop();
  let xmlContents = [];

  if (ext === 'zip') {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    for (const entry of entries) {
      if (entry.entryName.endsWith('.xml') && !entry.isDirectory) {
        xmlContents.push(entry.getData().toString('utf8'));
      }
    }
    console.log(`Extraídos ${xmlContents.length} XML(s) do ZIP`);
  } else if (ext === 'xml') {
    xmlContents.push(buffer.toString('utf8'));
  } else {
    console.error('Formato não suportado. Use .xml ou .zip');
    process.exit(1);
  }

  for (let i = 0; i < xmlContents.length; i++) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`XML #${i + 1}`);
    console.log('='.repeat(60));

    const data = extrairDadosXml(xmlContents[i]);

    if (data.error) {
      console.log(`ERRO: ${data.error}`);
      continue;
    }

    console.log(`Chave NF:     ${data.chaveNf}`);
    console.log(`NF:           ${data.nf}`);
    console.log(`Data NF:      ${data.dataNf || 'N/A'}`);
    console.log(`Nat. Op.:     ${data.natOp}`);
    console.log(`Cliente:      ${data.cliente}`);
    console.log(`Cidade:       ${data.cidade}`);
    console.log(`Bairro:       ${data.bairro}`);
    console.log(`Carga (FC):   ${data.numeroCarga || 'N/A'}`);
    console.log(`Box:          ${data.box || 'N/A'}`);
    console.log(`NF PV/Pedido: ${data.nfPv || 'N/A'}`);
    console.log(`Filial:       ${data.filial || 'N/A'}`);
    console.log(`Micro Zona:   ${data.microZona || 'N/A'}`);
    console.log(`\ninfCpl (início):`);
    console.log(data.infCpl || '(vazio)');
  }
}

main().catch(err => {
  console.error('Erro:', err);
  process.exit(1);
});

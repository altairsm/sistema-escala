import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

// Mock data
const veiculos = [
  { id: 1, placa: 'ABC-1234', tipo: 'Fiorino', obs: '' },
  { id: 2, placa: 'DEF-5678', tipo: 'Doblo', obs: '' },
  { id: 3, placa: 'GHI-9012', tipo: 'Sprinter', obs: '' },
  { id: 4, placa: 'JKL-3456', tipo: 'Vans', obs: '' },
  { id: 5, placa: 'MNO-7890', tipo: 'Caminhão', obs: '' },
];

const funcionarios = [
  { id: 1, nome: 'Carlos Silva', funcao: 'motorista' },
  { id: 2, nome: 'João Souza', funcao: 'motorista' },
  { id: 3, nome: 'Pedro Santos', funcao: 'motorista' },
  { id: 4, nome: 'Maria Oliveira', funcao: 'motorista' },
  { id: 5, nome: 'Ana Costa', funcao: 'ajudante' },
  { id: 6, nome: 'Lucas Pereira', funcao: 'ajudante' },
  { id: 7, nome: 'Fernanda Lima', funcao: 'ajudante' },
  { id: 8, nome: 'Rafael Almeida', funcao: 'ajudante' },
];

let cargas = [
  { id: 1, carga: 'CAR-001', data_entrega: '2026-05-31', qtd_entg: 10, cub: '15.5', box: 'A1', placa: '', regiao_nome: 'Zona Sul', regiao: 'ZS', confirma: false, confirma_equipe: false, motorista: null, ajudante_01: null, ajudante_02: null, cod_transp: '1400', transportadora: 'Transportadora Teste', tipo: 'VENDA', identificacao: 'NF-001' },
  { id: 2, carga: 'CAR-002', data_entrega: '2026-06-01', qtd_entg: 5, cub: '8.2', box: 'B2', placa: 'ABC-1234', regiao_nome: 'Zona Norte', regiao: 'ZN', confirma: true, confirma_equipe: false, motorista: null, ajudante_01: null, ajudante_02: null, cod_transp: '1400', transportadora: 'Transportadora Teste', tipo: 'COLETA', identificacao: 'NF-002' },
  { id: 3, carga: 'CAR-003', data_entrega: '2026-06-02', qtd_entg: 8, cub: '12.0', box: 'C3', placa: 'DEF-5678', regiao_nome: 'Centro', regiao: 'CT', confirma: true, confirma_equipe: true, motorista: 'Carlos Silva', ajudante_01: 'Ana Costa', ajudante_02: null, cod_transp: '1400', transportadora: 'Transportadora Teste', tipo: 'DEVOLUCAO', identificacao: 'NF-003' },
];

let entregas = [
  { id: 1, fc: 'CAR-001', nf: '1001', chave_nf: '35200600000000000000000000000000000000000001', cliente: 'Cliente A', cidade: 'São Paulo', bairro: 'Centro', box: 'A1', filial: '1', nf_pv: '001', micro_zona: 'MZ01', remessa: 'VENDA', data_nf: '2026-05-30', confirma_entrega: null, reentrega: null, motivo_insucesso: null, status_reentrega: null, transportadora_id: 1 },
  { id: 2, fc: 'CAR-002', nf: '1002', chave_nf: '35200600000000000000000000000000000000000002', cliente: 'Cliente B', cidade: 'São Paulo', bairro: 'Vila Maria', box: 'B2', filial: '2', nf_pv: '002', micro_zona: 'MZ02', remessa: 'COLETA', data_nf: '2026-05-31', confirma_entrega: true, reentrega: null, motivo_insucesso: null, status_reentrega: null, transportadora_id: 1 },
  { id: 3, fc: 'CAR-003', nf: '1003', chave_nf: '35200600000000000000000000000000000000000003', cliente: 'Cliente C', cidade: 'São Paulo', bairro: 'Pinheiros', box: 'C3', filial: '1', nf_pv: '003', micro_zona: 'MZ03', remessa: 'DEVOLUCAO', data_nf: '2026-06-01', confirma_entrega: null, reentrega: null, motivo_insucesso: null, status_reentrega: null, transportadora_id: 1 },
];

let reversas = [
  { id: 1, fc: 'CAR-002', nf: '2001', chave_nf: '35200600000000000000000000000000000000000004', cliente: 'Cliente D', cidade: 'São Paulo', bairro: 'Vila Maria', confirma_entrega: null, status_devolucao: null, motivo_insucesso: null, transportadora_id: 1 },
];

let devolucoes = [
  { id: 1, fc: 'CAR-003', nf: '3001', chave_nf: '35200600000000000000000000000000000000000005', cliente: 'Cliente E', cidade: 'São Paulo', bairro: 'Pinheiros', status_devolucao: null, transportadora_id: 1 },
];

// Auth middleware mock
function authMock(req, res, next) {
  req.user = { id: 1, transportadora_id: 1, funcao: 'master', email: 'teste@teste.com', nome: 'Usuário Teste', transportadora: 'Transportadora Teste' };
  next();
}

// ---- API ROUTES ----
app.get('/api/me', authMock, (req, res) => res.json(req.user));

app.post('/api/auth/login', (req, res) => {
  res.json({ token: 'mock-token-123', user: { id: 1, email: req.body.email, funcao: 'master', nome: 'Usuário Teste', transportadora: 'Transportadora Teste' } });
});

app.get('/api/cargas', authMock, (req, res) => {
  const { dataInicio } = req.query;
  let filtered = cargas;
  if (dataInicio) filtered = filtered.filter(c => c.data_entrega >= dataInicio);
  res.json(filtered);
});

app.get('/api/entregas', authMock, (req, res) => res.json(entregas));
app.get('/api/reversas', authMock, (req, res) => res.json(reversas));
app.get('/api/devolucoes', authMock, (req, res) => res.json(devolucoes));
app.get('/api/veiculos', authMock, (req, res) => res.json(veiculos));
app.get('/api/motoristas', authMock, (req, res) => res.json(funcionarios.filter(f => f.funcao === 'motorista')));
app.get('/api/ajudantes', authMock, (req, res) => res.json(funcionarios.filter(f => f.funcao === 'ajudante')));
app.get('/api/funcionarios', authMock, (req, res) => res.json(funcionarios));

app.put('/api/cargas/:id/equipe', authMock, (req, res) => {
  const c = cargas.find(x => x.id === parseInt(req.params.id));
  if (c) {
    c.motorista = req.body.motorista;
    c.ajudante_01 = req.body.ajudante_01;
    c.ajudante_02 = req.body.ajudante_02;
    c.confirma_equipe = true;
    res.json({ message: 'ok' });
  } else res.status(404).json({ error: 'not found' });
});

app.put('/api/cargas/:id/desfazer-equipe', authMock, (req, res) => {
  const c = cargas.find(x => x.id === parseInt(req.params.id));
  if (c) {
    c.confirma_equipe = false;
    c.motorista = null;
    c.ajudante_01 = null;
    c.ajudante_02 = null;
    res.json({ message: 'ok' });
  } else res.status(404).json({ error: 'not found' });
});

app.post('/api/auth/esqueci-senha', (req, res) => res.json({ message: 'Email enviado' }));
app.post('/api/auth/primeiro-acesso', authMock, (req, res) => res.json({ message: 'Senha alterada' }));

app.post('/api/importar-xml', authMock, (req, res) => res.json({ message: 'XML processado', inseridas: 1, atualizadas: 0 }));
app.post('/api/importar-cargas', authMock, (req, res) => res.json({ message: 'Cargas importadas', inseridas: 2, atualizadas: 1 }));

app.put('/api/cargas/:id/placa', authMock, (req, res) => {
  const c = cargas.find(x => x.id === parseInt(req.params.id));
  if (c) { c.placa = req.body.placa; res.json({ message: 'ok' }); }
  else res.status(404).json({ error: 'not found' });
});

app.post('/api/entregas/:id/confirmar-entrega', authMock, (req, res) => {
  const e = entregas.find(x => x.id === parseInt(req.params.id));
  if (e) { e.confirma_entrega = req.body.status; res.json({ message: 'ok' }); }
  else res.status(404).json({ error: 'not found' });
});

app.post('/api/entregas/:id/reabrir', authMock, (req, res) => {
  const e = entregas.find(x => x.id === parseInt(req.params.id));
  if (e) { e.confirma_entrega = null; e.reentrega = null; e.motivo_insucesso = null; res.json({ message: 'ok' }); }
  else res.status(404).json({ error: 'not found' });
});

app.post('/api/entregas/:id/insucesso', authMock, (req, res) => {
  const e = entregas.find(x => x.id === parseInt(req.params.id));
  if (e) { e.confirma_entrega = false; e.motivo_insucesso = req.body.motivo; e.reentrega = req.body.reentrega; res.json({ message: 'ok' }); }
  else res.status(404).json({ error: 'not found' });
});

app.post('/api/entregas/:id/reabrir-reentrega', authMock, (req, res) => {
  const e = entregas.find(x => x.id === parseInt(req.params.id));
  if (e) { e.confirma_entrega = null; e.status_reentrega = null; e.motivo_insucesso = null; res.json({ message: 'ok' }); }
  else res.status(404).json({ error: 'not found' });
});

app.post('/api/reversas/:id/confirmar-coleta', authMock, (req, res) => {
  const e = reversas.find(x => x.id === parseInt(req.params.id));
  if (e) { e.confirma_entrega = req.body.status; e.devolucao = true; res.json({ message: 'ok' }); }
  else res.status(404).json({ error: 'not found' });
});

app.post('/api/reversas/:id/reabrir-coleta', authMock, (req, res) => {
  const e = reversas.find(x => x.id === parseInt(req.params.id));
  if (e) { e.confirma_entrega = null; e.motivo_insucesso = null; e.reentrega = null; res.json({ message: 'ok' }); }
  else res.status(404).json({ error: 'not found' });
});

app.post('/api/reversas/:id/insucesso-coleta', authMock, (req, res) => {
  const e = reversas.find(x => x.id === parseInt(req.params.id));
  if (e) { e.confirma_entrega = false; e.motivo_insucesso = req.body.motivo; e.reentrega = req.body.reentrega; res.json({ message: 'ok' }); }
  else res.status(404).json({ error: 'not found' });
});

app.post('/api/reversas/:id/confirmar-recoleta', authMock, (req, res) => {
  const e = reversas.find(x => x.id === parseInt(req.params.id));
  if (e) { e.status_devolucao = req.body.status; res.json({ message: 'ok' }); }
  else res.status(404).json({ error: 'not found' });
});

app.post('/api/devolucoes/:id/confirmar', authMock, (req, res) => {
  const e = devolucoes.find(x => x.id === parseInt(req.params.id));
  if (e) { e.status_devolucao = true; res.json({ message: 'ok' }); }
  else res.status(404).json({ error: 'not found' });
});

app.get('/api/me/imap-config', authMock, (req, res) => res.json(null));
app.put('/api/me/imap-config', authMock, (req, res) => res.json({ message: 'Configuração IMAP salva' }));

// Admin routes
app.get('/api/me/transportadora', authMock, (req, res) => res.json({ id: 1, cod_transp: '1400', nome: 'Transportadora Teste', cnpj: '00.000.000/0001-00', email: 'teste@teste.com', telefone: '(11) 99999-9999' }));
app.get('/api/me/smtp-config', authMock, (req, res) => res.json(null));

app.post('/api/me/confirmar-primeiro-acesso', authMock, (req, res) => res.json({ message: 'ok' }));

app.get('/api/relatorios/:tipo', authMock, (req, res) => {
  const { formato } = req.query;
  if (formato === 'csv') res.set('Content-Type', 'text/csv').send('relatorio mock');
  else res.status(400).json({ error: 'formato nao suportado' });
});

app.get('/api/indicadores/resumo', authMock, (req, res) => res.json({
  total: entregas.length,
  entregues: entregas.filter(e => e.confirma_entrega === true).length,
  insucessos: entregas.filter(e => e.confirma_entrega === false).length,
  reentregasPend: entregas.filter(e => e.reentrega === true && e.status_reentrega === null).length,
  semPlaca: cargas.filter(c => !c.placa).length,
  coletasNaoDevolvidas: reversas.filter(r => r.confirma_entrega === true && (!r.status_devolucao || r.status_devolucao === false)).length,
  taxaSucesso: entregas.length > 0 ? Math.round(entregas.filter(e => e.confirma_entrega === true).length / entregas.length * 100) : 0,
}));

app.get('/api/indicadores/tendencia', authMock, (req, res) => res.json([]));
app.get('/api/indicadores/motivos', authMock, (req, res) => res.json([]));
app.get('/api/indicadores/top-motoristas', authMock, (req, res) => res.json([]));

// Serve frontend
app.use(express.static(path.join(__dirname, 'frontend', 'public')));

// SPA fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'public', 'index.html'));
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`[DEV] Servidor rodando em http://localhost:${PORT}`);
  console.log('[DEV] Login: qualquer email/senha funciona');
  console.log('[DEV] Ctrl+C para parar');
});

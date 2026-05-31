// ==================== API ====================
const API = '/api';

function getToken() { return localStorage.getItem('token'); }
function setToken(t) { localStorage.setItem('token', t); }
function getUser() { try { return JSON.parse(localStorage.getItem('user')); } catch { return null; } }
function setUser(u) { localStorage.setItem('user', JSON.stringify(u)); }
function clearAuth() { localStorage.removeItem('token'); localStorage.removeItem('user'); }

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!options.body || options.body instanceof FormData) {
    // don't set content-type for FormData
  } else {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API}${path}`, { ...options, headers });
  if (res.status === 401) {
    clearAuth();
    render();
    return null;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

function apiGet(path) { return apiFetch(path); }
function apiPost(path, body) { return apiFetch(path, { method: 'POST', body: JSON.stringify(body) }); }
function apiPut(path, body) { return apiFetch(path, { method: 'PUT', body: JSON.stringify(body) }); }
function apiDelete(path) { return apiFetch(path, { method: 'DELETE' }); }

// ==================== STATE ====================
let DATA = { cargas: [], entregas: [], reversas: [], devolucoes: [], veiculos: [], motoristas: [], ajudantes: [], funcionarios: [] };
const DEFAULT_DAYS = 3;

let filters = {
  cargaStatus: '', cargaInicio: daysAgo(DEFAULT_DAYS), cargaFim: today(),
  equipeInicio: daysAgo(DEFAULT_DAYS), equipeFim: today(), equipeStatus: '', equipePlaca: '',
  entInicio: daysAgo(DEFAULT_DAYS), entFim: today(), entCarga: '', entPlaca: '',
  revInicio: daysAgo(DEFAULT_DAYS), revFim: today(),
  devInicio: daysAgo(DEFAULT_DAYS), devFim: today()
};
let activeTab = 0;

function today() { return new Date().toISOString().split('T')[0]; }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }
function fmtDate(iso) { return iso ? iso.slice(0, 10) : '—'; }

// ==================== AUTH ====================
async function login(email, senha) {
  const data = await apiPost('/auth/login', { email, senha });
  if (data && data.token) {
    setToken(data.token);
    setUser(data.user);
    return data;
  }
  return null;
}

async function installSaaS(data) {
  return await apiPost('/install', data);
}

// ==================== RENDER ENGINE ====================
function render() {
  const token = getToken();
  const user = getUser();
  const root = document.getElementById('root');

  if (!token || !user) {
    renderLoginPage(root);
    return;
  }

  if (user.funcao === 'saas_owner') {
    renderSaaSPage(root);
  } else {
    renderTransportadoraPage(root);
  }
}

// ==================== LOGIN PAGE ====================
function renderLoginPage(root) {
  root.innerHTML = `
    <div class="page-center">
      <div class="page-card">
        <div class="logo">🏠</div>
        <h1>Gestão de Escala</h1>
        <p class="subtitle">Via Varejo · Equipe de Entregas</p>
        <div id="login-error" class="error"></div>
        <label>Email</label>
        <input type="email" id="login-email" placeholder="seu@email.com" autocomplete="email">
        <label>Senha</label>
        <input type="password" id="login-senha" placeholder="Sua senha" autocomplete="current-password">
        <button class="btn btn-primary" onclick="handleLogin()">Entrar</button>
        <div class="link"><a onclick="showEsqueciSenha()">Esqueci minha senha</a></div>
        <div class="link" id="install-link-area"></div>
      </div>
    </div>
  `;

  // Check if installed
  apiGet('/status').then(s => {
    if (s && !s.instalado) {
      document.getElementById('install-link-area').innerHTML =
        '<a onclick="checkInstall()">Primeiro acesso? Instalar sistema</a>';
    }
  });

  // Enter key
  document.getElementById('login-senha').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
}

window.handleLogin = async function() {
  const email = document.getElementById('login-email').value;
  const senha = document.getElementById('login-senha').value;
  const errEl = document.getElementById('login-error');
  if (!email || !senha) { errEl.textContent = 'Preencha email e senha'; return; }
  errEl.textContent = '';
  const result = await login(email, senha);
  if (result) {
    const user = result.user;
    if (result.primeiro_acesso) {
      renderPrimeiroAcesso();
    } else {
      render();
    }
  } else {
    errEl.textContent = 'Email ou senha inválidos';
  }
};

window.showEsqueciSenha = function() {
  const root = document.getElementById('root');
  root.innerHTML = `
    <div class="page-center">
      <div class="page-card">
        <div class="logo">🔑</div>
        <h1>Recuperar Senha</h1>
        <p class="subtitle">Digite seu email para receber uma nova senha</p>
        <div id="rec-error" class="error"></div>
        <label>Email</label>
        <input type="email" id="rec-email" placeholder="seu@email.com" autocomplete="email">
        <button class="btn btn-primary" onclick="handleEsqueciSenha()">Enviar</button>
        <div class="link"><a onclick="render()">Voltar ao login</a></div>
      </div>
    </div>
  `;
};

window.handleEsqueciSenha = async function() {
  const email = document.getElementById('rec-email').value;
  const errEl = document.getElementById('rec-error');
  if (!email) { errEl.textContent = 'Informe seu email'; return; }
  errEl.textContent = '';
  const result = await apiPost('/auth/esqueci-senha', { email });
  if (result && result.message) {
    document.querySelector('.page-card').innerHTML = `
      <div class="logo">✅</div>
      <h1>Email Enviado</h1>
      <p class="subtitle">${result.message}</p>
      <div class="link"><a onclick="render()">Voltar ao login</a></div>
    `;
  } else {
    errEl.textContent = (result && result.error) || 'Erro ao recuperar senha';
  }
};

window.checkInstall = function(reset) {
  const root = document.getElementById('root');
  root.innerHTML = `
    <div class="page-center">
      <div class="page-card">
        <div class="logo">🏠</div>
        <h1>Instalação do Sistema</h1>
        <p class="subtitle">Cadastro do proprietário SaaS</p>
        ${reset ? '<div class="warning-box" style="margin-bottom:16px">⚠️ ATENÇÃO: Isso apagará TODOS os dados do sistema e reinstalará do zero!</div>' : ''}
        <div id="install-error" class="error"></div>
        <label>Nome da Empresa *</label>
        <input type="text" id="inst-empresa" placeholder="Minha Transportadora SaaS">
        <label>CNPJ *</label>
        <input type="text" id="inst-cnpj" placeholder="00.000.000/0001-00">
        <label>Email do Proprietário *</label>
        <input type="email" id="inst-email" placeholder="admin@meusaas.com">
        <label>Telefone</label>
        <input type="text" id="inst-telefone" placeholder="(11) 99999-9999">
        <label>Email para Recuperação de Senha *</label>
        <input type="email" id="inst-email-rec" placeholder="recuperacao@meusaas.com">
        <label>Senha Mestre *</label>
        <input type="password" id="inst-senha" placeholder="Mínimo 6 caracteres">

        <hr style="margin:20px 0;border:none;border-top:1px solid var(--border)">
        <h3 style="font-size:0.95rem;margin-bottom:12px;color:var(--primary)">✉️ Configuração de Email (SMTP)</h3>
        <p style="font-size:0.75rem;color:var(--gray);margin-bottom:16px">Usado para enviar dados de acesso e recuperação de senha</p>

        <label>Email Remetente *</label>
        <input type="email" id="inst-sender-email" placeholder="gestao@seudominio.com.br">
        <label>Nome do Remetente</label>
        <input type="text" id="inst-sender-name" placeholder="Gestão de Escala">
        <label>Domínio do Email *</label>
        <input type="text" id="inst-smtp-domain" placeholder="seudominio.com.br">
        <label>Host SMTP *</label>
        <input type="text" id="inst-smtp-address" placeholder="smtp.titan.email">
        <label>Porta SMTP</label>
        <input type="number" id="inst-smtp-port" value="465">
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
          <input type="checkbox" id="inst-smtp-ssl" checked> SSL (desmarque se porta 587)
        </label>
        <label>Usuário SMTP *</label>
        <input type="text" id="inst-smtp-username" placeholder="gestao@seudominio.com.br">
        <label>Senha SMTP *</label>
        <input type="password" id="inst-smtp-password" placeholder="Senha do SMTP">
        <label>Domínio de Email de Entrada (opcional)</label>
        <input type="text" id="inst-inbound-domain" placeholder="seudominio.com.br">

        <button class="btn ${reset ? 'btn-danger' : 'btn-primary'}" onclick="handleInstall(${reset ? 'true' : ''})">
          ${reset ? '⚠️ Apagar tudo e Instalar' : 'Instalar'}
        </button>
        <div class="link"><a onclick="render()">Voltar ao login</a></div>
      </div>
    </div>
  `;
};

window.handleInstall = async function(reset) {
  const data = {
    empresa: document.getElementById('inst-empresa').value,
    cnpj: document.getElementById('inst-cnpj').value,
    email: document.getElementById('inst-email').value,
    telefone: document.getElementById('inst-telefone').value,
    email_recuperacao: document.getElementById('inst-email-rec').value,
    senha: document.getElementById('inst-senha').value,
    reset: !!reset,
    smtp: {
      sender_email: document.getElementById('inst-sender-email').value,
      sender_name: document.getElementById('inst-sender-name').value,
      smtp_domain: document.getElementById('inst-smtp-domain').value,
      smtp_address: document.getElementById('inst-smtp-address').value,
      smtp_port: parseInt(document.getElementById('inst-smtp-port').value) || 465,
      smtp_ssl: document.getElementById('inst-smtp-ssl').checked,
      smtp_username: document.getElementById('inst-smtp-username').value,
      smtp_password: document.getElementById('inst-smtp-password').value,
      inbound_email_domain: document.getElementById('inst-inbound-domain').value || null,
    }
  };
  const errEl = document.getElementById('install-error');
  if (!data.empresa || !data.cnpj || !data.email || !data.email_recuperacao || !data.senha) {
    errEl.textContent = 'Preencha todos os campos obrigatórios';
    return;
  }
  if (!data.smtp.sender_email || !data.smtp.smtp_address || !data.smtp.smtp_username || !data.smtp.smtp_password) {
    errEl.textContent = 'Preencha todos os campos SMTP obrigatórios';
    return;
  }
  if (data.senha.length < 6) { errEl.textContent = 'Senha deve ter no mínimo 6 caracteres'; return; }
  errEl.textContent = '';
  const result = await installSaaS(data);
  if (result && result.token) {
    setToken(result.token);
    setUser({ email: data.email, funcao: 'saas_owner', nome: data.empresa });
    render();
  } else {
    errEl.textContent = (result && result.error) || 'Erro ao instalar';
  }
};

// ==================== PRIMEIRO ACESSO ====================
window.renderPrimeiroAcesso = function() {
  const root = document.getElementById('root');
  root.innerHTML = `
    <div class="page-center">
      <div class="page-card">
        <div class="logo">🔑</div>
        <h1>Primeiro Acesso</h1>
        <p class="subtitle">Cadastre sua nova senha</p>
        <div id="pa-error" class="error"></div>
        <label>Nova Senha *</label>
        <input type="password" id="pa-senha" placeholder="Mínimo 6 caracteres">
        <label>Confirmar Senha *</label>
        <input type="password" id="pa-confirmar" placeholder="Repita a senha">
        <button class="btn btn-primary" onclick="handlePrimeiroAcesso()">Salvar</button>
      </div>
    </div>
  `;
};

window.handlePrimeiroAcesso = async function() {
  const senha = document.getElementById('pa-senha').value;
  const confirmar = document.getElementById('pa-confirmar').value;
  const errEl = document.getElementById('pa-error');
  if (senha.length < 6) { errEl.textContent = 'Mínimo 6 caracteres'; return; }
  if (senha !== confirmar) { errEl.textContent = 'Senhas não conferem'; return; }
  const result = await apiPost('/auth/primeiro-acesso', { senha });
  if (result && result.message) {
    const user = getUser();
    user.primeiro_acesso = false;
    setUser(user);
    render();
  } else {
    errEl.textContent = 'Erro ao alterar senha';
  }
};

// ==================== SAAS OWNER PAGE ====================
function renderSaaSPage(root) {
  root.innerHTML = `
    <div class="app">
      <div class="header">
        <div class="header-logo">🏠</div>
        <div class="header-info">
          <div class="header-title">Painel SaaS — Gestão de Escala <span id="saas-version" style="font-size:0.65rem;color:var(--gray);font-weight:400"></span></div>
          <div class="header-sub">${getUser().nome}</div>
        </div>
        <div class="header-actions">
          <button class="btn-refresh" onclick="carregarTransportadoras()">🔄 Atualizar</button>
          <button class="btn-refresh" onclick="handleLogout()">🚪 Sair</button>
        </div>
      </div>
      <div class="content" id="saas-content">
        <div class="empty-state">🔄 Carregando...</div>
      </div>
      <div id="modal-root"></div>
    </div>
  `;
  carregarTransportadoras();
}

async function carregarTransportadoras() {
  const data = await apiGet('/admin/transportadoras');
  const el = document.getElementById('saas-content');
  if (!data) { el.innerHTML = '<div class="empty-state">Erro ao carregar</div>'; return; }

  // Carrega config SMTP, perfil do proprietário e versão
  const [smtpConfig, ownerProfile, versionData] = await Promise.all([
    apiGet('/smtp-config'),
    apiGet('/owner/profile'),
    apiGet('/version'),
  ]);

  const versionEl = document.getElementById('saas-version');
  if (versionEl && versionData && versionData.commit) {
    versionEl.textContent = `v ${versionData.commit}`;
  }

  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-title">✉️ Configuração de Email</div>
        <button class="btn btn-sm btn-warning" onclick="showSmtpConfig()">⚙️ Configurar</button>
      </div>
      ${ownerProfile ? `
      <div style="background:var(--gray-light);padding:10px;border-radius:8px;margin-bottom:8px">
        <div style="font-size:0.7rem;font-weight:600;color:var(--gray);text-transform:uppercase">Email para Recuperação</div>
        <div style="font-size:0.85rem">${ownerProfile.email_recuperacao}</div>
      </div>` : ''}
      ${smtpConfig ? `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px">
        <div style="background:var(--gray-light);padding:10px;border-radius:8px">
          <div style="font-size:0.7rem;font-weight:600;color:var(--gray);text-transform:uppercase">Remetente</div>
          <div style="font-size:0.85rem">${smtpConfig.sender_email}</div>
        </div>
        <div style="background:var(--gray-light);padding:10px;border-radius:8px">
          <div style="font-size:0.7rem;font-weight:600;color:var(--gray);text-transform:uppercase">SMTP</div>
          <div style="font-size:0.85rem">${smtpConfig.smtp_address}:${smtpConfig.smtp_port}</div>
        </div>
        <div style="background:var(--gray-light);padding:10px;border-radius:8px">
          <div style="font-size:0.7rem;font-weight:600;color:var(--gray);text-transform:uppercase">Domínio</div>
          <div style="font-size:0.85rem">${smtpConfig.smtp_domain}</div>
        </div>
      </div>` : '<div class="empty-state" style="padding:20px">⚠️ SMTP não configurado — emails não serão enviados</div>'}
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">🏢 Transportadoras Cadastradas</div>
        <button class="btn btn-success" onclick="showNovaTransportadora()">+ Nova Transportadora</button>
      </div>
      ${data.length === 0 ? '<div class="empty-state">Nenhuma transportadora cadastrada</div>' : `
      <div class="table-container"><table>
        <thead><tr><th>Código</th><th>Nome</th><th>CNPJ</th><th>Email</th><th>Cadastro</th><th>Ações</th></tr></thead>
        <tbody>${data.map(t => `
          <tr>
            <td><strong>${t.cod_transp}</strong></td>
            <td>${t.nome}</td>
            <td>${t.cnpj}</td>
            <td>${t.email}</td>
            <td>${t.created_at}</td>
            <td>
              <button class="btn btn-sm btn-primary" onclick="verTransportadora(${t.id})">🔍 Detalhes</button>
            </td>
          </tr>
        `).join('')}</tbody>
      </table></div>`}
    </div>

    <div class="card" style="border:2px solid var(--red)">
      <div class="card-header">
        <div class="card-title" style="color:var(--red)">⚠️ Zona de Perigo</div>
      </div>
      <p style="font-size:0.8rem;color:var(--gray);margin-bottom:16px">
        Isso apagará <strong>TODOS</strong> os dados do sistema e reinstalará do zero.
        Transportadoras, usuários, cargas, entregas — tudo será perdido permanentemente.
      </p>
      <button class="btn btn-danger" onclick="showResetInstall()">🔄 Reset do Sistema</button>
    </div>
  `;
}

window.showSmtpConfig = async function() {
  const config = await apiGet('/smtp-config');
  showModal(`
    <div class="modal" style="width:520px">
      <div class="modal-title">✉️ Configuração SMTP</div>
      <div class="modal-row">
        <label>Email Remetente *</label>
        <input id="smtp-sender-email" value="${(config && config.sender_email) || ''}" placeholder="gestao@seudominio.com.br">
      </div>
      <div class="modal-row">
        <label>Nome do Remetente</label>
        <input id="smtp-sender-name" value="${(config && config.sender_name) || ''}" placeholder="Gestão de Escala">
      </div>
      <div class="modal-row">
        <label>Domínio *</label>
        <input id="smtp-domain" value="${(config && config.smtp_domain) || ''}" placeholder="seudominio.com.br">
      </div>
      <div class="modal-row">
        <label>Host SMTP *</label>
        <input id="smtp-address" value="${(config && config.smtp_address) || ''}" placeholder="smtp.titan.email">
      </div>
      <div class="modal-row" style="display:flex;gap:12px">
        <div style="flex:1">
          <label>Porta</label>
          <input type="number" id="smtp-port" value="${(config && config.smtp_port) || 465}">
        </div>
        <div style="flex:1;display:flex;align-items:flex-end;padding-bottom:10px">
          <label style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="smtp-ssl" ${(!config || config.smtp_ssl) ? 'checked' : ''}> SSL
          </label>
        </div>
      </div>
      <div class="modal-row">
        <label>Usuário SMTP *</label>
        <input id="smtp-username" value="${(config && config.smtp_username) || ''}" placeholder="gestao@seudominio.com.br">
      </div>
      <div class="modal-row">
        <label>Senha SMTP</label>
        <input type="password" id="smtp-password" placeholder="${config ? 'Deixe em branco para manter a atual' : 'Obrigatório'}">
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="salvarSmtpConfig()">💾 Salvar</button>
      </div>
    </div>
  `);
};

window.salvarSmtpConfig = async function() {
  const data = {
    sender_email: document.getElementById('smtp-sender-email').value,
    sender_name: document.getElementById('smtp-sender-name').value,
    smtp_domain: document.getElementById('smtp-domain').value,
    smtp_address: document.getElementById('smtp-address').value,
    smtp_port: parseInt(document.getElementById('smtp-port').value) || 465,
    smtp_ssl: document.getElementById('smtp-ssl').checked,
    smtp_username: document.getElementById('smtp-username').value,
    smtp_password: document.getElementById('smtp-password').value,
  };
  if (!data.sender_email || !data.smtp_address || !data.smtp_username) {
    alert('Preencha todos os campos obrigatórios');
    return;
  }
  const result = await apiPut('/smtp-config', data);
  if (result && result.message) {
    closeModal();
    carregarTransportadoras();
  } else {
    alert((result && result.error) || 'Erro ao salvar');
  }
};

window.showNovaTransportadora = function() {
  showModal(`
    <div class="modal">
      <div class="modal-title">➕ Nova Transportadora</div>
      <div class="modal-row">
        <label>Código da Transportadora *</label>
        <input id="form-cod" placeholder="Ex: TRANSP_ABC">
      </div>
      <div class="modal-row">
        <label>Nome *</label>
        <input id="form-nome" placeholder="Transportadora ABC Ltda">
      </div>
      <div class="modal-row">
        <label>CNPJ *</label>
        <input id="form-cnpj" placeholder="00.000.000/0001-00">
      </div>
      <div class="modal-row">
        <label>Email (contato) *</label>
        <input type="email" id="form-email" placeholder="contato@transportadora.com">
      </div>
      <div class="modal-row">
        <label>Telefone</label>
        <input id="form-telefone" placeholder="(11) 99999-9999">
      </div>
      <div class="modal-row">
        <label>Endereço</label>
        <input id="form-endereco" placeholder="Rua, número, bairro">
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-success" onclick="salvarTransportadora()">Salvar</button>
      </div>
    </div>
  `);
};

window.salvarTransportadora = async function() {
  const data = {
    cod_transp: document.getElementById('form-cod').value.trim(),
    nome: document.getElementById('form-nome').value.trim(),
    cnpj: document.getElementById('form-cnpj').value.trim(),
    email: document.getElementById('form-email').value.trim(),
    telefone: document.getElementById('form-telefone').value.trim(),
    endereco: document.getElementById('form-endereco').value.trim()
  };
  if (!data.cod_transp || !data.nome || !data.cnpj || !data.email) {
    alert('Preencha código, nome, CNPJ e email');
    return;
  }
  const result = await apiPost('/admin/transportadoras', data);
  if (result && result.message) {
    closeModal();
    alert(`Transportadora cadastrada!\n\nOs dados de acesso foram enviados por email para ${result.email_acesso}.`);
    carregarTransportadoras();
  } else {
    alert((result && result.error) || 'Erro ao cadastrar');
  }
};

window.verTransportadora = async function(id) {
  const data = await apiGet(`/admin/transportadoras/${id}`);
  if (!data) return;

  const db = data.db_externo;
  showModal(`
    <div class="modal" style="width:600px">
      <div class="modal-title">🔍 ${data.nome}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div style="background:var(--gray-light);padding:12px;border-radius:8px">
          <div style="font-size:0.7rem;font-weight:600;color:var(--gray);text-transform:uppercase">Código</div>
          <div style="font-size:0.9rem">${data.cod_transp}</div>
        </div>
        <div style="background:var(--gray-light);padding:12px;border-radius:8px">
          <div style="font-size:0.7rem;font-weight:600;color:var(--gray);text-transform:uppercase">CNPJ</div>
          <div style="font-size:0.9rem">${data.cnpj}</div>
        </div>
        <div style="background:var(--gray-light);padding:12px;border-radius:8px">
          <div style="font-size:0.7rem;font-weight:600;color:var(--gray);text-transform:uppercase">Email</div>
          <div style="font-size:0.9rem">${data.email}</div>
        </div>
        <div style="background:var(--gray-light);padding:12px;border-radius:8px">
          <div style="font-size:0.7rem;font-weight:600;color:var(--gray);text-transform:uppercase">Telefone</div>
          <div style="font-size:0.9rem">${data.telefone || '—'}</div>
        </div>
      </div>

      ${db ? `
      <div class="warning-box">🔌 Credenciais PostgreSQL para acesso externo</div>
      <div class="info-grid">
        <div><label>Host</label><span>${db.host}</span></div>
        <div><label>Porta</label><span>${db.port}</span></div>
        <div><label>Database</label><span>${db.database}</span></div>
        <div><label>Usuário</label><span>${db.user}</span></div>
        <div><label>Senha</label><span id="db-pass-display" data-password="${db.password}">●●●●●●●●●●●●</span></div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="btn btn-sm btn-primary" onclick="copiarSenha()">📋 Copiar Senha</button>
        <button class="btn btn-sm btn-warning" onclick="regenDbPass(${id})">Regenerar Senha PG</button>
      </div>
      ` : '<p style="color:var(--gray)">Credenciais PG não configuradas.</p>'}

      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-sm btn-warning" onclick="regenSenhaTransportadora(${id})">🔄 Regenerar Senha Master</button>
        <button class="btn btn-sm btn-danger" onclick="excluirTransportadora(${id}, '${data.cod_transp}')">🗑️ Excluir</button>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="closeModal()">Fechar</button>
      </div>
    </div>
  `);
};

window.copiarSenha = async function() {
  const el = document.getElementById('db-pass-display');
  if (!el || !el.dataset.password) return;
  try {
    await navigator.clipboard.writeText(el.dataset.password);
    const btn = document.querySelector('button[onclick="copiarSenha()"]');
    if (btn) { btn.textContent = '✅ Copiada!'; setTimeout(() => { btn.textContent = '📋 Copiar Senha'; }, 2000); }
  } catch {
    alert('Não foi possível copiar. Selecione a senha manualmente.');
  }
};

window.regenDbPass = async function(id) {
  if (!confirm('Tem certeza? A senha anterior será invalidada.')) return;
  const result = await apiPost(`/admin/transportadoras/${id}/regen-db-password`);
  if (result && result.db_externo) {
    alert(`Nova senha PG: ${result.db_externo.password}`);
    verTransportadora(id);
  } else {
    alert('Erro ao regenerar');
  }
};

window.regenSenhaTransportadora = async function(id) {
  if (!confirm('Tem certeza? A senha do master será resetada.')) return;
  const result = await apiPost(`/admin/transportadoras/${id}/regen-senha`);
  if (result && result.senha_temporaria) {
    alert(`Nova senha do master (${result.email}): ${result.senha_temporaria}`);
  } else {
    alert('Erro ao regenerar');
  }
};

window.excluirTransportadora = async function(id, codTransp) {
  const msg = `Tem certeza que deseja EXCLUIR a transportadora "${codTransp}"?\n\nTodos os dados serão apagados permanentemente:\n- Usuários, motoristas, ajudantes, veículos\n- Cargas, entregas, reversas, devoluções\n- Arquivos e configuração IMAP\n\nDigite o código "${codTransp}" para confirmar:`;
  const confirmacao = prompt(msg);
  if (confirmacao !== codTransp) {
    if (confirmacao !== null) alert('Código incorreto. Exclusão cancelada.');
    return;
  }
  const result = await apiDelete(`/admin/transportadoras/${id}`);
  if (result && result.message) {
    closeModal();
    alert(result.message);
    carregarTransportadoras();
  } else {
    alert((result && result.error) || 'Erro ao excluir transportadora');
  }
};

// ==================== RESET DO SISTEMA ====================
window.showResetInstall = function() {
  showModal(`
    <div class="modal" style="width:560px">
      <div class="modal-title" style="color:var(--red)">⚠️ Reset do Sistema</div>
      <p style="font-size:0.8rem;margin-bottom:16px">
        Isso apagará <strong>TODOS</strong> os dados do sistema e reinstalará do zero.
        Transportadoras, usuários, cargas, entregas, configurações — tudo será perdido.
      </p>

      <div id="reset-error" class="error"></div>

      <div class="modal-row">
        <label>Nome da Empresa *</label>
        <input id="reset-empresa" placeholder="Minha Transportadora SaaS">
      </div>
      <div class="modal-row">
        <label>CNPJ *</label>
        <input id="reset-cnpj" placeholder="00.000.000/0001-00">
      </div>
      <div class="modal-row">
        <label>Email do Proprietário *</label>
        <input type="email" id="reset-email" placeholder="admin@meusaas.com">
      </div>
      <div class="modal-row">
        <label>Telefone</label>
        <input id="reset-telefone" placeholder="(11) 99999-9999">
      </div>
      <div class="modal-row">
        <label>Email para Recuperação de Senha *</label>
        <input type="email" id="reset-email-rec" placeholder="recuperacao@meusaas.com">
      </div>
      <div class="modal-row">
        <label>Senha Mestre *</label>
        <input type="password" id="reset-senha" placeholder="Mínimo 6 caracteres">
      </div>

      <hr style="margin:16px 0;border:none;border-top:1px solid var(--border)">
      <p style="font-size:0.75rem;color:var(--gray);margin-bottom:12px">✉️ Configuração SMTP (obrigatório para envio de emails)</p>

      <div class="modal-row">
        <label>Email Remetente *</label>
        <input type="email" id="reset-sender-email" placeholder="gestao@seudominio.com.br">
      </div>
      <div class="modal-row">
        <label>Nome do Remetente</label>
        <input id="reset-sender-name" placeholder="Gestão de Escala">
      </div>
      <div class="modal-row">
        <label>Domínio do Email *</label>
        <input id="reset-smtp-domain" placeholder="seudominio.com.br">
      </div>
      <div class="modal-row">
        <label>Host SMTP *</label>
        <input id="reset-smtp-address" placeholder="smtp.titan.email">
      </div>
      <div class="modal-row" style="display:flex;gap:12px">
        <div style="flex:1">
          <label>Porta</label>
          <input type="number" id="reset-smtp-port" value="465">
        </div>
        <div style="flex:1;display:flex;align-items:flex-end;padding-bottom:10px">
          <label style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="reset-smtp-ssl" checked> SSL
          </label>
        </div>
      </div>
      <div class="modal-row">
        <label>Usuário SMTP *</label>
        <input id="reset-smtp-username" placeholder="gestao@seudominio.com.br">
      </div>
      <div class="modal-row">
        <label>Senha SMTP *</label>
        <input type="password" id="reset-smtp-password" placeholder="Senha do SMTP">
      </div>
      <div class="modal-row">
        <label>Domínio de Email de Entrada (opcional)</label>
        <input id="reset-inbound-domain" placeholder="seudominio.com.br">
      </div>

      <hr style="margin:16px 0;border:none;border-top:2px solid var(--red)">
      <div class="modal-row">
        <label style="color:var(--red);font-weight:700">Confirmação: digite o nome da empresa para confirmar *</label>
        <input id="reset-confirmacao" placeholder="Digite o nome da empresa exatamente como acima">
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-danger" onclick="handleResetInstall()">⚠️ Apagar tudo e Instalar</button>
      </div>
    </div>
  `);
};

window.handleResetInstall = async function() {
  const empresa = document.getElementById('reset-empresa').value.trim();
  const confirmacao = document.getElementById('reset-confirmacao').value.trim();
  const errEl = document.getElementById('reset-error');
  if (!errEl) return;

  if (!empresa) { errEl.textContent = 'Preencha o nome da empresa'; return; }
  if (confirmacao !== empresa) { errEl.textContent = 'Digite o nome da empresa exatamente como no campo acima para confirmar'; return; }

  const data = {
    empresa,
    cnpj: document.getElementById('reset-cnpj').value.trim(),
    email: document.getElementById('reset-email').value.trim(),
    telefone: document.getElementById('reset-telefone').value.trim(),
    email_recuperacao: document.getElementById('reset-email-rec').value.trim(),
    senha: document.getElementById('reset-senha').value,
    reset: true,
    smtp: {
      sender_email: document.getElementById('reset-sender-email').value.trim(),
      sender_name: document.getElementById('reset-sender-name').value.trim(),
      smtp_domain: document.getElementById('reset-smtp-domain').value.trim(),
      smtp_address: document.getElementById('reset-smtp-address').value.trim(),
      smtp_port: parseInt(document.getElementById('reset-smtp-port').value) || 465,
      smtp_ssl: document.getElementById('reset-smtp-ssl').checked,
      smtp_username: document.getElementById('reset-smtp-username').value.trim(),
      smtp_password: document.getElementById('reset-smtp-password').value,
      inbound_email_domain: document.getElementById('reset-inbound-domain').value.trim() || null,
    }
  };

  if (!data.cnpj || !data.email || !data.email_recuperacao || !data.senha) {
    errEl.textContent = 'Preencha todos os campos obrigatórios';
    return;
  }
  if (!data.smtp.sender_email || !data.smtp.smtp_address || !data.smtp.smtp_username || !data.smtp.smtp_password) {
    errEl.textContent = 'Preencha todos os campos SMTP obrigatórios';
    return;
  }
  if (data.senha.length < 6) { errEl.textContent = 'Senha deve ter no mínimo 6 caracteres'; return; }

  if (!confirm('ÚLTIMA CHANCE! Tem certeza que deseja apagar TODOS os dados do sistema?\n\nEsta ação é IRREVERSÍVEL.')) return;

  errEl.textContent = '⏳ Apagando dados e reinstalando...';
  const result = await installSaaS(data);
  if (result && result.token) {
    setToken(result.token);
    setUser({ email: data.email, funcao: 'saas_owner', nome: data.empresa });
    closeModal();
    render();
  } else {
    errEl.textContent = (result && result.error) || 'Erro ao resetar sistema';
  }
};

// ==================== TRANSPORTADORA PAGE ====================
const TABS = [
  { label: '📅 Programação' },
  { label: '👥 Equipe' },
  { label: '📦 Entregas' },
  { label: '🔄 Reversa' },
  { label: '🔁 Reentregas' },
  { label: '⬅️ Devoluções' },
  { label: '📊 Indicadores' },
  { label: '⚙️ Admin' },
  { label: '📁 Arquivo' }
];

function renderTransportadoraPage(root) {
  const user = getUser();
  root.innerHTML = `
    <div class="app">
      <div class="header">
        <div class="header-logo">🏠</div>
        <div class="header-info">
          <div class="header-title">Gestão de Escala — ${user.transportadora || ''}</div>
          <div class="header-sub">${user.nome} · ${user.funcao}</div>
        </div>
        <div class="header-actions">
          <button class="btn-refresh" onclick="loadTransportadoraData()">🔄 Atualizar</button>
          <button class="btn-refresh" onclick="handleLogout()">🚪 Sair</button>
        </div>
      </div>
      <div class="tabs" id="tabs-bar"></div>
      <div class="content" id="main-content"><div class="empty-state">🔄 Carregando...</div></div>
    </div>
    <div id="modal-root"></div>
  `;

  activeTab = 0;
  renderTabs();
  loadTransportadoraData();
}

function renderTabs() {
  const bar = document.getElementById('tabs-bar');
  if (!bar) return;
  bar.innerHTML = TABS.map((t, i) => `
    <div class="tab ${i === activeTab ? 'active' : ''}" onclick="switchTab(${i})">
      <span>${t.label}</span>
      ${i === 1 ? `<span class="tab-badge" id="badge-equipe">0</span>` : ''}
      ${i === 2 ? `<span class="tab-badge" id="badge-entregas">0</span>` : ''}
      ${i === 3 ? `<span class="tab-badge" id="badge-reversa">0</span>` : ''}
      ${i === 4 ? `<span class="tab-badge" id="badge-reentregas">0</span>` : ''}
      ${i === 5 ? `<span class="tab-badge" id="badge-devolucoes">0</span>` : ''}
    </div>
  `).join('');
  updateBadges();
}

function updateBadges() {
  const badgeEq = document.getElementById('badge-equipe');
  if (badgeEq) badgeEq.textContent = DATA.cargas.filter(c => c.confirma && !c.confirma_equipe).length;

  const badgeEnt = document.getElementById('badge-entregas');
  if (badgeEnt) badgeEnt.textContent = DATA.entregas.filter(e => e.confirma_entrega === null).length;

  const badgeRev = document.getElementById('badge-reversa');
  if (badgeRev) badgeRev.textContent = DATA.reversas.filter(e => e.confirma_entrega === null).length;

  const badgeReent = document.getElementById('badge-reentregas');
  if (badgeReent) badgeReent.textContent = DATA.entregas.filter(e => e.reentrega === true && e.status_reentrega === null).length;

  const badgeDev = document.getElementById('badge-devolucoes');
  if (badgeDev) badgeDev.textContent = DATA.devolucoes.filter(e => e.status_devolucao === null).length;
}

window.switchTab = function(i) {
  activeTab = i;
  renderTabs();
  renderContent();
};

// ==================== DATA LOADING ====================
async function loadTransportadoraData() {
  const p1 = apiGet(`/cargas${filters.cargaInicio ? `?dataInicio=${filters.cargaInicio}` : ''}`)
    .then(d => { if (d) DATA.cargas = d; });
  const p2 = apiGet(`/entregas${filters.entInicio ? `?dataInicio=${filters.entInicio}` : ''}${filters.entFim ? `&dataFim=${filters.entFim}` : ''}`)
    .then(d => { if (d) DATA.entregas = d; });
  const p3 = apiGet(`/reversas${filters.revInicio ? `?dataInicio=${filters.revInicio}` : ''}${filters.revFim ? `&dataFim=${filters.revFim}` : ''}`)
    .then(d => { if (d) DATA.reversas = d; });
  const p4 = apiGet(`/devolucoes${filters.devInicio ? `?dataInicio=${filters.devInicio}` : ''}${filters.devFim ? `&dataFim=${filters.devFim}` : ''}`)
    .then(d => { if (d) DATA.devolucoes = d; });
  const p5 = apiGet(`/veiculos`)
    .then(d => { if (d) DATA.veiculos = d; });
  const p6 = apiGet(`/motoristas`)
    .then(d => { if (d) DATA.motoristas = d; });
  const p7 = apiGet(`/ajudantes`)
    .then(d => { if (d) DATA.ajudantes = d; });
  const p8 = apiGet(`/funcionarios`)
    .then(d => { if (d) DATA.funcionarios = d; });

  await Promise.all([p1, p2, p3, p4, p5, p6, p7, p8]);

  updateBadges();
  renderContent();
}

function renderContent() {
  const el = document.getElementById('main-content');
  if (!el) return;

  const renderers = [
    renderProgramacao, renderEquipe, renderEntregas,
    renderReversa, renderReentregas, renderDevolucoes,
    renderIndicadores, renderAdminTransportadora, renderArquivo
  ];
  el.innerHTML = renderers[activeTab]();
  if (activeTab === 7) setTimeout(carregarImapStatus, 50);
}

// ==================== PROGRAMAÇÃO ====================
function renderProgramacao() {
  let cargas = DATA.cargas;
  if (filters.cargaStatus === 'confirmado') cargas = cargas.filter(c => c.confirma);
  if (filters.cargaStatus === 'pendente') cargas = cargas.filter(c => !c.confirma);
  const confCount = cargas.filter(c => c.confirma).length;

  return `
    <div class="card">
      <div class="card-header"><div class="card-title">📅 Programação de Cargas</div></div>
      <div class="filter-bar">
        <div class="filter-group"><label>📅 Início</label><input type="date" value="${filters.cargaInicio}" onchange="filters.cargaInicio=this.value;loadTransportadoraData()"></div>
        <div class="filter-group"><label>📅 Fim</label><input type="date" value="${filters.cargaFim}" onchange="filters.cargaFim=this.value;loadTransportadoraData()"></div>
        <div class="filter-group"><label>📊 Status</label>
          <input list="carga-status-list" value="${filters.cargaStatus}" onchange="filters.cargaStatus=this.value;renderContent()" placeholder="Todos" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0;color:#1e293b">
          <datalist id="carga-status-list">
            <option value="">Todos</option>
            <option value="confirmado">Confirmado</option>
            <option value="pendente">Pendente</option>
          </datalist>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-item"><div class="stat-label">Total</div><div class="stat-value primary">${cargas.length}</div></div>
        <div class="stat-item"><div class="stat-label">Placa Definida</div><div class="stat-value success">${confCount}</div></div>
        <div class="stat-item"><div class="stat-label">Pendentes</div><div class="stat-value warning">${cargas.length - confCount}</div></div>
      </div>
      <div class="table-container"><table><thead><tr><th>Carga</th><th>Data</th><th>Qtd</th><th>Box</th><th>Placa</th><th>Status</th><th>Ação</th></tr></thead>
      <tbody>${cargas.length === 0 ? `<tr><td colspan="7"><div class="empty-state">📭 Nenhuma carga</div></td></tr>` : cargas.map(c => `
        <tr>
          <td><strong>${c.carga}</strong></td>
          <td>${fmtDate(c.data_entrega)}</td>
          <td>${c.qtd_entg || 0}</td>
          <td>${c.box || ''}</td>
          <td>
            ${renderSelect(`placa-${c.id}`, DATA.veiculos, { valueField: 'placa', selected: c.placa || '', disabled: c.confirma, placeholder: 'Placa', style: 'width:130px;padding:4px 8px;border-radius:6px;border:1px solid #e2e8f0;color:#1e293b', onchange: `updatePlaca(${c.id}, this.value)` })}
          </td>
          <td>${c.confirma ? '<span class="badge badge-success">✅ Confirmado</span>' : '<span class="badge badge-warning">⏳ Pendente</span>'}</td>
          <td>
            ${!c.confirma
              ? `<button class="btn btn-sm btn-primary" onclick="confirmarCarga(${c.id})" ${!c.placa ? 'disabled' : ''}>✅ Confirmar</button>`
              : `<button class="btn btn-sm btn-warning" onclick="desconfirmarCarga(${c.id})">✏️ Editar</button>`}
          </td>
        </tr>
      `).join('')}</tbody></table></div>
    </div>
  `;
}

window.updatePlaca = async function(id, placa) {
  const c = DATA.cargas.find(x => x.id === id);
  if (c) c.placa = placa;
  const btn = document.querySelector(`button[onclick="confirmarCarga(${id})"]`);
  if (btn) btn.disabled = !placa;
};

window.confirmarCarga = async function(id) {
  const c = DATA.cargas.find(x => x.id === id);
  if (!c || !c.placa) { alert('Informe uma placa'); return; }
  const result = await apiPut(`/cargas/${id}/confirmar`, { placa: c.placa });
  if (result) { c.confirma = true; renderContent(); renderTabs(); }
  else alert('Erro ao confirmar');
};

window.desconfirmarCarga = async function(id) {
  const result = await apiPut(`/cargas/${id}/desconfirmar`);
  if (result) {
    const c = DATA.cargas.find(x => x.id === id);
    if (c) { c.confirma = false; c.confirma_equipe = false; c.motorista = null; c.ajudante_01 = null; c.ajudante_02 = null; }
    renderContent(); renderTabs();
  } else alert('Erro ao desconfirmar');
};

// ==================== EQUIPE ====================
function renderEquipe() {
  let cargas = DATA.cargas.filter(c => c.confirma);
  if (filters.equipeInicio) cargas = cargas.filter(c => c.data_entrega?.slice(0, 10) >= filters.equipeInicio);
  if (filters.equipeFim) cargas = cargas.filter(c => c.data_entrega?.slice(0, 10) <= filters.equipeFim);
  if (filters.equipeStatus === 'confirmado') cargas = cargas.filter(c => c.confirma_equipe);
  if (filters.equipeStatus === 'pendente') cargas = cargas.filter(c => !c.confirma_equipe);
  if (filters.equipePlaca) cargas = cargas.filter(c => c.placa === filters.equipePlaca);

  const placas = [...new Set(DATA.cargas.filter(c => c.placa).map(c => c.placa))];
  const funcionarios = Array.isArray(DATA.funcionarios) ? DATA.funcionarios : [];
  const motoristas = funcionarios.filter(f => f.funcao === 'motorista');
  const ajudantes = funcionarios.filter(f => f.funcao === 'ajudante');

  return `
    <div class="card">
      <div class="card-header"><div class="card-title">👥 Definição de Equipe</div></div>
      <div class="filter-bar">
        <div class="filter-group"><label>📅 Início</label><input type="date" value="${filters.equipeInicio}" onchange="filters.equipeInicio=this.value;renderContent()"></div>
        <div class="filter-group"><label>📅 Fim</label><input type="date" value="${filters.equipeFim}" onchange="filters.equipeFim=this.value;renderContent()"></div>
        <div class="filter-group"><label>📊 Status</label>
          <input list="equipe-status-list" value="${filters.equipeStatus}" onchange="filters.equipeStatus=this.value;renderContent()" placeholder="Todos" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0;color:#1e293b">
          <datalist id="equipe-status-list">
            <option value="">Todos</option>
            <option value="confirmado">Definida</option>
            <option value="pendente">Pendente</option>
          </datalist>
        </div>
        <div class="filter-group"><label>🚛 Placa</label>
          <input list="eqp-placas" value="${filters.equipePlaca}" onchange="filters.equipePlaca=this.value;renderContent()" placeholder="Filtrar">
          <datalist id="eqp-placas">${placas.map(p => `<option value="${p}">`).join('')}</datalist>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-item"><div class="stat-label">Cargas</div><div class="stat-value primary">${cargas.length}</div></div>
        <div class="stat-item"><div class="stat-label">Equipe OK</div><div class="stat-value success">${cargas.filter(c => c.confirma_equipe).length}</div></div>
        <div class="stat-item"><div class="stat-label">Pendentes</div><div class="stat-value warning">${cargas.filter(c => !c.confirma_equipe).length}</div></div>
      </div>
      ${cargas.length === 0 ? '<div class="empty-state">Nenhuma carga encontrada</div>' : cargas.map(c => `
        <div class="equipe-card ${c.confirma_equipe ? 'confirmed' : ''}" style="padding:16px;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-bottom:12px">
            <div><strong>${c.carga}</strong> <span class="badge badge-info">${c.placa || 'Sem placa'}</span></div>
            <div style="font-size:0.75rem;color:var(--gray);display:flex;gap:12px;flex-wrap:wrap">
              <span>📦 Entregas: ${c.qtd_entg || 0}</span>
              <span>📐 Cubagem: ${c.cub || '—'} m²</span>
              <span>📍 ${c.regiao_nome || ''} ${c.regiao || ''}</span>
            </div>
            ${c.confirma_equipe ? '<span class="badge badge-success">✅ Confirmada</span>' : '<span class="badge badge-warning">⏳ Pendente</span>'}
          </div>
          <div class="equipe-grid">
            <div>
              <label style="font-size:11px;color:#64748b">Motorista *</label>
              ${renderSelect(`mot-${c.id}`, motoristas, { selected: c.motorista || '', disabled: c.confirma_equipe, placeholder: 'Selecione' })}
            </div>
            <div>
              <label style="font-size:11px;color:#64748b">Ajudante 1</label>
              ${renderSelect(`aj1-${c.id}`, ajudantes, { selected: c.ajudante_01 || '', disabled: c.confirma_equipe, placeholder: 'Opcional' })}
            </div>
            <div>
              <label style="font-size:11px;color:#64748b">Ajudante 2</label>
              ${renderSelect(`aj2-${c.id}`, ajudantes, { selected: c.ajudante_02 || '', disabled: c.confirma_equipe, placeholder: 'Opcional' })}
            </div>
          </div>
          ${!c.confirma_equipe
            ? `<button class="btn btn-success" onclick="confirmarEquipe(${c.id})">✅ Confirmar Equipe</button>`
            : `<button class="btn btn-warning" onclick="editarEquipe(${c.id})">✏️ Editar</button>`}
        </div>
      `).join('')}
    </div>
  `;
}

window.confirmarEquipe = async function(id) {
  const mot = document.getElementById(`mot-${id}`)?.value;
  if (!mot) { alert('Informe o motorista'); return; }
  const payload = {
    motorista: mot,
    ajudante_01: document.getElementById(`aj1-${id}`)?.value || null,
    ajudante_02: document.getElementById(`aj2-${id}`)?.value || null
  };
  const result = await apiPut(`/cargas/${id}/equipe`, payload);
  if (result) {
    const c = DATA.cargas.find(x => x.id === id);
    if (c) Object.assign(c, payload, { confirma_equipe: true });
    renderContent(); renderTabs();
  } else alert('Erro ao confirmar equipe');
};

window.editarEquipe = async function(id) {
  const result = await apiPut(`/cargas/${id}/desfazer-equipe`);
  if (result) {
    const c = DATA.cargas.find(x => x.id === id);
    if (c) { c.confirma_equipe = false; c.motorista = null; c.ajudante_01 = null; c.ajudante_02 = null; }
    renderContent(); renderTabs();
  } else alert('Erro ao editar');
};

// ==================== ENTREGAS ====================
function renderEntregas() {
  let lista = DATA.entregas.filter(e => DATA.cargas.find(c => c.carga === e.fc && c.confirma_equipe));
  if (filters.entInicio) lista = lista.filter(e => e.data_nf?.slice(0, 10) >= filters.entInicio);
  if (filters.entFim) lista = lista.filter(e => e.data_nf?.slice(0, 10) <= filters.entFim);
  if (filters.entCarga) lista = lista.filter(e => e.fc === filters.entCarga);
  if (filters.entPlaca) lista = lista.filter(e => DATA.cargas.find(c => c.carga === e.fc && c.placa === filters.entPlaca));

  const entregues = lista.filter(e => e.confirma_entrega === true && !e.reentrega).length;
  const insucessos = lista.filter(e => e.confirma_entrega === false && !e.reentrega).length;
  const pendentes = lista.filter(e => e.confirma_entrega === null && !e.reentrega).length;

  return `
    <div class="card">
      <div class="card-header"><div class="card-title">📦 Confirmação de Entregas</div></div>
      <div class="filter-bar">
        <div class="filter-group"><label>📅 Início</label><input type="date" value="${filters.entInicio}" onchange="filters.entInicio=this.value;loadTransportadoraData()"></div>
        <div class="filter-group"><label>📅 Fim</label><input type="date" value="${filters.entFim}" onchange="filters.entFim=this.value;loadTransportadoraData()"></div>
      </div>
      <div class="stats-grid">
        <div class="stat-item"><div class="stat-label">Total</div><div class="stat-value primary">${lista.length}</div></div>
        <div class="stat-item"><div class="stat-label">Entregues</div><div class="stat-value success">${entregues}</div></div>
        <div class="stat-item"><div class="stat-label">Insucesso</div><div class="stat-value danger">${insucessos}</div></div>
        <div class="stat-item"><div class="stat-label">Pendentes</div><div class="stat-value warning">${pendentes}</div></div>
      </div>
      <div class="table-container"><table><thead><tr><th>NF</th><th>Carga</th><th>Cliente</th><th>Bairro</th><th>Status</th><th>Ação</th></tr></thead>
      <tbody>${lista.length === 0 ? `<tr><td colspan="6"><div class="empty-state">📭 Nenhuma entrega</div></td></tr>` : lista.map(e => `
        <tr>
          <td>${e.nf}</td>
          <td><span class="badge badge-info">${e.fc}</span></td>
          <td>${(e.cliente || '—').slice(0, 35)}</td>
          <td>${e.bairro || '—'}</td>
          <td>${e.confirma_entrega === true ? '<span class="badge badge-success">✅ Entregue</span>' :
                e.confirma_entrega === false ? '<span class="badge badge-danger">❌ Insucesso</span>' :
                '<span class="badge badge-gray">⏳ Pendente</span>'}</td>
          <td>
            ${e.confirma_entrega === null
              ? `<button class="btn btn-sm btn-success" onclick="confirmarEntrega(${e.id}, true)">✅ Entregue</button>
                 <button class="btn btn-sm btn-danger" onclick="openInsucesso(${e.id})">❌ Insucesso</button>`
              : `<button class="btn btn-sm btn-warning" onclick="reabrirEntrega(${e.id})">✏️ Editar</button>`}
          </td>
        </tr>
      `).join('')}</tbody></table></div>
    </div>
  `;
}

window.confirmarEntrega = async function(id, status) {
  const result = await apiPut(`/entregas/${id}/confirmar`, { status });
  if (result) {
    const e = DATA.entregas.find(x => x.id === id);
    if (e) e.confirma_entrega = status;
    renderContent(); renderTabs();
  } else alert('Erro');
};

window.reabrirEntrega = async function(id) {
  const result = await apiPut(`/entregas/${id}/reabrir`);
  if (result) {
    const e = DATA.entregas.find(x => x.id === id);
    if (e) { e.confirma_entrega = null; e.reentrega = null; e.motivo_insucesso = null; }
    renderContent(); renderTabs();
  } else alert('Erro');
};

window.openInsucesso = function(id) {
  const e = DATA.entregas.find(x => x.id === id);
  if (!e) return;
  const MOTIVOS = ['Cliente ausente','Endereço não encontrado','Recusou recebimento','Produto com avaria','Divergência no pedido','Acesso impedido','CEP incorreto','Reagendamento a pedido','Veículo sem acesso','Outros'];
  showModal(`
    <div class="modal">
      <div class="modal-title">⚠️ Insucesso - ${e.nf}</div>
      <div class="modal-row">
        <label>Motivo *</label>
        <input list="motivo-insucesso-list" id="motivo-insucesso" placeholder="Selecione" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0;color:#1e293b">
        <datalist id="motivo-insucesso-list">${MOTIVOS.map(m => `<option value="${m}">`).join('')}</datalist>
      </div>
      <div class="modal-row">
        <label>Reentrega?</label>
        <div class="radio-group">
          <label class="radio-opt" id="opt-sim" onclick="selectRadioOpt('sim')">
            <input type="radio" name="reentrega" value="true"> Sim, reagendar
          </label>
          <label class="radio-opt" id="opt-nao" onclick="selectRadioOpt('nao')">
            <input type="radio" name="reentrega" value="false"> Não, devolver ao CD
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-danger" onclick="salvarInsucesso(${id})">💾 Salvar</button>
      </div>
    </div>
  `);
};

window.selectRadioOpt = function(opt) {
  const sim = document.getElementById('opt-sim');
  const nao = document.getElementById('opt-nao');
  document.querySelector('input[name="reentrega"][value="' + opt + '"]').checked = true;
  if (sim) sim.className = 'radio-opt' + (opt === 'sim' ? ' selected-yes' : '');
  if (nao) nao.className = 'radio-opt' + (opt === 'nao' ? ' selected-no' : '');
};

window.salvarInsucesso = async function(id) {
  const motivo = document.getElementById('motivo-insucesso')?.value;
  const reentregaRadio = document.querySelector('input[name="reentrega"]:checked');
  if (!motivo || !reentregaRadio) { alert('Preencha todos os campos'); return; }
  const reentrega = reentregaRadio.value === 'true';
  const result = await apiPost(`/entregas/${id}/insucesso`, { motivo, reentrega, devolucao: !reentrega });
  if (result) {
    const e = DATA.entregas.find(x => x.id === id);
    if (e) { e.confirma_entrega = false; e.motivo_insucesso = motivo; e.reentrega = reentrega; }
    closeModal();
    renderContent(); renderTabs();
  } else alert('Erro');
};

// ==================== REVERSA ====================
function renderReversa() {
  let lista = [...DATA.reversas];
  const coletados = lista.filter(e => e.confirma_entrega === true && !e.reentrega).length;
  const pendentes = lista.filter(e => e.confirma_entrega === null).length;
  const agRecoleta = lista.filter(e => e.reentrega === true && e.status_devolucao === null).length;

  return `
    <div class="card">
      <div class="card-header"><div class="card-title">🔄 Coletas e Trocas (Reversa)</div></div>
      <div class="stats-grid">
        <div class="stat-item"><div class="stat-label">Total</div><div class="stat-value primary">${lista.length}</div></div>
        <div class="stat-item"><div class="stat-label">Coletados</div><div class="stat-value success">${coletados}</div></div>
        <div class="stat-item"><div class="stat-label">Aguard. Recoleta</div><div class="stat-value warning">${agRecoleta}</div></div>
        <div class="stat-item"><div class="stat-label">Pendentes</div><div class="stat-value default">${pendentes}</div></div>
      </div>
      <div class="table-container"><table><thead><tr><th>NF</th><th>Carga</th><th>Cliente</th><th>Bairro</th><th>Status</th><th>Ação</th></tr></thead>
      <tbody>${lista.length === 0 ? '<tr><td colspan="6"><div class="empty-state">📭 Nenhuma coleta</div></td></tr>' : lista.map(e => {
        let st = '', ac = '';
        if (e.status_reentrega === true || (e.status_devolucao === true && !e.reentrega)) {
          st = '<span class="badge badge-success">✅ Finalizado</span>';
          ac = '<span style="color:#64748b;font-size:0.75rem">Concluído</span>';
        } else if (e.reentrega === true && e.status_devolucao === null) {
          st = '<span class="badge badge-warning">🔄 Aguard. recoleta</span>';
          ac = `<button class="btn btn-sm btn-success" onclick="confirmarRecoleta(${e.id}, true)">✅ Recoletado</button>
                <button class="btn btn-sm btn-danger" onclick="confirmarRecoleta(${e.id}, false)">❌ Insucesso</button>`;
        } else if (e.reentrega === true && e.status_devolucao === true) {
          st = '<span class="badge badge-success">✅ Recoletado</span>';
          ac = '<span style="color:#64748b;font-size:0.75rem">Concluído</span>';
        } else if (e.devolucao === true && e.status_reentrega === null) {
          st = '<span class="badge badge-warning">📦 Dev. CD</span>';
          ac = `<button class="btn btn-sm btn-success" onclick="confirmarDevCD(${e.id})">✅ Dev. CD</button>`;
        } else if (e.confirma_entrega === true) {
          st = '<span class="badge badge-success">✅ Coletado</span>';
          ac = `<button class="btn btn-sm btn-warning" onclick="reabrirColeta(${e.id})">✏️ Editar</button>`;
        } else if (e.confirma_entrega === false) {
          st = '<span class="badge badge-danger">❌ Insucesso</span>';
          ac = `<button class="btn btn-sm btn-warning" onclick="reabrirColeta(${e.id})">✏️ Reabrir</button>`;
        } else {
          st = '<span class="badge badge-gray">⏳ Pendente</span>';
          ac = `<button class="btn btn-sm btn-success" onclick="confirmarColeta(${e.id}, true)">✅ Coletado</button>
                <button class="btn btn-sm btn-danger" onclick="openInsucessoColeta(${e.id})">❌ Insucesso</button>`;
        }
        return `<tr><td>${e.nf || e.chave_nf || '—'}</td><td><span class="badge badge-info">${e.fc || e.carga || '—'}</span></td><td>${(e.cliente||'—').slice(0,35)}</td><td>${e.bairro||'—'}</td><td>${st}</td><td>${ac}</td></tr>`;
      }).join('')}</tbody></table></div>
    </div>
  `;
}

window.confirmarColeta = async function(id, status) {
  const result = await apiPut(`/reversas/${id}/confirmar`, { status });
  if (result) {
    const e = DATA.reversas.find(x => x.id === id);
    if (e) { e.confirma_entrega = status; if (status) e.devolucao = true; }
    renderContent(); renderTabs();
  }
};

window.openInsucessoColeta = function(id) {
  const e = DATA.reversas.find(x => x.id === id);
  const MOTIVOS = ['Cliente ausente','Endereço não encontrado','Recusou troca','Produto com avaria','Divergência no pedido','Acesso impedido','Outros'];
  showModal(`
    <div class="modal">
      <div class="modal-title">⚠️ Insucesso Coleta - ${e?.nf || e?.chave_nf || ''}</div>
      <div class="modal-row"><label>Motivo *</label>
        <input list="mot-coleta-list" id="mot-coleta" placeholder="Selecione" style="width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0;color:#1e293b">
        <datalist id="mot-coleta-list">${MOTIVOS.map(m => `<option value="${m}">`).join('')}</datalist>
      </div>
      <div class="modal-row"><label>Recoleta?</label><div class="radio-group">
        <label class="radio-opt" id="rc-sim" onclick="selectRadioColeta('sim')"><input type="radio" name="recol" value="true"> Sim</label>
        <label class="radio-opt" id="rc-nao" onclick="selectRadioColeta('nao')"><input type="radio" name="recol" value="false"> Não, dev. CD</label>
      </div></div>
      <div class="modal-footer">
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-danger" onclick="salvarInsucessoColeta(${id})">💾 Salvar</button>
      </div>
    </div>
  `);
};

window.selectRadioColeta = function(opt) {
  const sim = document.getElementById('rc-sim');
  const nao = document.getElementById('rc-nao');
  document.querySelector('input[name="recol"][value="' + opt + '"]').checked = true;
  if (sim) sim.className = 'radio-opt' + (opt === 'sim' ? ' selected-yes' : '');
  if (nao) nao.className = 'radio-opt' + (opt === 'nao' ? ' selected-no' : '');
};

window.salvarInsucessoColeta = async function(id) {
  const motivo = document.getElementById('mot-coleta')?.value;
  const rec = document.querySelector('input[name="recol"]:checked');
  if (!motivo || !rec) { alert('Preencha tudo'); return; }
  const reentrega = rec.value === 'true';
  const result = await apiPost(`/reversas/${id}/insucesso`, { motivo, reentrega, devolucao: !reentrega });
  if (result) {
    const e = DATA.reversas.find(x => x.id === id);
    if (e) { e.confirma_entrega = false; e.motivo_insucesso = motivo; e.reentrega = reentrega; }
    closeModal(); renderContent(); renderTabs();
  }
};

window.reabrirColeta = async function(id) {
  const result = await apiPut(`/reversas/${id}/reabrir`);
  if (result) {
    const e = DATA.reversas.find(x => x.id === id);
    if (e) { e.confirma_entrega = null; e.reentrega = null; e.devolucao = null; e.motivo_insucesso = null; e.status_devolucao = null; e.status_reentrega = null; }
    renderContent(); renderTabs();
  }
};

window.confirmarRecoleta = async function(id, status) {
  const result = await apiPut(`/reversas/${id}/recoleta`, { status });
  if (result) {
    const e = DATA.reversas.find(x => x.id === id);
    if (e) e.status_devolucao = status;
    renderContent(); renderTabs();
  }
};

window.confirmarDevCD = async function(id) {
  const result = await apiPut(`/reversas/${id}/devolucao-cd`);
  if (result) {
    const e = DATA.reversas.find(x => x.id === id);
    if (e) e.status_reentrega = true;
    renderContent(); renderTabs();
  }
};

// ==================== REENTREGAS ====================
function renderReentregas() {
  let lista = DATA.entregas.filter(e => e.reentrega === true);
  const pend = lista.filter(e => e.status_reentrega === null && e.confirma_entrega === null).length;
  const ok = lista.filter(e => e.status_reentrega === true).length;
  const dev = lista.filter(e => e.status_reentrega === false).length;

  return `
    <div class="card">
      <div class="card-header"><div class="card-title">🔁 Reentregas</div></div>
      <div class="stats-grid">
        <div class="stat-item"><div class="stat-label">Total</div><div class="stat-value primary">${lista.length}</div></div>
        <div class="stat-item"><div class="stat-label">Pendentes</div><div class="stat-value warning">${pend}</div></div>
        <div class="stat-item"><div class="stat-label">Entregues</div><div class="stat-value success">${ok}</div></div>
        <div class="stat-item"><div class="stat-label">Devolvidas</div><div class="stat-value danger">${dev}</div></div>
      </div>
      <div class="table-container"><table><thead><tr><th>NF</th><th>Carga</th><th>Cliente</th><th>Motivo</th><th>Status</th><th>Ação</th></tr></thead>
      <tbody>${lista.length === 0 ? '<tr><td colspan="6"><div class="empty-state">Nenhuma reentrega</div></td></tr>' : lista.map(e => {
        let st, ac;
        if (e.status_reentrega === true) { st = '<span class="badge badge-success">✅ Entregue</span>'; ac = '<span style="color:#64748b;font-size:0.75rem">Concluído</span>'; }
        else if (e.status_reentrega === false) { st = '<span class="badge badge-danger">📦 Devolvido</span>'; ac = '<span style="color:#64748b;font-size:0.75rem">Processado</span>'; }
        else if (e.confirma_entrega === true) { st = '<span class="badge badge-success">✅ Entregue</span>'; ac = `<button class="btn btn-sm btn-warning" onclick="reabrirReentrega(${e.id})">✏️ Editar</button>`; }
        else if (e.confirma_entrega === false) { st = '<span class="badge badge-danger">❌ Insucesso</span>'; ac = `<button class="btn btn-sm btn-warning" onclick="reabrirReentrega(${e.id})">✏️ Reabrir</button>`; }
        else { st = '<span class="badge badge-warning">⏳ Pendente</span>'; ac = `<button class="btn btn-sm btn-success" onclick="confirmarEntrega(${e.id}, true)">✅ Entregue</button> <button class="btn btn-sm btn-danger" onclick="openInsucesso(${e.id})">❌ Insucesso</button>`; }
        return `<tr><td>${e.nf}</td><td><span class="badge badge-info">${e.fc}</span></td><td>${(e.cliente||'—').slice(0,35)}</td><td style="max-width:120px;white-space:normal">${e.motivo_insucesso||'—'}</td><td>${st}</td><td>${ac}</td></tr>`;
      }).join('')}</tbody></table></div>
    </div>
  `;
}

window.reabrirReentrega = function(id) {
  const e = DATA.entregas.find(x => x.id === id);
  if (!e) return;
  e.confirma_entrega = null; e.status_reentrega = null; e.motivo_insucesso = null;
  if (e.devolucao) e.devolucao = null;
  renderContent(); renderTabs();
};

// ==================== DEVOLUÇÕES ====================
function renderDevolucoes() {
  let lista = [...DATA.devolucoes];
  const pend = lista.filter(e => e.status_devolucao === null).length;
  const conf = lista.filter(e => e.status_devolucao === true).length;

  return `
    <div class="card">
      <div class="card-header"><div class="card-title">⬅️ Devoluções ao CD</div></div>
      <div class="stats-grid">
        <div class="stat-item"><div class="stat-label">Total</div><div class="stat-value primary">${lista.length}</div></div>
        <div class="stat-item"><div class="stat-label">Pendentes</div><div class="stat-value warning">${pend}</div></div>
        <div class="stat-item"><div class="stat-label">Confirmadas</div><div class="stat-value success">${conf}</div></div>
      </div>
      <div class="table-container"><table><thead><tr><th>NF</th><th>Carga</th><th>Cliente</th><th>Motivo</th><th>Status</th><th>Ação</th></tr></thead>
      <tbody>${lista.length === 0 ? '<tr><td colspan="6"><div class="empty-state">📦 Nenhuma devolução</div></td></tr>' : lista.map(e => `
        <tr>
          <td>${e.nf}</td>
          <td><span class="badge badge-info">${e.fc}</span></td>
          <td>${(e.cliente||'—').slice(0,35)}</td>
          <td style="max-width:120px;white-space:normal">${e.motivo_insucesso||'—'}</td>
          <td>${e.status_devolucao === true ? '<span class="badge badge-success">✅ Confirmada</span>' : '<span class="badge badge-warning">⏳ Pendente</span>'}</td>
          <td>${e.status_devolucao === null ? `<button class="btn btn-sm btn-success" onclick="confirmarDevolucao(${e.id})">✅ Confirmar</button>` : '<span style="color:#64748b;font-size:0.75rem">Finalizado</span>'}</td>
        </tr>
      `).join('')}</tbody></table></div>
    </div>
  `;
}

window.confirmarDevolucao = async function(id) {
  const result = await apiPut(`/devolucoes/${id}/confirmar`);
  if (result) {
    const e = DATA.devolucoes.find(x => x.id === id);
    if (e) e.status_devolucao = true;
    renderContent(); renderTabs();
  }
};

// ==================== INDICADORES ====================
function renderIndicadores() {
  const periodoInicio = filters.entInicio || daysAgo(30);
  const periodoFim = filters.entFim || today();

  return `
    <div class="card">
      <div class="card-header"><div class="card-title">📊 Indicadores de Performance</div></div>
      <div class="filter-bar">
        <div class="filter-group"><label>📅 Início</label><input type="date" id="ind-inicio" value="${periodoInicio}"></div>
        <div class="filter-group"><label>📅 Fim</label><input type="date" id="ind-fim" value="${periodoFim}"></div>
        <button class="btn btn-sm btn-primary" onclick="carregarIndicadores()">📊 Atualizar</button>
      </div>
      <div id="indicadores-content"><div class="empty-state">🔄 Carregando indicadores...</div></div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">📄 Relatórios</div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">
        <button class="btn btn-outline btn-sm" onclick="baixarRelatorio('entregas','csv')">📥 Entregas CSV</button>
        <button class="btn btn-outline btn-sm" onclick="baixarRelatorio('entregas','xlsx')">📥 Entregas XLSX</button>
        <button class="btn btn-outline btn-sm" onclick="baixarRelatorio('insucessos','csv')">📥 Insucessos CSV</button>
        <button class="btn btn-outline btn-sm" onclick="baixarRelatorio('motoristas','csv')">📥 Motoristas CSV</button>
        <button class="btn btn-outline btn-sm" onclick="baixarRelatorio('reentregas','csv')">📥 Reentregas CSV</button>
        <button class="btn btn-outline btn-sm" onclick="baixarRelatorio('devolucoes','csv')">📥 Devoluções CSV</button>
      </div>
    </div>
  `;

  // Auto-load
  setTimeout(() => carregarIndicadores(), 100);
}

async function carregarIndicadores() {
  const inicio = document.getElementById('ind-inicio')?.value || daysAgo(30);
  const fim = document.getElementById('ind-fim')?.value || today();
  const el = document.getElementById('indicadores-content');
  if (!el) return;

  const params = `?dataInicio=${inicio}&dataFim=${fim}`;
  const [resumo, tendencia, motivos, top] = await Promise.all([
    apiGet(`/indicadores/resumo${params}`),
    apiGet(`/indicadores/tendencia${params}`),
    apiGet(`/indicadores/motivos`),
    apiGet(`/indicadores/top-motoristas`)
  ]);

  if (!resumo) { el.innerHTML = '<div class="empty-state">Erro ao carregar</div>'; return; }

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-item"><div class="stat-label">Total Entregas</div><div class="stat-value primary">${resumo.total}</div></div>
      <div class="stat-item"><div class="stat-label">Taxa Sucesso</div><div class="stat-value success">${resumo.taxaSucesso}%</div></div>
      <div class="stat-item"><div class="stat-label">Insucessos</div><div class="stat-value danger">${resumo.insucessos}</div></div>
      <div class="stat-item"><div class="stat-label">Reentregas Pend.</div><div class="stat-value warning">${resumo.reentregasPend}</div></div>
      <div class="stat-item"><div class="stat-label">🚛 S/ Placa</div><div class="stat-value warning">${resumo.semPlaca || 0}</div></div>
      <div class="stat-item"><div class="stat-label">🔄 Não Devolvidas</div><div class="stat-value danger">${resumo.coletasNaoDevolvidas || 0}</div></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
        <div style="font-weight:600;margin-bottom:8px">📈 Tendência Diária</div>
        ${(tendencia || []).length === 0 ? '<div style="color:var(--gray);font-size:0.85rem">Sem dados no período</div>' : `
        <div style="display:flex;flex-direction:column;gap:4px;max-height:300px;overflow-y:auto">
          ${tendencia.map(t => `
            <div style="display:flex;align-items:center;gap:8px;font-size:0.8rem">
              <span style="min-width:80px">${fmtDate(t.data_nf)}</span>
              <div style="flex:1;display:flex;gap:2px;height:20px;border-radius:4px;overflow:hidden">
                <div style="flex:${t.entregues};background:var(--green);min-width:${t.total > 0 ? '4px' : '0'};height:100%"></div>
                <div style="flex:${t.insucessos};background:var(--red);min-width:${t.total > 0 ? '4px' : '0'};height:100%"></div>
              </div>
              <span style="min-width:50px;text-align:right;color:var(--gray)">${t.total} ents</span>
            </div>
          `).join('')}
        </div>`}
      </div>

      <div style="border:1px solid var(--border);border-radius:8px;padding:12px">
        <div style="font-weight:600;margin-bottom:8px">🥧 Motivos de Insucesso</div>
        ${(motivos || []).length === 0 ? '<div style="color:var(--gray);font-size:0.85rem">Sem insucessos</div>' : `
        <div style="display:flex;flex-direction:column;gap:6px">
          ${motivos.map(m => `
            <div style="display:flex;align-items:center;gap:8px;font-size:0.8rem">
              <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.motivo_insucesso}</span>
              <span class="badge badge-danger">${m.total}</span>
            </div>
          `).join('')}
        </div>`}
      </div>
    </div>

    <div style="margin-top:16px;border:1px solid var(--border);border-radius:8px;padding:12px">
      <div style="font-weight:600;margin-bottom:8px">🏆 Top Motoristas</div>
      ${(top || []).length === 0 ? '<div style="color:var(--gray);font-size:0.85rem">Sem dados</div>' : `
      <div class="table-container"><table>
        <thead><tr><th>Motorista</th><th>Placa</th><th>Entregas</th><th>Sucesso</th></tr></thead>
        <tbody>${top.map(t => `
          <tr><td>${t.motorista}</td><td>${t.placa}</td><td>${t.entregas}</td><td><span class="badge badge-success">${t.sucesso}</span></td></tr>
        `).join('')}</tbody>
      </table></div>`}
    </div>
  `;
}

async function baixarRelatorio(tipo, formato) {
  const inicio = document.getElementById('ind-inicio')?.value || daysAgo(30);
  const fim = document.getElementById('ind-fim')?.value || today();
  const token = getToken();
  const url = `${API}/relatorios/${tipo}?dataInicio=${inicio}&dataFim=${fim}&formato=${formato}`;
  try {
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) { alert('Erro ao gerar relatório'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${tipo}_${inicio}_${fim}.${formato}`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch { alert('Erro ao baixar'); }
}

// ==================== ADMIN TRANSPORTADORA ====================
function renderAdminTransportadora() {
  const user = getUser();
  const isMaster = user.funcao === 'master';

  return `
    <div class="card">
      <div class="card-header"><div class="card-title">⚙️ Administração</div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px">
        <div style="border:1px solid var(--border);border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:2rem;margin-bottom:8px">👨‍✈️</div>
          <div style="font-weight:600;margin-bottom:8px">Motoristas (${DATA.motoristas.filter(m => m.ativo !== false).length})</div>
          <button class="btn btn-sm btn-primary" onclick="abrirGestao('motoristas')">Gerenciar</button>
        </div>
        <div style="border:1px solid var(--border);border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:2rem;margin-bottom:8px">🧑‍🤝‍🧑</div>
          <div style="font-weight:600;margin-bottom:8px">Ajudantes (${DATA.ajudantes.filter(a => a.ativo !== false).length})</div>
          <button class="btn btn-sm btn-primary" onclick="abrirGestao('ajudantes')">Gerenciar</button>
        </div>
        <div style="border:1px solid var(--border);border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:2rem;margin-bottom:8px">🚛</div>
          <div style="font-weight:600;margin-bottom:8px">Veículos (${DATA.veiculos.filter(v => v.ativo !== false).length})</div>
          <button class="btn btn-sm btn-primary" onclick="abrirGestao('veiculos')">Gerenciar</button>
        </div>
        ${isMaster ? `
        <div style="border:1px solid var(--border);border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:2rem;margin-bottom:8px">👤</div>
          <div style="font-weight:600;margin-bottom:8px">Usuários</div>
          <button class="btn btn-sm btn-primary" onclick="abrirGestao('usuarios')">Gerenciar</button>
        </div>
        <div style="border:1px solid var(--border);border-radius:8px;padding:16px;text-align:center">
          <div style="font-size:2rem;margin-bottom:8px">🔌</div>
          <div style="font-weight:600;margin-bottom:8px">Conexão PostgreSQL</div>
          <button class="btn btn-sm btn-primary" onclick="verDbCredentials()">Ver Credenciais</button>
        </div>` : ''}
      </div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">📬 Configuração IMAP (Email XML NF-e)</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm btn-primary" onclick="forcarVerificacaoImap()">🔄 Forçar verificação</button>
          <button class="btn btn-sm btn-primary" onclick="testarConexaoImap()">🔌 Testar Conexão</button>
          <button class="btn btn-sm btn-warning" onclick="showImapConfig()">⚙️ Configurar</button>
        </div>
      </div>
      <div id="imap-status-card" style="font-size:0.85em;color:var(--gray)">Carregando...</div>
      <div id="imap-diagnostics" style="display:none;margin-top:12px"></div>
    </div>
  `;
}

async function carregarImapStatus() {
  const el = document.getElementById('imap-status-card');
  if (!el) return;
  try {
    const [cfg, logsData] = await Promise.all([
      apiGet('/me/imap-config'),
      apiGet('/imap/logs?limit=20'),
    ]);

    if (!cfg) {
      el.innerHTML = '<div class="empty-state" style="padding:12px">⚠️ IMAP não configurado</div>';
      return;
    }

    const stats = logsData?.stats || {};
    const logs = logsData?.logs || [];

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:12px">
        <div style="background:var(--gray-light);padding:8px;border-radius:6px">
          <div style="font-size:0.65rem;font-weight:600;color:var(--gray);text-transform:uppercase">Servidor</div>
          <div>${cfg.imap_host}:${cfg.imap_port}</div>
        </div>
        <div style="background:var(--gray-light);padding:8px;border-radius:6px">
          <div style="font-size:0.65rem;font-weight:600;color:var(--gray);text-transform:uppercase">Usuário</div>
          <div>${cfg.imap_username}</div>
        </div>
        <div style="background:var(--gray-light);padding:8px;border-radius:6px">
          <div style="font-size:0.65rem;font-weight:600;color:var(--gray);text-transform:uppercase">Status</div>
          <div>${cfg.active ? '✅ Ativo' : '⏹ Parado'}</div>
        </div>
        <div style="background:var(--gray-light);padding:8px;border-radius:6px">
          <div style="font-size:0.65rem;font-weight:600;color:var(--gray);text-transform:uppercase">Remetente</div>
          <div>${cfg.remetente_email || 'Todos'}</div>
        </div>
        <div style="background:var(--gray-light);padding:8px;border-radius:6px">
          <div style="font-size:0.65rem;font-weight:600;color:var(--gray);text-transform:uppercase">Última verificação</div>
          <div>${cfg.last_check_at || '—'}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:12px">
        <div style="background:var(--gray-light);padding:8px;border-radius:6px;text-align:center">
          <div style="font-size:1.1rem;font-weight:700;color:var(--primary)">${stats.emails_hoje || 0}</div>
          <div style="font-size:0.65rem;color:var(--gray)">Emails hoje</div>
        </div>
        <div style="background:var(--gray-light);padding:8px;border-radius:6px;text-align:center">
          <div style="font-size:1.1rem;font-weight:700;color:var(--primary)">${stats.xmls_hoje || 0}</div>
          <div style="font-size:0.65rem;color:var(--gray)">XMLs extraídos</div>
        </div>
        <div style="background:var(--gray-light);padding:8px;border-radius:6px;text-align:center">
          <div style="font-size:1.1rem;font-weight:700;color:green">${stats.inseridas_hoje || 0}</div>
          <div style="font-size:0.65rem;color:var(--gray)">NFs inseridas</div>
        </div>
        <div style="background:var(--gray-light);padding:8px;border-radius:6px;text-align:center">
          <div style="font-size:1.1rem;font-weight:700;color:var(--orange)">${stats.atualizadas_hoje || 0}</div>
          <div style="font-size:0.65rem;color:var(--gray)">NFs atualizadas</div>
        </div>
        <div style="background:var(--gray-light);padding:8px;border-radius:6px;text-align:center">
          <div style="font-size:1.1rem;font-weight:700;color:${(stats.erros_hoje || 0) > 0 ? 'var(--red)' : 'green'}">${stats.erros_hoje || 0}</div>
          <div style="font-size:0.65rem;color:var(--gray)">Erros hoje</div>
        </div>
      </div>

      ${logs.length > 0 ? `
      <div style="font-size:0.7rem;font-weight:600;color:var(--gray);text-transform:uppercase;margin-bottom:6px">Últimos processamentos</div>
      <div class="table-container" style="max-height:300px;overflow-y:auto">
      <table style="font-size:0.8rem">
        <thead><tr>
          <th>Data</th>
          <th>Remetente</th>
          <th>Anexos</th>
          <th>XMLs</th>
          <th>NFs</th>
          <th>Status</th>
        </tr></thead>
        <tbody>${logs.map(l => `
          <tr>
            <td>${l.created_at}</td>
            <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${l.email_subject || ''}">${l.email_from || '?'}</td>
            <td>${l.attachments_count}</td>
            <td>${l.xmls_extracted}</td>
            <td>
              ${l.nfs_inseridas > 0 ? `<span style="color:green">+${l.nfs_inseridas}</span>` : ''}
              ${l.nfs_atualizadas > 0 ? `<span style="color:var(--orange)">~${l.nfs_atualizadas}</span>` : ''}
              ${l.nfs_inseridas === 0 && l.nfs_atualizadas === 0 ? '—' : ''}
            </td>
            <td>${l.status === 'ok' ? '✅' : l.status === 'ignored' ? '⏭️' : '❌'}</td>
          </tr>
        `).join('')}</tbody>
      </table></div>` : '<div style="text-align:center;padding:12px;color:var(--gray)">Nenhum processamento registrado ainda</div>'}
    `;
  } catch {
    if (el) el.innerHTML = '<span style="color:var(--red)">Erro ao carregar</span>';
  }
}

window.showImapConfig = async function() {
  const cfg = await apiGet('/me/imap-config');
  showModal(`
    <div class="modal" style="width:520px">
      <div class="modal-title">📬 Configuração IMAP</div>
      <div class="modal-row">
        <label>Host IMAP *</label>
        <input id="imap-host" value="${(cfg && cfg.imap_host) || ''}" placeholder="imap.seudominio.com.br">
      </div>
      <div class="modal-row" style="display:flex;gap:12px">
        <div style="flex:1">
          <label>Porta</label>
          <input type="number" id="imap-port" value="${(cfg && cfg.imap_port) || 993}">
        </div>
        <div style="flex:1;display:flex;align-items:flex-end;padding-bottom:10px">
          <label style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="imap-ssl" ${(!cfg || cfg.imap_ssl) ? 'checked' : ''}> SSL
          </label>
        </div>
      </div>
      <div class="modal-row">
        <label>Usuário *</label>
        <input id="imap-username" value="${(cfg && cfg.imap_username) || ''}" placeholder="email@dominio.com">
      </div>
      <div class="modal-row">
        <label>Senha</label>
        <input type="password" id="imap-password" placeholder="${cfg ? 'Deixe em branco para manter' : 'Obrigatório'}">
      </div>
      <div class="modal-row">
        <label>Remetente (filtrar por email)</label>
        <input id="imap-remetente" value="${(cfg && cfg.remetente_email) || ''}" placeholder="remetente@dominio.com (opcional)">
      </div>
      <div class="modal-row" style="display:flex;gap:12px">
        <div style="flex:1">
          <label>Intervalo (minutos)</label>
          <input type="number" id="imap-interval" value="${(cfg && cfg.imap_check_interval) || 5}" min="1" max="60">
        </div>
        <div style="flex:1;display:flex;align-items:flex-end;padding-bottom:10px">
          <label style="display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="imap-active" ${(!cfg || cfg.active) ? 'checked' : ''}> Ativo
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="salvarImapConfig()">💾 Salvar</button>
      </div>
    </div>
  `);
};

window.salvarImapConfig = async function() {
  const data = {
    imap_host: document.getElementById('imap-host').value,
    imap_port: parseInt(document.getElementById('imap-port').value) || 993,
    imap_ssl: document.getElementById('imap-ssl').checked,
    imap_username: document.getElementById('imap-username').value,
    imap_password: document.getElementById('imap-password').value,
    imap_check_interval: parseInt(document.getElementById('imap-interval').value) || 5,
    active: document.getElementById('imap-active').checked,
    remetente_email: document.getElementById('imap-remetente').value || null,
  };
  if (!data.imap_host || !data.imap_username) {
    alert('Host e usuário são obrigatórios');
    return;
  }
  const res = await apiFetch('/me/imap-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (res && res.message) {
    closeModal();
    carregarImapStatus();
  } else {
    alert((res && res.error) || 'Erro ao salvar');
  }
};

window.forcarVerificacaoImap = async function() {
  const btn = document.querySelector('button[onclick="forcarVerificacaoImap()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Verificando...'; }
  const res = await apiPost('/imap/check');
  if (res && res.message) {
    alert('✅ ' + res.message);
  } else {
    alert((res && res.error) || 'Erro ao forçar verificação');
  }
  if (btn) { btn.disabled = false; btn.textContent = '🔄 Forçar verificação'; }
  carregarImapStatus();
};

window.testarConexaoImap = async function() {
  const btn = document.querySelector('button[onclick="testarConexaoImap()"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Testando...'; }
  const res = await apiPost('/imap/test');
  if (res && res.success !== false) {
    alert(`✅ Conexão bem-sucedida!\nTotal de mensagens na INBOX: ${res.messageCount}\nNão lidas: ${res.unseenCount}`);
  } else {
    alert('❌ Erro na conexão: ' + (res && res.error || 'Falha desconhecida'));
  }
  if (btn) { btn.disabled = false; btn.textContent = '🔌 Testar Conexão'; }
};

window.abrirGestao = async function(tipo) {
  const token = getToken();
  let lista, titulo, campos, apiUrl;

  switch (tipo) {
    case 'motoristas':
      lista = DATA.motoristas;
      titulo = 'Motoristas';
      campos = ['nome', 'cpf', 'cnh', 'telefone'];
      apiUrl = '/motoristas';
      break;
    case 'ajudantes':
      lista = DATA.ajudantes;
      titulo = 'Ajudantes';
      campos = ['nome', 'cpf', 'telefone'];
      apiUrl = '/ajudantes';
      break;
    case 'veiculos':
      lista = DATA.veiculos;
      titulo = 'Veículos';
      campos = ['placa', 'tipo', 'obs'];
      apiUrl = '/veiculos';
      break;
    case 'usuarios':
      const users = await apiGet('/usuarios');
      lista = users || [];
      titulo = 'Usuários';
      campos = ['nome', 'email', 'funcao'];
      apiUrl = '/usuarios';
      break;
    default: return;
  }

  const headers = campos.join('|');
  showModal(`
    <div class="modal" style="width:650px;max-height:80vh">
      <div class="modal-title">👥 ${titulo}</div>
      <div style="margin-bottom:12px">
        <button class="btn btn-sm btn-success" onclick="novoCadastro('${tipo}')">+ Novo</button>
      </div>
      <div class="table-container" style="max-height:400px;overflow-y:auto">
        <table>
          <thead><tr>${campos.map(c => `<th>${c.charAt(0).toUpperCase()+c.slice(1)}</th>`).join('')}${tipo !== 'usuarios' ? '<th>Ativo</th>' : ''}<th>Ação</th></tr></thead>
          <tbody>
            ${lista.length === 0 ? '<tr><td colspan="99"><div class="empty-state">Nenhum registro</div></td></tr>' : lista.map(item => `
              <tr>
                ${campos.map(c => `<td>${item[c] || '—'}</td>`).join('')}
                ${tipo !== 'usuarios' ? `<td>${item.ativo !== false ? '✅' : '❌'}</td>` : ''}
                <td>
                  <button class="btn btn-sm btn-warning" onclick="editarCadastro('${tipo}', ${item.id})">✏️</button>
                  <button class="btn btn-sm btn-danger" onclick="excluirCadastro('${tipo}', ${item.id})">🗑️</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="modal-footer"><button class="btn" onclick="closeModal()">Fechar</button></div>
    </div>
  `);
};

window.novoCadastro = function(tipo) {
  const titulo = tipo.charAt(0).toUpperCase() + tipo.slice(1);
  let body = '';

  if (tipo === 'motoristas') {
    body = `
      <div class="modal-row"><label>Nome *</label><input id="f-nome" placeholder="Nome completo"></div>
      <div class="modal-row"><label>CPF</label><input id="f-cpf" placeholder="000.000.000-00"></div>
      <div class="modal-row"><label>CNH</label><input id="f-cnh" placeholder="Nº da CNH"></div>
      <div class="modal-row"><label>Telefone</label><input id="f-tel" placeholder="(11) 99999-9999"></div>`;
  } else if (tipo === 'ajudantes') {
    body = `
      <div class="modal-row"><label>Nome *</label><input id="f-nome" placeholder="Nome completo"></div>
      <div class="modal-row"><label>CPF</label><input id="f-cpf" placeholder="000.000.000-00"></div>
      <div class="modal-row"><label>Telefone</label><input id="f-tel" placeholder="(11) 99999-9999"></div>`;
  } else if (tipo === 'veiculos') {
    body = `
      <div class="modal-row"><label>Placa *</label><input id="f-placa" placeholder="ABC-1234" style="text-transform:uppercase"></div>
      <div class="modal-row"><label>Tipo</label>${renderSelect('f-tipo', ['Fiorino','Doblo','Sprinter','Vans','Caminhão','Outro'].map(t => ({nome:t})), { placeholder: 'Selecione o tipo' })}</div>
      <div class="modal-row"><label>Observação</label><input id="f-obs" placeholder="Observações"></div>`;
  } else if (tipo === 'usuarios') {
    body = `
      <div class="modal-row"><label>Nome *</label><input id="f-nome" placeholder="Nome completo"></div>
      <div class="modal-row"><label>Email *</label><input id="f-email" type="email" placeholder="email@exemplo.com"></div>
      <div class="modal-row"><label>Função *</label>${renderSelect('f-funcao', [{nome:'admin'},{nome:'operador'}], { placeholder: 'Selecione a função' })}</div>`;
  }

  showModal(`
    <div class="modal">
      <div class="modal-title">➕ Novo ${titulo}</div>
      ${body}
      <div class="modal-footer">
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-success" onclick="salvarNovoCadastro('${tipo}')">💾 Salvar</button>
      </div>
    </div>
  `);
};

window.salvarNovoCadastro = async function(tipo) {
  const getVal = id => document.getElementById(id)?.value?.trim() || null;
  let data;

  if (tipo === 'motoristas') {
    const nome = getVal('f-nome');
    if (!nome) { alert('Nome é obrigatório'); return; }
    data = { nome, cpf: getVal('f-cpf'), cnh: getVal('f-cnh'), telefone: getVal('f-tel') };
  } else if (tipo === 'ajudantes') {
    const nome = getVal('f-nome');
    if (!nome) { alert('Nome é obrigatório'); return; }
    data = { nome, cpf: getVal('f-cpf'), telefone: getVal('f-tel') };
  } else if (tipo === 'veiculos') {
    const placa = getVal('f-placa');
    if (!placa) { alert('Placa é obrigatória'); return; }
    data = { placa: placa.toUpperCase(), tipo: getVal('f-tipo'), obs: getVal('f-obs') };
  } else if (tipo === 'usuarios') {
    const nome = getVal('f-nome');
    const email = getVal('f-email');
    if (!nome || !email) { alert('Nome e email são obrigatórios'); return; }
    data = { nome, email, funcao: getVal('f-funcao') || 'operador' };
  } else return;

  const result = await apiPost({ motoristas: '/motoristas', ajudantes: '/ajudantes', veiculos: '/veiculos', usuarios: '/usuarios' }[tipo], data);
  if (result && result.id) {
    closeModal();
    if (tipo === 'usuarios' && result.senha_enviada_para) {
      alert(`Usuário criado! Email enviado para ${result.senha_enviada_para} com os dados de acesso.`);
    }
    if (['motoristas', 'ajudantes'].includes(tipo)) {
      const d = await apiGet(`/${tipo}`);
      if (d) DATA[tipo] = d;
      const f = await apiGet('/funcionarios');
      if (f) DATA.funcionarios = f;
    } else if (tipo === 'veiculos') {
      const d = await apiGet('/veiculos');
      if (d) DATA.veiculos = d;
    }
    renderContent();
  } else {
    alert((result && result.error) || 'Erro ao salvar');
  }
};

window.salvarCadastro = async function(tipo, data) {
  const apiMap = { motoristas: '/motoristas', ajudantes: '/ajudantes', veiculos: '/veiculos', usuarios: '/usuarios' };
  const result = await apiPost(apiMap[tipo], data);
  if (result && result.id) {
    alert('Salvo com sucesso!');

    if (tipo === 'usuarios' && result.senha_enviada_para) {
      alert(`Email enviado para ${result.senha_enviada_para} com os dados de acesso.`);
    }

    // Refresh data
    if (['motoristas', 'ajudantes'].includes(tipo)) {
      const d = await apiGet(`/${tipo}`);
      if (d) DATA[tipo] = d;
      const f = await apiGet('/funcionarios');
      if (f) DATA.funcionarios = f;
    } else if (tipo === 'veiculos') {
      const d = await apiGet('/veiculos');
      if (d) DATA.veiculos = d;
    }
    renderContent();
  } else {
    alert((result && result.error) || 'Erro ao salvar');
  }
};

window.excluirCadastro = async function(tipo, id) {
  if (!confirm('Tem certeza?')) return;
  const apiMap = { motoristas: '/motoristas', ajudantes: '/ajudantes', veiculos: '/veiculos' };
  const result = await apiDelete(`${apiMap[tipo]}/${id}`);
  if (result && result.message) {
    DATA[tipo] = DATA[tipo].filter(x => x.id !== id);
    if (['motoristas', 'ajudantes'].includes(tipo)) {
      const f = await apiGet('/funcionarios');
      if (f) DATA.funcionarios = f;
    }
    renderContent();
  } else {
    alert('Erro ao excluir');
  }
};

window.editarCadastro = function(tipo, id) {
  const item = DATA[tipo]?.find(x => x.id === id);
  if (!item) return;

  const titulo = tipo.charAt(0).toUpperCase() + tipo.slice(1);
  let body = '';

  if (tipo === 'motoristas') {
    body = `
      <div class="modal-row"><label>Nome *</label><input id="f-nome" value="${item.nome}" placeholder="Nome completo"></div>
      <div class="modal-row"><label>CPF</label><input id="f-cpf" value="${item.cpf || ''}" placeholder="000.000.000-00"></div>
      <div class="modal-row"><label>CNH</label><input id="f-cnh" value="${item.cnh || ''}" placeholder="Nº da CNH"></div>
      <div class="modal-row"><label>Telefone</label><input id="f-tel" value="${item.telefone || ''}" placeholder="(11) 99999-9999"></div>`;
  } else if (tipo === 'ajudantes') {
    body = `
      <div class="modal-row"><label>Nome *</label><input id="f-nome" value="${item.nome}" placeholder="Nome completo"></div>
      <div class="modal-row"><label>CPF</label><input id="f-cpf" value="${item.cpf || ''}" placeholder="000.000.000-00"></div>
      <div class="modal-row"><label>Telefone</label><input id="f-tel" value="${item.telefone || ''}" placeholder="(11) 99999-9999"></div>`;
  } else if (tipo === 'veiculos') {
    body = `
      <div class="modal-row"><label>Placa *</label><input id="f-placa" value="${item.placa}" style="text-transform:uppercase" placeholder="ABC-1234"></div>
      <div class="modal-row"><label>Tipo</label>${renderSelect('f-tipo', ['Fiorino','Doblo','Sprinter','Vans','Caminhão','Outro'].map(t => ({nome:t})), { selected: item.tipo || '', placeholder: 'Selecione o tipo' })}</div>
      <div class="modal-row"><label>Observação</label><input id="f-obs" value="${item.obs || ''}" placeholder="Observações"></div>`;
  }

  showModal(`
    <div class="modal">
      <div class="modal-title">✏️ Editar ${titulo}</div>
      ${body}
      <div class="modal-footer">
        <button class="btn" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary" onclick="salvarEdicaoCadastro('${tipo}', ${id})">💾 Salvar</button>
      </div>
    </div>
  `);
};

window.salvarEdicaoCadastro = async function(tipo, id) {
  const getVal = id => document.getElementById(id)?.value?.trim() || null;
  let data;

  if (tipo === 'motoristas') {
    const nome = getVal('f-nome');
    if (!nome) { alert('Nome é obrigatório'); return; }
    data = { nome, cpf: getVal('f-cpf'), cnh: getVal('f-cnh'), telefone: getVal('f-tel') };
  } else if (tipo === 'ajudantes') {
    const nome = getVal('f-nome');
    if (!nome) { alert('Nome é obrigatório'); return; }
    data = { nome, cpf: getVal('f-cpf'), telefone: getVal('f-tel') };
  } else if (tipo === 'veiculos') {
    const placa = getVal('f-placa');
    if (!placa) { alert('Placa é obrigatória'); return; }
    data = { placa: placa.toUpperCase(), tipo: getVal('f-tipo'), obs: getVal('f-obs') };
  } else return;

  const result = await apiPut({ motoristas: `/motoristas/${id}`, ajudantes: `/ajudantes/${id}`, veiculos: `/veiculos/${id}` }[tipo], data);
  if (result) {
    closeModal();
    Object.assign(DATA[tipo].find(x => x.id === id) || {}, result);
    if (['motoristas', 'ajudantes'].includes(tipo)) {
      const f = await apiGet('/funcionarios');
      if (f) DATA.funcionarios = f;
    } else if (tipo === 'veiculos') {
      const v = await apiGet('/veiculos');
      if (v) DATA.veiculos = v;
    }
    renderContent();
  } else {
    alert((result && result.error) || 'Erro ao salvar');
  }
};

window.verDbCredentials = async function() {
  const data = await apiGet('/me/db-credentials');
  if (!data) { alert('Credenciais não configuradas ou acesso negado'); return; }
  showModal(`
    <div class="modal">
      <div class="modal-title">🔌 Conexão PostgreSQL</div>
      <div class="warning-box">⚠️ Use com responsabilidade. Estas credenciais dão acesso externo direto ao banco de dados da sua transportadora.</div>
      <div class="info-grid">
        <div><label>Host</label><span>${data.host}</span></div>
        <div><label>Porta</label><span>${data.port}</span></div>
        <div><label>Database</label><span>${data.database}</span></div>
        <div><label>Usuário</label><span>${data.user}</span></div>
        <div><label>Senha</label><span id="pw-show">●●●●●●●●●●●●</span></div>
      </div>
      <button class="btn btn-sm btn-primary" onclick="document.getElementById('pw-show').textContent = document.getElementById('pw-show').textContent === '●●●●●●●●●●●●' ? '${data.password}' : '●●●●●●●●●●●●'">Mostrar/Ocultar Senha</button>
      <div class="modal-footer"><button class="btn" onclick="closeModal()">Fechar</button></div>
    </div>
  `);
};

// ==================== ARQUIVO / IMPORTAR CARGAS E XML ====================
function renderArquivo() {
  return `
    <div class="card">
      <div class="card-header"><div class="card-title">📁 Importar Cargas (XLSX)</div></div>
      <div class="drop-area" onclick="document.getElementById('xlsx-input').click()">
        📂 Clique para selecionar arquivo XLSX de Programação<br><small>Máx 10MB · Formato: Programação Transportador</small>
        <input type="file" id="xlsx-input" style="display:none" accept=".xlsx" onchange="xlsxSelected(this)">
      </div>
      <div id="xlsx-info" style="margin-top:8px;font-size:0.9em;color:#888"></div>
      <button id="btn-importar-xlsx" class="btn-primary" style="margin-top:12px;display:none" onclick="importarXlsx()">
        ⬆️ Importar
      </button>
      <div id="xlsx-status" style="margin-top:12px"></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">📄 Importar XML NF-e (Casas Bahia / Via Varejo)</div></div>
      <div class="drop-area" onclick="document.getElementById('xml-input').click()">
        📂 Clique para selecionar arquivo XML ou .zip de NF-e<br><small>Máx 10MB · Aceita .xml ou .zip com múltiplos XMLs</small>
        <input type="file" id="xml-input" style="display:none" accept=".xml,.zip" onchange="xmlSelected(this)">
      </div>
      <div id="xml-info" style="margin-top:8px;font-size:0.9em;color:#888"></div>
      <button id="btn-importar-xml" class="btn-primary" style="margin-top:12px;display:none" onclick="importarXml()">
        ⬆️ Importar XML
      </button>
      <div id="xml-status" style="margin-top:12px"></div>
    </div>
  `;
}

window.xlsxSelected = function(input) {
  if (!input.files[0]) return;
  document.getElementById('xlsx-info').textContent = `📎 ${input.files[0].name} (${(input.files[0].size / 1024).toFixed(1)} KB)`;
  document.getElementById('btn-importar-xlsx').style.display = 'inline-block';
};

window.xmlSelected = function(input) {
  if (!input.files[0]) return;
  document.getElementById('xml-info').textContent = `📎 ${input.files[0].name} (${(input.files[0].size / 1024).toFixed(1)} KB)`;
  document.getElementById('btn-importar-xml').style.display = 'inline-block';
};

window.importarXlsx = async function() {
  const input = document.getElementById('xlsx-input');
  if (!input.files[0]) return;
  const formData = new FormData();
  formData.append('arquivo', input.files[0]);
  const el = document.getElementById('xlsx-status');
  el.innerHTML = '<span class="badge badge-info">⏳ Importando...</span>';
  document.getElementById('btn-importar-xlsx').disabled = true;
  try {
    const res = await fetch(`${API}/importar-cargas`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` },
      body: formData
    });
    if (!res.ok) {
      const err = await res.json();
      el.innerHTML = `<span class="badge badge-danger">❌ ${err.error || 'Erro na importação'}</span>`;
      return;
    }
    const data = await res.json();
    let html = '<div style="margin-top:8px">';
    html += `<span class="badge badge-success">✅ Inseridas: ${data.inseridas}</span> `;
    html += `<span class="badge badge-info">🔄 Atualizadas: ${data.atualizadas}</span> `;
    html += `<span class="badge badge-gray">⏭ Ignoradas: ${data.ignoradas}</span>`;
    if (data.erros && data.erros.length > 0) {
      html += '<div style="margin-top:8px;color:#e74c3c;font-size:0.85em"><strong>Erros:</strong><br>';
      data.erros.forEach(e => { html += `${e}<br>`; });
      html += '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  } catch {
    el.innerHTML = '<span class="badge badge-danger">❌ Erro de conexão</span>';
  }
  document.getElementById('btn-importar-xlsx').disabled = false;
  input.value = '';
  document.getElementById('xlsx-info').textContent = '';
};

window.importarXml = async function() {
  const input = document.getElementById('xml-input');
  if (!input.files[0]) return;
  const formData = new FormData();
  formData.append('arquivo', input.files[0]);
  const el = document.getElementById('xml-status');
  el.innerHTML = '<span class="badge badge-info">⏳ Importando...</span>';
  document.getElementById('btn-importar-xml').disabled = true;
  try {
    const res = await fetch(`${API}/importar-xml`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` },
      body: formData
    });
    if (!res.ok) {
      const err = await res.json();
      el.innerHTML = `<span class="badge badge-danger">❌ ${err.error || 'Erro na importação'}</span>`;
      return;
    }
    const data = await res.json();
    let html = '<div style="margin-top:8px">';
    html += `<span class="badge badge-success">✅ Inseridas: ${data.inseridas}</span> `;
    html += `<span class="badge badge-info">🔄 Atualizadas: ${data.atualizadas}</span> `;
    if (data.erros && data.erros.length > 0) {
      html += '<div style="margin-top:8px;color:#e74c3c;font-size:0.85em"><strong>Erros:</strong><br>';
      data.erros.forEach(e => { html += `${e}<br>`; });
      html += '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  } catch {
    el.innerHTML = '<span class="badge badge-danger">❌ Erro de conexão</span>';
  }
  document.getElementById('btn-importar-xml').disabled = false;
  input.value = '';
  document.getElementById('xml-info').textContent = '';
};

// ==================== UTILS ====================
window.showModal = function(html) {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = `<div class="modal-overlay" onclick="closeModalOutside(event)">${html}</div>`;
};

window.closeModal = function() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
  renderContent();
};

window.closeModalOutside = function(e) {
  if (e.target.classList.contains('modal-overlay')) closeModal();
};

window.handleLogout = function() {
  clearAuth();
  render();
};

// ==================== SELECT HELPER ====================
function renderSelect(id, data, opts = {}) {
  const {
    labelField = 'nome',
    valueField,
    selected = '',
    disabled = false,
    placeholder = 'Selecione',
    style = 'width:100%;padding:8px;border-radius:8px;border:1px solid #e2e8f0;color:#1e293b',
    filterFn,
    onchange,
    extraAttrs = '',
  } = opts;
  const listId = id.replace(/[^a-zA-Z0-9_-]/g, '') + '-list';
  const items = Array.isArray(data) ? (filterFn ? data.filter(filterFn) : data) : [];
  const options = items.map(item => {
    const v = typeof item === 'object' && item !== null
      ? (valueField ? item[valueField] : item[labelField])
      : item;
    return `<option value="${v ?? ''}">`;
  }).join('');
  return `
    <input list="${listId}" id="${id}" value="${selected}" ${disabled ? 'disabled' : ''} placeholder="${placeholder}" style="${style}" ${onchange ? `onchange="${onchange}"` : ''} ${extraAttrs}>
    <datalist id="${listId}">${options}</datalist>
  `;
}

// ==================== INIT ====================
render();

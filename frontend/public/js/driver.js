// ==================== AUTH HELPERS ====================
function getToken() { return sessionStorage.getItem('token') || localStorage.getItem('token'); }
function setToken(t) { localStorage.setItem('token', t); sessionStorage.setItem('token', t); }
function getUser() { try { return JSON.parse(sessionStorage.getItem('user') || localStorage.getItem('user') || 'null'); } catch { return null; } }
function setUser(u) { const s = JSON.stringify(u); localStorage.setItem('user', s); sessionStorage.setItem('user', s); }
function clearAuth() { localStorage.removeItem('token'); localStorage.removeItem('user'); sessionStorage.clear(); }

// ==================== CONFIG ====================
const API = '/api';
let user = null;
let entregas = [];
let chatwootConfig = null;

// ==================== INIT ====================
(function init() {
  user = getUser();
  if (!user || !getToken()) { window.location.href = 'index.html'; return; }
  if (user.funcao !== 'motorista') { window.location.href = 'index.html'; return; }
  document.getElementById('userInfo').textContent = user.nome || user.email;
  loadChatwootConfig().then(() => initChatwootWidget());
  document.getElementById('inputCarga').addEventListener('keydown', e => {
    if (e.key === 'Enter') loadCarga();
  });
})();

async function api(url, opts = {}) {
  const token = getToken();
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers };
  const res = await fetch(API + url, { ...opts, headers });
  const data = await res.json().catch(() => null);
  if (res.status === 401) { clearAuth(); window.location.href = 'index.html'; return null; }
  return data;
}

async function loadChatwootConfig() {
  chatwootConfig = await api('/motorista/chatwoot-config');
}

function showToast(msg) {
  const c = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 2000);
}

function showLoading(show) {
  const container = document.getElementById('cargaContent');
  if (!show) return;
  container.innerHTML = '<div class="loading">Carregando</div>';
}

// ==================== SCREENS ====================
function showScreen(id) {
  ['screenHome', 'screenCarga'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
  document.getElementById('btnBack').classList.toggle('hidden', id === 'screenHome');
  document.getElementById('driverTitle').textContent = id === 'screenHome' ? 'Entregas' : `Carga ${document.getElementById('inputCarga').value || ''}`;
}

function goHome() {
  showScreen('screenHome');
  entregas = [];
}

function logout() {
  clearAuth();
  window.location.href = 'index.html';
}

// ==================== LOAD CARGA ====================
window.loadCarga = async function() {
  const num = document.getElementById('inputCarga').value.trim();
  if (!num) { showToast('Digite o número da carga'); return; }
  showScreen('screenCarga');
  showLoading(true);
  const data = await api(`/motorista/carga/${encodeURIComponent(num)}`);
  showLoading(false);
  if (!data) return;
  entregas = data;
  entregas.sort((a, b) => {
    if (a.has_recent_contact_message && !b.has_recent_contact_message) return -1;
    if (!a.has_recent_contact_message && b.has_recent_contact_message) return 1;
    return 0;
  });
  if (entregas.length === 0) {
    document.getElementById('cargaContent').innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>Nenhuma entrega encontrada para esta carga.</p></div>';
    return;
  }
  renderCarga();
};

// ==================== RENDER ====================
function renderCarga() {
  const container = document.getElementById('cargaContent');
  const total = entregas.length;
  const confirmadas = entregas.filter(e => e.confirma_entrega === true).length;
  const falhas = entregas.filter(e => e.confirma_entrega === false).length;
  const pendentes = total - confirmadas - falhas;

  let html = `
    <div class="carga-header">
      <h2>Carga ${entregas[0].fc || ''}</h2>
      <span class="badge">${total} entregas</span>
    </div>
    <div class="stats">
      <div class="stat-card pendente"><div class="num">${pendentes}</div><div class="label">Pendentes</div></div>
      <div class="stat-card ok"><div class="num">${confirmadas}</div><div class="label">Confirmadas</div></div>
      <div class="stat-card falha"><div class="num">${falhas}</div><div class="label">Insucesso</div></div>
    </div>
  `;

  entregas.forEach(e => {
    const status = e.confirma_entrega === null ? 'pendente' : (e.confirma_entrega ? 'confirmada' : 'insucesso');
    const statusLabel = e.confirma_entrega === null ? 'Pendente' : (e.confirma_entrega ? '✓ Confirmada' : '✗ Insucesso');
    const done = e.confirma_entrega !== null;
    const endereco = [e.bairro, e.cidade].filter(Boolean).join(' - ') || '—';
    const chatwootAvailable = chatwootConfig && e.whatsapp_jid;

    html += `
      <div class="entrega-card${e.has_recent_contact_message ? ' recent-message' : ''}" data-id="${e.id}" data-status="${status}">
        <div class="card-header">
          <span class="nf-num">NF ${e.nf || '—'}${e.has_recent_contact_message ? '<span class="recent-badge">💬 Nova mensagem</span>' : ''}</span>
          <span class="status-badge ${status}">${statusLabel}</span>
        </div>
        <div class="cliente">${e.cliente || '—'}</div>
        <div class="endereco">📍 ${endereco}</div>
        <div class="info-row">
          <span>📦 ${e.qtd_volumes || 1} vol</span>
          <span>💰 R$ ${parseFloat(e.valor_nf || 0).toFixed(2)}</span>
          <span>⚖️ ${parseFloat(e.peso_real || 0).toFixed(1)} kg</span>
          ${e.cep ? `<span>📮 ${e.cep}</span>` : ''}
          ${e.telefone ? `<span>📞 ${e.telefone}</span>` : ''}
        </div>
        ${chatwootAvailable ? `<button class="chatwoot-btn" onclick="openChatwoot(${e.id})">💬 WhatsApp</button>` : ''}
        ${!done ? `
        <div class="actions">
          <button class="btn-success-driver" onclick="confirmarEntrega(${e.id})">✓ Recebida</button>
          <button class="btn-danger-driver" onclick="abrirInsucesso(${e.id})">✗ Inconsistência</button>
        </div>
        ` : e.motivo_insucesso ? `<div style="font-size:13px;color:#c5221f;margin-top:6px">Motivo: ${e.motivo_insucesso}</div>` : ''}
      </div>
    `;
  });

  container.innerHTML = html;
}

// ==================== CONFIRMAR ENTREGA ====================
window.confirmarEntrega = async function(id) {
  const body = {};
  if ('geolocation' in navigator) {
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }));
      body.latitude = pos.coords.latitude;
      body.longitude = pos.coords.longitude;
    } catch {}
  }
  const result = await api(`/motorista/entregas/${id}/confirmar`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!result) return;
  const e = entregas.find(x => x.id === id);
  if (e) { e.confirma_entrega = true; e.latitude = body.latitude; e.longitude = body.longitude; }
  renderCarga();
  showToast('Entrega confirmada com sucesso!');
};

// ==================== INSUCESSO ====================
let insucessoId = null;

window.abrirInsucesso = function(id) {
  insucessoId = id;
  const overlay = document.createElement('div');
  overlay.className = 'insucesso-modal-overlay';
  overlay.id = 'insucessoOverlay';
  overlay.onclick = e => { if (e.target === overlay) fecharInsucesso(); };
  overlay.innerHTML = `
    <div class="insucesso-modal">
      <h3>Motivo da Inconsistência</h3>
      <select id="motivoInsucesso">
        <option value="">Selecione...</option>
        <option value="Cliente ausente">Cliente ausente</option>
        <option value="Endereço incorreto">Endereço incorreto</option>
        <option value="Recusou receber">Recusou receber</option>
        <option value="Produto avariado">Produto avariado</option>
        <option value="NF não confere">NF não confere</option>
        <option value="Local fechado">Local fechado</option>
        <option value="Outro">Outro</option>
      </select>
      <div class="btn-row">
        <button class="btn-outline" onclick="fecharInsucesso()">Cancelar</button>
        <button class="btn-danger-driver" onclick="confirmarInsucesso()">Confirmar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
};

window.fecharInsucesso = function() {
  const el = document.getElementById('insucessoOverlay');
  if (el) el.remove();
  insucessoId = null;
};

window.confirmarInsucesso = async function() {
  const motivo = document.getElementById('motivoInsucesso').value;
  if (!motivo) { showToast('Selecione um motivo'); return; }
  const body = { motivo };
  if ('geolocation' in navigator) {
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000, maximumAge: 30000 }));
      body.latitude = pos.coords.latitude;
      body.longitude = pos.coords.longitude;
    } catch {}
  }
  const result = await api(`/motorista/entregas/${insucessoId}/insucesso`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  fecharInsucesso();
  if (!result) return;
  const e = entregas.find(x => x.id === insucessoId);
  if (e) { e.confirma_entrega = false; e.motivo_insucesso = motivo; e.latitude = body.latitude; e.longitude = body.longitude; }
  insucessoId = null;
  renderCarga();
  showToast('Inconsistência registrada');
};

// ==================== CHATWOOT INTEGRATION ====================
window.openChatwoot = async function(entregaId) {
  if (!chatwootConfig) return;
  const e = entregas.find(x => x.id === entregaId);
  if (!e || !e.whatsapp_jid) return;
  const { api_url, account_id, inbox_id, website_token } = chatwootConfig;
  if (!api_url || !account_id || !inbox_id || !website_token) {
    showToast('Chatwoot não configurado');
    return;
  }

  if (e.chatwoot_conversation_id) {
    const url = `${api_url}/app/accounts/${account_id}/conversations/${e.chatwoot_conversation_id}`;
    window.open(url, '_blank');
    return;
  }

  try {
    const contact = await api(`/chatwoot/sync/${entregaId}`, { method: 'POST' });
    if (contact && contact.conversation_url) {
      window.open(contact.conversation_url, '_blank');
    }
  } catch (err) {
    showToast('Erro ao abrir Chatwoot');
  }
};

// ==================== CHATWOOT WIDGET SUPORTE ====================
function initChatwootWidget() {
  if (!chatwootConfig || !chatwootConfig.suporte_website_token || !chatwootConfig.api_url) {
    document.getElementById('supportFab').classList.remove('visible');
    return;
  }
  if (window.$chatwoot) return;

  const baseUrl = chatwootConfig.api_url.replace(/\/+$/, '');
  const g = document.createElement('script');
  g.src = baseUrl + '/packs/js/sdk.js';
  g.async = true;
  g.defer = true;
  document.body.appendChild(g);
  g.onload = function() {
    window.chatwootSDK.run({
      websiteToken: chatwootConfig.suporte_website_token,
      baseUrl: baseUrl,
    });
    if (user) {
      setTimeout(() => {
        window.$chatwoot?.setUser?.(user.email, {
          name: user.nome || user.email,
          email: user.email,
        });
      }, 1000);
    }
  };
}

window.toggleSuporte = function() {
  if (window.$chatwoot) {
    window.$chatwoot.toggle();
  } else {
    showToast('Chat de suporte não disponível');
  }
};

// Show/hide support FAB based on screen
const origShowScreen = showScreen;
showScreen = function(id) {
  origShowScreen(id);
  const fab = document.getElementById('supportFab');
  if (fab) fab.classList.toggle('visible', id === 'screenCarga');
};

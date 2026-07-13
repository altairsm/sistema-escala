// ==================== AUTH HELPERS ====================
function getToken() { return sessionStorage.getItem('token') || localStorage.getItem('token'); }
function setToken(t) { localStorage.setItem('token', t); sessionStorage.setItem('token', t); }
function getUser() { try { return JSON.parse(sessionStorage.getItem('user') || localStorage.getItem('user') || 'null'); } catch { return null; } }
function setUser(u) { const s = JSON.stringify(u); localStorage.setItem('user', s); sessionStorage.setItem('user', s); }
function clearAuth() { localStorage.removeItem('token'); localStorage.removeItem('user'); sessionStorage.clear(); }

// ==================== CONFIG ====================
const API = '/api';
let user = null;
let romaneio = null;
let entregas = [];
let chatwootConfig = null;

// ==================== INIT ====================
(function init() {
  user = getUser();
  if (!user || !getToken()) { window.location.href = 'index.html'; return; }
  if (user.funcao !== 'motorista') { window.location.href = 'index.html'; return; }
  document.getElementById('userInfo').textContent = user.nome || user.email;
  loadChatwootConfig().then(() => initChatwootWidget());
  loadRomaneioAtual();
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
  ['screenHome', 'screenCarga', 'screenImport', 'screenChat'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
  const showBack = id === 'screenCarga' || id === 'screenImport';
  document.getElementById('btnBack').classList.toggle('hidden', !showBack);
  document.querySelector('.driver-header').classList.toggle('hidden', id === 'screenChat');
  const titles = { screenHome: 'Entregas', screenCarga: 'Entregas', screenImport: 'Importar Carga', screenChat: 'WhatsApp' };
  document.getElementById('driverTitle').textContent = titles[id] || 'Entregas';
  if (id !== 'screenCarga') pararPollEntregas();
}

function goHome() {
  if (currentChatId) { closeChat(); return; }
  pararPollEntregas();
  showScreen('screenHome');
  entregas = [];
  loadRomaneioAtual();
}

function logout() {
  clearAuth();
  window.location.href = 'index.html';
}

// ==================== ROMANEIOS ====================
async function loadRomaneioAtual() {
  showScreen('screenHome');
  const data = await api('/motorista/romaneio/atual');
  if (!data) { showToast('Erro ao carregar romaneio'); return; }
  romaneio = data.romaneio;
  entregas = data.entregas || [];
  renderHome();
}

function renderHome() {
  const container = document.getElementById('homeContent');
  if (!romaneio) {
    container.innerHTML = `
      <div class="home-card">
        <h2>🚚 Romaneio</h2>
        <p class="home-subtitle">Nenhum romaneio aberto</p>
        <div style="text-align:center;padding:20px 0">
          <p style="color:#888;margin-bottom:16px">Importe uma carga para criar um romaneio com as entregas.</p>
          <button class="btn-primary-driver btn-full" onclick="abrirImportarCarga()">Importar Carga</button>
        </div>
        <div class="logout-row"><button onclick="logout()">Sair</button></div>
      </div>
    `;
    return;
  }

  const pendentes = entregas.filter(e => e.confirma_entrega === null).length;
  const sucesso = entregas.filter(e => e.confirma_entrega === true).length;
  const falhas = entregas.filter(e => e.confirma_entrega === false).length;
  const total = entregas.length;

  container.innerHTML = `
    <div class="home-card">
      <h2>📋 ${romaneio.numero}</h2>
      <p class="home-subtitle">Romaneio aberto</p>
      <div class="stats">
        <div class="stat-card pendente"><div class="num">${pendentes}</div><div class="label">Pendentes</div></div>
        <div class="stat-card ok"><div class="num">${sucesso}</div><div class="label">Sucesso</div></div>
        <div class="stat-card falha"><div class="num">${falhas}</div><div class="label">Insucesso</div></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn-primary-driver btn-full" onclick="verEntregas()">Ver Entregas (${pendentes})</button>
        <button class="btn-outline btn-full" style="border-color:#1a73e8;color:#1a73e8;padding:14px;font-size:16px;font-weight:600;border-radius:12px" onclick="abrirImportarCarga()">+ Importar Carga</button>
      </div>
      <div class="logout-row"><button onclick="logout()">Sair</button></div>
    </div>
  `;
}

// ==================== IMPORTAR CARGA ====================
window.abrirImportarCarga = function() {
  showScreen('screenImport');
  document.getElementById('importContent').innerHTML = `
    <div class="home-card">
      <h2>📦 Importar Carga</h2>
      <p class="home-subtitle">Digite o número da carga para visualizar as entregas</p>
      <div class="add-carga-row" style="margin-bottom:12px">
        <input type="text" id="inputImportCarga" placeholder="Nº da Carga" inputmode="numeric" autocomplete="off">
        <button class="btn-add-carga" onclick="buscarCargaImport()">Buscar</button>
      </div>
      <div id="importPreview"></div>
    </div>
  `;
  document.getElementById('inputImportCarga').focus();
  document.getElementById('inputImportCarga').addEventListener('keydown', e => {
    if (e.key === 'Enter') buscarCargaImport();
  });
};

let importEntregaIds = [];

window.buscarCargaImport = async function() {
  const num = document.getElementById('inputImportCarga').value.trim();
  if (!num) { showToast('Digite o número da carga'); return; }
  const preview = document.getElementById('importPreview');
  preview.innerHTML = '<div class="loading">Buscando</div>';

  const data = await api(`/motorista/carga/${encodeURIComponent(num)}/preview`);
  if (!data) { preview.innerHTML = ''; return; }
  if (data.error) { preview.innerHTML = `<div class="empty-state"><p>${data.error}</p></div>`; return; }

  const entregasCarga = data.entregas || [];
  if (entregasCarga.length === 0) {
    preview.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>Nenhuma entrega pendente nesta carga</p></div>';
    return;
  }

  importEntregaIds = entregasCarga.map(e => e.id);

  preview.innerHTML = `
    <p style="font-size:13px;color:#888;margin:8px 0 12px">${entregasCarga.length} entrega(s) encontrada(s) na carga ${data.carga.carga}</p>
    <div style="max-height:400px;overflow-y:auto">
      ${entregasCarga.map((e, i) => {
        const jaVinculado = e.em_romaneio && e.em_romaneio.status === 'aberto';
        const disabled = jaVinculado && !e.em_romaneio.mesmo_motorista;
        return `
        <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#f8f9fa;border-radius:8px;margin-bottom:6px;${disabled ? 'opacity:.5' : ''}">
          <input type="checkbox" class="import-checkbox" data-id="${e.id}" checked ${disabled ? 'disabled' : ''} style="width:18px;height:18px;flex-shrink:0">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:14px">NF ${e.nf || '—'} ${jaVinculado ? `<span style="font-size:11px;color:#e37400">(já em ${e.em_romaneio.numero})</span>` : ''}</div>
            <div style="font-size:12px;color:#666">${e.cliente || '—'} · 📦 ${e.qtd_volumes || 1} vol · 💰 R$ ${parseFloat(e.valor_nf || 0).toFixed(2)}</div>
          </div>
        </label>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn-outline btn-full" style="padding:12px;font-size:14px;font-weight:600;border-radius:10px" onclick="goHome()">Cancelar</button>
      <button class="btn-primary-driver btn-full" onclick="adicionarAoRomaneio()" style="padding:12px;font-size:14px">Adicionar ao Romaneio</button>
    </div>
  `;

  // Atualiza lista ao desmarcar
  preview.querySelectorAll('.import-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      importEntregaIds = [...preview.querySelectorAll('.import-checkbox:checked')].map(c => parseInt(c.dataset.id));
    });
  });
};

window.adicionarAoRomaneio = async function() {
  if (importEntregaIds.length === 0) { showToast('Selecione pelo menos uma entrega'); return; }
  const data = await api('/motorista/romaneio', {
    method: 'POST',
    body: JSON.stringify({ entrega_ids: importEntregaIds }),
  });
  if (!data) return;
  if (data.error) { showToast(data.error); return; }
  showToast(`${data.entregas_vinculadas.length} entrega(s) adicionada(s) ao romaneio ${data.romaneio.numero}`);
  await loadRomaneioAtual();
};

// ==================== VER ENTREGAS ====================
window.verEntregas = async function() {
  if (!romaneio) { showToast('Nenhum romaneio aberto'); return; }
  showScreen('screenCarga');
  showLoading(true);
  const data = await api('/motorista/minhas-entregas');
  if (!data) { goHome(); return; }
  if (!Array.isArray(data)) { goHome(); return; }
  entregas = data;
  entregas.sort((a, b) => {
    if (a.has_recent_contact_message && !b.has_recent_contact_message) return -1;
    if (!a.has_recent_contact_message && b.has_recent_contact_message) return 1;
    return 0;
  });
  if (entregas.length === 0) {
    document.getElementById('cargaContent').innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>Todas as entregas foram finalizadas!</p></div>';
    return;
  }
  renderCarga();
  iniciarPollEntregas();
};

async function recarregarEntregas() {
  const data = await api('/motorista/minhas-entregas');
  if (!data || !Array.isArray(data)) return;
  data.sort((a, b) => {
    if (a.has_recent_contact_message && !b.has_recent_contact_message) return -1;
    if (!a.has_recent_contact_message && b.has_recent_contact_message) return 1;
    return 0;
  });
  entregas = data;
  const container = document.getElementById('cargaContent');
  if (entregas.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>Todas as entregas foram finalizadas!</p></div>';
    return;
  }
  renderCarga();
}

let pollEntregasTimer = null;

function iniciarPollEntregas() {
  pararPollEntregas();
  pollEntregasTimer = setInterval(recarregarEntregas, 15000);
}

function pararPollEntregas() {
  if (pollEntregasTimer) {
    clearInterval(pollEntregasTimer);
    pollEntregasTimer = null;
  }
}

// ==================== RENDER ====================
function renderCarga() {
  const container = document.getElementById('cargaContent');
  const pendentes = entregas.filter(e => e.confirma_entrega === null).length;
  const falhas = entregas.filter(e => e.confirma_entrega === false).length;
  const total = entregas.length;

  let html = `
    <div class="carga-header">
      <div>
        <h2>📋 ${romaneio?.numero || ''}</h2>
        <div style="font-size:12px;color:#888">${total} entrega(s) · ${pendentes} pendente(s)</div>
      </div>
      <span class="badge">${pendentes} pendentes</span>
    </div>
    <div class="stats">
      <div class="stat-card pendente"><div class="num">${pendentes}</div><div class="label">Pendentes</div></div>
      <div class="stat-card ok"><div class="num">${entregas.filter(e => e.confirma_entrega === true).length}</div><div class="label">Sucesso</div></div>
      <div class="stat-card falha"><div class="num">${falhas}</div><div class="label">Insucesso</div></div>
    </div>
  `;

  entregas.forEach(e => {
    const status = e.confirma_entrega === null ? 'pendente' : 'insucesso';
    const statusLabel = e.confirma_entrega === null ? 'Pendente' : '✗ Insucesso';
    const done = e.confirma_entrega !== null;
    const endereco = [e.bairro, e.cidade].filter(Boolean).join(' - ') || '—';
    const chatwootAvailable = chatwootConfig && e.whatsapp_jid;

    html += `
      <div class="entrega-card${e.has_recent_contact_message ? ' recent-message' : ''}" data-id="${e.id}" data-status="${status}">
        <div class="card-header">
          <span class="nf-num">NF ${e.nf || '—'}${e.has_recent_contact_message ? '<span class="recent-badge">💬 Nova mensagem</span>' : ''}</span>
          <span class="status-badge ${status}">${statusLabel}</span>
        </div>
        <div style="font-size:11px;color:#888;margin:2px 0 4px">Carga ${e.fc || '—'}</div>
        <div class="cliente">${e.cliente || '—'}</div>
        <div class="endereco">📍 ${endereco}</div>
        <div class="highlight-row">
          <span class="highlight-item">📦 <strong>${e.qtd_volumes || 1}</strong> vol</span>
          <span class="highlight-item">💰 <strong>R$ ${parseFloat(e.valor_nf || 0).toFixed(2)}</strong></span>
        </div>
        <div class="info-row">
          <span>⚖️ ${parseFloat(e.peso_real || 0).toFixed(1)} kg</span>
          ${e.telefone ? `<span>📞 ${e.telefone}</span>` : ''}
        </div>
        ${chatwootAvailable ? `<button class="whatsapp-btn" onclick="openChat(${e.id})">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-1.102-1.02-1.848-2.295-2.065-2.682-.217-.387-.023-.597.163-.791.167-.174.372-.454.559-.681.186-.227.248-.389.372-.648.124-.259.062-.484-.031-.679-.093-.195-.67-1.617-.92-2.215-.242-.58-.487-.48-.67-.49-.173-.01-.372-.012-.571-.012-.199 0-.523.074-.796.372-.273.298-1.043 1.02-1.043 2.488 0 1.468 1.069 2.886 1.217 3.085.149.199 2.101 3.207 5.09 4.401.71.284 1.264.454 1.696.581.712.21 1.36.18 1.872.109.571-.079 1.758-.718 2.006-1.413.248-.695.248-1.29.173-1.413-.074-.124-.272-.198-.57-.347zm-5.47 7.118h-.003a9.93 9.93 0 01-5.064-1.45l-.36-.214-3.775.992 1.008-3.682-.235-.374a9.865 9.865 0 01-1.517-5.26c.002-5.477 4.458-9.932 9.939-9.932 2.654 0 5.147 1.035 7.025 2.913 1.877 1.877 2.912 4.37 2.912 7.024 0 5.48-4.455 9.935-9.931 9.935z"/></svg>
          Conversar
        </button>` : ''}
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
  const check = await api(`/motorista/entrega/${id}/status`);
  if (check && check.processada) { showToast('Esta entrega já foi processada por outro motorista'); recarregarEntregas(); return; }
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
  if (!result || result.error) { if (result?.error) showToast(result.error); return; }
  const e = entregas.find(x => x.id === id);
  if (e) { e.confirma_entrega = true; e.latitude = body.latitude; e.longitude = body.longitude; }
  if (result.romaneio_finalizado) {
    showToast('✅ Romaneio finalizado! Todas as entregas foram processadas.');
    setTimeout(() => goHome(), 1500);
    return;
  }
  renderCarga();
  showToast('✅ Entrega confirmada com sucesso!');
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
  const id = insucessoId;
  const check = await api(`/motorista/entrega/${id}/status`);
  if (check && check.processada) { showToast('Esta entrega já foi processada por outro motorista'); fecharInsucesso(); recarregarEntregas(); return; }
  const body = { motivo };
  if ('geolocation' in navigator) {
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000, maximumAge: 30000 }));
      body.latitude = pos.coords.latitude;
      body.longitude = pos.coords.longitude;
    } catch {}
  }
  const result = await api(`/motorista/entregas/${id}/insucesso`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  fecharInsucesso();
  if (!result || result.error) { if (result?.error) showToast(result.error); return; }
  const e = entregas.find(x => x.id === id);
  if (e) { e.confirma_entrega = false; e.motivo_insucesso = motivo; e.latitude = body.latitude; e.longitude = body.longitude; }
  if (result.romaneio_finalizado) {
    showToast('✅ Romaneio finalizado! Todas as entregas foram processadas.');
    setTimeout(() => goHome(), 1500);
    return;
  }
  renderCarga();
  showToast('Inconsistência registrada');
};

// ==================== CHAT EMBUTIDO (WHATSAPP) ====================
let currentChatId = null;
let chatPollTimer = null;

window.openChat = async function(entregaId) {
  const e = entregas.find(x => x.id === entregaId);
  if (!e) return;

  currentChatId = entregaId;
  document.getElementById('chatHeaderName').textContent = e.cliente || 'WhatsApp';
  document.getElementById('chatHeaderStatus').textContent = `Motorista: ${user?.nome || '—'}`;
  document.getElementById('chatMessages').innerHTML = '<div class="chat-empty">Carregando mensagens...</div>';
  document.getElementById('chatInput').value = '';
  document.getElementById('chatSendBtn').disabled = true;
  setSupportBubbleVisible(false);
  showScreen('screenChat');

  await fetchMessages();
  startChatPoll();

  document.getElementById('chatInput').disabled = false;
  document.getElementById('chatInput').focus();
};

window.closeChat = function() {
  stopChatPoll();
  currentChatId = null;
  showScreen('screenCarga');
  setSupportBubbleVisible(true);
  iniciarPollEntregas();
};

function setSupportBubbleVisible(show) {
  if (window.$chatwoot) {
    try {
      if (typeof window.$chatwoot.toggleBubbleVisibility === 'function') {
        window.$chatwoot.toggleBubbleVisibility(show ? 'show' : 'hide');
      }
      if (!show && typeof window.$chatwoot.toggle === 'function') {
        window.$chatwoot.toggle('close');
      }
    } catch (e) {}
  }
  const sel = '.woot-widget-holder, .woot--widget-holder, .woot--bubble-holder, [class*="woot-widget"], [class*="woot--bubble"]';
  document.querySelectorAll(sel).forEach(el => {
    if (show) {
      el.style.removeProperty('display');
      el.style.removeProperty('visibility');
      el.style.removeProperty('opacity');
      el.style.removeProperty('pointer-events');
    } else {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('opacity', '0', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    }
  });
}

async function fetchMessages() {
  if (!currentChatId) return;
  const msgs = await api(`/motorista/entregas/${currentChatId}/mensagens`);
  const container = document.getElementById('chatMessages');
  if (!msgs || msgs.length === 0) {
    container.innerHTML = '<div class="chat-empty">Nenhuma mensagem ainda. Envie uma mensagem para iniciar a conversa.</div>';
    return;
  }
  container.innerHTML = '';
  msgs.forEach(m => renderMessage(m));
  container.scrollTop = container.scrollHeight;
}

function renderMessage(msg) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + (msg.message_type === 1 ? 'from-motorista' : 'from-cliente');
  div.dataset.msgId = msg.id;
  const time = msg.created_at ? new Date(msg.created_at * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  div.innerHTML = `<div>${escapeHtml(msg.content || '')}</div><div class="msg-time">${time}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

window.sendMessage = async function() {
  const input = document.getElementById('chatInput');
  const content = input.value.trim();
  if (!content || !currentChatId) return;

  input.value = '';
  document.getElementById('chatSendBtn').disabled = true;

  const msg = await api(`/motorista/entregas/${currentChatId}/mensagens`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });

  if (msg && msg.id) {
    renderMessage(msg);
  } else {
    showToast('Erro ao enviar mensagem');
  }
  input.focus();
};

function stopChatPoll() {
  if (chatPollTimer) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
}

function startChatPoll() {
  stopChatPoll();
  chatPollTimer = setInterval(async () => {
    if (currentChatId) {
      const msgs = await api(`/motorista/entregas/${currentChatId}/mensagens`);
      if (!msgs) return;
      const container = document.getElementById('chatMessages');
      const existingIds = new Set();
      container.querySelectorAll('.chat-msg').forEach(el => {
        const id = el.dataset.msgId;
        if (id) existingIds.add(id);
      });
      msgs.forEach(m => {
        if (!existingIds.has(String(m.id))) {
          renderMessage(m);
        }
      });
    }
  }, 15000);
}

// Enable/disable send button based on input
(function() {
  const input = document.getElementById('chatInput');
  const btn = document.getElementById('chatSendBtn');
  if (input && btn) {
    input.addEventListener('input', () => {
      btn.disabled = !input.value.trim();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !btn.disabled) {
        sendMessage();
      }
    });
  }
})();

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// ==================== CHATWOOT WIDGET SUPORTE ====================
function initChatwootWidget() {
  if (!chatwootConfig || !chatwootConfig.suporte_website_token) {
    return;
  }
  if (window.$chatwoot) return;

  window.chatwootSettings = {
    position: "right",
    type: "standard",
    launcherTitle: "Fale suporte a entrega",
  };

  const BASE_URL = chatwootConfig.api_url || "https://app.sactudo.com.br";
  const g = document.createElement("script");
  g.src = BASE_URL + "/packs/js/sdk.js";
  g.async = true;
  document.body.appendChild(g);
  g.onload = function () {
    window.chatwootSDK.run({
      websiteToken: chatwootConfig.suporte_website_token,
      baseUrl: BASE_URL,
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

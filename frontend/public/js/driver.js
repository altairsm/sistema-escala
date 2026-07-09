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
  ['screenHome', 'screenCarga', 'screenChat'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
  document.getElementById('btnBack').classList.toggle('hidden', id === 'screenHome' || id === 'screenChat');
  const title = id === 'screenHome' ? 'Entregas' : (id === 'screenChat' ? 'WhatsApp' : `Carga ${document.getElementById('inputCarga').value || ''}`);
  document.getElementById('driverTitle').textContent = title;
}

function goHome() {
  if (currentChatId) { closeChat(); return; }
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

// ==================== CHAT EMBUTIDO (WHATSAPP) ====================
let currentChatId = null;
let chatPollTimer = null;

window.openChat = async function(entregaId) {
  const e = entregas.find(x => x.id === entregaId);
  if (!e) return;

  currentChatId = entregaId;
  document.getElementById('chatHeaderName').textContent = e.cliente || 'WhatsApp';
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
};

function setSupportBubbleVisible(show) {
  if (window.$chatwoot && typeof window.$chatwoot.toggleBubbleVisibility === 'function') {
    window.$chatwoot.toggleBubbleVisibility(show);
    return;
  }
  const id = 'chatwoot-bubble-style';
  if (!show) {
    if (!document.getElementById(id)) {
      const s = document.createElement('style');
      s.id = id;
      s.textContent = '.woot--bubble-holder, .woot--widget-holder { display: none !important; }';
      document.head.appendChild(s);
    }
  } else {
    document.getElementById(id)?.remove();
  }
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

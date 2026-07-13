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
  loadMinhasCargas();
  document.getElementById('inputNovaCarga').addEventListener('keydown', e => {
    if (e.key === 'Enter') adicionarCarga();
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
  document.getElementById('btnBack').classList.toggle('hidden', id !== 'screenCarga');
  document.querySelector('.driver-header').classList.toggle('hidden', id === 'screenChat');
  const title = id === 'screenHome' ? 'Entregas' : (id === 'screenChat' ? 'WhatsApp' : 'Entregas');
  document.getElementById('driverTitle').textContent = title;
  if (id !== 'screenCarga') pararPollEntregas();
}

function goHome() {
  if (currentChatId) { closeChat(); return; }
  pararPollEntregas();
  showScreen('screenHome');
  entregas = [];
  loadMinhasCargas();
}

function logout() {
  clearAuth();
  window.location.href = 'index.html';
}

// ==================== MINHAS CARGAS ====================
let minhasCargas = [];

async function loadMinhasCargas() {
  showScreen('screenHome');
  const data = await api('/motorista/minhas-cargas');
  if (!data || !Array.isArray(data)) { showToast('Erro ao carregar cargas'); return; }
  minhasCargas = data;
  renderHome();
}

const STATUS_LABELS = {
  1: { label: 'Em programação', color: '#1a73e8' },
  2: { label: 'Com equipe', color: '#e37400' },
  3: { label: 'Em rota', color: '#34a853' },
  4: { label: 'Parcial', color: '#f9ab00' },
  5: { label: 'Parcial', color: '#f9ab00' },
  6: { label: 'Concluída', color: '#999' },
};

function renderHome() {
  const list = document.getElementById('cargasList');
  if (minhasCargas.length === 0) {
    list.innerHTML = '<div class="empty-cargas">Nenhuma carga associada ainda.<br>Adicione uma carga abaixo.</div>';
    return;
  }
  list.innerHTML = minhasCargas.map(c => {
    const st = STATUS_LABELS[c.status] || STATUS_LABELS[4];
    return `
    <div class="carga-item">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="width:12px;height:12px;border-radius:50%;background:${st.color};flex-shrink:0"></span>
        <div>
          <div class="carga-num">${c.carga}</div>
          <div style="font-size:11px;color:#888">${st.label} · ${c.pendentes} pendente${c.pendentes !== 1 ? 's' : ''}${c.insucesso > 0 ? `, ${c.insucesso} insucesso${c.insucesso !== 1 ? 's' : ''}` : ''}</div>
        </div>
      </div>
      ${c.status !== 6 ? `<button class="remove-btn" onclick="removerCarga('${c.carga}')" title="Remover carga">×</button>` : ''}
    </div>`;
  }).join('');
}

window.adicionarCarga = async function() {
  const num = document.getElementById('inputNovaCarga').value.trim();
  if (!num) { showToast('Digite o número da carga'); return; }
  document.getElementById('inputNovaCarga').value = '';
  document.getElementById('inputNovaCarga').disabled = true;

  const data = await api('/motorista/carga/associar', {
    method: 'POST',
    body: JSON.stringify({ carga: num }),
  });

  document.getElementById('inputNovaCarga').disabled = false;
  document.getElementById('inputNovaCarga').focus();

  if (!data) return;

  if (data.error) {
    showToast(data.error);
    return;
  }

  if (data.status === 'conflict') {
    mostrarModalConflito(data.carga, data.current_motorista, async () => {
      const forceData = await api('/motorista/carga/associar', {
        method: 'POST',
        body: JSON.stringify({ carga: num, force: true }),
      });
      if (forceData && forceData.status === 'ok') {
        showToast(`Carga ${num} associada com sucesso!`);
        await loadMinhasCargas();
      }
    });
    return;
  }

  if (data.status === 'ok') {
    showToast(`Carga ${num} associada com sucesso!`);
    await loadMinhasCargas();
  }
};

window.removerCarga = async function(numero) {
  const data = await api(`/motorista/carga/${encodeURIComponent(numero)}`, { method: 'DELETE' });
  if (!data) return;
  showToast(`Carga ${numero} removida`);
  await loadMinhasCargas();
};

window.verEntregas = async function() {
  if (minhasCargas.length === 0) {
    showToast('Adicione pelo menos uma carga primeiro');
    return;
  }
  document.getElementById('inputNovaCarga').disabled = true;
  showScreen('screenCarga');
  showLoading(true);
  const data = await api('/motorista/minhas-entregas');
  document.getElementById('inputNovaCarga').disabled = false;
  if (!data) { showScreen('screenHome'); return; }
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

function mostrarModalConflito(carga, motorista, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'insucesso-modal-overlay';
  overlay.id = 'conflitoOverlay';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="insucesso-modal">
      <h3>⚠️ Carga já associada</h3>
      <p style="font-size:14px;color:#555;margin:12px 0;line-height:1.5">
        A carga <strong>${carga}</strong> já está associada a <strong>${motorista}</strong>.
        Deseja assumir esta carga?
      </p>
      <div class="btn-row">
        <button class="btn-outline" onclick="this.closest('.insucesso-modal-overlay').remove()">Não</button>
        <button class="btn-danger-driver" onclick="this.closest('.insucesso-modal-overlay').remove(); onConfirmCarga()">Sim, assumir</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  window.onConfirmCarga = onConfirm;
}

// ==================== RENDER ====================
function renderCarga() {
  const container = document.getElementById('cargaContent');
  const total = entregas.length;
  const falhas = entregas.filter(e => e.confirma_entrega === false).length;
  const pendentes = total - falhas;
  const cargasUnicas = [...new Set(entregas.map(e => e.fc).filter(Boolean))];

  let html = `
    <div class="carga-header">
      <h2>${cargasUnicas.length > 1 ? `Cargas ${cargasUnicas.join(', ')}` : `Carga ${cargasUnicas[0] || ''}`}</h2>
      <span class="badge">${total} pendentes</span>
    </div>
    <div class="stats">
      <div class="stat-card pendente"><div class="num">${pendentes}</div><div class="label">Pendentes</div></div>
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
        ${cargasUnicas.length > 1 ? `<div style="font-size:11px;color:#888;margin:2px 0 4px">Carga ${e.fc || '—'}</div>` : ''}
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

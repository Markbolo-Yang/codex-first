'use strict';

const state = { token: '', page: 0, pageSize: 30, hasMore: false, list: [], selected: null, searchTimer: null };
const elements = {};

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function statusBadge(status) {
  return element('span', `status-badge status-${status === 'processed' ? 'processed' : 'pending'}`, status === 'processed' ? '已处理' : '待处理');
}

function readToken() {
  const hashToken = decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
  if (hashToken) {
    sessionStorage.setItem('consultAdminToken', hashToken);
    history.replaceState(null, '', window.location.pathname);
    return hashToken;
  }
  return sessionStorage.getItem('consultAdminToken') || '';
}

async function api(path, options = {}) {
  const response = await fetch(`/api/admin/consults${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}`, ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({ code: -1, msg: '服务器返回格式错误' }));
  if (!response.ok || payload.code !== 0) {
    if (response.status === 401) sessionStorage.removeItem('consultAdminToken');
    throw new Error(payload.msg || '请求失败');
  }
  return payload.data;
}

function showMessage(message) {
  elements.message.textContent = message || '';
  elements.message.hidden = !message;
}

function appendCell(row, className, text) {
  row.append(element('td', className, text || '-'));
}

function openProcessDialog(consult) {
  state.selected = consult;
  elements.dialogSummary.textContent = `${consult.consultType || '未分类'} · ${consult.content || '未填写具体诉求'}`;
  elements.remarkInput.value = consult.remark || '';
  elements.processDialog.showModal();
}

function renderTable() {
  elements.consultTableBody.replaceChildren();
  elements.mobileCards.replaceChildren();
  state.list.forEach(consult => {
    const row = element('tr');
    appendCell(row, '', consult.createTime);
    appendCell(row, '', consult.consultType);
    appendCell(row, 'content-cell', consult.content);
    appendCell(row, 'openid-cell', consult._openid);
    const statusCell = element('td');
    statusCell.append(statusBadge(consult.status));
    row.append(statusCell);
    appendCell(row, 'remark-cell', consult.remark);
    const actionCell = element('td');
    if (consult.status !== 'processed') {
      const button = element('button', 'link-button', '标记已处理');
      button.type = 'button';
      button.addEventListener('click', () => openProcessDialog(consult));
      actionCell.append(button);
    } else actionCell.textContent = '—';
    row.append(actionCell);
    elements.consultTableBody.append(row);

    const card = element('article', 'mobile-card');
    const cardHead = element('div', 'mobile-card-head');
    cardHead.append(element('span', 'mobile-category', consult.consultType || '未分类'), statusBadge(consult.status));
    card.append(cardHead, element('div', 'mobile-content', consult.content || '未填写具体诉求'));
    card.append(element('div', 'mobile-meta', `提交时间：${consult.createTime || '-'}`));
    card.append(element('div', 'mobile-meta', `OpenID：${consult._openid || '-'}`));
    card.append(element('div', 'mobile-meta', `客服备注：${consult.remark || '-'}`));
    if (consult.status !== 'processed') {
      const button = element('button', 'link-button', '标记已处理');
      button.type = 'button';
      button.addEventListener('click', () => openProcessDialog(consult));
      card.append(button);
    }
    elements.mobileCards.append(card);
  });

  elements.desktopTable.hidden = state.list.length === 0;
  elements.empty.hidden = state.list.length > 0;
  elements.pageLabel.textContent = `第 ${state.page + 1} 页`;
  elements.previousButton.disabled = state.page === 0;
  elements.nextButton.disabled = !state.hasMore;
}

async function loadConsults() {
  showMessage('');
  elements.loading.hidden = false;
  elements.empty.hidden = true;
  try {
    const params = new URLSearchParams({
      page: state.page,
      pageSize: state.pageSize,
      status: elements.statusSelect.value,
      search: elements.searchInput.value.trim()
    });
    const data = await api(`/list?${params}`);
    state.list = data.list;
    state.hasMore = data.hasMore;
    renderTable();
  } catch (error) {
    state.list = [];
    renderTable();
    showMessage(error.message);
    if (!sessionStorage.getItem('consultAdminToken')) {
      elements.workspace.hidden = true;
      elements.accessPanel.hidden = false;
    }
  } finally {
    elements.loading.hidden = true;
  }
}

function bindEvents() {
  elements.accessForm.addEventListener('submit', event => {
    event.preventDefault();
    state.token = elements.tokenInput.value.trim();
    sessionStorage.setItem('consultAdminToken', state.token);
    elements.accessPanel.hidden = true;
    elements.workspace.hidden = false;
    loadConsults();
  });
  elements.refreshButton.addEventListener('click', () => loadConsults());
  elements.statusSelect.addEventListener('change', () => { state.page = 0; loadConsults(); });
  elements.searchInput.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => { state.page = 0; loadConsults(); }, 350);
  });
  elements.previousButton.addEventListener('click', () => { if (state.page > 0) { state.page -= 1; loadConsults(); } });
  elements.nextButton.addEventListener('click', () => { if (state.hasMore) { state.page += 1; loadConsults(); } });
  elements.closeDialogButton.addEventListener('click', () => elements.processDialog.close());
  elements.cancelButton.addEventListener('click', () => elements.processDialog.close());
  elements.processForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!state.selected) return;
    elements.confirmButton.disabled = true;
    try {
      await api(`/${encodeURIComponent(state.selected._id)}/process`, {
        method: 'POST', body: JSON.stringify({ remark: elements.remarkInput.value })
      });
      elements.processDialog.close();
      await loadConsults();
    } catch (error) {
      window.alert(error.message);
    } finally {
      elements.confirmButton.disabled = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  for (const id of ['accessPanel', 'accessForm', 'tokenInput', 'workspace', 'refreshButton', 'searchInput', 'statusSelect', 'message', 'loading', 'empty', 'desktopTable', 'consultTableBody', 'mobileCards', 'previousButton', 'nextButton', 'pageLabel', 'processDialog', 'processForm', 'dialogSummary', 'remarkInput', 'closeDialogButton', 'cancelButton', 'confirmButton']) {
    elements[id] = document.getElementById(id);
  }
  bindEvents();
  state.token = readToken();
  elements.accessPanel.hidden = Boolean(state.token);
  elements.workspace.hidden = !state.token;
  if (state.token) loadConsults();
});

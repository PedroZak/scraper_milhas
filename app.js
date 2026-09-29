const STORAGE_KEY = 'milhas:promocoes';
const UPDATED_KEY = 'milhas:atualizado';
const DATA_URL = './promocoes.json';

const $alertas = document.getElementById('alertas');
const $tabela = document.getElementById('tabela');
const $status = document.getElementById('status');

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {}
}

function loadStored() {
  try {
    const data = JSON.parse(storageGet(STORAGE_KEY));
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function isTransfer(promo) {
  const title = (promo.titulo || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /transfer|transfir/.test(title);
}

function formatDate(iso) {
  const date = new Date(iso);
  if (isNaN(date)) return '';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

function safeHref(link) {
  return /^https?:\/\//i.test(link) ? link : '#';
}

// Títulos vêm de feeds externos: sempre textContent, nunca innerHTML.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function alertCard(promo) {
  const card = el('a', 'snap-start shrink-0 w-64 rounded-lg bg-white/10 hover:bg-white/20 p-3 block');
  card.href = safeHref(promo.link);
  card.target = '_blank';
  card.rel = 'noopener noreferrer';
  card.append(
    el('p', 'text-sm font-medium leading-snug line-clamp-3', promo.titulo),
    el('p', 'mt-2 text-xs text-blue-200', `${formatDate(promo.data)} · ${promo.fonte || ''}`)
  );
  return card;
}

function tableRow(promo) {
  const row = el('tr', 'hover:bg-slate-50');
  const link = el('a', 'text-blue-700 hover:underline', promo.titulo);
  link.href = safeHref(promo.link);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';

  const title = el('td', 'px-3 py-2');
  title.append(link, el('div', 'sm:hidden text-xs text-slate-400 mt-0.5', promo.fonte || ''));

  row.append(
    el('td', 'px-3 py-2 whitespace-nowrap text-slate-500', formatDate(promo.data)),
    title,
    el('td', 'px-3 py-2 hidden sm:table-cell text-slate-500', promo.fonte || '')
  );
  return row;
}

function emptyRow(message) {
  const row = el('tr');
  const cell = el('td', 'px-3 py-6 text-center text-slate-400', message);
  cell.colSpan = 3;
  row.append(cell);
  return row;
}

function render(promos) {
  const transfers = promos.filter(isTransfer);
  const others = promos.filter((p) => !isTransfer(p));

  $alertas.replaceChildren(
    ...(transfers.length
      ? transfers.map(alertCard)
      : [el('p', 'text-sm text-blue-200', 'Nenhum alerta de transferência no momento.')])
  );
  $tabela.replaceChildren(...(others.length ? others.map(tableRow) : [emptyRow('Nenhuma promoção encontrada.')]));
}

function showStatus(message) {
  $status.textContent = message;
}

function updatedLabel() {
  const stored = storageGet(UPDATED_KEY);
  return stored ? `Atualizado em ${formatDate(stored)}` : '';
}

async function refresh() {
  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Formato inesperado');

    storageSet(STORAGE_KEY, JSON.stringify(data));
    storageSet(UPDATED_KEY, new Date().toISOString());
    render(data);
    showStatus(updatedLabel());
  } catch (_) {
    showStatus(`Sem conexão · dados salvos. ${updatedLabel()}`.trim());
  }
}

// A) offline-first: pinta o que já está no localStorage
render(loadStored());
showStatus(updatedLabel() || 'Buscando dados…');

// B) busca dados novos e re-renderiza
refresh();

// C) Service Worker
window.addEventListener('load', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW não registrado:', err));
  }
});

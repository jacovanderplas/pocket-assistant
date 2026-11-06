'use strict';

/* Pocket – a small personal assistant: shopping list, to-dos, appointments.
   Everything is stored in localStorage on this device. */

const VERSION = '1.1.0';
const KEY = 'pocket.v1';
const TAB_KEY = 'pocket.tab';
const LOCALE = 'en-GB'; // English text, day-month dates, 24h clock

/* ===================== helpers ===================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayISO = () => iso(new Date());
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };

function dayLabel(s) {
  const t = todayISO();
  if (s === t) return 'Today';
  if (s === addDays(t, 1)) return 'Tomorrow';
  if (s === addDays(t, -1)) return 'Yesterday';
  const d = parseISO(s);
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(LOCALE, opts);
}
function fmtTime(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}
const byDue = (a, b) => (a.due || '').localeCompare(b.due || '') || a.created - b.created;
const byWhen = (a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''));
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/* ===================== storage ===================== */
const blank = () => ({ version: 1, shopping: [], todos: [], appts: [], history: [], recipes: [], prefs: {} });

function normalize(d) {
  const out = blank();
  if (d.prefs && typeof d.prefs === 'object') out.prefs = { ...d.prefs };
  for (const k of ['shopping', 'todos', 'appts', 'recipes']) {
    if (Array.isArray(d[k])) {
      out[k] = d[k].filter(x => x && typeof x === 'object').map(x => ({ ...x, id: String(x.id || uid()) }));
    }
  }
  if (Array.isArray(d.history)) out.history = d.history.filter(s => typeof s === 'string').slice(0, 200);
  return out;
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && typeof d === 'object') return normalize(d);
  } catch (e) { /* fall through */ }
  return blank();
}
let db = load();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('Could not save – storage is full or blocked'); }
}
function commit() { persist(); render(); }

const find = (kind, id) => db[kind].find(x => x.id === id);

function removeWithUndo(kind, id, msg) {
  const snapshot = JSON.stringify(db);
  db[kind] = db[kind].filter(x => x.id !== id);
  commit();
  toast(msg, () => { db = normalize(JSON.parse(snapshot)); commit(); });
}

function remember(name) {
  const n = name.trim();
  if (!n) return;
  db.history = [n, ...db.history.filter(h => h.toLowerCase() !== n.toLowerCase())].slice(0, 200);
}

/* ===================== recipes & ingredients ===================== */
// Things most kitchens already have: shown in the list but unticked by default.
const PANTRY = /^(salt|pepper|black pepper|salt and pepper|olive oil|oil|vegetable oil|sunflower oil|water|sugar)$/i;
const METRIC = ['g', 'kg', 'ml', 'l', 'dl', 'cl'];
// Units you buy whole – never ask for half a can.
const WHOLE_UNITS = ['can', 'tin', 'jar', 'pack', 'bottle', 'head', 'ball', 'sheet', 'bunch', 'pinch', 'clove', 'stick', 'slice'];
const UNIT_RE = 'kg|g|ml|dl|cl|l|tbsp|tsp|cans?|tins?|jars?|cloves?|bunch(?:es)?|pinch(?:es)?|slices?|sheets?|sprigs?|heads?|balls?|sticks?|packs?|bottles?|cups?';
const NUM_RE = '\\d+(?:[.,]\\d+)?|\\d*[½¼¾]|\\d+\\/\\d+';
const ING_RE = new RegExp(`^(?:(${NUM_RE})\\s*(?:(${UNIT_RE})\\.?(?=\\s|$))?\\s*)?(.+)$`, 'i');
const QTY_RE = new RegExp(`^(${NUM_RE})\\s*(${UNIT_RE})?$`, 'i');

function parseNum(s) {
  if (!s) return null;
  const frac = { '½': 0.5, '¼': 0.25, '¾': 0.75 };
  const m = s.match(/^(\d*)([½¼¾])$/);
  if (m) return (m[1] ? Number(m[1]) : 0) + frac[m[2]];
  if (s.includes('/')) { const [a, b] = s.split('/').map(Number); return b ? a / b : null; }
  return parseFloat(s.replace(',', '.'));
}
const singularUnit = u => (u || '').toLowerCase()
  .replace(/^(bunch|pinch)es$/, '$1')
  .replace(/^(can|tin|jar|clove|slice|sheet|sprig|head|ball|stick|pack|bottle|cup)s$/, '$1');
const pluralUnit = (u, n) => (n <= 1 || METRIC.includes(u) || /^(tbsp|tsp)$/.test(u)) ? u : /^(bunch|pinch)$/.test(u) ? u + 'es' : u + 's';

function parseIngredient(line) {
  const m = String(line).trim().match(ING_RE);
  if (!m) return { n: null, unit: '', name: String(line).trim() };
  return { n: parseNum(m[1]), unit: singularUnit(m[2]), name: m[3].trim() };
}

function roundAmount(n, unit, wholeItems = false) {
  if (['kg', 'l', 'dl', 'cl'].includes(unit)) ({ n, unit } = toBase(n, unit)); // 0.25 kg reads better as 250 g
  if (unit === 'g' || unit === 'ml') {
    if (n >= 1000) return { n: Math.round(n / 100) / 10, unit: unit === 'g' ? 'kg' : 'l' };
    return { n: n >= 100 ? Math.round(n / 10) * 10 : Math.max(5, Math.round(n / 5) * 5), unit };
  }
  if (WHOLE_UNITS.includes(unit) || (!unit && wholeItems)) return { n: Math.max(1, Math.ceil(n - 0.01)), unit };
  if (unit) return { n: Math.max(0.25, Math.round(n * 4) / 4), unit };
  // whole items (eggs, onions…): halves below 2, then whole numbers
  return { n: n < 2 ? Math.max(0.5, Math.ceil(n * 2 - 0.01) / 2) : Math.ceil(n - 0.01), unit };
}
function fmtNumber(n) {
  const w = Math.floor(n), f = Math.round((n - w) * 100) / 100;
  if (!f) return String(w);
  const ch = { 0.25: '¼', 0.5: '½', 0.75: '¾' }[f];
  return ch ? (w || '') + ch : String(Math.round(n * 10) / 10);
}
function amountText({ n, unit }, compact = false) {
  if (n == null) return '';
  if (METRIC.includes(unit)) { const num = String(Math.round(n * 10) / 10); return compact ? num + unit : `${num} ${unit}`; }
  const num = fmtNumber(n);
  if (!unit) return num;
  return `${num} ${pluralUnit(unit, n)}`;
}

function scaledIngredients(r, servings) {
  const f = servings / (r.serves || 1);
  return (r.ingredients || []).map(line => {
    const p = parseIngredient(line);
    const amt = p.n == null ? null : roundAmount(p.n * f, p.unit, /\beggs?\b/i.test(p.name)); // no half eggs
    return { name: p.name, n: amt ? amt.n : null, unit: amt ? amt.unit : '', text: amt ? amountText(amt) : '', pantry: PANTRY.test(p.name) };
  });
}

const allRecipes = () => [...db.recipes.map(r => ({ ...r, mine: true })), ...BUILTIN_RECIPES];
const recipeById = id => allRecipes().find(r => r.id === id);
const recipeData = r => ({ id: r.id, name: r.name, serves: r.serves, time: r.time, veg: !!r.veg, ingredients: [...r.ingredients], steps: [...(r.steps || [])], mine: !!r.mine });
const matchesFilter = (r, f) => (f === 'veg' ? r.veg : f === 'quick' ? r.time <= 30 : true);

function suggestRecipe(filter, seen) {
  const all = allRecipes().filter(r => matchesFilter(r, filter));
  // Avoid what was cooked (or is planned) within three weeks either side of today.
  const t = todayISO(), from = addDays(t, -21), to = addDays(t, 21);
  const recent = new Set(db.appts.filter(a => a.recipe && a.date >= from && a.date <= to).map(a => a.recipe.id));
  let pool = all.filter(r => !seen.has(r.id) && !recent.has(r.id));
  if (!pool.length) pool = all.filter(r => !seen.has(r.id));
  if (!pool.length) { seen.clear(); pool = all; }
  return pool[Math.floor(Math.random() * pool.length)] || null;
}

// Grams and kilos (or ml and litres) can be added together.
function toBase(n, unit) {
  const f = { kg: ['g', 1000], l: ['ml', 1000], dl: ['ml', 100], cl: ['ml', 10] }[unit];
  return f ? { n: n * f[1], unit: f[0] } : { n, unit };
}
function mergeQty(oldQty, ing) {
  const add = ing.n == null ? '' : amountText(ing, true);
  if (!oldQty) return add;
  if (!add) return oldQty;
  const m = String(oldQty).trim().match(QTY_RE);
  if (m) {
    const a = toBase(parseNum(m[1]), singularUnit(m[2])), b = toBase(ing.n, ing.unit);
    if (a.unit === b.unit) return amountText(roundAmount(a.n + b.n, a.unit), true);
  }
  return `${oldQty} + ${add}`;
}

function addToShopping(items, label) {
  for (const ing of items) {
    const idx = db.shopping.findIndex(x => x.name.toLowerCase() === ing.name.toLowerCase());
    const ex = db.shopping[idx];
    if (ex && !ex.done) {
      ex.qty = mergeQty(ex.qty, ing);
      const notes = (ex.note || '').split(', ').filter(Boolean);
      if (!notes.includes(label)) ex.note = [...notes, label].join(', ');
    } else {
      if (ex) db.shopping.splice(idx, 1);
      db.shopping.push({ id: ex ? ex.id : uid(), name: ing.name, qty: ing.n == null ? '' : amountText(ing, true), note: label, done: false, doneAt: null, created: Date.now() });
    }
    remember(ing.name);
  }
  return items.length;
}

// Other tabs/windows of the app stay in sync.
window.addEventListener('storage', e => { if (e.key === KEY) { db = load(); render(); } });

/* ===================== tabs ===================== */
const TABS = ['today', 'shopping', 'todos', 'calendar'];
const TAB_TITLES = { shopping: 'Shopping', todos: 'To-dos', calendar: 'Calendar' };

function initialTab() {
  const h = location.hash.slice(1);
  if (TABS.includes(h)) return h;
  try { const t = localStorage.getItem(TAB_KEY); if (TABS.includes(t)) return t; } catch (e) { /* ignore */ }
  return 'today';
}
let tab = initialTab();

function setTab(t) {
  tab = t;
  try { localStorage.setItem(TAB_KEY, t); } catch (e) { /* ignore */ }
  history.replaceState(null, '', '#' + t);
  render();
  window.scrollTo(0, 0);
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/* ===================== render ===================== */
const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4 4 9-9.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  bag: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1.2 11.2a1.5 1.5 0 0 1-1.5 1.3H7.7a1.5 1.5 0 0 1-1.5-1.3L5 8z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="M3.5 6.5l1.6 1.6 2.6-2.8M3.5 12l1.6 1.6 2.6-2.8M3.5 17.5l1.6 1.6 2.6-2.8"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  pot: '<svg class="cook-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-6z"/><path d="M2 10h20M9 6.5c0-1 .8-1.5.8-2.5M14 6.5c0-1 .8-1.5.8-2.5"/></svg>',
};

function render() {
  const t = todayISO();
  document.body.dataset.tab = tab;
  $('#title').textContent = tab === 'today' ? greeting() : TAB_TITLES[tab];
  $('#eyebrow').textContent = new Date().toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
  for (const v of $$('.view')) v.hidden = v.dataset.view !== tab;
  for (const b of $$('.tabbar button')) {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  $('#fab').hidden = !(tab === 'today' || tab === 'calendar');
  $('#fab').setAttribute('aria-label', 'Add something');

  setBadge('shopping', db.shopping.filter(x => !x.done).length);
  setBadge('todos', db.todos.filter(x => !x.done && x.due && x.due <= t).length);
  setBadge('calendar', db.appts.filter(a => a.date === t).length);

  ({ today: renderToday, shopping: renderShopping, todos: renderTodos, calendar: renderCalendar })[tab]();
}

function setBadge(name, n) {
  const b = $(`.tabbar [data-tab="${name}"] .badge`);
  b.hidden = !n;
  b.textContent = n > 99 ? '99+' : n;
}

function empty(icon, title, text) {
  return `<div class="empty">${icon}<strong>${esc(title)}</strong><p>${esc(text)}</p></div>`;
}

function checkRow(kind, it, title, subHTML = '', extra = '') {
  return `<li class="row${it.done ? ' done' : ''}" data-kind="${kind}" data-id="${esc(it.id)}">
    <button type="button" class="check" data-act="toggle" aria-pressed="${!!it.done}" aria-label="${it.done ? 'Undo' : 'Done'}: ${esc(title)}">${ICON.check}</button>
    <button type="button" class="row-main" data-act="edit">
      <span class="row-text"><span class="row-title">${esc(title)}</span>${subHTML ? `<span class="row-sub">${subHTML}</span>` : ''}</span>${extra}
    </button>
  </li>`;
}

function qtyLabel(q) {
  if (!q) return '';
  return /^(\d+([.,]\d+)?|\d*[½¼¾])$/.test(q) ? '×' + q : q;
}
const shopRow = it => checkRow('shopping', it, it.name, it.note ? 'for ' + esc(it.note) : '', it.qty ? `<span class="qty">${esc(qtyLabel(it.qty))}</span>` : '');

function todoRow(it, { showDue = true } = {}) {
  const t = todayISO();
  let due = '';
  if (it.due && showDue && !it.done) {
    due = it.due < t ? `<b class="warn">Overdue · ${esc(dayLabel(it.due))}</b>` : esc(dayLabel(it.due));
  }
  const firstNote = esc((it.notes || '').split('\n')[0]);
  return checkRow('todos', it, it.title, [due, firstNote].filter(Boolean).join(' · '));
}

function apptRow(a, past = false) {
  const time = a.time
    ? `<span class="appt-time">${esc(fmtTime(a.time))}${a.end ? `<small>${esc(fmtTime(a.end))}</small>` : ''}</span>`
    : '<span class="appt-time allday">All day</span>';
  const cook = a.recipe ? `Cooking · ${plural(a.recipe.servings, 'serving')}` : '';
  const sub = [cook, a.location, (a.notes || '').split('\n')[0]].filter(Boolean).join(' · ');
  return `<li class="appt${past ? ' past' : ''}${a.recipe ? ' cook' : ''}" data-kind="appts" data-id="${esc(a.id)}">
    <button type="button" class="appt-btn" data-act="edit">${time}
      <span class="appt-body"><span class="row-title">${a.recipe ? ICON.pot : ''}${esc(a.title)}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}</span>
    </button></li>`;
}

/* ---------- Today ---------- */
function renderToday() {
  const t = todayISO();
  const apToday = db.appts.filter(a => a.date === t).sort(byWhen);
  const next = db.appts.filter(a => a.date > t).sort(byWhen)[0];
  const due = db.todos.filter(x => !x.done && x.due && x.due <= t).sort(byDue);
  const otherTodos = db.todos.filter(x => !x.done && !(x.due && x.due <= t)).length;
  const shop = db.shopping.filter(x => !x.done);

  let h = '';
  if (installEvent && !isStandalone()) {
    h += `<div class="card banner"><p>Install Pocket on your home screen for quick, offline access.</p><button type="button" class="btn primary" data-act="install">Install</button></div>`;
  }

  // Appointments
  h += `<div class="card c-cal"><button type="button" class="card-head" data-act="goto" data-tab="calendar">
      <h2><span class="dot"></span>Appointments</h2><span class="more">${apToday.length ? plural(apToday.length, 'today', 'today') : 'Calendar'}${ICON.chev}</span></button>`;
  if (apToday.length) h += `<ul class="list">${apToday.map(a => apptRow(a)).join('')}</ul>`;
  else h += `<p class="card-note">Nothing scheduled today.</p>`;
  if (next) h += `<p class="card-note">Next: <b>${esc(next.title)}</b> · ${esc(dayLabel(next.date))}${next.time ? ' ' + esc(fmtTime(next.time)) : ''}</p>`;
  h += `</div>`;

  // To-dos
  h += `<div class="card c-todo"><button type="button" class="card-head" data-act="goto" data-tab="todos">
      <h2><span class="dot"></span>To-dos</h2><span class="more">${due.length ? due.length + ' due' : 'All'}${ICON.chev}</span></button>`;
  if (due.length) h += `<ul class="list">${due.map(x => todoRow(x)).join('')}</ul>`;
  else h += `<p class="card-note">Nothing due today.</p>`;
  if (otherTodos) h += `<p class="card-note">${plural(otherTodos, 'more open to-do')} for later.</p>`;
  h += `</div>`;

  // Shopping
  h += `<div class="card c-shop"><button type="button" class="card-head" data-act="goto" data-tab="shopping">
      <h2><span class="dot"></span>Shopping</h2><span class="more">${shop.length ? plural(shop.length, 'item') : 'List'}${ICON.chev}</span></button>`;
  if (shop.length) {
    const shown = shop.slice(0, 12);
    h += `<div class="chips">${shown.map(x => `<span class="chip">${esc(x.name)}</span>`).join('')}${shop.length > shown.length ? `<span class="chip">+${shop.length - shown.length} more</span>` : ''}</div>`;
  } else h += `<p class="card-note">Your shopping list is empty.</p>`;
  h += `</div>`;

  $('#today-view').innerHTML = h;
}

/* ---------- Shopping ---------- */
function renderShopping() {
  const open = db.shopping.filter(x => !x.done);
  const done = db.shopping.filter(x => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  let h = '';
  if (!open.length && !done.length) {
    h = empty(ICON.bag, 'Your list is empty', 'Type an item above. Start with a number for a quantity, like “2 milk” or “500g flour”.');
  } else if (!open.length) {
    h = `<p class="all-done">Everything’s in the basket 🎉</p>`;
  }
  if (open.length) h += `<ul class="card list">${open.map(shopRow).join('')}</ul>`;
  if (done.length) {
    h += `<div class="section-head"><h3>In basket · ${done.length}</h3><button type="button" class="link" data-act="clear-basket">Clear</button></div>
      <ul class="card list">${done.map(shopRow).join('')}</ul>`;
  }
  $('#shop-list').innerHTML = h;

  const onList = new Set(open.map(x => x.name.toLowerCase()));
  $('#shop-history').innerHTML = db.history.filter(n => !onList.has(n.toLowerCase()))
    .map(n => `<option value="${esc(n)}"></option>`).join('');
}

function parseShopping(raw) {
  const m = raw.match(/^(\d+(?:[.,]\d+)?\s*(?:x|×|kg|g|l|ml|cl|dl|pcs?|packs?|bottles?|cans?)?)\s+(.+)$/i);
  return m ? { qty: m[1].replace(/\s+/g, ''), name: m[2].trim() } : { qty: '', name: raw };
}

function addShopping(name, qty = '') {
  const idx = db.shopping.findIndex(x => x.name.toLowerCase() === name.toLowerCase());
  const ex = db.shopping[idx];
  if (ex && !ex.done) {
    if (qty) ex.qty = qty;
    toast(`“${ex.name}” is already on the list`);
  } else if (ex) {
    db.shopping.splice(idx, 1);
    db.shopping.push({ ...ex, done: false, doneAt: null, qty: qty || ex.qty });
  } else {
    db.shopping.push({ id: uid(), name, qty, done: false, doneAt: null, created: Date.now() });
  }
  remember(name);
  commit();
}

/* ---------- To-dos ---------- */
let showDone = false;

function renderTodos() {
  const t = todayISO();
  const open = db.todos.filter(x => !x.done);
  const overdue = open.filter(x => x.due && x.due < t).sort(byDue);
  const today = open.filter(x => x.due === t).sort(byDue);
  const upcoming = open.filter(x => x.due && x.due > t).sort(byDue);
  const someday = open.filter(x => !x.due);
  const done = db.todos.filter(x => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));

  let h = '';
  const section = (title, items, cls = '', opts) => items.length
    ? `<div class="section-head"><h3 class="${cls}">${title}</h3></div><ul class="card list">${items.map(x => todoRow(x, opts)).join('')}</ul>` : '';

  if (!open.length && !done.length) {
    h = empty(ICON.list, 'No to-dos yet', 'Add one above. End with “today” or “tomorrow” to give it a due date; tap a to-do to add notes or pick a date.');
  } else if (!open.length) {
    h = `<p class="all-done">All done. Nice work ✨</p>`;
  }
  h += section('Overdue', overdue, 'warn');
  h += section('Today', today, 'hl', { showDue: false });
  h += section('Upcoming', upcoming);
  h += section(overdue.length || today.length || upcoming.length ? 'Any time' : '', someday);

  if (done.length) {
    h += `<div class="section-head"><button type="button" class="link" data-act="toggle-done" aria-expanded="${showDone}" style="padding-left:0;color:var(--muted)">
        ${showDone ? 'Hide' : 'Show'} done (${done.length})</button>
      ${showDone ? '<button type="button" class="link" data-act="clear-done">Clear done</button>' : ''}</div>`;
    if (showDone) h += `<ul class="card list">${done.slice(0, 50).map(x => todoRow(x)).join('')}</ul>`;
  }
  $('#todo-list').innerHTML = h;
}

function parseTodo(raw) {
  const m = raw.match(/^(.+?)\s+(today|tomorrow)$/i);
  if (!m) return { title: raw, due: '' };
  return { title: m[1].trim(), due: addDays(todayISO(), m[2].toLowerCase() === 'today' ? 0 : 1) };
}

/* ---------- Calendar ---------- */
let showPast = false;

function renderCalendar() {
  const t = todayISO();
  const upcoming = db.appts.filter(a => a.date >= t).sort(byWhen);
  const past = db.appts.filter(a => a.date < t).sort(byWhen).reverse();

  const groups = (list, isPast) => {
    let out = '', cur = null, items = [];
    const flush = () => {
      if (!cur) return;
      out += `<div class="section-head"><h3 class="${cur === t ? 'hl' : ''}">${esc(dayLabel(cur))}</h3></div>
        <ul class="card list">${items.map(a => apptRow(a, isPast)).join('')}</ul>`;
    };
    for (const a of list) {
      if (a.date !== cur) { flush(); cur = a.date; items = []; }
      items.push(a);
    }
    flush();
    return out;
  };

  let h = upcoming.length
    ? groups(upcoming, false)
    : empty(ICON.cal, 'No upcoming appointments', 'Tap + to add one. You can also send it to your phone’s calendar for reminders.');
  if (past.length) {
    h += `<div class="section-head"><button type="button" class="link" data-act="toggle-past" aria-expanded="${showPast}" style="padding-left:0;color:var(--muted)">
      ${showPast ? 'Hide' : 'Show'} past (${past.length})</button></div>`;
    if (showPast) h += groups(past.slice(0, 100), true);
  }
  $('#appt-list').innerHTML = h;
}

/* ===================== sheet (dialog) ===================== */
const sheet = $('#sheet');
let sheetHandlers = {};

function field(label, name, value = '', { type = 'text', required = false, placeholder = '', autofocus = false, textarea = false } = {}) {
  const attrs = `name="${name}"${required ? ' required' : ''}${autofocus ? ' autofocus' : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${type === 'number' ? ' min="1" max="999" inputmode="numeric"' : ''}`;
  const control = textarea
    ? `<textarea ${attrs} rows="3">${esc(value)}</textarea>`
    : `<input type="${type}" ${attrs} value="${esc(value)}"${type === 'text' ? ' autocomplete="off"' : ''}>`;
  return `<label class="field"><span>${esc(label)}</span>${control}</label>`;
}

function openSheet({ title, body, save = 'Save', onSave, onDelete, actions = '', handlers = {}, cls = '' }) {
  if (sheet.open) sheet.close();
  sheet.className = 'sheet ' + cls;
  sheet.innerHTML = `<form>
    <header class="sheet-head">
      <button type="button" class="link" data-sheet="close">${onSave ? 'Cancel' : 'Close'}</button>
      <h2>${esc(title)}</h2>
      ${onSave ? `<button type="submit" class="link"><b>${esc(save)}</b></button>` : '<span></span>'}
    </header>
    <div class="sheet-body">${body}</div>
    ${actions || onDelete ? `<div class="sheet-actions">${actions}${onDelete ? '<button type="button" class="btn danger" data-sheet="delete">Delete</button>' : ''}</div>` : ''}
  </form>`;
  const form = $('form', sheet);
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (onSave && onSave(new FormData(form), form) !== false) sheet.close();
  });
  sheetHandlers = { ...handlers, delete: onDelete && (() => { sheet.close(); onDelete(); }) };
  sheet.showModal();
}

sheet.addEventListener('click', e => {
  if (e.target === sheet) { sheet.close(); return; } // backdrop
  const b = e.target.closest('[data-sheet]');
  if (!b) return;
  const name = b.dataset.sheet;
  if (name === 'close') sheet.close();
  else sheetHandlers[name]?.(b, e);
});

/* ---------- edit / new forms ---------- */
function editShopping(id) {
  const it = find('shopping', id);
  if (!it) return;
  openSheet({
    title: 'Shopping item',
    body: field('Item', 'name', it.name, { required: true }) +
      field('Quantity', 'qty', it.qty, { placeholder: 'e.g. 2, 500g, 1 pack' }),
    onSave: fd => {
      const x = find('shopping', id);
      if (!x) return;
      x.name = fd.get('name').trim() || x.name;
      x.qty = fd.get('qty').trim();
      remember(x.name);
      commit();
    },
    onDelete: () => removeWithUndo('shopping', id, `Removed “${it.name}”`),
  });
}

function editTodo(id) {
  const it = id ? find('todos', id) : null;
  if (id && !it) return;
  const t = todayISO();
  const chips = [['Today', 0], ['Tomorrow', 1], ['In a week', 7], ['No date', null]];
  openSheet({
    title: it ? 'To-do' : 'New to-do',
    save: it ? 'Save' : 'Add',
    body: field('What needs doing?', 'title', it?.title, { required: true, autofocus: !it }) +
      `<div class="field"><span>Due</span>
        <div class="chip-row">${chips.map(([l, d]) => `<button type="button" class="chip-btn" data-sheet="due" data-days="${d ?? ''}">${l}</button>`).join('')}</div>
        <input type="date" name="due" value="${esc(it?.due || '')}" aria-label="Due date">
      </div>` +
      field('Notes', 'notes', it?.notes, { textarea: true }),
    handlers: {
      due: b => {
        $('[name=due]', sheet).value = b.dataset.days === '' ? '' : addDays(t, Number(b.dataset.days));
        syncDueChips();
      },
    },
    onSave: fd => {
      const data = { title: fd.get('title').trim(), due: fd.get('due') || '', notes: fd.get('notes').trim() };
      if (!data.title) return false;
      if (it) {
        const x = find('todos', id);
        if (x) Object.assign(x, data);
      } else {
        db.todos.push({ id: uid(), ...data, done: false, doneAt: null, created: Date.now() });
      }
      commit();
    },
    onDelete: it && (() => removeWithUndo('todos', id, `Deleted “${it.title}”`)),
  });
  $('[name=due]', sheet).addEventListener('input', syncDueChips);
  syncDueChips();

  function syncDueChips() {
    const v = $('[name=due]', sheet).value;
    for (const b of $$('[data-sheet=due]', sheet)) {
      const target = b.dataset.days === '' ? '' : addDays(t, Number(b.dataset.days));
      b.setAttribute('aria-pressed', String(v === target));
    }
  }
}

function editAppt(id, presetDate) {
  const a = id ? find('appts', id) : null;
  if (id && !a) return;
  openSheet({
    title: a ? 'Appointment' : 'New appointment',
    save: a ? 'Save' : 'Add',
    cls: 'c-cal',
    body: field('Title', 'title', a?.title, { required: true, autofocus: !a, placeholder: 'e.g. Dentist' }) +
      field('Date', 'date', a?.date || presetDate || todayISO(), { type: 'date', required: true }) +
      `<div class="two">${field('Starts', 'time', a?.time, { type: 'time' })}${field('Ends', 'end', a?.end, { type: 'time' })}</div>` +
      field('Location', 'location', a?.location, { placeholder: 'Optional' }) +
      field('Notes', 'notes', a?.notes, { textarea: true }),
    actions: a ? '<button type="button" class="btn" data-sheet="ics">Add to phone calendar</button>' : '',
    handlers: { ics: () => exportICS(find('appts', id)) },
    onSave: (fd, form) => {
      const data = {
        title: fd.get('title').trim(), date: fd.get('date'), time: fd.get('time') || '', end: fd.get('end') || '',
        location: fd.get('location').trim(), notes: fd.get('notes').trim(),
      };
      const endInput = form.elements.end;
      endInput.setCustomValidity(data.end && !data.time ? 'Set a start time first' : data.end && data.end <= data.time ? 'End must be after start' : '');
      if (!form.reportValidity()) return false;
      if (!data.title || !data.date) return false;
      if (a) {
        const x = find('appts', id);
        if (x) Object.assign(x, data);
      } else {
        db.appts.push({ id: uid(), ...data, created: Date.now() });
      }
      commit();
      if (!a && data.date !== todayISO() && tab !== 'calendar') toast(`Added for ${dayLabel(data.date)}`);
    },
    onDelete: a && (() => removeWithUndo('appts', id, `Deleted “${a.title}”`)),
  });
  const form = $('form', sheet);
  for (const el of [form.elements.time, form.elements.end]) el.addEventListener('input', () => form.elements.end.setCustomValidity(''));
}

/* ---------- cooking session ---------- */
const COOK_FILTERS = [['any', 'Any'], ['veg', 'Vegetarian'], ['quick', 'Quick ≤ 30 min']];

function editCook(id, presetDate) {
  const a = id ? find('appts', id) : null;
  if (id && !(a && a.recipe)) return;
  const added = !!(a && a.recipe.added);
  const st = {
    filter: 'any', seen: new Set(), servings: a ? a.recipe.servings : (db.prefs.servings || 2),
    recipe: null, source: a ? 'saved' : 'suggest', skip: null, addToList: !added, methodOpen: false,
  };
  st.recipe = a ? (recipeById(a.recipe.id) || a.recipe.data) : suggestRecipe('any', st.seen);
  if (st.recipe) st.seen.add(st.recipe.id);

  openSheet({
    title: a ? 'Cooking session' : 'Plan cooking',
    save: a ? 'Save' : 'Schedule',
    cls: 'c-cook',
    body: `<div id="cook-pick"></div>
      <div class="two">${field('Date', 'date', a ? a.date : (presetDate || todayISO()), { type: 'date', required: true })}${field('Time', 'time', a ? a.time : '18:30', { type: 'time' })}</div>
      <div id="cook-ings" class="sheet-body-inner"></div>
      ${field('Notes', 'notes', a && a.notes, { textarea: true, placeholder: 'Optional, e.g. guests coming' })}`,
    actions: a ? '<button type="button" class="btn" data-sheet="ics">Add to phone calendar</button>' : '',
    handlers: {
      suggest: () => pick(suggestRecipe(st.filter, st.seen), 'suggest'),
      filter: b => {
        st.filter = b.dataset.filter;
        if (st.recipe && matchesFilter(st.recipe, st.filter)) draw();
        else pick(suggestRecipe(st.filter, st.seen), 'suggest');
      },
      serv: b => {
        keepUi();
        st.servings = Math.min(20, Math.max(1, st.servings + Number(b.dataset.d)));
        drawIngredients();
      },
      ics: () => exportICS(find('appts', id)),
    },
    onSave: fd => {
      const r = st.recipe;
      const date = fd.get('date');
      if (!r || !date) return false;
      const snapshot = JSON.stringify(db);
      const data = {
        title: r.name, date, time: fd.get('time') || '', end: '', location: '', notes: fd.get('notes').trim(),
        recipe: { id: r.id, servings: st.servings, added, data: recipeData(r) },
      };
      let n = 0;
      if (fd.get('addToList')) {
        const ticked = new Set(fd.getAll('ing').map(Number));
        n = addToShopping(scaledIngredients(r, st.servings).filter((x, i) => ticked.has(i)), r.name);
        data.recipe.added = data.recipe.added || n > 0;
      }
      if (a) Object.assign(find('appts', id) || {}, data);
      else db.appts.push({ id: uid(), ...data, created: Date.now() });
      db.prefs.servings = st.servings;
      commit();
      const dl = dayLabel(date);
      const what = a ? 'Saved' : `Cooking ${/^(Today|Tomorrow)$/.test(dl) ? dl.toLowerCase() : 'on ' + dl}`;
      toast(n ? `${what} · ${plural(n, 'item')} added to shopping` : what, () => { db = normalize(JSON.parse(snapshot)); commit(); });
    },
    onDelete: a && (() => removeWithUndo('appts', id, `Deleted “${a.title}”`)),
  });
  draw();

  function pick(r, source) {
    st.recipe = r;
    st.source = source;
    st.skip = null; // new recipe: default ticks again
    if (r) st.seen.add(r.id);
    draw();
  }
  function keepUi() {
    const boxes = $$('[name=ing]', sheet);
    if (boxes.length) st.skip = new Set(boxes.filter(b => !b.checked).map(b => Number(b.value)));
    const add = $('[name=addToList]', sheet);
    if (add) st.addToList = add.checked;
    const det = $('details.method', sheet);
    if (det) st.methodOpen = det.open;
  }
  function draw() { drawPick(); drawIngredients(); }

  function drawPick() {
    const r = st.recipe;
    const opts = list => list.map(x => `<option value="${esc(x.id)}"${r && x.id === r.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
    $('#cook-pick', sheet).innerHTML = `<div class="recipe-card">
      <div class="chip-row" role="group" aria-label="Kind of recipe">${COOK_FILTERS.map(([k, l]) =>
        `<button type="button" class="chip-btn" data-sheet="filter" data-filter="${k}" aria-pressed="${st.filter === k}">${l}</button>`).join('')}</div>
      ${r ? `<div><p class="recipe-kicker">${st.source === 'suggest' ? 'Suggestion' : 'Recipe'}</p>
          <h3 class="recipe-name">${esc(r.name)}</h3>
          <p class="hint">${r.time} min${r.veg ? ' · Vegetarian' : ''}${r.mine ? ' · My recipe' : ''}</p></div>`
        : '<p class="hint">No recipes match this filter.</p>'}
      <div class="recipe-actions">
        <button type="button" class="btn" data-sheet="suggest">↻ Suggest another</button>
        <label class="select-wrap"><span class="sr-only">Choose a recipe</span>
          <select name="pick"><option value="">Choose…</option>${db.recipes.length ? `<optgroup label="My recipes">${opts(db.recipes)}</optgroup>` : ''}<optgroup label="Recipes">${opts(BUILTIN_RECIPES)}</optgroup></select>
        </label>
      </div>
    </div>`;
    $('[name=pick]', sheet).addEventListener('change', e => { const x = recipeById(e.target.value); if (x) pick(x, 'pick'); });
  }

  function drawIngredients() {
    const r = st.recipe, box = $('#cook-ings', sheet);
    if (!r) { box.innerHTML = ''; return; }
    const onList = new Set(db.shopping.filter(x => !x.done).map(x => x.name.toLowerCase()));
    const ings = scaledIngredients(r, st.servings);
    box.innerHTML = `
      <div class="field"><span>Servings</span>
        <div class="stepper">
          <button type="button" data-sheet="serv" data-d="-1" aria-label="Fewer servings">−</button>
          <output aria-live="polite">${st.servings}</output>
          <button type="button" data-sheet="serv" data-d="1" aria-label="More servings">+</button>
        </div>
      </div>
      <fieldset class="ings"><legend>Ingredients · tick what you need to buy</legend>
        ${ings.map((g, i) => {
          const on = st.skip ? !st.skip.has(i) : !g.pantry;
          return `<label class="ing"><input type="checkbox" name="ing" value="${i}"${on ? ' checked' : ''}>
            <span class="ing-name">${esc(g.name)}${onList.has(g.name.toLowerCase()) ? '<small>on list</small>' : ''}</span>
            <span class="ing-amt">${esc(g.text)}</span></label>`;
        }).join('')}
      </fieldset>
      <label class="toggle"><input type="checkbox" name="addToList"${st.addToList ? ' checked' : ''}>
        <span>${added ? 'Add ticked items to the shopping list again' : 'Add ticked items to the shopping list'}</span></label>
      ${r.steps && r.steps.length ? `<details class="method"${st.methodOpen ? ' open' : ''}><summary>Method · ${plural(r.steps.length, 'step')}</summary>
        <ol>${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></details>` : ''}`;
  }
}

/* ---------- my recipes ---------- */
function openMyRecipes() {
  openSheet({
    title: 'My recipes',
    body: `<p class="hint">Your own recipes are suggested alongside the ${BUILTIN_RECIPES.length} built-in ones.</p>
      ${db.recipes.length ? `<ul class="card list flat">${db.recipes.map(r => `<li class="row">
        <button type="button" class="row-main pad" data-sheet="edit" data-id="${esc(r.id)}">
          <span class="row-text"><span class="row-title">${esc(r.name)}</span>
          <span class="row-sub">${r.time} min · serves ${r.serves}${r.veg ? ' · Vegetarian' : ''}</span></span>${ICON.chev}
        </button></li>`).join('')}</ul>` : ''}
      <button type="button" class="btn primary" data-sheet="new">New recipe</button>`,
    cls: 'c-cook',
    handlers: { edit: b => editRecipe(b.dataset.id), new: () => editRecipe(null) },
  });
}

function editRecipe(id) {
  const r = id ? db.recipes.find(x => x.id === id) : null;
  if (id && !r) return;
  openSheet({
    title: r ? 'Edit recipe' : 'New recipe',
    cls: 'c-cook',
    body: field('Name', 'name', r && r.name, { required: true, autofocus: !r, placeholder: 'e.g. Grandma’s lasagne' }) +
      `<div class="two">${field('Serves', 'serves', r ? r.serves : 4, { type: 'number', required: true })}${field('Minutes', 'time', r ? r.time : 30, { type: 'number', required: true })}</div>` +
      `<label class="toggle"><input type="checkbox" name="veg"${r && r.veg ? ' checked' : ''}><span>Vegetarian</span></label>` +
      field('Ingredients · one per line', 'ingredients', r ? r.ingredients.join('\n') : '', { textarea: true, required: true, placeholder: '400 g spaghetti\n2 cloves garlic\n1 onion\nsalt and pepper' }) +
      field('Method · one step per line', 'steps', r ? (r.steps || []).join('\n') : '', { textarea: true }),
    onSave: fd => {
      const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
      const data = {
        name: fd.get('name').trim(), serves: Math.max(1, Math.round(Number(fd.get('serves')) || 4)),
        time: Math.max(1, Math.round(Number(fd.get('time')) || 30)), veg: !!fd.get('veg'),
        ingredients: lines(fd.get('ingredients')), steps: lines(fd.get('steps')),
      };
      if (!data.name || !data.ingredients.length) return false;
      if (r) Object.assign(r, data);
      else db.recipes.push({ id: 'my-' + uid(), ...data, created: Date.now() });
      commit();
      setTimeout(openMyRecipes, 0);
    },
    onDelete: r && (() => removeWithUndo('recipes', id, `Deleted “${r.name}”`)),
  });
}

function chooseNew() {
  openSheet({
    title: 'Add',
    body: `<div class="choose">
      <button type="button" class="c-cal" data-sheet="appt"><span class="dot"></span>Appointment</button>
      <button type="button" class="c-cook" data-sheet="cook"><span class="dot"></span><span>Cooking session<small>Suggests a recipe, fills your shopping list</small></span></button>
      <button type="button" class="c-todo" data-sheet="todo"><span class="dot"></span>To-do</button>
      <button type="button" class="c-shop" data-sheet="shop"><span class="dot"></span>Shopping item</button>
    </div>`,
    handlers: {
      shop: () => { sheet.close(); setTab('shopping'); $('#shop-input').focus(); },
      todo: () => editTodo(null),
      appt: () => editAppt(null),
      cook: () => editCook(null),
    },
  });
}

/* ---------- settings & backup ---------- */
async function openSettings() {
  let persisted = null;
  try { persisted = await navigator.storage?.persisted?.(); } catch (e) { /* ignore */ }
  const installed = isStandalone();
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installHint = installed
    ? 'Pocket is installed on this device.'
    : ios
      ? 'On iPhone: open this page in Safari, tap the Share button, then “Add to Home Screen”.'
      : 'Open your browser menu and choose “Install app” or “Add to Home screen”.';

  openSheet({
    title: 'Settings',
    body: `
      <section class="setting">
        <h3>Backup</h3>
        <p class="hint">Your lists live only on this device. Export a backup now and then, and use it to move to a new phone.</p>
        <button type="button" class="btn" data-sheet="export">Export backup</button>
        <button type="button" class="btn" data-sheet="import">Restore from backup…</button>
      </section>
      <section class="setting">
        <h3>Recipes</h3>
        <p class="hint">${BUILTIN_RECIPES.length} built-in recipes${db.recipes.length ? ` and ${plural(db.recipes.length, 'recipe')} of your own` : ''}. Add your own to have them suggested too.</p>
        <button type="button" class="btn" data-sheet="recipes">My recipes</button>
      </section>
      <section class="setting">
        <h3>Home screen</h3>
        <p class="hint">${esc(installHint)}</p>
        ${installEvent && !installed ? '<button type="button" class="btn primary" data-sheet="install">Install Pocket</button>' : ''}
      </section>
      <p class="stats">${plural(db.shopping.length, 'shopping item')} · ${plural(db.todos.length, 'to-do')} · ${plural(db.appts.length, 'appointment')}<br>
        Storage: ${persisted === true ? 'protected' : persisted === false ? 'may be cleared by the browser if space runs low' : 'unknown'} · v${VERSION}</p>`,
    handlers: {
      export: exportBackup,
      import: () => $('#import-file').click(),
      recipes: openMyRecipes,
      install: () => { sheet.close(); promptInstall(); },
    },
  });
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function exportBackup() {
  const name = `pocket-backup-${todayISO()}.json`;
  const text = JSON.stringify({ ...db, exportedAt: new Date().toISOString(), app: 'pocket', appVersion: VERSION }, null, 2);
  // On phones the share sheet is the most reliable way to save a file (Files, Drive, mail…).
  try {
    const file = new File([text], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Pocket backup' });
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  download(name, text, 'application/json');
}

$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || !['shopping', 'todos', 'appts'].some(k => Array.isArray(data[k]))) {
      throw new Error('not a Pocket backup');
    }
    const next = normalize(data);
    const summary = `${plural(next.shopping.length, 'shopping item')}, ${plural(next.todos.length, 'to-do')}, ${plural(next.appts.length, 'appointment')}`;
    if (!confirm(`Replace everything in Pocket with this backup?\n\n${summary}`)) return;
    const snapshot = JSON.stringify(db);
    db = next;
    if (sheet.open) sheet.close();
    commit();
    toast('Backup restored', () => { db = normalize(JSON.parse(snapshot)); commit(); });
  } catch (err) {
    if (sheet.open) sheet.close();
    toast('That file isn’t a Pocket backup');
  }
});

/* ---------- calendar export (.ics) ---------- */
function exportICS(a) {
  if (!a) return;
  const icsText = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const d = a.date.replace(/-/g, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pocket//Personal assistant//EN', 'BEGIN:VEVENT',
    `UID:${a.id}@pocket`, `DTSTAMP:${stamp}`];
  if (a.time) {
    const start = a.time.replace(':', '') + '00';
    let end = a.end;
    if (!end) { const [h, m] = a.time.split(':').map(Number); end = `${pad(Math.min(h + 1, 23))}:${pad(h >= 23 ? 59 : m)}`; }
    lines.push(`DTSTART:${d}T${start}`, `DTEND:${d}T${end.replace(':', '')}00`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${addDays(a.date, 1).replace(/-/g, '')}`);
  }
  lines.push(`SUMMARY:${icsText(a.recipe ? 'Cook: ' + a.title : a.title)}`);
  if (a.location) lines.push(`LOCATION:${icsText(a.location)}`);
  const desc = a.recipe
    ? [`Ingredients for ${a.recipe.servings}:`, ...scaledIngredients(a.recipe.data, a.recipe.servings).map(g => `- ${g.text ? g.text + ' ' : ''}${g.name}`), a.notes].filter(Boolean).join('\n')
    : a.notes;
  if (desc) lines.push(`DESCRIPTION:${icsText(desc)}`);
  if (a.time) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(a.title)}`, 'TRIGGER:-PT30M', 'END:VALARM');
  lines.push('END:VEVENT', 'END:VCALENDAR');
  const safe = a.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'appointment';
  download(`${safe}.ics`, lines.join('\r\n'), 'text/calendar');
}

/* ===================== toast ===================== */
let toastTimer;
function toast(msg, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
  if (undo) $('button', el).onclick = () => { hideToast(); undo(); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, undo ? 5000 : 2600);
}
function hideToast() { $('#toast').classList.remove('show'); }

/* ===================== events ===================== */
let renderTimer;
function renderSoon() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 450); }

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.closest('dialog')) return;
  const row = btn.closest('[data-id]');
  const kind = row?.dataset.kind;
  const id = row?.dataset.id;

  switch (btn.dataset.act) {
    case 'toggle': {
      const it = find(kind, id);
      if (!it) return;
      it.done = !it.done;
      it.doneAt = it.done ? Date.now() : null;
      row.classList.toggle('done', it.done);
      btn.setAttribute('aria-pressed', String(it.done));
      navigator.vibrate?.(8);
      persist();
      renderSoon(); // short pause so quick ticks don't make the list jump
      break;
    }
    case 'edit':
      if (kind === 'shopping') editShopping(id);
      else if (kind === 'todos') editTodo(id);
      else if (kind === 'appts') (find('appts', id) && find('appts', id).recipe ? editCook : editAppt)(id);
      break;
    case 'goto': setTab(btn.dataset.tab); break;
    case 'install': promptInstall(); break;
    case 'clear-basket': {
      const snapshot = JSON.stringify(db);
      const n = db.shopping.filter(x => x.done).length;
      db.shopping = db.shopping.filter(x => !x.done);
      commit();
      toast(`Cleared ${plural(n, 'item')}`, () => { db = normalize(JSON.parse(snapshot)); commit(); });
      break;
    }
    case 'clear-done': {
      const snapshot = JSON.stringify(db);
      const n = db.todos.filter(x => x.done).length;
      db.todos = db.todos.filter(x => !x.done);
      showDone = false;
      commit();
      toast(`Cleared ${plural(n, 'to-do')}`, () => { db = normalize(JSON.parse(snapshot)); commit(); });
      break;
    }
    case 'toggle-done': showDone = !showDone; render(); break;
    case 'toggle-past': showPast = !showPast; render(); break;
  }
});

for (const b of $$('.tabbar button')) b.addEventListener('click', () => setTab(b.dataset.tab));
$('#fab').addEventListener('click', chooseNew);
$('#menu-btn').addEventListener('click', openSettings);

$('#shop-add').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#shop-input');
  const raw = input.value.trim();
  if (!raw) return;
  const { name, qty } = parseShopping(raw);
  addShopping(name, qty);
  input.value = '';
  input.focus();
});

$('#todo-add').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#todo-input');
  const raw = input.value.trim();
  if (!raw) return;
  const { title, due } = parseTodo(raw);
  db.todos.push({ id: uid(), title, due, notes: '', done: false, doneAt: null, created: Date.now() });
  commit();
  input.value = '';
  input.focus();
});

window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (TABS.includes(h) && h !== tab) setTab(h);
});

// Keep "today" correct when the app stays open past midnight or comes back from the background.
let lastDay = todayISO();
setInterval(() => { if (todayISO() !== lastDay) { lastDay = todayISO(); render(); } }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastDay = todayISO(); render(); } });

/* ===================== install / offline ===================== */
let installEvent = null;
function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installEvent = e;
  if (tab === 'today') render();
});
window.addEventListener('appinstalled', () => { installEvent = null; render(); toast('Pocket installed'); });
async function promptInstall() {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => {});
  installEvent = null;
  render();
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
// Ask the browser not to evict our data when space runs low.
navigator.storage?.persist?.().catch(() => {});

render();

'use strict';

/* Pocket – a small personal assistant: shopping list, to-dos, appointments.
   Everything is stored in localStorage on this device. */

const VERSION = '1.0.0';
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
const blank = () => ({ version: 1, shopping: [], todos: [], appts: [], history: [] });

function normalize(d) {
  const out = blank();
  for (const k of ['shopping', 'todos', 'appts']) {
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
  $('#fab').setAttribute('aria-label', tab === 'calendar' ? 'New appointment' : 'Add something');

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
  return /^\d+([.,]\d+)?$/.test(q) ? '×' + q : q;
}
const shopRow = it => checkRow('shopping', it, it.name, '', it.qty ? `<span class="qty">${esc(qtyLabel(it.qty))}</span>` : '');

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
  const sub = [a.location, (a.notes || '').split('\n')[0]].filter(Boolean).join(' · ');
  return `<li class="appt${past ? ' past' : ''}" data-kind="appts" data-id="${esc(a.id)}">
    <button type="button" class="appt-btn" data-act="edit">${time}
      <span class="appt-body"><span class="row-title">${esc(a.title)}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}</span>
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
  const attrs = `name="${name}"${required ? ' required' : ''}${autofocus ? ' autofocus' : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}`;
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

function chooseNew() {
  openSheet({
    title: 'Add',
    body: `<div class="choose">
      <button type="button" class="c-shop" data-sheet="shop"><span class="dot"></span>Shopping item</button>
      <button type="button" class="c-todo" data-sheet="todo"><span class="dot"></span>To-do</button>
      <button type="button" class="c-cal" data-sheet="appt"><span class="dot"></span>Appointment</button>
    </div>`,
    handlers: {
      shop: () => { sheet.close(); setTab('shopping'); $('#shop-input').focus(); },
      todo: () => editTodo(null),
      appt: () => editAppt(null),
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
        <h3>Home screen</h3>
        <p class="hint">${esc(installHint)}</p>
        ${installEvent && !installed ? '<button type="button" class="btn primary" data-sheet="install">Install Pocket</button>' : ''}
      </section>
      <p class="stats">${plural(db.shopping.length, 'shopping item')} · ${plural(db.todos.length, 'to-do')} · ${plural(db.appts.length, 'appointment')}<br>
        Storage: ${persisted === true ? 'protected' : persisted === false ? 'may be cleared by the browser if space runs low' : 'unknown'} · v${VERSION}</p>`,
    handlers: {
      export: exportBackup,
      import: () => $('#import-file').click(),
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
  lines.push(`SUMMARY:${icsText(a.title)}`);
  if (a.location) lines.push(`LOCATION:${icsText(a.location)}`);
  if (a.notes) lines.push(`DESCRIPTION:${icsText(a.notes)}`);
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
      else if (kind === 'appts') editAppt(id);
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
$('#fab').addEventListener('click', () => (tab === 'calendar' ? editAppt(null) : chooseNew()));
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

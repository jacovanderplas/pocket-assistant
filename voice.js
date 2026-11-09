'use strict';

/* Pocket – voice input. Uses the browser's speech recognition (Web Speech API).
   Loaded after app.js and uses its helpers (db, openSheet, toast, …).
   - The mic in the header understands short commands and files them into the right list.
   - The mic in the Shopping and To-do add bars dictates straight into that list. */

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const VOICE_LANGS = [['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['de-CH', 'Deutsch (Schweiz)'], ['de-DE', 'Deutsch (Deutschland)']];

function voiceLang() {
  const saved = db.prefs.voiceLang;
  if (VOICE_LANGS.some(([v]) => v === saved)) return saved;
  return /^de/i.test(navigator.language || '') ? 'de-CH' : 'en-GB';
}
const isGerman = lang => /^de/i.test(lang);

/* ===================== understanding what was said ===================== */
const NUM_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12,
};
const NUM_WORD_RE = Object.keys(NUM_WORDS).join('|');
const numVal = w => NUM_WORDS[w.toLowerCase()];

// A whole-word phrase. \b doesn't work with ä/ö/ü, so words are delimited by spaces;
// texts are padded with a space on each side before matching.
const phrase = src => new RegExp(`\\s(?:${src})(?=\\s)`, 'i');

const WEEKDAYS = ['sunday|sonntag', 'monday|montag', 'tuesday|dienstag', 'wednesday|mittwoch', 'thursday|donnerstag', 'friday|freitag', 'saturday|samstag|sonnabend'];
const MONTHS = ['january|januar|jänner', 'february|februar', 'march|märz', 'april', 'may|mai', 'june|juni', 'july|juli', 'august', 'september', 'october|oktober', 'november', 'december|dezember'];
const WD_ALL = WEEKDAYS.join('|');
const MON_ALL = MONTHS.join('|');
const indexIn = (list, word) => list.findIndex(alts => new RegExp(`^(?:${alts})s?$`, 'i').test(word));

function validDate(y, m, d) {
  const dt = new Date(y, m, d);
  return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d ? iso(dt) : null;
}

// Pulls dates and times out of a sentence. Returns { date, time, end, rest } where rest is the text without them.
function extractWhen(text, base = todayISO(), lang = voiceLang()) {
  let s = ` ${text.replace(/,/g, ' , ')} `;
  // Spoken numbers next to time words become digits ("at three" → "at 3", "drei Uhr" → "3 Uhr").
  s = s.replace(new RegExp(`(\\s(?:at|um|from|von|to|bis|till|until|and|und|past|halb|nach|vor|in|gegen|ab)\\s)(${NUM_WORD_RE})(?=\\s)`, 'gi'), (m, p, w) => p + numVal(w));
  s = s.replace(new RegExp(`(\\s)(${NUM_WORD_RE})(?=\\s(?:o'?clock|uhr|p\\.?\\s?m|a\\.?\\s?m|days?|tagen?|weeks?|wochen?)\\b)`, 'gi'), (m, p, w) => p + numVal(w));

  let date = '', ctx = '', start = null, end = null;
  const baseDate = parseISO(base);
  const take = (re, fn) => {
    const m = s.match(re);
    if (!m || fn(m) === false) return false;
    s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    return true;
  };

  // part of the day
  take(phrase('tonight|heute\\sabend|heute\\snacht'), () => { date = base; ctx = 'evening'; });
  take(phrase('morgen\\sfrüh'), () => { date = addDays(base, 1); ctx = 'morning'; });
  take(phrase('this\\smorning|heute\\smorgen|heute\\sfrüh'), () => { date = base; ctx = 'morning'; });
  take(phrase('this\\safternoon|heute\\snachmittag'), () => { date = base; ctx = 'afternoon'; });
  take(phrase('this\\sevening'), () => { date = base; ctx = 'evening'; });
  take(phrase('in\\sthe\\sevening|evening|abends|am\\sabend'), () => { ctx = 'evening'; });
  take(phrase('in\\sthe\\smorning|morning|morgens|am\\smorgen|vormittags|am\\svormittag'), () => { ctx = 'morning'; });
  take(phrase('in\\sthe\\safternoon|afternoon|nachmittags|am\\snachmittag'), () => { ctx = 'afternoon'; });

  // times
  // In German "am" means "on" ("am Freitag"), so only the dotted "a.m." counts there.
  const mer = isGerman(lang) ? String.raw`a\.\s?m\.?|p\.?\s?m\.?` : String.raw`a\.?\s?m\.?|p\.?\s?m\.?`;
  const T = String.raw`(\d{1,2})(?:[:.](\d{2}))?(?:\s?(${mer}|uhr|h|o'?clock)(?:\s(\d{2})(?=\s))?)?`;
  const readT = (h, m, suf, m2) => {
    const t = { h: Number(h), m: Number(m || m2 || 0), mer: suf && /^a/i.test(suf) ? 'am' : suf && /^p/i.test(suf) ? 'pm' : '', h24: /^0\d/.test(h) };
    return t.h <= 24 && t.m < 60 ? t : null;
  };
  const range = (m, o = 1) => {
    const a = readT(m[o], m[o + 1], m[o + 2], m[o + 3]);
    const b = readT(m[o + 4], m[o + 5], m[o + 6], m[o + 7]);
    if (!a || !b) return false;
    if (!a.mer) a.mer = b.mer;
    start = a; end = b;
  };
  take(new RegExp(`\\s(?:from|von|between|zwischen)\\s${T}\\s(?:to|till|until|and|bis|und|-|–)\\s${T}(?=\\s)`, 'i'), range)
    || take(new RegExp(`\\s(?:at\\s|um\\s)?${T}\\s?(?:-|–|to|till|until|bis)\\s?${T}(?=\\s)`, 'i'), m => (m[3] || m[7] || m[2] || m[6]) ? range(m) : false);

  if (!start) {
    take(new RegExp(`\\s(?:at\\s|um\\s|gegen\\s)?(half|quarter)\\s(past|to)\\s(\\d{1,2})(?:\\s?(${mer}|o'?clock))?(?=\\s)`, 'i'), m => {
      const h = Number(m[3]);
      if (h > 12) return false;
      const mins = m[1].toLowerCase() === 'half' ? 30 : 15;
      start = m[2].toLowerCase() === 'past' ? { h, m: mins } : { h: h - 1 || 12, m: 60 - mins };
      start.mer = m[4] && /^a/i.test(m[4]) ? 'am' : m[4] && /^p/i.test(m[4]) ? 'pm' : '';
    })
    || take(/\s(?:um\s|gegen\s)?(halb|viertel\snach|viertel\svor|dreiviertel)\s(\d{1,2})(?:\suhr)?(?=\s)/i, m => {
      const h = Number(m[2]), w = m[1].toLowerCase();
      if (h > 24) return false;
      start = w === 'halb' ? { h: h - 1, m: 30 } : w === 'viertel nach' ? { h, m: 15 } : { h: h - 1, m: 45 };
      start.mer = '';
    })
    || take(phrase('(?:at\\s|um\\s|zu\\s)?(?:noon|midday|mittag|mittags)'), () => { start = { h: 12, m: 0, mer: '' }; })
    || take(new RegExp(`\\s(?:at|um|ab|by|gegen)\\s${T}(?=\\s)`, 'i'), m => { start = readT(m[1], m[2], m[3], m[4]); return start ? undefined : false; })
    || take(new RegExp(`\\s${T}(?=\\s)`, 'i'), m => {
      if (!m[2] && !m[3]) return false; // a bare number is not a time
      if (!m[3] && m[0].includes('.')) return false; // "14.11" is a date, not a time
      start = readT(m[1], m[2], m[3], m[4]);
      return start ? undefined : false;
    });
  }

  // dates
  take(phrase('the\\sday\\safter\\stomorrow|übermorgen'), () => { date = addDays(base, 2); })
    || take(phrase('today|heute'), () => { date = base; })
    || take(phrase('tomorrow|morgen'), () => { date = addDays(base, 1); })
    || take(/\sin\s(\d+)\s(?:days?|tagen)(?=\s)/i, m => { date = addDays(base, Number(m[1])); })
    || take(/\sin\s(\d+|a|einer)\s(?:weeks?|wochen?)(?=\s)/i, m => { date = addDays(base, 7 * (Number(m[1]) || 1)); })
    || take(phrase('next\\sweek|nächste\\swoche'), () => { date = addDays(base, 7); })
    || take(new RegExp(`\\s(?:(?:on|am)\\s)?(?:(next|this|coming|nächsten|nächste|diesen|kommenden)\\s)?(${WD_ALL})s?(?=\\s)`, 'i'), m => {
      const target = indexIn(WEEKDAYS, m[2]);
      let diff = (target - baseDate.getDay() + 7) % 7;
      if (diff === 0 && m[1] && !/^(this|diesen)$/i.test(m[1])) diff = 7;
      date = addDays(base, diff);
    })
    || take(new RegExp(`\\s(?:(?:on|am)\\s)?(?:the\\s)?(\\d{1,2})(?:st|nd|rd|th|\\.)?\\s(?:of\\s)?(${MON_ALL})(?:,?\\s(\\d{4}))?(?=\\s)`, 'i'), m => dayMonth(m[1], indexIn(MONTHS, m[2]), m[3]))
    || take(new RegExp(`\\s(?:on\\s)?(${MON_ALL})\\s(?:the\\s)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s(\\d{4}))?(?=\\s)`, 'i'), m => dayMonth(m[2], indexIn(MONTHS, m[1]), m[3]))
    || take(/\s(?:(?:on|am)\s)?(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\.?(?=\s)/i, m => {
      const [d, mo] = lang === 'en-US' ? [m[2], m[1]] : [m[1], m[2]];
      return dayMonth(d, Number(mo) - 1, m[3]);
    })
    || take(/\s(?:on\s)?the\s(\d{1,2})(?:st|nd|rd|th)(?=\s)|\sam\s(\d{1,2})\.(?=\s)/i, m => {
      const d = Number(m[1] || m[2]);
      let y = baseDate.getFullYear(), mo = baseDate.getMonth();
      if (d < baseDate.getDate()) { mo++; if (mo > 11) { mo = 0; y++; } }
      const v = validDate(y, mo, d);
      if (!v) return false;
      date = v;
    });

  function dayMonth(d, mo, y) {
    if (mo < 0 || mo > 11) return false;
    let year = y ? Number(y.length === 2 ? '20' + y : y) : baseDate.getFullYear();
    let v = validDate(year, mo, Number(d));
    if (v && !y && v < base) v = validDate(year + 1, mo, Number(d));
    if (!v) return false;
    date = v;
  }

  const hhmm = t => {
    if (!t) return '';
    let h = t.h;
    if (t.mer === 'pm' && h < 12) h += 12;
    else if (t.mer === 'am' && h === 12) h = 0;
    else if (!t.mer && h < 12 && !t.h24) {
      if (ctx === 'evening' || ctx === 'afternoon') h += 12;
      else if (ctx !== 'morning' && h >= 1 && h <= 7) h += 12; // "at 3" usually means 15:00
    }
    if (h === 24) h = 0;
    return h < 24 ? `${pad(h)}:${pad(t.m)}` : '';
  };
  const time = hhmm(start);
  let endTime = hhmm(end);
  if (endTime && time && endTime <= time && end.h < 12 && !end.mer) endTime = hhmm({ ...end, h: end.h + 12 });
  if (endTime && (!time || endTime <= time)) endTime = '';

  let rest = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4; i++) {
    rest = rest.replace(/(?:^|\s)(?:on|at|am|um|for|für|this|next|the|by|bis|until|from|von|ab|in|and|und)$/i, '').replace(/^[,\s]+|[,\s]+$/g, '').trim();
  }
  rest = rest.replace(/\s+,/g, ',');
  return { date, time, end: endTime, rest };
}

const firstMatch = (res, text) => {
  for (const re of res) {
    const m = text.match(re);
    if (m) { const v = m.slice(1).find(x => x); if (v) return v.trim(); }
  }
  return null;
};

const SHOP_RES = [
  /^(?:please\s)?(?:add|put|write)\s(.+?)\s(?:to|on|onto)\s(?:the\s|my\s|our\s)?(?:shopping\s?list|shopping|list)$/i,
  /^(.+?)\s(?:to|on)\s(?:the\s|my\s|our\s)?shopping\s?list$/i,
  /^(?:shopping\s?list|shopping|einkaufsliste|einkaufen)\s?:?\s(.+)$/i,
  /^(?:(?:i|we)\s(?:need|have)\sto\sbuy|(?:i|we)\s(?:must|should)\sbuy|(?:i|we)\sneed(?!\sto\s)|we're\sout\sof|we\sare\sout\sof|buy)\s(.+)$/i,
  /^(?:(?:schreib|schreibe|setz|setze|füg|füge)\s)?(.+?)\s(?:auf\s(?:die|unsere|meine)\s(?:einkaufsliste|liste)|zur\seinkaufsliste)(?:\s(?:hinzu|setzen|schreiben|hinzufügen))?$/i,
  /^(?:ich|wir)\s(?:muss|müssen|sollte|sollten)\s(?:noch\s)?(.+?)\s(?:kaufen|einkaufen|holen|besorgen)$/i,
  /^(?:wir\sbrauchen|ich\sbrauche|uns\sfehlt|uns\sfehlen|kauf|kaufe|kaufen)\s(?:noch\s)?(.+)$/i,
  /^(.+?)\s(?:kaufen|einkaufen|besorgen)$/i,
];
const TODO_RES = [
  /^(?:please\s)?(?:remind\sme\s(?:to\s|about\s|that\s)?|reminder\s(?:to\s)?|(?:add\s(?:a\s)?)?to-?\s?do\s?:?\s(?:to\s)?|task\s?:?\s|(?:please\s)?don'?t\slet\sme\sforget\sto\s|don'?t\sforget\sto\s|i\s(?:need|have|must|should|ought)\sto\s|i\smust\s)(.+)$/i,
  /^(?:add\s)?(.+?)\s(?:to|on)\s(?:my\s|the\s)?(?:to-?\s?do|todo)(?:\s?list)?$/i,
  /^(?:erinnere?\smich(?:\sdaran)?,?\s(?:dass\s|an\s|zu\s)?|aufgabe\s?:?\s|to-?\s?do\s?:?\s|nicht\svergessen\s?:?\s|ich\s(?:muss|sollte)\s)(.+)$/i,
  /^(.+?)\s(?:auf\s(?:die|meine)\s(?:aufgabenliste|to-?do-?liste|todo-?liste|aufgaben)|zu\s(?:den|meinen)\saufgaben)(?:\s(?:hinzu|setzen|schreiben))?$/i,
];
const COOK_RE = phrase('cook|cooking|kochen|koche|kochabend');
const APPT_RE = phrase('appointment|meeting|calendar|termin|treffen|besprechung|kalender');

const VOICE_UNITS = [
  [/^(?:grams?|gramm|g)$/i, 'g', true], [/^(?:kilos?|kilograms?|kilogramm|kg)$/i, 'kg', true],
  [/^(?:litres?|liters?|l)$/i, 'l', true], [/^(?:millilitres?|milliliters?|ml)$/i, 'ml', true],
  [/^(?:packs?|packets?|packages?|packung(?:en)?|päckchen)$/i, 'pack'], [/^(?:bottles?|flaschen?)$/i, 'bottle'],
  [/^(?:cans?|tins?|dosen?)$/i, 'can'], [/^(?:jars?|gläser|glas)$/i, 'jar'], [/^(?:bags?|beutel|tüten?)$/i, 'bag'],
  [/^(?:box(?:es)?|schachteln?)$/i, 'box'],
];
const capFirst = s => s.charAt(0).toLocaleUpperCase() + s.slice(1);

function voiceItem(raw) {
  let s = raw.trim().replace(/^(?:some|a\sfew|a\scouple\sof|etwas|noch)\s/i, '');
  s = s.replace(new RegExp(`^(${NUM_WORD_RE})(?=\\s)`, 'i'), w => numVal(w));
  // "a litre of milk", "eine Flasche Wein" → quantity 1
  s = s.replace(/^(?:an?|one|ein|eine|einen)\s(?=(\S+)\s)/i, (m, next) => VOICE_UNITS.some(([re]) => re.test(next.replace(/\.$/, ''))) ? '1 ' : '');
  let qty = '';
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s?(\S+)?\s+(.+)$/) || s.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
  if (m) {
    const unitWord = m[3] !== undefined ? (m[2] || '').replace(/\.$/, '') : '';
    const unit = unitWord && VOICE_UNITS.find(([re]) => re.test(unitWord));
    const n = m[1].replace(',', '.');
    if (unit) {
      const [, u, metric] = unit;
      qty = metric ? n + u : `${n} ${Number(n) === 1 ? u : u === 'box' ? 'boxes' : u + 's'}`;
      s = m[3].replace(/^(?:of|von)\s/i, '');
    } else {
      qty = n;
      s = m[3] !== undefined ? `${m[2] ? m[2] + ' ' : ''}${m[3]}` : m[2];
    }
  }
  s = s.replace(/^(?:the|a|an)\s/i, '').trim();
  return { name: capFirst(s), qty };
}

function voiceItems(text) {
  return text
    .split(/\s*(?:,|;|\s(?:and|und|plus|sowie|as\swell\sas)\s)\s*/i)
    .map(x => x.trim().replace(/^(?:and|und)\s/i, ''))
    .filter(Boolean)
    .map(voiceItem)
    .filter(x => x.name);
}

function apptTitle(rest, lang) {
  let t = rest
    .replace(/\s(?:to|in|into|on)\s(?:my\s|the\s)?(?:calendar|diary)$/i, '')
    .replace(/\s(?:in\s(?:den|meinen)\s)?kalender(?:\seintragen)?$/i, '')
    .replace(/\seintragen$/i, '')
    .replace(/^(?:please\s)?(?:add|create|schedule|book|make|put|set\sup|plan|new|neuer|neuen|trag|trage)\s(?:an?\s|the\s|einen\s)?(?:new\s)?/i, '')
    .replace(/^(?:i\shave|i've\sgot|i\shave\sgot|there\sis|there'?s|ich\shabe|wir\shaben)\s(?:an?\s|einen?\s)?/i, '')
    .replace(/^(?:appointment|event|termin|eintrag)\s?(?::|called|named|for|für)\s?/i, '')
    .trim();
  return capFirst(t) || (isGerman(lang) ? 'Termin' : 'Appointment');
}

/* Works out what a spoken sentence means.
   as: '' (work it out), 'shopping' or 'todo' (the mic in that list).
   Returns { kind: 'shopping' | 'todo' | 'appt' | 'cook' | 'unknown', heard, … }. */
function parseVoice(raw, { base = todayISO(), lang = voiceLang(), as = '' } = {}) {
  const heard = raw.trim();
  const text = heard.replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim();
  if (!text) return { kind: 'unknown', heard, text };
  const shop = firstMatch(SHOP_RES, text);
  const todo = shop == null ? firstMatch(TODO_RES, text) : null;

  const asShopping = body => {
    const items = voiceItems(body);
    return items.length ? { kind: 'shopping', items, heard } : { kind: 'unknown', heard, text };
  };
  const asTodo = body => {
    const w = extractWhen(body, base, lang);
    const title = capFirst(w.rest.replace(/^(?:an|daran|dass|zu|to|about)\s/i, '').trim());
    return title ? { kind: 'todo', title, due: w.date, heard } : { kind: 'unknown', heard, text };
  };

  if (as === 'shopping') return asShopping(shop ?? text);
  if (as === 'todo') return asTodo(firstMatch(TODO_RES, text) ?? text);
  if (shop != null) return asShopping(shop);
  if (todo != null) return asTodo(todo);

  const padded = ` ${text} `;
  const when = extractWhen(text, base, lang);
  if (COOK_RE.test(padded)) return { kind: 'cook', date: when.date || base, heard };
  if (APPT_RE.test(padded) || when.time) {
    return { kind: 'appt', title: apptTitle(when.rest, lang), date: when.date || base, time: when.time, end: when.end, heard };
  }
  return { kind: 'unknown', heard, text, date: when.date };
}

/* ===================== listening ===================== */
const VOICE_ERRORS = {
  'not-allowed': 'Microphone access is blocked. Allow the microphone for Pocket in your browser’s site settings, then try again.',
  'service-not-allowed': 'Speech recognition is turned off or not allowed in this browser. On iPhone, make sure Dictation is on (Settings → General → Keyboard).',
  'no-speech': 'I didn’t hear anything. Tap the mic and try again.',
  'audio-capture': 'No microphone was found.',
  'network': 'Voice input needs an internet connection.',
  'language-not-supported': 'This browser can’t recognise the chosen language. Pick another one under ⋯ → Voice.',
  'start-failed': 'Couldn’t start the microphone. Try again.',
};
const voiceError = code => VOICE_ERRORS[code] || 'Voice input stopped unexpectedly. Try again.';

let activeRec = null;

function listen({ onInterim, onFinal, onError, onEnd }) {
  stopListening();
  let rec;
  try { rec = new SpeechRec(); } catch (e) { onError('start-failed'); onEnd?.(); return null; }
  rec.lang = voiceLang();
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '', interim = '', failed = false, cancelled = false;
  const handle = {
    stop: () => { try { rec.stop(); } catch (e) { /* already stopped */ } },
    abort: () => { cancelled = true; try { rec.abort(); } catch (e) { /* already stopped */ } },
  };
  rec.onresult = e => {
    let f = '', i = '';
    for (const r of e.results) { if (r.isFinal) f += r[0].transcript; else i += r[0].transcript; }
    finalText = f; interim = i;
    onInterim?.(`${f} ${i}`.trim());
  };
  rec.onerror = e => {
    if (e.error === 'aborted' || cancelled) { cancelled = true; return; }
    failed = true;
    onError(e.error);
  };
  rec.onend = () => {
    if (activeRec === handle) activeRec = null;
    if (!failed && !cancelled) {
      const text = (finalText || interim).trim(); // some browsers end without marking the result final
      if (text) onFinal(text); else onError('no-speech');
    }
    onEnd?.();
  };
  activeRec = handle;
  try { rec.start(); } catch (e) { activeRec = null; onError('start-failed'); onEnd?.(); return null; }
  navigator.vibrate?.(10);
  return handle;
}
function stopListening() { const r = activeRec; activeRec = null; r?.abort(); }

/* ===================== the voice sheet (header mic) ===================== */
const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg>';

function voiceExamples(lang) {
  return isGerman(lang)
    ? ['Milch, Eier und Brot kaufen', 'Erinnere mich morgen, Anna anzurufen', 'Zahnarzt am Freitag um 15 Uhr', 'Kochen am Samstag']
    : ['Buy milk, eggs and bread', 'Remind me to call Anna tomorrow', 'Dentist on Friday at 3 pm', 'Cook on Saturday'];
}

function openVoice() {
  if (!SpeechRec) { toast('Voice input isn’t supported in this browser'); return; }
  let snapshot = null;
  openSheet({
    title: 'Voice',
    cls: 'voice-sheet',
    body: '<div class="voice" id="voice"></div>',
    handlers: {
      again: start,
      stop: () => activeRec?.stop(),
      as: b => {
        const r = parseVoice(b.dataset.heard, { as: b.dataset.kind === 'appt' ? '' : b.dataset.kind });
        if (b.dataset.kind === 'appt') {
          const w = extractWhen(b.dataset.heard, todayISO(), voiceLang());
          act({ kind: 'appt', title: apptTitle(w.rest, voiceLang()), date: w.date || todayISO(), time: w.time, end: w.end, heard: b.dataset.heard });
        } else act(r);
      },
      undo: () => {
        if (!snapshot) return;
        db = normalize(JSON.parse(snapshot));
        snapshot = null;
        commit();
        draw(`<p class="voice-done">Undone.</p>${againBtn()}`);
      },
    },
  });
  const mySeq = sheetSeq;
  sheet.addEventListener('close', stopListening, { once: true });
  start();

  function draw(html) {
    if (sheetSeq !== mySeq || !sheet.open) return false;
    $('#voice', sheet).innerHTML = html;
    return true;
  }
  function againBtn(label = 'Speak again') {
    return `<button type="button" class="btn voice-again" data-sheet="again">${MIC_SVG}${esc(label)}</button>`;
  }
  function start() {
    snapshot = null;
    const lang = voiceLang();
    draw(`<button type="button" class="voice-mic listening" data-sheet="stop" aria-label="Stop listening">${MIC_SVG}</button>
      <p class="voice-text" id="voice-text" aria-live="polite"><span class="muted">Listening…</span></p>
      <div class="voice-examples"><p>Try saying</p><ul>${voiceExamples(lang).map(x => `<li>“${esc(x)}”</li>`).join('')}</ul></div>`);
    listen({
      onInterim: t => { const el = sheetSeq === mySeq && $('#voice-text', sheet); if (el) el.textContent = t; },
      onFinal: t => {
        if (sheetSeq !== mySeq || !sheet.open) return;
        let r = parseVoice(t);
        if (r.kind === 'unknown' && tab === 'shopping') r = parseVoice(t, { as: 'shopping' });
        if (r.kind === 'unknown' && tab === 'todos') r = parseVoice(t, { as: 'todo' });
        act(r);
      },
      onError: code => draw(`<p class="voice-err" role="alert">${esc(voiceError(code))}</p>${againBtn('Try again')}`),
      onEnd: () => { const b = sheetSeq === mySeq && $('.voice-mic', sheet); if (b) b.classList.remove('listening'); },
    });
  }

  function act(r) {
    const heard = `<p class="voice-heard">“${esc(r.heard)}”</p>`;
    if (r.kind === 'appt') { editAppt(null, r.date, { title: r.title, time: r.time, end: r.end }); return; }
    if (r.kind === 'cook') { editCook(null, r.date); return; }
    if (r.kind === 'shopping') {
      snapshot = JSON.stringify(db);
      const { added, already } = addShoppingItems(r.items);
      draw(`${heard}<div class="voice-result c-shop"><h3>${added.length ? 'Added to Shopping' : 'Nothing new for Shopping'}</h3>
        ${added.length ? `<ul>${added.map(x => `<li>${esc(x.name)}${x.qty ? ` <span class="qty">${esc(qtyLabel(x.qty))}</span>` : ''}</li>`).join('')}</ul>` : ''}
        ${already.length ? `<p class="hint">Already on the list: ${esc(already.join(', '))}</p>` : ''}</div>
        <div class="voice-actions">${againBtn()}${added.length ? '<button type="button" class="btn" data-sheet="undo">Undo</button>' : ''}</div>`);
      return;
    }
    if (r.kind === 'todo') {
      snapshot = JSON.stringify(db);
      db.todos.push({ id: uid(), title: r.title, due: r.due || '', notes: '', done: false, doneAt: null, created: Date.now() });
      commit();
      draw(`${heard}<div class="voice-result c-todo"><h3>Added to To-dos</h3>
        <ul><li>${esc(r.title)}${r.due ? ` <span class="qty">${esc(dayLabel(r.due))}</span>` : ''}</li></ul></div>
        <div class="voice-actions">${againBtn()}<button type="button" class="btn" data-sheet="undo">Undo</button></div>`);
      return;
    }
    const h = esc(r.heard);
    draw(`${heard}<p class="voice-q">Where should this go?</p>
      <div class="choose">
        <button type="button" class="c-shop" data-sheet="as" data-kind="shopping" data-heard="${h}"><span class="dot"></span>Shopping list</button>
        <button type="button" class="c-todo" data-sheet="as" data-kind="todo" data-heard="${h}"><span class="dot"></span>To-do</button>
        <button type="button" class="c-cal" data-sheet="as" data-kind="appt" data-heard="${h}"><span class="dot"></span>Appointment</button>
      </div>${againBtn()}`);
  }
}

// Adds several items at once. Returns what was added and what was already on the list.
function addShoppingItems(items) {
  const added = [], already = [];
  for (const { name, qty } of items) {
    const idx = db.shopping.findIndex(x => x.name.toLowerCase() === name.toLowerCase());
    const ex = db.shopping[idx];
    if (ex && !ex.done) {
      if (qty) { ex.qty = qty; added.push({ name: ex.name, qty }); } else already.push(ex.name);
    } else if (ex) {
      db.shopping.splice(idx, 1);
      db.shopping.push({ ...ex, done: false, doneAt: null, qty: qty || ex.qty });
      added.push({ name: ex.name, qty: qty || ex.qty });
    } else {
      db.shopping.push({ id: uid(), name, qty, done: false, doneAt: null, created: Date.now() });
      added.push({ name, qty });
    }
    remember(name);
  }
  commit();
  return { added, already };
}

/* ===================== mic in the add bars ===================== */
function dictateInto(kind, btn) {
  if (activeRec && btn.classList.contains('listening')) { activeRec.stop(); return; }
  const input = btn.form.querySelector('input');
  const placeholder = input.placeholder;
  btn.classList.add('listening');
  btn.setAttribute('aria-pressed', 'true');
  input.value = '';
  input.placeholder = 'Listening…';
  const done = () => {
    btn.classList.remove('listening');
    btn.setAttribute('aria-pressed', 'false');
    input.placeholder = placeholder;
  };
  listen({
    onInterim: t => { input.value = t; },
    onFinal: t => {
      input.value = '';
      const r = parseVoice(t, { as: kind === 'shop' ? 'shopping' : 'todo' });
      if (r.kind === 'shopping') {
        const snapshot = JSON.stringify(db);
        const { added, already } = addShoppingItems(r.items);
        if (added.length) toast(`Added ${added.map(x => x.name).join(', ')}`, () => { db = normalize(JSON.parse(snapshot)); commit(); });
        else if (already.length) toast(`Already on the list: ${already.join(', ')}`);
      } else if (r.kind === 'todo') {
        const snapshot = JSON.stringify(db);
        db.todos.push({ id: uid(), title: r.title, due: r.due || '', notes: '', done: false, doneAt: null, created: Date.now() });
        commit();
        toast(`Added “${r.title}”${r.due ? ` · ${dayLabel(r.due)}` : ''}`, () => { db = normalize(JSON.parse(snapshot)); commit(); });
      } else {
        input.value = t; // couldn't make sense of it: leave the words in the box to fix and add
        input.focus();
      }
    },
    onError: code => { input.value = ''; toast(voiceError(code)); },
    onEnd: done,
  }) || done();
}

/* ===================== settings ===================== */
function voiceSettingHTML() {
  if (!SpeechRec) {
    return `<h3>Voice</h3><p class="hint">This browser doesn’t support voice input. It works in Chrome and Edge on Android and in Safari on iPhone.</p>`;
  }
  const cur = voiceLang();
  return `<h3>Voice</h3>
    <p class="hint">Tap the mic at the top to say things like “buy milk and eggs”, “remind me to call Anna tomorrow” or “dentist on Friday at 3 pm”.
      Commands are understood in English and German. Your browser turns speech into text, so the recording goes to Google (Chrome) or Apple (Safari), not to Pocket.</p>
    <label class="select-wrap voice-lang"><span class="sr-only">Speech language</span>
      <select name="voicelang">${VOICE_LANGS.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
}

/* ===================== wiring ===================== */
if (SpeechRec) {
  for (const el of $$('[data-voice]')) el.hidden = false;
  $('#voice-btn').addEventListener('click', openVoice);
  for (const b of $$('.mic-btn')) b.addEventListener('click', () => dictateInto(b.dataset.mic, b));
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopListening(); });
  window.addEventListener('hashchange', stopListening);
  for (const b of $$('.tabbar button')) b.addEventListener('click', stopListening);
}
document.addEventListener('change', e => {
  if (e.target.name === 'voicelang' && e.target.closest('#sheet')) {
    db.prefs.voiceLang = e.target.value;
    persist();
  }
});

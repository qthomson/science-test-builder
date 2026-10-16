/* writer.js — "My questions": teacher-written questions beyond the single multiple-choice form.
 *
 * One editor builds a written-response question or a whole cluster: any mix of passages, multiple-choice questions
 * and written questions, each written question with its own answer space (lines, blank area, box, short blank with a
 * unit, labelled lines, check boxes, a graph grid, a table to fill in, or a picture to write on). A question can start
 * as a copy of a Regents question, picked from the worksheet or found by a word search of the whole subject.
 *
 * A record: { id: 'cc_…', title, shared, based, created, updated, parts: [
 *     { t: 'passage', heading, text, figs: [{src, w, h}] },
 *     { t: 'mc', stem, figs, choices: [4 strings], cimgs: [pictures or null], answer, unit, type },
 *     { t: 'cr', stem, figs, credit, space: {kind, …}, note, unit, type } ] }
 * build(rec) turns it into what the app already knows: an old-format cluster (bank entry + text record), so the list,
 * the preview with its tick boxes, the worksheet, the key and the exports need nothing new. Passages after the first
 * question ride on the next question as `pre` blocks.
 * Text markup in every field: H_2O or x_{10} subscript, 10^3 or 10^{-3} superscript, *italic*, **bold**.
 * Storage: the signed-in backend (private unless shared), or this browser on the plain website.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = (tag, attrs, html) => { const e = document.createElement(tag); if (attrs) for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k === 'style') e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); } if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const DPI = 150, num = (v, d) => { const n = Number(v); return isFinite(n) && n > 0 ? n : d; }, linesOf = s => String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  let A = null, RECS = [];

  // ------------------------------------------------------------------------------------------------ text <-> runs
  const TOKEN = /\*\*(.+?)\*\*|\*(\S(?:[^*]*?\S)?)\*|([_^])\{([^}]*)\}|(?<=[^\s_^])([_^])([A-Za-z0-9+−-])/g;
  function parseRuns(text) {
    const runs = []; let last = 0, m; const s = String(text || ''); TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(s))) {
      if (m.index > last) runs.push({ s: s.slice(last, m.index) });
      if (m[1] != null) runs.push({ s: m[1], b: true }); else if (m[2] != null) runs.push({ s: m[2], i: true });
      else { const key = (m[3] || m[5]) === '_' ? 'sub' : 'sup', r = { s: m[4] != null ? m[4] : m[6] }; r[key] = true; runs.push(r); }
      last = TOKEN.lastIndex;
    }
    if (last < s.length) runs.push({ s: s.slice(last) });
    return runs.length ? runs : [{ s: '' }];
  }
  const runText = r => r.frac ? `(${rt(r.frac.num)})/(${rt(r.frac.den)})` : r.sqrt ? `sqrt(${rt(r.sqrt)})` : r.stack ? `${rt(r.stack.top)}/${rt(r.stack.bot)}` : r.br ? '\n' : (r.s || '');
  const rt = x => Array.isArray(x) ? x.map(runText).join('') : String(x == null ? '' : x);
  function runsToMarkup(runs) {
    return (runs || []).map(r => { if (r.stack) return `^{${rt(r.stack.top)}}_{${rt(r.stack.bot)}}`;      // mass number over atomic number: typed as a superscript then a subscript
      const t = runText(r); if (!t) return '';
      if (r.sub) return t.length === 1 && /[A-Za-z0-9+−-]/.test(t) ? '_' + t : `_{${t}}`;
      if (r.sup) return t.length === 1 && /[A-Za-z0-9+−-]/.test(t) ? '^' + t : `^{${t}}`;
      if (r.b && t.trim()) return `**${t}**`; if (r.i && t.trim()) return `*${t}*`; return t; }).join('');
  }
  const plain = s => String(s || '').replace(/\*\*|\*|[_^]\{([^}]*)\}/g, (m, a) => a || '').replace(/([^\s_^])[_^]([A-Za-z0-9+−-])/g, '$1$2').replace(/\s+/g, ' ').trim();
  const textToBlocks = text => linesOf(text).map(ln => ({ t: 'p', runs: parseRuns(ln) }));
  const figBlocks = (figs, maxW, sc) => (figs || []).map(f => { const w = Math.min(f.w / DPI * (sc || 1), maxW || 6.6); return { t: 'img', src: f.src, w_in: +w.toFixed(3), h_in: +(w * f.h / f.w).toFixed(3) }; });

  // ------------------------------------------------------------------------------------------------ answer spaces
  const SPACES = [['lines', 'Ruled lines'], ['work', 'Work space with an answer blank'], ['blank', 'Blank space'], ['box', 'Box'], ['short', 'Short blank, with a label or unit'], ['labelled', 'Labelled lines'], ['checks', 'Check boxes'],
                  ['grid', 'Graph grid'], ['table', 'Table to fill in'], ['picture', 'A picture to write or draw on'], ['none', 'No answer space']];
  function canvasPic(wIn, hIn, draw) { const c = document.createElement('canvas'); c.width = Math.round(wIn * DPI); c.height = Math.round(hIn * DPI); const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.strokeStyle = '#000'; g.fillStyle = '#000'; draw(g, DPI); return { src: c.toDataURL('image/png'), w: c.width, h: c.height }; }
  function makeGrid(s) {
    const cols = Math.min(40, Math.max(2, Math.round(num(s.cols, 10)))), rows = Math.min(40, Math.max(2, Math.round(num(s.rows, 10)))), cell = Math.min(0.3, 5.2 / cols, 4.2 / rows);
    const L = s.ylab ? 0.5 : 0.08, T = s.title ? 0.34 : 0.06, Bm = s.xlab ? 0.36 : 0.08, gw = cols * cell, gh = rows * cell;
    return canvasPic(L + gw + 0.08, T + gh + Bm, (g, d) => {
      g.lineWidth = 1; g.strokeStyle = '#8a8a8a';
      for (let i = 0; i <= cols; i++) { const x = Math.round((L + i * cell) * d) + 0.5; g.beginPath(); g.moveTo(x, T * d); g.lineTo(x, (T + gh) * d); g.stroke(); }
      for (let j = 0; j <= rows; j++) { const y = Math.round((T + j * cell) * d) + 0.5; g.beginPath(); g.moveTo(L * d, y); g.lineTo((L + gw) * d, y); g.stroke(); }
      g.strokeStyle = '#000'; g.lineWidth = 2; g.strokeRect(L * d, T * d, gw * d, gh * d);
      g.font = 'bold 17px Arial, Helvetica, sans-serif'; g.textAlign = 'center';
      if (s.title) g.fillText(s.title, (L + gw / 2) * d, 0.2 * d);
      if (s.xlab) g.fillText(s.xlab, (L + gw / 2) * d, (T + gh + 0.26) * d);
      if (s.ylab) { g.save(); g.translate(0.22 * d, (T + gh / 2) * d); g.rotate(-Math.PI / 2); g.fillText(s.ylab, 0, 0); g.restore(); }
    });
  }
  function makeTable(s) {
    const heads = String(s.heads || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean), cols = Math.max(2, heads.length), rows = Math.min(20, Math.max(1, Math.round(num(s.rows, 4))));
    const W = Math.min(6.2, cols * 1.6), cw = W / cols, hh = 0.42, rh = 0.38;
    return canvasPic(W + 0.04, hh + rows * rh + 0.04, (g, d) => {
      g.lineWidth = 1.5; g.strokeRect(0.02 * d, 0.02 * d, W * d, (hh + rows * rh) * d);
      for (let i = 1; i < cols; i++) { g.beginPath(); g.moveTo((0.02 + i * cw) * d, 0.02 * d); g.lineTo((0.02 + i * cw) * d, (0.02 + hh + rows * rh) * d); g.stroke(); }
      for (let j = 0; j < rows; j++) { const y = (0.02 + hh + j * rh) * d; g.beginPath(); g.moveTo(0.02 * d, y); g.lineTo((0.02 + W) * d, y); g.stroke(); }
      g.font = 'bold 16px Arial, Helvetica, sans-serif'; g.textAlign = 'center';
      heads.forEach((h, i) => g.fillText(h, (0.02 + (i + 0.5) * cw) * d, 0.28 * d, cw * d - 8));
    });
  }
  function respOf(s) {
    if (!s) return null;
    const pic = kind => s.img ? { kind: 'template', img: s.img.src, w_in: +(Math.min(s.img.w / DPI, 6.4)).toFixed(3), h_in: +(Math.min(s.img.w / DPI, 6.4) * s.img.h / s.img.w).toFixed(3), template_kind: kind } : null;
    switch (s.kind) {
      case 'lines': return { kind: 'lines', lines: s.n ? Math.min(25, Math.max(1, Math.round(num(s.n, 2)))) : null };     // null: the sheet's default count
      case 'blank': return { kind: 'blank', h_in: num(s.h, 1.5) };
      case 'box': return { kind: 'box', box_h_in: num(s.h, 2) };
      case 'short': { const parts = []; if (s.label) parts.push({ runs: parseRuns(s.label) }); parts.push({ blank_in: num(s.len, 2) }); if (s.unit) parts.push({ runs: parseRuns(s.unit).map(r => Object.assign(r, { b: true })) }); return { kind: 'labelled-blank', parts }; }
      case 'work': { const parts = [{ runs: parseRuns(s.label || 'Answer:') }, { blank_in: num(s.len, 1.5) }]; if (s.unit) parts.push({ runs: parseRuns(s.unit).map(r => Object.assign(r, { b: true })) }); return { kind: 'labelled-blank', parts, pre_blank_in: num(s.h, 1.5) }; }
      case 'labelled': { const labs = linesOf(s.labels); return labs.length ? { kind: 'lines', lines: labs.length, labels: labs.map((l, i) => ({ line: i + 1, runs: parseRuns(l) })) } : { kind: 'lines', lines: 2 }; }
      case 'checks': { const o = linesOf(s.options); return o.length ? { kind: 'lines', lines: 0, boxes: o.map(x => ({ runs: parseRuns(x) })), boxes_stack: true } : null; }
      case 'grid': return pic('graph-grid'); case 'table': return pic('table'); case 'picture': return pic('diagram');
      case 'orig': return s.resp || null;
      default: return null;
    }
  }

  // ------------------------------------------------------------------------------------------------ importing a question written from the handoff
  const HANDOFF_URL = 'https://qthomson.github.io/science-test-builder/docs/question-import-handoff.md';
  const IMG_RE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/;
  const measure = src => new Promise(res => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res(null); im.src = src; });
  /** the part of the handoff that comes from the app's own tables: this subject's units, question types and standards */
  function handoffAppendix() {
    const S = A.SUBJECT || {}, T = A.T || {}, NT = A.NT || {}, order = A.UORDER || [], retired = new Set(((window.UNIT_MAP || {}).retired || []).map(Number));
    const L = [];
    L.push('<!-- APPENDIX -->', '', `## Appendix: ${S.name || 'this subject'} (generated by the app on ${new Date().toISOString().slice(0, 10)})`, '',
           `This file was downloaded from the **${S.name || ''}** app, so every question is for ${S.name || 'this subject'}. The lists below come straight from the app and are the only valid codes.`, '');
    L.push('### Units (`"unit"`: use the id)', '');
    order.forEach(u => L.push(`- ${u}: ${A.uLabel(u)}`));
    const SUBS = (window.BANK || {}).subtopics || [], subName = id => { const s = SUBS.find(x => String(x.id) === String(id)); return s ? s.name : null; };
    // types listed by unit (and by subtopic where the subject has them): the subtopic of a question follows from its type
    const listTypes = (table, keys, label) => {
      const byUnit = {}; keys.forEach(t => { const u = table[t].unit == null ? 'none' : String(table[t].unit); (byUnit[u] = byUnit[u] || []).push(t); });
      const units = Object.keys(byUnit).sort((a, b) => (a === 'none') - (b === 'none') || order.indexOf(Number(a)) - order.indexOf(Number(b)));
      units.forEach(u => {
        L.push('', `#### ${u === 'none' ? 'Not tied to a unit' : A.uLabel(Number(u))}`);
        const ts = byUnit[u].sort((a, b) => (table[a].subtopic ?? 0) - (table[b].subtopic ?? 0) || ((table[a].order ?? a) - (table[b].order ?? b)));
        let lastSub = undefined;
        ts.forEach(t => {
          const sub = SUBS.length ? (subName(table[t].subtopic) || 'Other') : null;
          if (sub !== null && sub !== lastSub) { L.push('', `Subtopic: ${sub}`, ''); lastSub = sub; }
          L.push(`- ${t}${label(t)}: ${table[t].name}${table[t].desc ? ' — ' + String(table[t].desc).replace(/\s+/g, ' ') : ''}`);
        });
      });
    };
    L.push('', '### Old Regents question types (`"type"`: use the number; the name says what the question looks like)' + (SUBS.length ? '. Pick the type under the right subtopic: the app files a question under its subtopic by its type, so there is no subtopic field.' : ''));
    listTypes(T, Object.keys(T).map(Number).filter(t => !retired.has(t)), t => ` (${T[t].code || 'T' + t})`);
    const nkeys = Object.keys(NT).map(Number);
    if (nkeys.length) {
      L.push('', '### New-format question types (`"ntype"`, new-style clusters only: use the number)' + (SUBS.length ? ', by unit and subtopic' : ''));
      listTypes(NT, nkeys, () => '');
      const pes = {}; (A.NC || []).forEach(c => (c.questions || []).forEach(q => (q.pe || []).forEach(p => { pes[p] = (pes[p] || 0) + 1; })));
      const codes = Object.keys(pes).sort((a, b) => a.replace(/\d+/g, d => d.padStart(3, '0')) < b.replace(/\d+/g, d => d.padStart(3, '0')) ? -1 : 1);
      L.push('', '### Performance expectations seen on this subject\'s new-format exams (`"pe"`, new-style clusters only)', '', 'NYSSLS / NGSS high-school codes; the count is how many exam questions have carried each so far. Other HS- codes of this subject are allowed when they fit.', '');
      codes.forEach(p => L.push(`- ${p} (${pes[p]})`));
    } else L.push('', '_This subject has no new-format clusters yet: write old-style questions only (no "style": "new")._');
    return L.join('\n') + '\n';
  }
  /** obj (parsed JSON) -> { rec, errors, warnings }. rec is a fresh record of the teacher's own, ready for the editor. */
  async function importQuestion(obj) {
    const errors = [], warnings = [], isObj = x => x && typeof x === 'object' && !Array.isArray(x);
    if (Array.isArray(obj) && obj.length === 1 && isObj(obj[0])) obj = obj[0];
    if (!isObj(obj)) return { errors: ['The file must hold one question object (see section 1 of the handoff).' + (Array.isArray(obj) ? ' It holds a list of ' + obj.length + '.' : '')], warnings };
    if (isObj(obj.question) && !obj.parts) obj = obj.question;
    const parts = obj.parts;
    if (!Array.isArray(parts) || !parts.length) return { errors: ['"parts" must be a non-empty list of passage, mc and cr parts.'], warnings };
    if (parts.length > 12) errors.push(`${parts.length} parts; at most 12 in one file.`);
    const str = (v, what, where, req) => { if (v == null || v === '') { if (req) errors.push(`${where}: "${what}" is missing.`); return ''; } if (typeof v !== 'string') { if (typeof v === 'number') return String(v); errors.push(`${where}: "${what}" must be text.`); return ''; } return v; };
    const numIn = (v, lo, hi, what, where, d) => { if (v == null || v === '') return d; const n = Number(v); if (!isFinite(n) || n < lo || n > hi) { errors.push(`${where}: "${what}" must be a number from ${lo} to ${hi} (got ${JSON.stringify(v)}).`); return d; } return n; };
    const pic = async (v, where) => {
      if (!v) return null;
      const src = typeof v === 'string' ? v : v.src;
      if (typeof src !== 'string' || !IMG_RE.test(src.replace(/\s+/g, ''))) { errors.push(`${where}: a picture must be a PNG or JPEG data URL ("data:image/png;base64,…"); a file name or a web address cannot be imported.`); return null; }
      if (src.length > 2.8e6) { errors.push(`${where}: a picture is larger than 2 MB. Ask for it at 900 pixels wide or less.`); return null; }
      const m = await measure(src);
      if (!m) { errors.push(`${where}: a picture could not be decoded (not a valid image).`); return null; }
      const w = Number(v.w) > 0 ? Number(v.w) : m.w, h = Number(v.h) > 0 ? Number(v.h) : m.h;
      if (Math.abs(w - m.w) > 2 || Math.abs(h - m.h) > 2) warnings.push(`${where}: the picture's stated size was ${v.w}×${v.h}; it is really ${m.w}×${m.h} and that size is used.`);
      if (m.w > 1400) warnings.push(`${where}: a picture is ${m.w} pixels wide (prints ${(m.w / DPI).toFixed(1)} in at 150 dpi); it will be shrunk to fit the page.`);
      return { src, w: m.w, h: m.h };
    };
    const figsOf = async (v, where) => { if (v == null) return []; if (!Array.isArray(v)) { errors.push(`${where}: "figs" must be a list of pictures.`); return []; } const out = []; for (let i = 0; i < v.length; i++) { const p = await pic(v[i], `${where}, picture ${i + 1}`); if (p) out.push(p); } return out; };
    const units = (A.UORDER || []).map(String), types = Object.keys(A.T || {});
    const unitOf = (v, where) => { if (v == null || v === '' || v === 'misc') return 'misc'; if (units.includes(String(v))) return String(v); warnings.push(`${where}: unit "${v}" is not one of this subject's units; set it in the editor.`); return 'misc'; };
    const typeOf = (v, where) => { if (v == null || v === '' || v === 'misc') return 'misc'; if (types.includes(String(v))) return String(v); warnings.push(`${where}: type "${v}" is not one of this subject's question types; set it in the editor.`); return 'misc'; };
    const newStyle = obj.style === 'new', NT = A.NT || {}, peSeen = new Set(); (A.NC || []).forEach(c => (c.questions || []).forEach(q => (q.pe || []).forEach(p => peSeen.add(p))));
    if (obj.style != null && obj.style !== 'new' && obj.style !== 'old') errors.push(`"style" must be "old" or "new" (got ${JSON.stringify(obj.style)}).`);
    if (newStyle && !(A.NC || []).length) errors.push('"style": "new" needs the New clusters tab, which this subject does not have yet.');
    const ntypeOf = (v, where) => { if (v == null || v === '' || v === 'misc') return 'misc'; if (NT[String(v)]) return String(v); warnings.push(`${where}: new-format type "${v}" is not one of this subject's N-types; set it in the editor.`); return 'misc'; };
    const peOf = (v, where) => { const list = peList(v), ok = []; list.forEach(p => { if (!/^HS-[A-Z]{2,4}\d?-\d+$/.test(p)) warnings.push(`${where}: "${p}" is not a performance expectation code (like HS-PS2-1) and was dropped.`); else { if (!peSeen.has(p)) warnings.push(`${where}: standard ${p} has not appeared on this subject's new exams yet (kept).`); ok.push(p); } }); if (newStyle && !ok.length) warnings.push(`${where}: no standard ("pe"); set one in the editor.`); return ok; };
    const known = { passage: ['t', 'heading', 'text', 'figs'], mc: ['t', 'stem', 'figs', 'choices', 'cimgs', 'answer', 'thead', 'eq', 'unit', 'type', 'layout', 'pe', 'ntype'], cr: ['t', 'stem', 'figs', 'credit', 'space', 'note', 'unit', 'type', 'layout', 'pe', 'ntype'] };
    const outParts = []; let nq = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], where = `Part ${i + 1}`;
      if (!isObj(p)) { errors.push(`${where} is not an object.`); continue; }
      const t = p.t === 'passage' || p.t === 'mc' || p.t === 'cr' ? p.t : null;
      if (!t) { errors.push(`${where}: "t" must be "passage", "mc" or "cr" (got ${JSON.stringify(p.t)}).`); continue; }
      Object.keys(p).filter(k => !known[t].includes(k)).forEach(k => warnings.push(`${where}: field "${k}" is not used and was dropped.`));
      if (t === 'passage') {
        const text = str(p.text, 'text', where, false), figs = await figsOf(p.figs, where);
        if (!text && !figs.length) errors.push(`${where}: a passage needs "text" or a picture.`);
        outParts.push({ t: 'passage', heading: str(p.heading, 'heading', where, false), text, figs });
        continue;
      }
      nq++;
      const stem = str(p.stem, 'stem', where, true), figs = await figsOf(p.figs, where);
      if (t === 'mc') {
        let ch = p.choices;
        if (!Array.isArray(ch) || ch.length !== 4) { errors.push(`${where}: "choices" must be a list of exactly four${Array.isArray(ch) ? ' (got ' + ch.length + ')' : ''}.`); ch = ['', '', '', '']; }
        ch = ch.map((c, k) => str(c, `choice ${k + 1}`, where, false));
        let cimgs = null;
        if (p.cimgs != null) {
          if (!Array.isArray(p.cimgs) || p.cimgs.length !== 4) errors.push(`${where}: "cimgs" must be a list of four pictures (or null for a text choice).`);
          else { cimgs = []; for (let k = 0; k < 4; k++) cimgs.push(await pic(p.cimgs[k], `${where}, choice picture ${k + 1}`)); if (!cimgs.some(Boolean)) cimgs = null; }
        }
        if (!cimgs && ch.some(c => !c.trim())) errors.push(`${where}: every choice needs text (or give four choice pictures).`);
        const answer = numIn(p.answer, 1, 4, 'answer', where, null);
        if (answer == null || answer !== Math.round(answer)) errors.push(`${where}: "answer" must be 1, 2, 3 or 4.`);
        const thead = str(p.thead, 'thead', where, false);
        if (thead) { const n = thead.split('|').length; ch.forEach((c, k) => { if (c.split('|').length !== n) errors.push(`${where}: choice ${k + 1} has a different number of "|" cells than "thead".`); }); }
        outParts.push(Object.assign({ t: 'mc', stem, figs, choices: ch, cimgs, answer: answer || 1, thead, eq: str(p.eq, 'eq', where, false), unit: unitOf(p.unit, where), type: typeOf(p.type, where) }, newStyle ? { pe: peOf(p.pe, where), ntype: ntypeOf(p.ntype, where) } : {}));
      } else {
        const credit = numIn(p.credit, 1, 10, 'credit', where, 1);
        const note = str(p.note, 'note', where, false); if (!note) warnings.push(`${where}: no scoring "note"; the key will have nothing for this question.`);
        let s = p.space; const sp = {};
        if (s == null) { sp.kind = 'lines'; warnings.push(`${where}: no "space"; ruled lines are used.`); }
        else if (!isObj(s)) { errors.push(`${where}: "space" must be an object with a "kind".`); s = {}; sp.kind = 'lines'; }
        else {
          const kinds = SPACES.map(([k]) => k);
          if (!kinds.includes(s.kind)) { errors.push(`${where}: space kind "${s.kind}" is not one of ${kinds.join(', ')}.`); sp.kind = 'lines'; }
          else sp.kind = s.kind;
          const list = v => Array.isArray(v) ? v.map(x => String(x)).join('\n') : str(v, 'list', where, false);
          switch (sp.kind) {
            case 'lines': if (s.n != null && s.n !== '') sp.n = numIn(s.n, 1, 25, 'n', where, ''); break;
            case 'work': sp.h = numIn(s.h, 0.3, 6, 'h', where, 1.5); sp.label = str(s.label, 'label', where, false) || 'Answer:'; sp.len = numIn(s.len, 0.5, 5, 'len', where, 1.5); sp.unit = str(s.unit, 'unit', where, false); break;
            case 'short': sp.label = str(s.label, 'label', where, false); sp.len = numIn(s.len, 0.5, 5, 'len', where, 2); sp.unit = str(s.unit, 'unit', where, false); break;
            case 'blank': sp.h = numIn(s.h, 0.3, 6, 'h', where, 1.5); break;
            case 'box': sp.h = numIn(s.h, 0.5, 6, 'h', where, 2); break;
            case 'labelled': sp.labels = list(s.labels); if (!sp.labels.trim()) errors.push(`${where}: a "labelled" space needs "labels".`); break;
            case 'checks': sp.options = list(s.options); if (!sp.options.trim()) errors.push(`${where}: a "checks" space needs "options".`); break;
            case 'grid': sp.cols = numIn(s.cols, 2, 40, 'cols', where, 10); sp.rows = numIn(s.rows, 2, 40, 'rows', where, 10); sp.title = str(s.title, 'title', where, false); sp.xlab = str(s.xlab, 'xlab', where, false); sp.ylab = str(s.ylab, 'ylab', where, false); break;
            case 'table': sp.heads = Array.isArray(s.heads) ? s.heads.map(String).join(', ') : str(s.heads, 'heads', where, false); sp.rows = numIn(s.rows, 1, 20, 'rows', where, 4); if (!sp.heads.trim()) errors.push(`${where}: a "table" space needs "heads".`); break;
            case 'picture': sp.img = await pic(s.img, `${where}, answer picture`); if (!sp.img) errors.push(`${where}: a "picture" space needs "img".`); break;
            default: break;
          }
        }
        outParts.push(Object.assign({ t: 'cr', stem, figs, credit: Math.round(credit), space: sp, note, unit: unitOf(p.unit, where), type: typeOf(p.type, where) }, newStyle ? { pe: peOf(p.pe, where), ntype: ntypeOf(p.ntype, where) } : {}));
      }
    }
    if (!nq) errors.push('The file has no question: add an mc or cr part.');
    const firstQ = outParts.findIndex(p => p.t !== 'passage');
    if (firstQ > 0 && outParts.length > 1 && nq === 1 && outParts[0].t === 'passage') warnings.push('A passage with one question: fine, it prints as one question with its text above.');
    const title = str(obj.title, 'title', 'The file', false).slice(0, 120) || (outParts.find(p => p.stem) || {}).stem.slice(0, 60) || 'Imported question';
    const figScale = obj.figScale == null ? undefined : numIn(obj.figScale, 10, 200, 'figScale', 'The file', 100);
    const rec = { id: 'cc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title, shared: false, created: Date.now(), updated: Date.now(), mine: true, parts: outParts, style: newStyle ? 'new' : 'old' };
    if (newStyle && !outParts.some(p => p.t === 'passage')) warnings.push('A new-format cluster usually starts with a passage (the scenario); this one has none.');
    if (figScale) rec.figScale = figScale;
    outParts.forEach(p => { if (p.t === 'cr') regenPic(p); });
    return { rec, errors, warnings };
  }

  // ------------------------------------------------------------------------------------------------ record -> bank entry + text record
  const SUBJECT_KNOWLEDGE = { physics: 'Physical Science: Physics', chemistry: 'Physical Science: Chemistry', earth: 'Earth and Space Sciences', biology: 'Life Science: Biology' };
  const peList = v => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : String(v || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
  const isNewStyle = rec => rec && rec.style === 'new';
  /** a new-format cluster (the New clusters tab): a titled scenario, questions tagged with a performance expectation and a
   *  new-format type; meta = a bank-new cluster entry, text = its text record (lead, passages, q blocks) */
  function buildNew(rec) {
    const FS = Math.min(2, Math.max(0.1, (Number(rec.figScale) || 100) / 100)), NT = A.NT || {};
    const blocks = [], questions = [], ptext = []; let qn = 0, hasLead = false;
    (rec.parts || []).forEach(p => {
      if (p.t === 'passage') {
        const bl = [].concat(p.heading ? [{ t: 'p', role: 'heading', runs: [{ s: p.heading, b: true }] }] : [], textToBlocks(p.text), figBlocks(p.figs, null, FS));
        if (/base your answers/i.test(p.text || '')) hasLead = true;
        if (bl.length) { blocks.push({ t: 'passage', blocks: bl }); ptext.push(plain(p.text)); }
        return;
      }
      qn++;
      const stem = textToBlocks(p.stem).concat(p.eq && p.eq.trim() ? [{ t: 'eq', runs: parseRuns(p.eq.trim()) }] : [], figBlocks(p.figs, 6.2, FS));
      const nt = p.ntype == null || p.ntype === '' || p.ntype === 'misc' ? null : Number(p.ntype), unit = nt && NT[nt] ? NT[nt].unit : (p.unit == null || p.unit === '' || p.unit === 'misc' ? null : Number(p.unit));
      const base = { q: qn, mc: p.t === 'mc', types: nt ? [nt] : [], type: nt, unit, subtopic: nt && NT[nt] ? NT[nt].subtopic : null, descriptor: plain(p.stem).slice(0, 100), pe: peList(p.pe), tag_confidence: 'T' };
      if (p.t === 'mc') {
        const cs = (p.choices || ['', '', '', '']).slice(0, 4), imgs = p.cimgs || [];
        let choices = cs.map((c, k) => imgs[k] ? { img: imgs[k].src, w_in: +(Math.min(imgs[k].w / DPI * FS, 3)).toFixed(3), h_in: +(Math.min(imgs[k].w / DPI * FS, 3) * imgs[k].h / imgs[k].w).toFixed(3) } : { runs: parseRuns(c) });
        const any = imgs.some(Boolean), all = any && cs.every((c, k) => imgs[k]);
        let choice_layout = all ? 'grid' : any ? 'stacked' : cs.every(c => plain(c).length <= 18) ? 'grid' : 'stacked', table_head;
        if (p.thead && p.thead.trim()) { table_head = p.thead.split('|').map(h => ({ runs: parseRuns(h.trim()) })); choices = cs.map(c => ({ cells: c.split('|').map(s => ({ runs: parseRuns(s.trim()) })) })); choice_layout = 'table'; }
        const answer = Math.min(4, Math.max(1, Number(p.answer) || 1));
        blocks.push(Object.assign({ t: 'q', q: qn, mc: true, credit: 1, blocks: stem, choices, choice_layout, key: { credit: 1, mc_answer: answer, blocks: [{ t: 'p', role: 'rule', runs: [{ s: `Allow 1 credit for ${answer}.` }] }] } }, table_head ? { table_head } : {}));
        questions.push(Object.assign(base, { credit: 1, answer, has_key: true, text: (plain(p.stem) + ' ' + cs.map((c, k) => `(${k + 1}) ${plain(c)}`).join(' ')).trim() }));
      } else {
        const credit = Math.max(1, Math.round(num(p.credit, 1)));
        blocks.push({ t: 'q', q: qn, mc: false, credit, blocks: stem, resp: respOf(p.space), key: { credit, blocks: textToBlocks(p.note) } });
        questions.push(Object.assign(base, { credit, answer: null, has_key: !!(p.note && p.note.trim()), text: plain(p.stem) }));
      }
    });
    const order = A.UORDER || [], units = [...new Set(questions.map(q => q.unit).filter(u => u != null))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const title = rec.title || 'My cluster', know = SUBJECT_KNOWLEDGE[window.SUBJECT_ID] || 'science';
    const text = { id: rec.id, group: [1, Math.max(1, qn)], title, lead: hasLead ? null : { runs: [{ s: `Base your answers to questions {a} through {b} on the information below and on your knowledge of ${know}.` }] }, blocks, fidelity: 'text' };
    const meta = { id: rec.id, kind: 'ncl', custom: true, owner: rec.owner || '', mine: rec.mine !== false, shared: !!rec.shared, exam: 'custom', code: 'custom', year: '', session: 'Custom', sample: false,
                   group: [1, Math.max(1, qn)], title, questions, pages: [], n_mc: questions.filter(q => q.mc).length, n_cr: questions.filter(q => !q.mc).length, units, max_unit: units.length ? Math.max(...units) : null,
                   text: [title].concat(ptext, questions.map(q => q.text)).join(' ') };
    return { meta, text };
  }
  function build(rec) {
    if (isNewStyle(rec)) return buildNew(rec);
    const FS = Math.min(2, Math.max(0.1, (Number(rec.figScale) || 100) / 100));   // the question's own diagram size (10-200 %)
    const items = [], lead = [], metaItems = []; let pend = [], qn = 0;
    (rec.parts || []).forEach(p => {
      if (p.t === 'passage') { pend.push(...[].concat(p.heading ? [{ t: 'p', role: 'heading', runs: [{ s: p.heading, b: true }] }] : [], textToBlocks(p.text), figBlocks(p.figs, null, FS))); return; }
      qn++;
      const it = { q: qn, mc: p.t === 'mc', credit: p.t === 'mc' ? 1 : Math.max(1, Math.round(num(p.credit, 1))), blocks: textToBlocks(p.stem).concat(p.eq && p.eq.trim() ? [{ t: 'eq', runs: parseRuns(p.eq.trim()) }] : [], figBlocks(p.figs, 6.2, FS)) };
      if (qn === 1) lead.push(...pend); else if (pend.length) it.pre = pend; pend = [];
      let ctext = '';
      if (it.mc) {
        const cs = (p.choices || ['', '', '', '']).slice(0, 4), imgs = p.cimgs || [];
        it.choices = cs.map((c, k) => imgs[k] ? { img: imgs[k].src, w_in: +(Math.min(imgs[k].w / DPI * FS, 3)).toFixed(3), h_in: +(Math.min(imgs[k].w / DPI * FS, 3) * imgs[k].h / imgs[k].w).toFixed(3) } : { runs: parseRuns(c) });
        const any = imgs.some(Boolean), all = any && cs.every((c, k) => imgs[k]);
        it.choice_layout = all ? 'grid' : any ? 'stacked' : cs.every(c => plain(c).length <= 18) ? 'grid' : 'stacked';
        if (p.thead && p.thead.trim()) {                                                         // table choices: headings "A | B", each choice "cell | cell"
          it.table_head = p.thead.split('|').map(h => ({ runs: parseRuns(h.trim()) }));
          it.choices = cs.map(c => ({ cells: c.split('|').map(s => ({ runs: parseRuns(s.trim()) })) }));
          it.choice_layout = 'table';
        }
        it.key = { credit: 1, mc_answer: Math.min(4, Math.max(1, Number(p.answer) || 1)) }; ctext = cs.map((c, k) => `(${k + 1}) ${plain(c)}`).join(' ');
      } else { it.resp = respOf(p.space); it.key = { credit: it.credit, blocks: textToBlocks(p.note) }; }
      items.push(it);
      const type = p.type == null || p.type === 'misc' || p.type === '' ? null : Number(p.type), unit = p.unit == null || p.unit === '' || p.unit === 'misc' ? null : Number(p.unit);
      metaItems.push({ q: qn, credit: it.credit, mc: it.mc, answer: it.mc ? it.key.mc_answer : null, stem: { text: plain(p.stem), q: qn }, resp: { kind: it.resp ? it.resp.kind : null, template_kind: it.resp ? it.resp.template_kind : null },
                       types: type ? [type] : [], type, unit, descriptor: plain(p.stem).slice(0, 100), tables: [], ref: 'none', refnote: '', text: (plain(p.stem) + ' ' + ctext).trim(), has_key: it.mc || !!(p.note && p.note.trim()) });
    });
    const ptext = lead.map(b => b.runs ? b.runs.map(r => r.s || '').join('') : '').join(' ');
    const us = metaItems.map(i => i.unit).filter(u => u != null), order = A.UORDER || [], cnt = {}; us.forEach(u => { cnt[u] = (cnt[u] || 0) + 1; });
    const text = { id: rec.id, group: [1, Math.max(1, qn)], lead: null, blocks: lead, items, fidelity: 'text' };
    const meta = { id: rec.id, kind: 'cluster', custom: true, owner: rec.owner || '', mine: rec.mine !== false, shared: !!rec.shared, title: rec.title || 'My question', exam: 'custom', session: 'Custom', year: '', part: '',
                   group: [1, Math.max(1, qn)], fidelity: 'text', units: [...new Set(us)].sort((a, b) => order.indexOf(a) - order.indexOf(b)), unit: us.length ? Number(Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0]) : null,
                   passage: { text: ptext }, items: metaItems, text: [rec.title || '', ptext].concat(metaItems.map(i => i.text)).join(' ') };
    return { meta, text };
  }
  const fresh = () => { if (window.BANK) delete window.BANK._clById; A.reindex(); };        // the typesetter keeps its own index of the clusters
  function register(rec) {
    const b = build(rec), into = isNewStyle(rec) ? A.NC : A.C, other = isNewStyle(rec) ? A.C : A.NC;
    const j = other.findIndex(c => c.id === rec.id); if (j >= 0) other.splice(j, 1);           // a cluster that changed homes
    const i = into.findIndex(c => c.id === rec.id); if (i >= 0) into[i] = b.meta; else into.push(b.meta);
    A.TEXT[rec.id] = b.text; fresh();
  }
  function unregister(id) { [A.C, A.NC].forEach(L => { const i = L.findIndex(c => c.id === id); if (i >= 0) L.splice(i, 1); }); delete A.TEXT[id]; fresh(); }

  // ------------------------------------------------------------------------------------------------ storage
  const LSKEY = () => A.SK + 'written';
  const storeLocal = () => { if (A.SHARED) return; try { localStorage.setItem(LSKEY(), JSON.stringify(RECS.filter(r => r.mine !== false))); } catch (e) { alert('This browser is out of storage space, so the question could not be kept on this computer. Smaller or fewer pictures will help.'); } };
  function loadRecs() {
    const by = {}; (window.CUSTOM_CLUSTERS || []).forEach(r => { by[r.id] = r; });
    if (!A.SHARED) { try { JSON.parse(localStorage.getItem(LSKEY()) || '[]').forEach(r => { by[r.id] = r; }); } catch (e) { } }
    return Object.values(by).filter(r => r && r.parts && r.parts.length).sort((a, b) => (a.created || 0) - (b.created || 0));
  }
  async function saveRec(rec) {
    const i = RECS.findIndex(r => r.id === rec.id); if (i >= 0) RECS[i] = rec; else RECS.push(rec);
    register(rec); storeLocal(); ensureCustomOption();
    if (A.SHARED) { try { await A.call('saveCustom', rec); } catch (e) { alert('Kept in this browser for now, but it could not be saved to your account: ' + e.message); } }
  }
  /** records carried inside an imported worksheet file: new ones, and newer versions of ones already here, are saved as the
   *  teacher's own; the rest are skipped. Returns how many were saved. */
  async function importRecs(recs) {
    let n = 0;
    for (const rec of recs || []) {
      if (!rec || !rec.id || !Array.isArray(rec.parts)) continue;
      const have = RECS.find(r => r.id === rec.id);
      if (have && (have.updated || 0) >= (rec.updated || 0)) continue;
      await saveRec(Object.assign({}, rec, { mine: true })); n++;
    }
    return n;
  }
  async function deleteRec(id) {
    RECS = RECS.filter(r => r.id !== id); unregister(id); storeLocal();
    const st = A.state; if (st.picked.includes(id)) { st.picked = st.picked.filter(x => x !== id); delete st.dropped[id]; A.setState(st); } else A.renderList();
    if (A.SHARED) { try { await A.call('deleteCustom', id); } catch (e) { alert('Removed here, but not from your account: ' + e.message); } }
  }
  function ensureCustomOption() { const f = $('fExam'); if (f && ![...f.options].some(o => o.value === 'custom')) f.append(new Option('My questions (custom)', 'custom'));
    const n = $('nExam'); if (n && (A.NC || []).some(c => c.custom) && ![...n.options].some(o => o.value === 'custom')) n.append(new Option('My clusters (custom)', 'custom')); }
  /** a shared worksheet must not point at questions colleagues cannot see: share the writer's own questions that are on it */
  function shareUsed() {
    if (!A.SHARED) return;
    A.picked.forEach(id => {
      const r = RECS.find(x => x.id === id);
      if (r && r.mine !== false && !r.shared) { r.shared = true; saveRec(r); return; }
      const q = A.byId[id];
      if (q && q.kind === 'custom' && q.mine !== false && !q.shared) { q.shared = true;
        A.call('saveCustom', { id: q.id, intro: q.intro, stem: q.stem, choices: q.choices, answer: q.answer, width: q.width, unit: q.unit, type: q.type, ref: q.ref, tables: q.tables, author: q.author, diagram: q.diagram, dW: q.dW, dH: q.dH, cimgs: q.cimgs || null, created: q.created, shared: true }).catch(() => { }); }
    });
  }

  // ------------------------------------------------------------------------------------------------ copying a Regents question
  function toDataURL(src) {
    if (!src || String(src).startsWith('data:')) return src || null;
    const b = A.bytesOf(src); if (!b) return null; let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return 'data:image/png;base64,' + btoa(s);
  }
  /** blocks of the text bank -> editable text (with the markup) and pictures */
  function unblock(blocks) {
    const out = { heading: '', lines: [], figs: [] };
    (blocks || []).forEach(b => {
      if (b.t === 'passage') { const u = unblock(b.blocks); if (!out.heading) out.heading = u.heading; out.lines.push(...u.lines); out.figs.push(...u.figs); return; }
      if (b.t === 'img') { const src = toDataURL(b.src); if (src) out.figs.push({ src, w: Math.round((b.w_in || 3) * DPI), h: Math.round((b.h_in || 2) * DPI) }); return; }
      if (b.t === 'list') { (b.items || []).forEach(it => out.lines.push('• ' + runsToMarkup(it))); return; }
      if (!b.runs) return;
      const t = runsToMarkup(b.runs).trim(); if (!t || /\{a\}/.test(t)) return;                     // "Base your answers to questions {a} through {b} …" is not copied
      if (b.role === 'heading' && !out.heading && !out.lines.length) out.heading = plain(t); else out.lines.push(t);
    });
    return out;
  }
  const passagePart = blocks => { const u = unblock(blocks); return u.lines.length || u.figs.length || u.heading ? { t: 'passage', heading: u.heading, text: u.lines.join('\n'), figs: u.figs } : null; };
  function mcPart(rec, answer, unit, type) {
    const u = unblock(rec.blocks), cimgs = [null, null, null, null];
    const choices = (rec.choices || []).slice(0, 4).map((c, k) => { if (c.img) { const src = toDataURL(c.img); if (src) cimgs[k] = { src, w: Math.round((c.w_in || 1.5) * DPI), h: Math.round((c.h_in || 1) * DPI) }; return ''; }
      return c.cells ? c.cells.map(x => runsToMarkup(x.runs)).join(' / ') : runsToMarkup(c.runs); });
    while (choices.length < 4) choices.push('');
    return { t: 'mc', stem: u.lines.join('\n'), figs: u.figs, choices, cimgs: cimgs.some(Boolean) ? cimgs : null, answer: Number(answer) || 1, unit: unit == null ? 'misc' : unit, type: type == null ? 'misc' : type };
  }
  function crPart(rec, resp, unit, type) {
    const u = unblock(rec.blocks), r = resp ? JSON.parse(JSON.stringify(resp)) : null;
    if (r && r.img) r.img = toDataURL(r.img); if (r) { delete r.shared_with; delete r.clip; delete r.page; }
    const key = unblock((rec.key || {}).blocks);
    return { t: 'cr', stem: u.lines.join('\n'), figs: u.figs, credit: rec.credit || 1, space: r ? { kind: 'orig', resp: r } : { kind: 'lines', n: 3 }, note: key.lines.join('\n'), unit: unit == null ? 'misc' : unit, type: type == null ? 'misc' : type };
  }
  /** the parts that reproduce one Regents question (qn: the question inside a cluster; whole: every question of the cluster) */
  async function copyParts(id, qn, whole) {
    const q = A.byId[id]; if (!q) return null;
    await A.ensureExam(A.examOf(id));
    const T = A.TEXT[id], parts = [], src = `${q.sample ? 'Sample' : (q.session || '') + ' ' + (q.year || '')}`.trim();
    if (!T && q.kind !== 'custom') throw new Error('The text of that question could not be loaded.');
    if (q.kind === 'cluster') {
      const p = passagePart(T.blocks); if (p) parts.push(p);
      (T.items || []).filter(ti => whole ? true : String(ti.q) === String(qn)).forEach(ti => {
        const m = q.items.find(x => x.q === ti.q) || {}; if (ti.pre) { const pp = passagePart(ti.pre); if (pp) parts.push(pp); }
        const resp = ti.resp && ti.resp.shared_with != null ? ((T.items.find(x => x.q === ti.resp.shared_with) || {}).resp || null) : ti.resp;
        parts.push(ti.mc ? mcPart(ti, (ti.key || {}).mc_answer || m.answer, m.unit, m.type) : crPart(ti, resp, m.unit, m.type)); });
      return { parts, based: `${src} Q${whole ? q.group[0] + '–' + q.group[1] : qn}`, title: T.title || '' };
    }
    if (q.kind === 'ncl') {
      let pend = [];
      (T.blocks || []).forEach(b => {
        if (b.t === 'passage') { pend.push(b); return; }
        if (b.t !== 'q') return;
        if (!whole && String(b.q) !== String(qn)) return;
        pend.forEach(pb => { const pp = passagePart(pb.blocks); if (pp) parts.push(pp); }); pend = [];
        const m = (q.questions || []).find(x => x.q === b.q) || {};
        parts.push(b.mc ? mcPart(b, (b.key || {}).mc_answer || m.answer, m.unit, 'misc') : crPart(b, b.resp, m.unit, 'misc')); });
      return { parts, based: `${src} Q${whole ? q.group[0] + '–' + q.group[1] : qn}`, title: q.title || '' };
    }
    if (q.stimulus) { await A.ensureExam(A.examOf(q.stimulus)); const S = A.TEXT[q.stimulus]; const p = S && passagePart(S.blocks); if (p) parts.push(p); }
    parts.push(mcPart(T, q.answer, q.unit, q.type));
    return { parts, based: `${src} Q${q.q}`, title: '' };
  }

  // ------------------------------------------------------------------------------------------------ the editor
  let ed = null, pvTimer = null;
  const lastUnit = () => { const p = ed && ed.rec.parts.slice().reverse().find(x => x.t !== 'passage'); return p ? p.unit : 'misc'; };
  const newPart = t => t === 'passage' ? { t, heading: '', text: '', figs: [] } : t === 'mc' ? { t, stem: '', figs: [], choices: ['', '', '', ''], cimgs: null, answer: 1, unit: lastUnit(), type: 'misc' }
    : { t: 'cr', stem: '', figs: [], credit: 1, space: { kind: 'lines', n: '' }, note: '', unit: lastUnit(), type: 'misc' };
  const NAME = { passage: 'Passage', mc: 'Multiple choice', cr: 'Written response' };
  // ---- layouts: the card a part was started from; older records are read from what they hold
  const MC_LAYOUTS = [['plain', 'Plain question', 'A question and four choices. The app lays the choices out to fit.'], ['diagram', 'Diagram in the question', 'Pictures under the question; choices beside them when they fit.'],
                      ['pics', 'Picture answers', 'Four pictures as the choices, with an optional picture in the question.'], ['table', 'Table of choices', '"Which row…": column headings and four rows.'],
                      ['equation', 'Equation in the question', 'A displayed equation line under the question.'], ['regents', 'Start from a Regents question', 'Copy a bank question and change it. The original is never touched.']];
  const CR_LAYOUTS = [['lines', 'Ruled lines', 'Lines to write on; the count follows the sheet unless you set it.'], ['picture', 'Draw on the diagram', 'The picture is the answer space.'],
                      ['work', 'Work space with an answer blank', 'Blank room to show work, then "Answer ______ unit".'], ['short', 'Short labelled blank', '"Mass: ______ g" on one line.'],
                      ['table', 'Fill in a table', 'Column headings and empty rows.'], ['grid', 'Graph grid', 'A grid with axis titles.'], ['other', 'Other', 'A box or check boxes; every kind is in the Answer space list.'], ['regents', 'Start from a Regents question', 'Copy a bank question and change it.']];
  const NAMES = Object.fromEntries(MC_LAYOUTS.concat(CR_LAYOUTS).map(([k, n]) => [k, n]));
  const layoutOf = p => p.t === 'mc' ? (p.layout || (p.cimgs && p.cimgs.some(Boolean) ? 'pics' : p.thead ? 'table' : p.eq ? 'equation' : p.figs && p.figs.length ? 'diagram' : 'plain'))
                                     : (p.t === 'cr' ? (p.layout || ({ lines: 'lines', picture: 'picture', work: 'work', short: 'short', table: 'table', grid: 'grid' }[(p.space || {}).kind] || 'other')) : 'passage');
  function applyLayout(p, layout) {
    p.layout = layout;
    if (p.t === 'mc') {
      if (layout === 'pics' && !(p.cimgs && p.cimgs.some(Boolean))) p.cimgs = [null, null, null, null];
      if (layout === 'table' && p.thead == null) p.thead = '';
      if (layout === 'equation' && p.eq == null) p.eq = '';
      if (layout !== 'pics' && p.cimgs && !p.cimgs.some(Boolean)) p.cimgs = null;
      if (layout !== 'table') p.thead = '';
    } else if (p.t === 'cr') {
      const kinds = { lines: { kind: 'lines', n: '' }, picture: { kind: 'picture' }, work: { kind: 'work', h: 1.5, label: 'Answer:', len: 1.5, unit: '' }, short: { kind: 'short', label: '', len: 2, unit: '' }, table: { kind: 'table', heads: '', rows: 4 }, grid: { kind: 'grid', cols: 10, rows: 10 }, other: { kind: 'box', h: 2 } };
      if (kinds[layout] && (!p.space || layoutOf(Object.assign({}, p, { layout: null })) !== layout)) { p.space = kinds[layout]; regenPic(p); }
    }
  }
  // ---- the symbol cards: bars for text, boxes for pictures, real numbers for choices
  const ICON = {
    bar: w => `<i class="bar" style="width:${w}%"></i>`, q: (n, w) => `<span class="t"><em>${n}</em><i class="bar" style="width:${w}%"></i></span>`,
    opts: (pic) => `<span class="opts">${[1, 3, 2, 4].map(k => `<span class="opt"><em>(${k})</em>${pic ? '<i class="box sm"></i>' : '<i class="bar"></i>'}</span>`).join('')}</span>`,
    rule: () => '<i class="rule"></i>', box: h => `<i class="box" style="height:${h || 26}px"></i>`,
  };
  function cardIcon(kind) {
    const I = ICON;
    switch (kind) {
      case 'mc': case 'plain': return I.q(1, 92) + I.bar(66) + I.opts();
      case 'cr': case 'lines': return I.q(1, 92) + I.bar(48) + I.rule() + I.rule();
      case 'cluster': return I.bar(70) + I.box(24) + I.q(1, 50) + I.opts() + I.q(2, 64) + I.rule();
      case 'import': return '<span class="t"><em class="pill">.json</em></span>' + I.q(1, 80) + I.opts() + I.q(2, 60) + I.rule();
      case 'diagram': return I.q(1, 92) + I.box(26) + I.opts();
      case 'pics': return I.q(1, 92) + I.opts(true);
      case 'table': return I.q(1, 92) + `<table><tr><td></td><td><i class="bar"></i></td><td><i class="bar"></i></td></tr>${[1, 2, 3, 4].map(k => `<tr><td><em>(${k})</em></td><td><i class="bar"></i></td><td><i class="bar"></i></td></tr>`).join('')}</table>`;
      case 'equation': return I.q(1, 92) + '<span class="eq">2H<sub>2</sub> + O<sub>2</sub> → 2H<sub>2</sub>O</span>' + I.opts();
      case 'regents': return '<span class="t"><em class="pill">June 2019 Q24</em></span>' + I.q(1, 92) + I.opts();
      case 'picture': return I.q(1, 92) + I.box(40);
      case 'work': return I.q(1, 92) + '<i class="work"></i><span class="lab"><i class="bar" style="width:28px"></i><i class="rule"></i><em>m/s</em></span>';
      case 'short': return I.q(1, 92) + '<span class="lab"><i class="bar" style="width:28px"></i><i class="rule"></i><em>g</em></span>';
      case 'crtable': return I.q(1, 92) + '<table><tr><td><i class="bar"></i></td><td><i class="bar"></i></td><td><i class="bar"></i></td></tr><tr><td><i class="bar"></i></td><td></td><td></td></tr><tr><td><i class="bar"></i></td><td></td><td></td></tr></table>';
      case 'grid': return I.q(1, 92) + '<i class="grid"></i>';
      case 'other': return I.q(1, 92) + '<span class="chk"><b></b><i class="bar" style="width:36%"></i></span><span class="chk"><b></b><i class="bar" style="width:50%"></i></span><i class="boxed"></i>';
    }
    return '';
  }
  // ---- the gallery: New question -> a branch -> a layout card. ctx.mode: 'new' (a record), 'part' (append to the open record), 'relayout' (change one part)
  let gal = null;
  function openGallery(ctx) {
    gal = ctx; $('wNew').hidden = false; renderGallery(ctx.stage || 'branch');
  }
  function renderGallery(stage) {
    gal.stage = stage;
    const chem = window.SUBJECT_ID === 'chemistry';
    const cards = stage === 'branch' ? (gal.mode === 'new' ? [['mc', 'Multiple choice', 'One question, four choices. Next: its layout.'], ['cr', 'Written response', 'One question with an answer space. Next: the kind of space.'], ['cluster', 'Cluster', 'A shared passage or diagram with several questions, built one piece at a time.'], ['import', 'Import', 'A question an AI wrote from the handoff, as a .json file. Checked, then opened here.']]
                                                           : [['mc', 'Multiple choice', 'Four choices. Next: its layout.'], ['cr', 'Written response', 'An answer space. Next: the kind of space.']])
                : stage === 'mc' ? MC_LAYOUTS.filter(([k]) => k !== 'equation' || chem).filter(([k]) => k !== 'regents' || gal.mode !== 'relayout')
                : CR_LAYOUTS.filter(([k]) => k !== 'regents' || gal.mode !== 'relayout');
    const title = stage === 'branch' ? (gal.mode === 'new' ? 'New question' : 'Add a question') : stage === 'mc' ? 'Multiple choice' : 'Written response';
    $('wNewTitle').textContent = title; $('wNewBack').hidden = stage === 'branch';
    $('wNewCards').innerHTML = cards.map(([k, n, d]) => `<button class="wcard" data-k="${k}"><span class="ico">${cardIcon(stage === 'cr' && k === 'table' ? 'crtable' : k)}</span><span class="name">${esc(n)}</span><span class="desc">${esc(d)}</span></button>`).join('');
    $('wNewCards').querySelectorAll('.wcard').forEach(b => { b.onclick = () => pickCard(stage, b.dataset.k); });
  }
  function closeGallery() { $('wNew').hidden = true; gal = null; }
  function openImport() { $('wImpOut').style.color = ''; $('wImpOut').textContent = ''; $('wImp').hidden = false; }
  function pickCard(stage, k) {
    const ctx = gal;
    if (stage === 'branch') {
      if (k === 'cluster') { closeGallery(); openEditor({ title: '', parts: [{ t: 'passage', heading: '', text: '', figs: [] }] }, true); return; }
      if (k === 'import') { closeGallery(); openImport(); return; }
      renderGallery(k); return;
    }
    if (k === 'regents') { closeGallery(); openPicker(got => { if (ctx.mode === 'new') openEditor({ title: got.title || '', based: got.based, parts: got.parts }, true); else { ed.rec.parts.push(...got.parts); if (!ed.rec.based) ed.rec.based = got.based; renderParts(); } }); return; }
    closeGallery();
    if (ctx.mode === 'relayout') { const p = ed.rec.parts[ctx.index]; applyLayout(p, k); renderParts(); return; }
    const p = newPart(stage); applyLayout(p, k);
    if (ctx.mode === 'new') { openEditor({ title: '', parts: [p] }, true); $('wEdTitle').textContent = 'New question · ' + NAMES[k]; }
    else { ed.rec.parts.push(p); renderParts(); }
  }
  function ntypeOptions(cur) { const NT = A.NT || {}, order = A.UORDER || [];
    return Object.keys(NT).map(Number).sort((a, b) => (order.indexOf(NT[a].unit) - order.indexOf(NT[b].unit)) || (a - b)).map(t => `<option value="${t}"${String(cur) === String(t) ? ' selected' : ''}>N${t}. ${esc(NT[t].name)}${NT[t].unit != null ? ' (U' + A.uNum(NT[t].unit) + ')' : ''}</option>`).join('') +
      `<option value="misc"${cur == null || cur === 'misc' ? ' selected' : ''}>Not set</option>`; }
  function unitOptions(cur) { return (A.UORDER || []).map(u => `<option value="${u}"${String(cur) === String(u) ? ' selected' : ''}>${esc(A.uLabel(u))}</option>`).join('') + `<option value="misc"${cur == null || cur === 'misc' ? ' selected' : ''}>Misc / other</option>`; }
  function typeOptions(unit, cur) { const T = A.T || {};
    return Object.keys(T).map(Number).sort((a, b) => (T[a].order ?? a) - (T[b].order ?? b)).filter(t => unit == null || unit === 'misc' || String(T[t].unit) === String(unit)).map(t => `<option value="${t}"${String(cur) === String(t) ? ' selected' : ''}>${T[t].code || t}. ${esc(T[t].name)}</option>`).join('') +
      `<option value="misc"${cur == null || cur === 'misc' ? ' selected' : ''}>Misc / other</option>`; }
  const figsHTML = (p, i) => `<div class="wfigs">${(p.figs || []).map((f, k) => `<span class="wfig"><img src="${f.src}" alt=""><button data-p="${i}" data-figrm="${k}" title="Remove this picture">✕</button></span>`).join('')}` +
    `<label class="wadd">+ Picture<input type="file" accept="image/*" multiple hidden data-p="${i}" data-figadd="1"></label></div>`;
  function spaceHTML(p, i) {
    const s = p.space || { kind: 'none' }, f = (name, attrs) => `data-p="${i}" data-f="space.${name}" ${attrs || ''}`;
    let h = `<div class="wrow"><label>Answer space</label><select data-p="${i}" data-space="1">${SPACES.map(([k, n]) => `<option value="${k}"${s.kind === k ? ' selected' : ''}>${n}</option>`).join('')}${s.kind === 'orig' ? '<option value="orig" selected>Same as the original question</option>' : ''}</select></div>`;
    const n = (name, label, val, min, max, step) => `<label class="wmini">${label}<input type="number" ${f(name)} value="${esc(val)}" min="${min}" max="${max}" step="${step || 1}"></label>`;
    const t = (name, label, val, ph) => `<label class="wmini wide">${label}<input type="text" ${f(name)} value="${esc(val || '')}" placeholder="${esc(ph || '')}"></label>`;
    if (s.kind === 'lines') h += `<div class="wrow sub"><label class="wmini">Lines<select ${f('n')}><option value="">Sheet default</option>${[1, 2, 3, 4, 5, 6, 8, 10, 12, 15].map(v => `<option value="${v}"${Number(s.n) === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label></div>`;
    if (s.kind === 'blank' || s.kind === 'box') h += `<div class="wrow sub">${n('h', 'Height in inches', s.h || (s.kind === 'box' ? 2 : 1.5), 0.3, 9, 0.1)}</div>`;
    if (s.kind === 'short') h += `<div class="wrow sub">${t('label', 'Label before the blank', s.label, 'Mass:')}${n('len', 'Blank length, inches', s.len || 2, 0.5, 6, 0.25)}${t('unit', 'Unit after the blank', s.unit, 'g/mL')}</div>`;
    if (s.kind === 'work') h += `<div class="wrow sub">${n('h', 'Work space, inches', s.h || 1.5, 0.3, 6, 0.25)}${t('label', 'Label before the blank', s.label, 'Answer:')}${n('len', 'Blank length, inches', s.len || 1.5, 0.5, 6, 0.25)}${t('unit', 'Unit after the blank', s.unit, 'm/s')}</div>`;
    if (s.kind === 'labelled') h += `<div class="wrow sub"><label class="wmini wide" style="flex:1">One label per line: each gets a ruled line<textarea ${f('labels')} rows="3" placeholder="Claim:&#10;Evidence:&#10;Reasoning:">${esc(s.labels || '')}</textarea></label></div>`;
    if (s.kind === 'checks') h += `<div class="wrow sub"><label class="wmini wide" style="flex:1">One option per line: each gets a check box<textarea ${f('options')} rows="3" placeholder="Increases&#10;Decreases&#10;Stays the same">${esc(s.options || '')}</textarea></label></div>`;
    if (s.kind === 'grid') h += `<div class="wrow sub">${n('cols', 'Columns', s.cols || 10, 2, 40)}${n('rows', 'Rows', s.rows || 10, 2, 40)}${t('xlab', 'Bottom axis title', s.xlab, 'Time (s)')}${t('ylab', 'Side axis title', s.ylab, 'Distance (m)')}${t('title', 'Title above', s.title, '')}</div>`;
    if (s.kind === 'table') h += `<div class="wrow sub">${t('heads', 'Column headings, separated by commas', s.heads, 'Trial, Mass (g), Volume (mL)')}${n('rows', 'Empty rows', s.rows || 4, 1, 20)}</div>`;
    if (s.kind === 'picture') h += `<div class="wrow sub">${s.img ? `<span class="wfig"><img src="${s.img.src}" alt=""></span>` : ''}<label class="wadd">${s.img ? 'Replace the picture' : 'Choose a picture'}<input type="file" accept="image/*" hidden data-p="${i}" data-spacepic="1"></label></div>`;
    if (s.kind === 'orig') h += `<div class="wrow sub hint">The answer space of the Regents question is kept as it was. Choose another kind to replace it.</div>`;
    return h;
  }
  function partHTML(p, i, n) {
    const lay = layoutOf(p);
    const head = `<div class="whead"><b>${NAME[p.t]}${p.t !== 'passage' ? ` · ${esc(NAMES[lay] || '')}` : ''}</b>${p.t !== 'passage' ? `<button class="small" data-p="${i}" data-layout="1" title="Pick another layout; the text stays">Layout…</button>` : ''}<span style="flex:1"></span><button class="small" data-p="${i}" data-mv="-1"${i === 0 ? ' disabled' : ''} title="Move up">▲</button><button class="small" data-p="${i}" data-mv="1"${i === n - 1 ? ' disabled' : ''} title="Move down">▼</button><button class="small" data-p="${i}" data-del="1" title="Remove this part">✕</button></div>`;
    const ta = (name, val, rows, ph) => `<textarea data-p="${i}" data-f="${name}" rows="${rows}" placeholder="${esc(ph)}">${esc(val || '')}</textarea>`;
    if (p.t === 'passage') return `<div class="wpart" data-i="${i}">${head}<input type="text" data-p="${i}" data-f="heading" value="${esc(p.heading || '')}" placeholder="Title above the passage (optional)">${ta('text', p.text, 5, 'The reading, data description or directions. Each line you type is its own paragraph.')}${figsHTML(p, i)}</div>`;
    const tags = isNewStyle(ed.rec)
      ? `<div class="wrow"><label>Standard</label><input type="text" data-p="${i}" data-f="pe" value="${esc(Array.isArray(p.pe) ? p.pe.join(', ') : (p.pe || ''))}" placeholder="HS-PS2-1 (several: separate with commas)" style="flex:1;min-width:0;max-width:46%"><label style="margin-left:8px">Type</label><select data-p="${i}" data-f="ntype" style="flex:1;min-width:0">${ntypeOptions(p.ntype)}</select></div>`
      : `<div class="wrow"><label>Unit</label><select data-p="${i}" data-unit="1" style="flex:1;min-width:0;max-width:46%">${unitOptions(p.unit)}</select><label style="margin-left:8px">Type</label><select data-p="${i}" data-f="type" style="flex:1;min-width:0">${typeOptions(p.unit, p.type)}</select></div>`;
    const more = `<details class="wmore"><summary>More: ${isNewStyle(ed.rec) ? 'standard and type' : 'unit and type'}</summary>${tags}</details>`;
    if (p.t === 'mc') {
      const showFigs = lay !== 'plain' && lay !== 'table' || (p.figs && p.figs.length);
      const choice = k => lay === 'pics'
        ? `<div class="wrow"><label style="width:22px">(${k + 1})</label>${p.cimgs && p.cimgs[k] ? `<span class="wfig"><img src="${p.cimgs[k].src}" alt=""><button data-p="${i}" data-cimgrm="${k}" title="Remove this picture">✕</button></span>` : `<label class="wadd">Choose a picture<input type="file" accept="image/*" hidden data-p="${i}" data-cimgadd="${k}"></label>`}<input type="text" data-p="${i}" data-f="choices.${k}" value="${esc(p.choices[k] || '')}" placeholder="Caption (optional)" style="flex:1;min-width:120px"></div>`
        : `<div class="wrow"><label style="width:22px">(${k + 1})</label><input type="text" data-p="${i}" data-f="choices.${k}" value="${esc(p.choices[k] || '')}" placeholder="${lay === 'table' ? 'cell | cell' : ''}" style="flex:1"></div>`;
      return `<div class="wpart" data-i="${i}">${head}${ta('stem', p.stem, 3, 'The question')}${lay === 'equation' ? `<div class="wrow"><label>Equation line</label><input type="text" data-p="${i}" data-f="eq" value="${esc(p.eq || '')}" placeholder="2H_2(g) + O_2(g) → 2H_2O(ℓ) + energy" style="flex:1"></div>` : ''}${showFigs ? figsHTML(p, i) : ''}` +
        (lay === 'table' ? `<div class="wrow"><label>Column headings</label><input type="text" data-p="${i}" data-f="thead" value="${esc(p.thead || '')}" placeholder="Separated by | : Recording with the higher rate | More accurate copy" style="flex:1"></div>` : '') +
        [0, 1, 2, 3].map(choice).join('') +
        `<div class="wrow"><label>Correct answer</label><select data-p="${i}" data-f="answer">${[1, 2, 3, 4].map(k => `<option value="${k}"${Number(p.answer) === k ? ' selected' : ''}>(${k})</option>`).join('')}</select></div>${more}</div>`;
    }
    return `<div class="wpart" data-i="${i}">${head}${ta('stem', p.stem, 3, 'The question')}${figsHTML(p, i)}<div class="wrow"><label>Credits</label><input type="number" data-p="${i}" data-f="credit" value="${esc(p.credit || 1)}" min="1" max="9" style="width:64px"></div>` +
      spaceHTML(p, i) + `<div class="wrow sub" style="display:block"><label class="wmini wide" style="display:block">Scoring note for the key (optional)${ta('note', p.note, 2, 'Allow 1 credit for …')}</label></div>${more}</div>`;
  }
  const hasPics = rec => (rec.parts || []).some(p => (p.figs && p.figs.length) || (p.cimgs && p.cimgs.some(Boolean)));
  function renderParts() {
    const n = ed.rec.parts.length;
    $('wScaleRow').hidden = !hasPics(ed.rec); $('wScale').value = ed.rec.figScale || 100; $('wScaleVal').textContent = (ed.rec.figScale || 100) + '%';
    $('wParts').innerHTML = n ? ed.rec.parts.map((p, i) => partHTML(p, i, n)).join('') : '<div class="hint" style="padding:8px 2px">Nothing yet. Add a passage or a question below.</div>';
    preview();
  }
  function preview() {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(() => {
      try {
        const b = build(Object.assign({}, ed.rec, { id: ed.rec.id || 'cc_preview' })).text, W = 6.4, pt = 11.5; let h = '';
        const nums = b.items.length ? { a: b.items[0].q, b: b.items[b.items.length - 1].q } : null;
        if (b.blocks.length) h += A.opsHTML(A.ENG.layoutBlocks({ blocks: b.blocks }, W, pt, { nums }));
        b.items.forEach(it => { if (it.pre) h += A.opsHTML(A.ENG.layoutBlocks({ blocks: it.pre }, W, pt, { nums }));
          const lay = it.mc ? A.ENG.layoutBlocks(it, W - 0.4, pt, {}) : A.ENG.layoutBlocks({ blocks: it.blocks }, W - 0.4, pt, { credit: it.credit, resp: it.resp });
          h += `<div style="display:flex;gap:0.08in;margin-top:0.12in"><div style="width:0.3in;text-align:right;font:11.5pt 'LibSerif','Times New Roman',serif;color:#000">${it.q}</div>${A.opsHTML(lay)}</div>`; });
        $('wPreview').innerHTML = h || '<div class="hint">The question appears here as it will print.</div>';
      } catch (e) { $('wPreview').innerHTML = `<div class="hint">${esc(e.message)}</div>`; }
    }, 180);
  }
  const readPic = (file, maxW) => new Promise(res => { const r = new FileReader(); r.onload = async () => res(await A.shrinkImage(r.result, maxW || 1200)); r.readAsDataURL(file); });
  function setField(p, path, value) { const ks = path.split('.'); let o = p; for (let k = 0; k < ks.length - 1; k++) { if (o[ks[k]] == null) o[ks[k]] = /^\d+$/.test(ks[k + 1]) ? [] : {}; o = o[ks[k]]; } o[ks[ks.length - 1]] = value; }
  const regenPic = p => { const s = p.space; if (s && s.kind === 'grid') s.img = makeGrid(s); if (s && s.kind === 'table') s.img = makeTable(s); };
  function wireEditor() {
    const box = $('wParts');
    box.addEventListener('input', e => {
      const t = e.target, i = Number(t.dataset.p); if (!ed || isNaN(i) || !t.dataset.f) return; const p = ed.rec.parts[i];
      setField(p, t.dataset.f, t.type === 'number' ? Number(t.value) : t.value); if (t.dataset.f.startsWith('space.')) regenPic(p); preview();
    });
    box.addEventListener('change', async e => {
      const t = e.target, i = Number(t.dataset.p); if (!ed || isNaN(i)) return; const p = ed.rec.parts[i];
      if (t.dataset.unit) { p.unit = t.value; p.type = 'misc'; renderParts(); }
      else if (t.dataset.space) { p.space = t.value === 'none' ? { kind: 'none' } : Object.assign({ kind: t.value }, t.value === 'lines' ? { n: 3 } : {}); regenPic(p); renderParts(); }
      else if (t.dataset.figadd) { for (const f of t.files) p.figs.push(await readPic(f)); renderParts(); }
      else if (t.dataset.spacepic && t.files[0]) { p.space.img = await readPic(t.files[0], 1400); renderParts(); }
      else if (t.dataset.cimgadd != null && t.files[0]) { p.cimgs = p.cimgs || [null, null, null, null]; p.cimgs[Number(t.dataset.cimgadd)] = await readPic(t.files[0], 900); renderParts(); }
    });
    box.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !ed) return; const i = Number(b.dataset.p), ps = ed.rec.parts;
      if (b.dataset.layout) { openGallery({ mode: 'relayout', index: i, stage: ps[i].t === 'mc' ? 'mc' : 'cr' }); }
      else if (b.dataset.mv) { const j = i + Number(b.dataset.mv); [ps[i], ps[j]] = [ps[j], ps[i]]; renderParts(); }
      else if (b.dataset.del) { ps.splice(i, 1); renderParts(); }
      else if (b.dataset.figrm != null) { ps[i].figs.splice(Number(b.dataset.figrm), 1); renderParts(); }
      else if (b.dataset.cimgrm != null) { ps[i].cimgs[Number(b.dataset.cimgrm)] = null; if (!ps[i].cimgs.some(Boolean)) ps[i].cimgs = null; renderParts(); }
    });
    $('wAddP').onclick = () => { ed.rec.parts.push(newPart('passage')); renderParts(); };
    $('wAddD').onclick = () => { ed.rec.parts.push(newPart('passage')); renderParts(); const inp = $('wParts').querySelector(`input[data-figadd][data-p="${ed.rec.parts.length - 1}"]`); if (inp) inp.click(); };
    $('wAddQ').onclick = () => openGallery({ mode: 'part' });
    $('wAddM').onclick = () => { const p = newPart('mc'); applyLayout(p, 'plain'); ed.rec.parts.push(p); renderParts(); };
    $('wAddC').onclick = () => { ed.rec.parts.push(newPart('cr')); renderParts(); };
    $('wAddR').onclick = () => openPicker(got => { ed.rec.parts.push(...got.parts); if (!ed.rec.based) ed.rec.based = got.based; if (!$('wTitle').value && got.title) $('wTitle').value = got.title; renderParts(); });
    $('wScale').addEventListener('input', () => { if (!ed) return; ed.rec.figScale = Number($('wScale').value) || 100; $('wScaleVal').textContent = ed.rec.figScale + '%'; preview(); });
    $('wCancel').onclick = () => { $('wEd').hidden = true; ed = null; };
    $('wDelete').onclick = () => { if (ed && !ed.isNew && confirm('Delete this question for good?')) { const id = ed.rec.id; $('wEd').hidden = true; ed = null; deleteRec(id); } };
    $('wSave').onclick = async () => {
      const rec = ed.rec, qs = rec.parts.filter(p => p.t !== 'passage');
      if (!qs.length) { alert('Add at least one question.'); return; }
      if (rec.parts[rec.parts.length - 1].t === 'passage') { alert('The last part is a passage with no question after it. Add a question below it or remove it.'); return; }
      const bad = qs.find(p => !p.stem.trim() && !(p.figs && p.figs.length)) || qs.find(p => p.t === 'mc' && (layoutOf(p) === 'pics' ? !(p.cimgs && p.cimgs.every(Boolean)) : p.choices.some((c, k) => !c.trim() && !(p.cimgs && p.cimgs[k]))));
      if (bad) { alert(bad.t === 'mc' ? 'Every multiple-choice question needs its question and all four choices.' : 'Every question needs its text.'); return; }
      rec.title = $('wTitle').value.trim() || plain(qs[0].stem).slice(0, 50) || 'My question'; rec.shared = $('wShare').checked; rec.updated = Date.now();
      const isNew = ed.isNew; if (isNew) { rec.id = 'cc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); rec.created = rec.updated; rec.mine = true; if (A.me && A.me.email) rec.owner = A.me.email; }
      $('wEd').hidden = true; ed = null;
      await saveRec(rec);
      if (isNew) { const st = A.state; st.picked.push(rec.id); A.setState(st); } else { A.renderList(); A.renderSheet(); }
    };
  }
  function openEditor(rec, isNew) {
    ed = { rec: JSON.parse(JSON.stringify(rec)), isNew: !!isNew };
    $('wEdTitle').textContent = isNew ? 'New question' : 'Edit question'; $('wTitle').value = ed.rec.title || ''; $('wShare').checked = !!ed.rec.shared;
    const single = ed.rec.parts.length === 1 && ed.rec.parts[0].t !== 'passage'; $('wRelayout').hidden = !single;
    $('wRelayout').onclick = () => openGallery({ mode: 'relayout', index: 0, stage: ed.rec.parts[0].t === 'mc' ? 'mc' : 'cr' });
    $('wShareRow').style.display = A.SHARED ? '' : 'none'; $('wDelete').hidden = !!isNew;
    const canNew = (A.NC || []).length > 0 || isNewStyle(ed.rec), clusterish = ed.rec.parts.length > 1 || ed.rec.parts.some(p => p.t === 'passage');
    $('wStyleRow').hidden = !(canNew && clusterish); $('wStyle').value = isNewStyle(ed.rec) ? 'new' : 'old';
    $('wStyle').onchange = () => { ed.rec.style = $('wStyle').value === 'new' ? 'new' : 'old'; renderParts(); };
    $('wBased').textContent = ed.rec.based ? 'Based on ' + ed.rec.based : '';
    $('wMgr').hidden = true; $('wEd').hidden = false; renderParts();
  }
  const edit = id => { const r = RECS.find(x => x.id === id); if (r) openEditor(r, false); };

  // ------------------------------------------------------------------------------------------------ picking a Regents question to start from
  let pickDone = null;
  function searchAll(term) {
    const t = term.toLowerCase(), out = [], lim = 80, T = A.T || {};
    const snip = s => { const x = String(s || '').replace(/\s+/g, ' '); const k = x.toLowerCase().indexOf(t); return k > 40 ? '…' + x.slice(k - 30, k + 90) : x.slice(0, 120); };
    for (const q of A.Q) { if (out.length >= lim) break; if (q.kind !== 'custom' && String(q.text || '').toLowerCase().includes(t)) out.push({ id: q.id, qn: null, label: `${q.session} ${q.year} Q${q.q} · ${(T[q.type] || {}).name || ''}`, text: snip(q.text) }); }
    for (const c of A.C) { if (out.length >= lim || c.custom) continue; c.items.forEach(it => { const x = it.text || (it.stem && it.stem.text) || it.descriptor || ''; if (out.length < lim && String(x).toLowerCase().includes(t)) out.push({ id: c.id, qn: it.q, label: `${c.session} ${c.year} Q${it.q} · written or cluster`, text: snip(x) }); }); }
    for (const c of A.NC) { if (out.length >= lim) break; c.questions.forEach(q => { if (out.length < lim && String(q.text || '').toLowerCase().includes(t)) out.push({ id: c.id, qn: q.q, label: `${c.sample ? 'Sample' : c.session + ' ' + c.year} · ${c.title || ''} Q${q.q}`, text: snip(q.text) }); }); }
    return out;
  }
  function renderPick() {
    const term = $('wPickSearch').value.trim();
    const rows = term.length >= 2 ? searchAll(term) : ((window.APPUI && APPUI.worksheetQuestions ? APPUI.worksheetQuestions() : []).map(q => ({ id: q.id, qn: q.qn, label: q.label, text: '' })));
    $('wPickHint').textContent = term.length >= 2 ? (rows.length >= 80 ? 'The first 80 matches. Type more to narrow it.' : `${rows.length} match${rows.length === 1 ? '' : 'es'} in the whole subject.`) : (rows.length ? 'On your worksheet, the most recently added first. Or type a word to search every question in the subject.' : 'Type a word to search every question in the subject.');
    $('wPickList').innerHTML = rows.map((r, k) => `<div class="wpick" data-k="${k}"><b>${esc(r.label)}</b>${r.text ? `<div class="hint">${esc(r.text)}</div>` : ''}</div>`).join('') || '<div class="hint" style="padding:8px">Nothing to show.</div>';
    $('wPickList').querySelectorAll('.wpick').forEach(d => { d.onclick = async () => {
      const r = rows[Number(d.dataset.k)], q = A.byId[r.id], whole = $('wPickWhole').checked && (q.kind === 'cluster' || q.kind === 'ncl');
      d.style.opacity = '.5';
      try { const got = await copyParts(r.id, r.qn, whole); if (!got || !got.parts.length) throw new Error('Nothing could be copied from that question.'); $('wPick').hidden = true; const f = pickDone; pickDone = null; if (f) f(got); }
      catch (e) { d.style.opacity = ''; alert(e.message); } }; });
  }
  function openPicker(done) { pickDone = done; $('wPickSearch').value = ''; $('wPickWhole').checked = false; $('wPick').hidden = false; renderPick(); $('wPickSearch').focus(); }

  // ------------------------------------------------------------------------------------------------ the list of your questions
  function renderMgr() {
    const mine = [], theirs = [];
    A.Q.filter(q => q.kind === 'custom').forEach(q => (q.mine === false ? theirs : mine).push({ id: q.id, kind: 'Multiple choice', title: String(q.stem || '').slice(0, 90), shared: q.shared, mc: true, owner: q.owner }));
    RECS.forEach(r => { const n = r.parts.filter(p => p.t !== 'passage').length; (r.mine === false ? theirs : mine).push({ id: r.id, kind: n > 1 || r.parts.some(p => p.t === 'passage') ? `Cluster · ${n} question${n === 1 ? '' : 's'}` : r.parts.some(p => p.t === 'mc') ? 'Multiple choice' : 'Written response', title: r.title, shared: r.shared, owner: r.owner }); });
    const row = (x, own) => `<tr><td>${esc(x.title || '')}</td><td>${esc(x.kind)}</td><td>${own ? (x.shared ? 'Shared' : A.SHARED ? 'Private' : '') : esc(String(x.owner || '').split('@')[0])}</td><td style="white-space:nowrap;text-align:right">` +
      `<button class="small" data-add="${x.id}">${A.picked.includes(x.id) ? 'On worksheet' : 'Add to worksheet'}</button> ${own ? `<button class="small primary" data-ed="${x.id}"${x.mc ? ' data-mc="1"' : ''}>Edit</button>` : ''}</td></tr>`;
    $('wMgrList').innerHTML = (mine.length ? `<table class="libtable"><tr><th>Yours</th><th>Kind</th><th></th><th></th></tr>${mine.map(x => row(x, true)).join('')}</table>` : '<div class="hint" style="padding:6px 0">You have not written any questions yet.</div>') +
      (theirs.length ? `<table class="libtable" style="margin-top:12px"><tr><th>Shared by colleagues</th><th>Kind</th><th>By</th><th></th></tr>${theirs.map(x => row(x, false)).join('')}</table>` : '');
    $('wMgrList').querySelectorAll('button[data-add]').forEach(b => { b.onclick = () => { const id = b.dataset.add; if (!A.picked.includes(id)) { const st = A.state; st.picked.push(id); A.setState(st); } renderMgr(); }; });
    $('wMgrList').querySelectorAll('button[data-ed]').forEach(b => { b.onclick = () => { if (b.dataset.mc) { $('wMgr').hidden = true; A.openBuilder(A.byId[b.dataset.ed]); } else edit(b.dataset.ed); }; });
  }
  function open() { renderMgr(); $('wMgr').hidden = false; }

  // ------------------------------------------------------------------------------------------------ start
  const CSS = `
  #wEd .dialog { width: min(1240px, 97vw); max-height: 94vh; display: flex; flex-direction: column; }
  #wEd .wcols { display: grid; grid-template-columns: minmax(380px, 1fr) minmax(0, 6.9in); gap: 14px; min-height: 0; flex: 1; }
  #wEd .wleft { overflow: auto; padding-right: 4px; max-height: 68vh; }
  #wPreview { overflow: auto; max-height: 68vh; background: #fff; color: #000; border: 1px solid #ddd9d9; border-radius: 10px; padding: 12px 14px; }
  .wpart { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; margin: 0 0 10px; background: var(--panel); }
  .wpart textarea, .wpart input[type=text] { width: 100%; margin: 4px 0; font-family: Arial, Helvetica, sans-serif; }
  .whead { display: flex; align-items: center; gap: 4px; color: var(--maroon-deep); font-family: Georgia, serif; margin-bottom: 2px; }
  .whead button { padding: 0 7px; font-size: 11px; line-height: 18px; }
  .wrow { display: flex; align-items: center; gap: 8px; margin: 5px 0; flex-wrap: wrap; font-size: 12.5px; }
  .wrow > label { color: var(--soft); font-size: 12px; }
  .wrow.sub { padding-left: 10px; border-left: 3px solid var(--tint-line); align-items: flex-end; }
  .wmini { display: flex; flex-direction: column; gap: 2px; font-size: 11.5px; color: var(--soft); }
  .wmini input[type=number] { width: 86px; } .wmini.wide input, .wmini.wide textarea { width: 100%; min-width: 150px; margin: 0; }
  .wfigs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0; }
  .wfig { position: relative; display: inline-block; border: 1px solid var(--line); border-radius: 6px; padding: 2px; background: #fff; }
  .wfig img { max-height: 54px; max-width: 120px; display: block; }
  .wfig button { position: absolute; top: -7px; right: -7px; padding: 0 5px; font-size: 10px; line-height: 16px; }
  .wadd { font-size: 12px; color: var(--maroon-deep); border: 1.5px dashed var(--tint-line); border-radius: 999px; padding: 3px 10px; cursor: pointer; }
  .waddbar { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 2px; }
  .wpick { padding: 7px 10px; border-bottom: 1px solid var(--line); cursor: pointer; font-size: 13px; }
  .wpick:hover { background: var(--maroon-tint); }
  body.dark #wPreview, body.dark .wfig { background: #fff; }
  .wcards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; max-height: 62vh; overflow: auto; padding: 2px; }
  .wcard { display: grid; gap: 6px; text-align: left; border: 1.5px solid var(--line); border-radius: 10px; padding: 9px; background: var(--panel); color: var(--ink); cursor: pointer; font: inherit; }
  .wcard:hover { border-color: var(--maroon); box-shadow: inset 0 0 0 1px var(--maroon); background: var(--maroon-tint); }
  .wcard .name { font-size: 13px; font-weight: bold; } .wcard .desc { font-size: 11.5px; color: var(--soft); line-height: 1.35; }
  .wcard .ico { background: #fff; color: #000; border: 1px solid #cfc9c9; border-radius: 4px; padding: 8px 9px; min-height: 104px; display: grid; gap: 5px; align-content: start; font: 10px "LibSerif", "Times New Roman", serif; }
  .wcard .ico em { font-style: normal; } .wcard .ico .t { display: flex; gap: 5px; align-items: center; }
  .wcard .ico .bar { display: block; height: 5px; background: #8a8282; border-radius: 3px; }
  .wcard .ico .opts { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 9px; padding-left: 11px; } .wcard .ico .opt { display: flex; gap: 4px; align-items: center; } .wcard .ico .opt .bar { flex: 1; }
  .wcard .ico .box { display: block; background: #d8d3d3; border: 1px solid #9a9393; border-radius: 2px; height: 26px; margin: 1px 20px 1px 11px; } .wcard .ico .box.sm { height: 20px; margin: 0; flex: 1; }
  .wcard .ico table { border-collapse: collapse; margin-left: 11px; } .wcard .ico td { border: 1px solid #000; padding: 2px 6px; min-width: 30px; } .wcard .ico td .bar { width: 100%; }
  .wcard .ico .rule { display: block; border-top: 1px solid #000; height: 0; margin: 6px 0 0 11px; } .wcard .ico .work { display: block; border: 1px dashed #bbb; height: 24px; margin-left: 11px; border-radius: 2px; }
  .wcard .ico .lab { display: flex; gap: 5px; align-items: center; padding-left: 11px; } .wcard .ico .lab .rule { flex: 1; margin: 0; }
  .wcard .ico .eq { text-align: center; } .wcard .ico .pill { font: 9px Arial, sans-serif; border: 1px solid #000; border-radius: 999px; padding: 1px 5px; }
  .wcard .ico .grid { display: block; height: 32px; margin-left: 11px; border: 1px solid #000; background: repeating-linear-gradient(90deg, #bbb 0 1px, transparent 1px 9px), repeating-linear-gradient(180deg, #bbb 0 1px, transparent 1px 9px); }
  .wcard .ico .chk { display: flex; gap: 5px; align-items: center; padding-left: 11px; } .wcard .ico .chk b { width: 9px; height: 9px; border: 1px solid #000; } .wcard .ico .boxed { display: block; border: 1px solid #000; height: 16px; margin: 3px 0 0 11px; }
  .wmore { margin: 6px 0 2px; font-size: 12px; } .wmore summary { cursor: pointer; color: var(--maroon-deep); } .wmore .wrow { margin-top: 6px; }
  `;
  function init(app) {
    A = app;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const add = html => document.body.insertAdjacentHTML('beforeend', html);
    add(`<div id="wMgr" class="modal" hidden><div class="dialog" style="width:min(820px,96vw)"><h2>My questions</h2>
      <div class="waddbar"><button id="wNewQ" class="primary">New question…</button><button id="wNewMC" hidden>New multiple choice</button><button id="wNewCR" hidden>New written question</button><button id="wNewCL" hidden>New cluster</button><button id="wNewR" hidden>Start from a Regents question…</button></div>
      <div id="wMgrList" style="max-height:56vh;overflow:auto;margin-top:10px"></div>
      <div class="actions"><span class="hint" style="flex:1">Your questions are private unless you share them. They are listed with the old Regents questions under Kind, My questions.</span><button id="wMgrClose">Close</button></div></div></div>`);
    add(`<div id="wNew" class="modal" hidden style="z-index:56"><div class="dialog" style="width:min(900px,96vw)"><div class="wrow" style="justify-content:space-between"><h2 id="wNewTitle" style="margin:0">New question</h2><button class="small" id="wNewBack" hidden>‹ Back</button></div>
      <div class="hint" style="margin:4px 0 10px">Pick what it looks like. You can change the layout later without losing what you typed.</div>
      <div class="wcards" id="wNewCards"></div>
      <div class="actions"><span class="spacer"></span><button id="wNewCancel">Cancel</button></div></div></div>`);
    add(`<div id="wImp" class="modal" hidden style="z-index:56"><div class="dialog" style="width:min(720px,96vw)"><h2>Import a question</h2>
      <div class="hint">Give an AI the handoff below and ask it for a question or a cluster on your topic. Save what it returns as a .json file and choose that file here. One file opens in the editor so you can look it over and save it. Several files at once (or one file holding a list of questions) are checked and saved straight into your list, without a preview.</div>
      <div class="wrow" style="margin-top:10px"><button id="wImpDoc">Download the AI handoff</button><label class="wadd primary" style="cursor:pointer">Choose .json file(s)<input type="file" id="wImpFile" accept=".json,application/json,text/plain" multiple hidden></label></div>
      <div id="wImpOut" class="hint" style="white-space:pre-wrap;margin-top:8px"></div>
      <div class="actions"><span class="spacer"></span><button id="wImpCancel">Cancel</button></div></div></div>`);
    add(`<div id="wEd" class="modal" hidden><div class="dialog"><div class="wrow" style="justify-content:space-between"><h2 id="wEdTitle" style="margin:0">New question</h2><button class="small" id="wRelayout" hidden>Change layout…</button></div>
      <div class="wrow"><label>Title</label><input type="text" id="wTitle" placeholder="A short name for your list" style="flex:1;min-width:200px"><span id="wShareRow"><label style="display:flex;align-items:center;gap:5px;color:inherit"><input type="checkbox" id="wShare"> Share with the department</label></span><span class="hint" id="wBased"></span></div>
      <div class="wrow" id="wStyleRow" hidden><label>Lives in</label><select id="wStyle"><option value="old">Old Regents list (My questions): unit and question type per question</option><option value="new">New clusters tab: a titled scenario, each question tagged with a standard and a new-format type</option></select></div>
      <div class="wrow" id="wScaleRow" hidden><label>Diagram size</label><input type="range" id="wScale" min="10" max="200" step="5" value="100" style="flex:1"><span id="wScaleVal" style="width:46px;text-align:right">100%</span><span class="hint">every picture in this question, on the page and in the choices</span></div>
      <div class="wcols"><div class="wleft"><div id="wParts"></div>
        <div class="waddbar"><button class="small" id="wAddP">+ Paragraph</button><button class="small" id="wAddD">+ Diagram</button><button class="small" id="wAddQ">+ Question…</button><button class="small" id="wAddR">+ Copy a Regents question…</button><button class="small" id="wAddM" hidden>+ Multiple choice</button><button class="small" id="wAddC" hidden>+ Written response</button></div>
        <div class="hint">Subscripts and superscripts: H_2O, x_{10}, 10^3, 10^{-3}. Italic: *word*. Bold: **word**. Each line you type is its own line on the page.</div></div>
        <div id="wPreview"></div></div>
      <div class="actions"><button id="wDelete" class="danger" hidden>Delete</button><span class="spacer"></span><button id="wCancel">Cancel</button><button id="wSave" class="primary">Save</button></div></div></div>`);
    add(`<div id="wPick" class="modal" hidden style="z-index:55"><div class="dialog narrow" style="width:min(680px,96vw)"><h2>Start from a Regents question</h2>
      <input type="search" id="wPickSearch" placeholder="Search every question in this subject" style="width:100%">
      <div class="hint" id="wPickHint" style="margin:6px 0"></div>
      <div id="wPickList" style="max-height:48vh;overflow:auto;border:1px solid var(--line);border-radius:10px"></div>
      <div class="actions"><label class="hint" style="display:flex;align-items:center;gap:5px;flex:1"><input type="checkbox" id="wPickWhole"> For a cluster, bring the passage and all of its questions</label><button id="wPickCancel">Cancel</button></div></div></div>`);
    $('wMgrClose').onclick = () => { $('wMgr').hidden = true; };
    $('wPickCancel').onclick = () => { $('wPick').hidden = true; pickDone = null; };
    $('wPickSearch').oninput = renderPick;
    ['wMgr', 'wPick'].forEach(id => $(id).addEventListener('click', e => { if (e.target === $(id)) $(id).hidden = true; }));
    $('wNewQ').onclick = () => { $('wMgr').hidden = true; openGallery({ mode: 'new' }); };
    $('wNewCancel').onclick = closeGallery; $('wNewBack').onclick = () => renderGallery('branch');
    $('wImpCancel').onclick = () => { $('wImp').hidden = true; };
    $('wImp').addEventListener('click', e => { if (e.target === $('wImp')) $('wImp').hidden = true; });
    $('wImpDoc').onclick = async () => {
      try { const r = await fetch(HANDOFF_URL); if (!r.ok) throw new Error(r.status); const t = (await r.text()).replace(/<!-- APPENDIX -->[\s\S]*$/, '') + handoffAppendix(); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/markdown' })); a.download = `question-import-handoff-${window.SUBJECT_ID || 'science'}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
      catch (e) { window.open(HANDOFF_URL, '_blank'); }
    };
    $('wImpFile').addEventListener('change', async e => {
      const files = [...(e.target.files || [])]; e.target.value = ''; if (!files.length) return;
      const out = $('wImpOut'); out.style.color = ''; out.textContent = 'Checking…';
      const bad = s => { out.style.color = 'var(--danger, #b00020)'; out.textContent = s; };
      // every file's content: one object, or a list of objects (each a question)
      const units = [];
      for (const f of files) {
        let obj;
        try { obj = JSON.parse(await f.text()); } catch (err) { units.push({ name: f.name, errors: ['not valid JSON: ' + err.message + ' (ask the AI for the file again, or look for a missing comma or bracket)'] }); continue; }
        if (Array.isArray(obj) && obj.length > 1) obj.forEach((o, k) => units.push({ name: `${f.name} #${k + 1}`, obj: o }));
        else units.push({ name: f.name, obj });
      }
      if (units.length > 1) {                                           // several questions: check and save them all, no preview
        let saved = 0; const notes = [];
        for (const u of units) {
          const r = u.errors ? { errors: u.errors, warnings: [] } : await importQuestion(u.obj);
          if (r.errors.length) { notes.push(`${u.name}: NOT imported\n   • ` + r.errors.join('\n   • ')); continue; }
          await saveRec(r.rec); saved++;
          if (r.warnings.length) notes.push(`${u.name}: imported "${r.rec.title}" with notes\n   • ` + r.warnings.join('\n   • '));
        }
        out.style.color = saved ? '' : 'var(--danger, #b00020)';
        out.textContent = `${saved} of ${units.length} question${units.length === 1 ? '' : 's'} saved to your list.` + (notes.length ? '\n\n' + notes.join('\n') : '');
        renderMgr(); return;
      }
      const u = units[0]; if (u.errors) { bad('That file is ' + u.errors[0]); return; }
      const res = await importQuestion(u.obj);
      if (res.errors.length) { out.style.color = 'var(--danger, #b00020)'; out.textContent = 'This file cannot be imported:\n• ' + res.errors.join('\n• ') + (res.warnings.length ? '\n\nAlso noticed:\n• ' + res.warnings.join('\n• ') : ''); return; }
      $('wImp').hidden = true;
      if (res.warnings.length) alert('Imported with notes:\n• ' + res.warnings.join('\n• '));
      openEditor(res.rec, true); $('wEdTitle').textContent = 'Imported question · check it, then Save';
    });
    $('wNewMC').onclick = () => { $('wMgr').hidden = true; const p = newPart('mc'); applyLayout(p, 'plain'); openEditor({ title: '', parts: [p] }, true); };
    $('wNewCR').onclick = () => openEditor({ title: '', parts: [{ t: 'cr', stem: '', figs: [], credit: 1, space: { kind: 'lines', n: 3 }, note: '', unit: 'misc', type: 'misc' }] }, true);
    $('wNewCL').onclick = () => openEditor({ title: '', parts: [{ t: 'passage', heading: '', text: '', figs: [] }, { t: 'cr', stem: '', figs: [], credit: 1, space: { kind: 'lines', n: 3 }, note: '', unit: 'misc', type: 'misc' }] }, true);
    $('wNewR').onclick = () => openPicker(got => openEditor({ title: got.title || '', based: got.based, parts: got.parts }, true));
    wireEditor();
    RECS = loadRecs(); RECS.forEach(r => { try { register(r); } catch (e) { console.warn('could not load a written question', r.id, e); } });
    if (RECS.length) { ensureCustomOption(); A.renderList(); if (A.picked.some(id => RECS.some(r => r.id === id))) A.renderSheet(); }
  }
  window.WRITER = { init, open, edit, shareUsed, parseRuns, runsToMarkup, build, copyParts, makeGrid, makeTable, respOf, importRecs, importQuestion, handoffAppendix, get recs() { return RECS; } };
})();

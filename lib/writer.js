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
  const figBlocks = (figs, maxW) => (figs || []).map(f => { const w = Math.min(f.w / DPI, maxW || 6.6); return { t: 'img', src: f.src, w_in: +w.toFixed(3), h_in: +(w * f.h / f.w).toFixed(3) }; });

  // ------------------------------------------------------------------------------------------------ answer spaces
  const SPACES = [['lines', 'Ruled lines'], ['blank', 'Blank space'], ['box', 'Box'], ['short', 'Short blank, with a label or unit'], ['labelled', 'Labelled lines'], ['checks', 'Check boxes'],
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
      case 'lines': return { kind: 'lines', lines: Math.min(25, Math.max(1, Math.round(num(s.n, 3)))) };
      case 'blank': return { kind: 'blank', h_in: num(s.h, 1.5) };
      case 'box': return { kind: 'box', box_h_in: num(s.h, 2) };
      case 'short': { const parts = []; if (s.label) parts.push({ runs: parseRuns(s.label) }); parts.push({ blank_in: num(s.len, 2) }); if (s.unit) parts.push({ runs: parseRuns(s.unit).map(r => Object.assign(r, { b: true })) }); return { kind: 'labelled-blank', parts }; }
      case 'labelled': { const labs = linesOf(s.labels); return labs.length ? { kind: 'lines', lines: labs.length, labels: labs.map((l, i) => ({ line: i + 1, runs: parseRuns(l) })) } : { kind: 'lines', lines: 2 }; }
      case 'checks': { const o = linesOf(s.options); return o.length ? { kind: 'lines', lines: 0, boxes: o.map(x => ({ runs: parseRuns(x) })), boxes_stack: true } : null; }
      case 'grid': return pic('graph-grid'); case 'table': return pic('table'); case 'picture': return pic('diagram');
      case 'orig': return s.resp || null;
      default: return null;
    }
  }

  // ------------------------------------------------------------------------------------------------ record -> bank entry + text record
  function build(rec) {
    const items = [], lead = [], metaItems = []; let pend = [], qn = 0;
    (rec.parts || []).forEach(p => {
      if (p.t === 'passage') { pend.push(...[].concat(p.heading ? [{ t: 'p', role: 'heading', runs: [{ s: p.heading, b: true }] }] : [], textToBlocks(p.text), figBlocks(p.figs))); return; }
      qn++;
      const it = { q: qn, mc: p.t === 'mc', credit: p.t === 'mc' ? 1 : Math.max(1, Math.round(num(p.credit, 1))), blocks: textToBlocks(p.stem).concat(figBlocks(p.figs, 6.2)) };
      if (qn === 1) lead.push(...pend); else if (pend.length) it.pre = pend; pend = [];
      let ctext = '';
      if (it.mc) {
        const cs = (p.choices || ['', '', '', '']).slice(0, 4), imgs = p.cimgs || [];
        it.choices = cs.map((c, k) => imgs[k] ? { img: imgs[k].src, w_in: +(Math.min(imgs[k].w / DPI, 3)).toFixed(3), h_in: +(Math.min(imgs[k].w / DPI, 3) * imgs[k].h / imgs[k].w).toFixed(3) } : { runs: parseRuns(c) });
        const any = imgs.some(Boolean), all = any && cs.every((c, k) => imgs[k]);
        it.choice_layout = all ? 'grid' : any ? 'stacked' : cs.every(c => plain(c).length <= 18) ? 'grid' : 'stacked';
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
  function register(rec) { const b = build(rec), C = A.C, i = C.findIndex(c => c.id === rec.id); if (i >= 0) C[i] = b.meta; else C.push(b.meta); A.TEXT[rec.id] = b.text; fresh(); }
  function unregister(id) { const i = A.C.findIndex(c => c.id === id); if (i >= 0) A.C.splice(i, 1); delete A.TEXT[id]; fresh(); }

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
  async function deleteRec(id) {
    RECS = RECS.filter(r => r.id !== id); unregister(id); storeLocal();
    const st = A.state; if (st.picked.includes(id)) { st.picked = st.picked.filter(x => x !== id); delete st.dropped[id]; A.setState(st); } else A.renderList();
    if (A.SHARED) { try { await A.call('deleteCustom', id); } catch (e) { alert('Removed here, but not from your account: ' + e.message); } }
  }
  function ensureCustomOption() { const f = $('fExam'); if (f && ![...f.options].some(o => o.value === 'custom')) f.append(new Option('My questions (custom)', 'custom')); }
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
    : { t: 'cr', stem: '', figs: [], credit: 1, space: { kind: 'lines', n: 3 }, note: '', unit: lastUnit(), type: 'misc' };
  const NAME = { passage: 'Passage', mc: 'Multiple choice', cr: 'Written response' };
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
    if (s.kind === 'lines') h += `<div class="wrow sub">${n('n', 'Number of lines', s.n || 3, 1, 25)}</div>`;
    if (s.kind === 'blank' || s.kind === 'box') h += `<div class="wrow sub">${n('h', 'Height in inches', s.h || (s.kind === 'box' ? 2 : 1.5), 0.3, 9, 0.1)}</div>`;
    if (s.kind === 'short') h += `<div class="wrow sub">${t('label', 'Label before the blank', s.label, 'Mass:')}${n('len', 'Blank length, inches', s.len || 2, 0.5, 6, 0.25)}${t('unit', 'Unit after the blank', s.unit, 'g/mL')}</div>`;
    if (s.kind === 'labelled') h += `<div class="wrow sub"><label class="wmini wide" style="flex:1">One label per line: each gets a ruled line<textarea ${f('labels')} rows="3" placeholder="Claim:&#10;Evidence:&#10;Reasoning:">${esc(s.labels || '')}</textarea></label></div>`;
    if (s.kind === 'checks') h += `<div class="wrow sub"><label class="wmini wide" style="flex:1">One option per line: each gets a check box<textarea ${f('options')} rows="3" placeholder="Increases&#10;Decreases&#10;Stays the same">${esc(s.options || '')}</textarea></label></div>`;
    if (s.kind === 'grid') h += `<div class="wrow sub">${n('cols', 'Columns', s.cols || 10, 2, 40)}${n('rows', 'Rows', s.rows || 10, 2, 40)}${t('xlab', 'Bottom axis title', s.xlab, 'Time (s)')}${t('ylab', 'Side axis title', s.ylab, 'Distance (m)')}${t('title', 'Title above', s.title, '')}</div>`;
    if (s.kind === 'table') h += `<div class="wrow sub">${t('heads', 'Column headings, separated by commas', s.heads, 'Trial, Mass (g), Volume (mL)')}${n('rows', 'Empty rows', s.rows || 4, 1, 20)}</div>`;
    if (s.kind === 'picture') h += `<div class="wrow sub">${s.img ? `<span class="wfig"><img src="${s.img.src}" alt=""></span>` : ''}<label class="wadd">${s.img ? 'Replace the picture' : 'Choose a picture'}<input type="file" accept="image/*" hidden data-p="${i}" data-spacepic="1"></label></div>`;
    if (s.kind === 'orig') h += `<div class="wrow sub hint">The answer space of the Regents question is kept as it was. Choose another kind to replace it.</div>`;
    return h;
  }
  function partHTML(p, i, n) {
    const head = `<div class="whead"><b>${NAME[p.t]}</b><span style="flex:1"></span><button class="small" data-p="${i}" data-mv="-1"${i === 0 ? ' disabled' : ''} title="Move up">▲</button><button class="small" data-p="${i}" data-mv="1"${i === n - 1 ? ' disabled' : ''} title="Move down">▼</button><button class="small" data-p="${i}" data-del="1" title="Remove this part">✕</button></div>`;
    const ta = (name, val, rows, ph) => `<textarea data-p="${i}" data-f="${name}" rows="${rows}" placeholder="${esc(ph)}">${esc(val || '')}</textarea>`;
    if (p.t === 'passage') return `<div class="wpart" data-i="${i}">${head}<input type="text" data-p="${i}" data-f="heading" value="${esc(p.heading || '')}" placeholder="Title above the passage (optional)">${ta('text', p.text, 5, 'The reading, data description or directions. Each line you type is its own paragraph.')}${figsHTML(p, i)}</div>`;
    const tags = `<div class="wrow"><label>Unit</label><select data-p="${i}" data-unit="1" style="flex:1;min-width:0;max-width:46%">${unitOptions(p.unit)}</select><label style="margin-left:8px">Type</label><select data-p="${i}" data-f="type" style="flex:1;min-width:0">${typeOptions(p.unit, p.type)}</select></div>`;
    if (p.t === 'mc') return `<div class="wpart" data-i="${i}">${head}${ta('stem', p.stem, 3, 'The question')}${figsHTML(p, i)}` +
      [0, 1, 2, 3].map(k => `<div class="wrow"><label style="width:22px">(${k + 1})</label>${p.cimgs && p.cimgs[k] ? `<span class="wfig"><img src="${p.cimgs[k].src}" alt=""><button data-p="${i}" data-cimgrm="${k}" title="Remove the picture and type this choice">✕</button></span>` : `<input type="text" data-p="${i}" data-f="choices.${k}" value="${esc(p.choices[k] || '')}" style="flex:1">`}</div>`).join('') +
      `<div class="wrow"><label>Correct answer</label><select data-p="${i}" data-f="answer">${[1, 2, 3, 4].map(k => `<option value="${k}"${Number(p.answer) === k ? ' selected' : ''}>(${k})</option>`).join('')}</select></div>${tags}</div>`;
    return `<div class="wpart" data-i="${i}">${head}${ta('stem', p.stem, 3, 'The question')}${figsHTML(p, i)}<div class="wrow"><label>Credits</label><input type="number" data-p="${i}" data-f="credit" value="${esc(p.credit || 1)}" min="1" max="9" style="width:64px"></div>` +
      spaceHTML(p, i) + `<div class="wrow sub" style="display:block"><label class="wmini wide" style="display:block">Scoring note for the key (optional)${ta('note', p.note, 2, 'Allow 1 credit for …')}</label></div>${tags}</div>`;
  }
  function renderParts() {
    const n = ed.rec.parts.length;
    $('wParts').innerHTML = n ? ed.rec.parts.map((p, i) => partHTML(p, i, n)).join('') : '<div class="hint" style="padding:8px 2px">Nothing yet. Add a passage or a question below.</div>';
    preview();
  }
  function preview() {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(() => {
      try {
        const b = build(Object.assign({}, ed.rec, { id: ed.rec.id || 'cc_preview' })).text, W = 6.4, pt = 11.5; let h = '';
        if (b.blocks.length) h += A.opsHTML(A.ENG.layoutBlocks({ blocks: b.blocks }, W, pt, {}));
        b.items.forEach(it => { if (it.pre) h += A.opsHTML(A.ENG.layoutBlocks({ blocks: it.pre }, W, pt, {}));
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
    });
    box.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !ed) return; const i = Number(b.dataset.p), ps = ed.rec.parts;
      if (b.dataset.mv) { const j = i + Number(b.dataset.mv); [ps[i], ps[j]] = [ps[j], ps[i]]; renderParts(); }
      else if (b.dataset.del) { ps.splice(i, 1); renderParts(); }
      else if (b.dataset.figrm != null) { ps[i].figs.splice(Number(b.dataset.figrm), 1); renderParts(); }
      else if (b.dataset.cimgrm != null) { ps[i].cimgs[Number(b.dataset.cimgrm)] = null; if (!ps[i].cimgs.some(Boolean)) ps[i].cimgs = null; renderParts(); }
    });
    $('wAddP').onclick = () => { ed.rec.parts.push(newPart('passage')); renderParts(); };
    $('wAddM').onclick = () => { ed.rec.parts.push(newPart('mc')); renderParts(); };
    $('wAddC').onclick = () => { ed.rec.parts.push(newPart('cr')); renderParts(); };
    $('wAddR').onclick = () => openPicker(got => { ed.rec.parts.push(...got.parts); if (!ed.rec.based) ed.rec.based = got.based; if (!$('wTitle').value && got.title) $('wTitle').value = got.title; renderParts(); });
    $('wCancel').onclick = () => { $('wEd').hidden = true; ed = null; };
    $('wDelete').onclick = () => { if (ed && !ed.isNew && confirm('Delete this question for good?')) { const id = ed.rec.id; $('wEd').hidden = true; ed = null; deleteRec(id); } };
    $('wSave').onclick = async () => {
      const rec = ed.rec, qs = rec.parts.filter(p => p.t !== 'passage');
      if (!qs.length) { alert('Add at least one question.'); return; }
      if (rec.parts[rec.parts.length - 1].t === 'passage') { alert('The last part is a passage with no question after it. Add a question below it or remove it.'); return; }
      const bad = qs.find(p => !p.stem.trim() && !(p.figs && p.figs.length)) || qs.find(p => p.t === 'mc' && p.choices.some((c, k) => !c.trim() && !(p.cimgs && p.cimgs[k])));
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
    $('wShareRow').style.display = A.SHARED ? '' : 'none'; $('wDelete').hidden = !!isNew;
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
  `;
  function init(app) {
    A = app;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const add = html => document.body.insertAdjacentHTML('beforeend', html);
    add(`<div id="wMgr" class="modal" hidden><div class="dialog" style="width:min(820px,96vw)"><h2>My questions</h2>
      <div class="waddbar"><button id="wNewMC">New multiple choice</button><button id="wNewCR">New written question</button><button id="wNewCL">New cluster</button><button id="wNewR">Start from a Regents question…</button></div>
      <div id="wMgrList" style="max-height:56vh;overflow:auto;margin-top:10px"></div>
      <div class="actions"><span class="hint" style="flex:1">Your questions are private unless you share them. They are listed with the old Regents questions under Kind, My questions.</span><button id="wMgrClose">Close</button></div></div></div>`);
    add(`<div id="wEd" class="modal" hidden><div class="dialog"><h2 id="wEdTitle">New question</h2>
      <div class="wrow"><label>Title</label><input type="text" id="wTitle" placeholder="A short name for your list" style="flex:1;min-width:200px"><span id="wShareRow"><label style="display:flex;align-items:center;gap:5px;color:inherit"><input type="checkbox" id="wShare"> Share with the department</label></span><span class="hint" id="wBased"></span></div>
      <div class="wcols"><div class="wleft"><div id="wParts"></div>
        <div class="waddbar"><button class="small" id="wAddP">+ Passage</button><button class="small" id="wAddM">+ Multiple choice</button><button class="small" id="wAddC">+ Written response</button><button class="small" id="wAddR">+ Copy a Regents question…</button></div>
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
    $('wNewMC').onclick = () => { $('wMgr').hidden = true; A.openBuilder(null); };
    $('wNewCR').onclick = () => openEditor({ title: '', parts: [{ t: 'cr', stem: '', figs: [], credit: 1, space: { kind: 'lines', n: 3 }, note: '', unit: 'misc', type: 'misc' }] }, true);
    $('wNewCL').onclick = () => openEditor({ title: '', parts: [{ t: 'passage', heading: '', text: '', figs: [] }, { t: 'cr', stem: '', figs: [], credit: 1, space: { kind: 'lines', n: 3 }, note: '', unit: 'misc', type: 'misc' }] }, true);
    $('wNewR').onclick = () => openPicker(got => openEditor({ title: got.title || '', based: got.based, parts: got.parts }, true));
    wireEditor();
    RECS = loadRecs(); RECS.forEach(r => { try { register(r); } catch (e) { console.warn('could not load a written question', r.id, e); } });
    if (RECS.length) { ensureCustomOption(); A.renderList(); if (A.picked.some(id => RECS.some(r => r.id === id))) A.renderSheet(); }
  }
  window.WRITER = { init, open, edit, shareUsed, parseRuns, runsToMarkup, build, copyParts, makeGrid, makeTable, respOf, get recs() { return RECS; } };
})();

/* textpdf.js — typesets Text Bank questions (runs with sub/sup/italic/bold, equations, figures, choices) into
 * pdf-lib pages. Works in Node (module.exports) and in the browser (window.TextPDF). Geometry is in inches.
 *
 *   const eng = await TextPDF.create({ PDFLib, fontkit, fonts: { serif, bold, italic, symbol? }, image: path => bytes });
 *   fonts.symbol (optional, e.g. a STIX Two Math subset) supplies arrows and any character the text face lacks.
 *   const items = eng.buildItems(picked, { bank, text, cols, pt, blank });      // picked: question ids in order
 *   const M = eng.buildModel(items, { cols, pt, start, blank, note });           // pages, numbering, key rows
 *   const bytes = await eng.makePDF(M, 'sheet' | 'key', 'A' | 'B', { title, blanks, note, key, refBlock, src, label });
 *
 * Layout constants match the image-based Chem Test Builder so the two can be compared page for page.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.TextPDF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const PT = 72, MARGIN = 36, PH = 792;
  const PAGE_H = 10, PAGE_W = 7.5, ITEM_GAP = 0.16, GUTTER = 0.36;
  const BLANK_W = 0.3, BLANK_GAP = 0.03, BLANK_IN = 0.1;
  const LH = 1.2, ASC = 0.891, LABEL_W = 0.3;
  const SUB_K = 0.65, SUB_DY = 0.17, SUP_DY = -0.36;      // script size and baseline shift, in em of the body size
  const BASE_PT = 11.5;                                    // the exams' body size; figures are stored at printed size
  const HARP_W = 0.9;                                      // ⇌ advance, em (only when no symbol font is given)
  const SYMBOL_ALWAYS = /[←-⇿∀-⋿]/;   // arrows and operators always come from the symbol font: the text face's are too light
  const TABLE_NAMES = { 'PT-ox': 'Periodic Table oxidation states', 'PT-config': 'Periodic Table electron configurations', 'PT-mass': 'Periodic Table masses' };
  const tableLabel = t => TABLE_NAMES[t] || `Table ${t}`;

  async function create(env) {
    const { PDFDocument, rgb } = env.PDFLib;
    const measureDoc = await PDFDocument.create(); measureDoc.registerFontkit(env.fontkit);
    const MF = { r: await measureDoc.embedFont(env.fonts.serif), b: await measureDoc.embedFont(env.fonts.bold), i: await measureDoc.embedFont(env.fonts.italic) };
    if (env.fonts.symbol) MF.m = await measureDoc.embedFont(env.fonts.symbol, { subset: false });
    const CHARSET = new Set(MF.r.getCharacterSet()), SYMSET = new Set(MF.m ? MF.m.getCharacterSet() : []);
    const missing = {};
    const isSym = ch => MF.m && (SYMBOL_ALWAYS.test(ch) ? SYMSET.has(ch.codePointAt(0)) : (!CHARSET.has(ch.codePointAt(0)) && SYMSET.has(ch.codePointAt(0))));
    const clean = (s, ctx, f) => Array.from(String(s ?? '')).map(ch => {
      if ((f === 'm' ? SYMSET : CHARSET).has(ch.codePointAt(0))) return ch;
      (missing[ch] = missing[ch] || new Set()).add(ctx || '?'); return '?';
    }).join('');
    const widthIn = (s, pt, f) => MF[f || 'r'].widthOfTextAtSize(clean(s, null, f), pt) / PT;

    // ------------------------------------------------------------ runs -> fragments -> atoms (words)
    const fontOf = r => r.b ? 'b' : r.i ? 'i' : 'r';
    function fragsOf(runs, pt, ctx) {
      // one fragment per run piece; '⇌' is a drawn glyph, everything else is text in one of the three faces
      const out = [];
      for (const r of runs) {
        const k = (r.sub || r.sup) ? SUB_K : 1, dy = r.sub ? SUB_DY : r.sup ? SUP_DY : 0, f = fontOf(r);
        // split into runs of text-face characters and symbol-face characters
        let buf = '', bufSym = null;
        const flush = () => { if (buf) out.push({ s: clean(buf, ctx, bufSym ? 'm' : f), f: bufSym ? 'm' : f, k, dy, pt: pt * k }); buf = ''; };
        for (const ch of String(r.s)) {
          if (ch === '⇌' && !MF.m) { flush(); out.push({ harp: true, w: HARP_W * pt / PT, k: 1, dy: 0, f: 'r', s: '' }); continue; }
          const sym = isSym(ch);
          if (buf && sym !== bufSym) flush();
          buf += ch; bufSym = sym;
        }
        flush();
      }
      return out;
    }
    function atomsOf(runs, pt, ctx) {
      // split at spaces (body-size spaces between atoms); an atom is a list of fragments that must stay together
      const atoms = []; let cur = [];
      const flush = () => { if (cur.length) atoms.push(cur); cur = []; };
      for (const fr of fragsOf(runs, pt, ctx)) {
        if (fr.harp) { flush(); atoms.push([fr]); continue; }
        const parts = fr.s.split(' ');
        parts.forEach((p, i) => {
          if (i > 0) flush();
          if (p) cur.push({ s: p, f: fr.f, k: fr.k, dy: fr.dy, pt: fr.pt, w: widthIn(p, fr.pt, fr.f) });
        });
      }
      flush();
      return atoms;
    }
    const atomW = a => a.reduce((s, fr) => s + fr.w, 0);

    /** Wrap atoms into lines of at most wIn; returns [[atom...], ...]. */
    function wrapAtoms(atoms, wIn, pt) {
      const sp = widthIn(' ', pt), lines = []; let line = [], lw = 0;
      for (const a of atoms) {
        const aw = atomW(a);
        if (line.length && lw + sp + aw > wIn + 1e-6) { lines.push(line); line = []; lw = 0; }
        if (!line.length && aw > wIn) {                       // an unbreakable word wider than the column: cut by characters
          let rest = a.slice();
          while (rest.length) {
            const piece = []; let pw = 0;
            while (rest.length) {
              const fr = rest[0];
              if (pw + fr.w <= wIn || !piece.length && fr.s.length <= 1) { piece.push(fr); pw += fr.w; rest.shift(); continue; }
              let cut = fr.s.length - 1; while (cut > 1 && pw + widthIn(fr.s.slice(0, cut), fr.pt, fr.f) > wIn) cut--;
              if (cut <= 0) break;
              const head = Object.assign({}, fr, { s: fr.s.slice(0, cut) }); head.w = widthIn(head.s, fr.pt, fr.f);
              piece.push(head); rest[0] = Object.assign({}, fr, { s: fr.s.slice(cut) }); rest[0].w = widthIn(rest[0].s, fr.pt, fr.f);
              break;
            }
            if (!piece.length) break;
            lines.push([piece]);
          }
          continue;
        }
        line.push(a); lw += (line.length > 1 ? sp : 0) + aw;
      }
      if (line.length) lines.push(line);
      return lines;
    }
    const lineW = (line, pt) => line.reduce((s, a) => s + atomW(a), 0) + widthIn(' ', pt) * Math.max(0, line.length - 1);

    // ------------------------------------------------------------ a question or stimulus -> ops
    /**
     * lay = layoutBlocks(q, wIn, pt, {perm, nums, id}) -> {ops, h, w, base0}
     * ops: {t:'text', s, x, y(baseline), pt, f} | {t:'harp', x, y(baseline), pt} | {t:'img', src, x, y, w, h}
     */
    function layoutBlocks(q, wIn, pt, o) {
      o = o || {};
      const ops = []; let y = 0; const lh = pt / PT * LH, asc = pt / PT * ASC, sp = widthIn(' ', pt);
      const kImg = pt / BASE_PT, LW = LABEL_W * kImg;
      let base0 = null;
      const emit = (lines, x, w, align) => {
        for (const line of lines) {
          y += lh; const base = y - (lh - asc) / 2 - 0.02; if (base0 === null) base0 = base;
          let cx = x + (align === 'center' ? Math.max(0, (w - lineW(line, pt)) / 2) : 0);
          for (const a of line) {
            for (const fr of a) {
              if (fr.harp) ops.push({ t: 'harp', x: cx, y: base, pt });
              else ops.push({ t: 'text', s: fr.s, x: cx, y: base + fr.dy * pt / PT, pt: fr.pt, f: fr.f });
              cx += fr.w;
            }
            cx += sp;
          }
        }
      };
      const subst = runs => o.nums ? runs.map(r => Object.assign({}, r, { s: String(r.s).replace('{a}', o.nums.a).replace('{b}', o.nums.b) })) : runs;
      const para = (runs, x, w, align) => emit(wrapAtoms(atomsOf(subst(runs), pt, o.id), w, pt), x, w, align);
      const image = (b, x, w) => {
        let iw = b.w_in * kImg, ih = b.h_in * kImg;
        const fit = Math.min(1, w / iw, (PAGE_H - 0.6) / ih); iw *= fit; ih *= fit;
        ops.push({ t: 'img', src: b.src || b.img, x: x + (w - iw) / 2, y, w: iw, h: ih });
        y += ih;
      };
      const blocks = q.blocks || [];
      blocks.forEach((b, bi) => {
        if (bi) y += (b.t === 'img' || blocks[bi - 1].t === 'img') ? 0.08 : (b.t === 'eq' || blocks[bi - 1].t === 'eq') ? 0.08 : 0.05;
        if (b.t === 'p') para(b.runs, 0, wIn, 'left');
        else if (b.t === 'eq') para(b.runs, 0, wIn, 'center');
        else if (b.t === 'img') image(b, 0, wIn);
        else if (b.t === 'list') {
          const ind = 0.25 * kImg;
          (b.items || []).forEach(item => {
            const labeled = /^(?:[A-Za-z]|[IVX]+|\d+|[A-Za-z]+ \d+)[:.)]/.test(item.map(r => r.s).join('').trim());
            const y0 = y;
            if (!labeled) { y = y0; emit([[[{ s: '•', f: 'r', k: 1, dy: 0, pt, w: widthIn('•', pt) }]]], ind - 0.14, 0.14, 'left'); }
            y = y0; para(item, ind, wIn - ind, 'left');
          });
        }
        if (bi === blocks.length - 1 && b.t === 'img') y += 0.02;
      });
      // choices
      const choices = q.choices || [];
      if (choices.length) {
        y += 0.08;
        const order = o.perm || [1, 2, 3, 4];                  // perm[k] = original choice shown at position k (1-based)
        const shown = order.map(n => choices[n - 1]);
        const isImg = c => c && c.img;
        const textFits = (c, w) => !isImg(c) && lineW([...atomsOf(c.runs, pt, o.id)].length ? wrapAtoms(atomsOf(c.runs, pt, o.id), 99, pt)[0] : [], pt) <= w;
        const imgFits = (c, w) => isImg(c) && c.w_in * kImg * 0.8 <= w;      // pictures may shrink a little to make a row, as the exams do
        let layout = q.choice_layout || 'stacked';
        const gridGap = 0.06 * kImg, rowGap = 0.12 * kImg;
        const cellNeed = c => isImg(c) ? c.w_in * kImg : (lineW(wrapAtoms(atomsOf(c.runs, pt, o.id), 99, pt)[0] || [], pt) + LW);
        const rowColW = Math.min((wIn - 3 * rowGap) / 4, Math.max(...shown.map(c => cellNeed(c) || 0)) + 0.45 * kImg);
        // a 2 x 2 of pictures stays compact in a wide column; text choices use the half-column positions as printed
        const gridColW = shown.every(isImg) ? Math.min((wIn - gridGap) / 2, Math.max(...shown.map(cellNeed)) + 1.0 * kImg) : (wIn - gridGap) / 2;
        if (layout === 'row' && !shown.every(c => imgFits(c, rowColW) || textFits(c, rowColW - LW))) layout = 'grid';
        if (layout === 'grid' && !shown.every(c => imgFits(c, gridColW) || textFits(c, gridColW - LW))) layout = 'stacked';
        const label = (k, x, base) => ops.push({ t: 'text', s: `(${k + 1})`, x, y: base, pt, f: 'r' });
        const stackedChoice = (c, k, x, w) => {
          if (isImg(c)) {
            let iw = c.w_in * kImg, ih = c.h_in * kImg; const fit = Math.min(1, (w - LW) / iw); iw *= fit; ih *= fit;
            const base = ih <= lh ? y + (lh - asc) / 2 + asc - 0.02 : y + ih / 2 + asc * 0.35;   // small pictures sit on the text line; the label centres on a tall one
            label(k, x, base);
            ops.push({ t: 'img', src: c.img, x: x + LW, y: y + (ih <= lh ? (lh - ih) / 2 : 0), w: iw, h: ih });
            y += Math.max(ih, lh);
          } else {
            const y0 = y; para(c.runs, x + LW, w - LW, 'left');
            label(k, x, y0 + lh - (lh - asc) / 2 - 0.02);
          }
        };
        const imgSize = (c, w) => { let iw = c.w_in * kImg, ih = c.h_in * kImg; const fit = Math.min(1, w / iw); return { iw: iw * fit, ih: ih * fit }; };
        // a row of grid / row cells: pictures are centred in a common box with their labels on one line underneath (as printed);
        // small pictures and text keep the hanging label at the left
        const cellRow = (cells, w, gap) => {
          const y0 = y; let yMax = y;
          const caption = cells.some(([c]) => isImg(c) && imgSize(c, w).ih > 1.5 * lh);
          const box = caption ? Math.max(...cells.map(([c]) => isImg(c) ? imgSize(c, w).ih : 0)) : 0;
          cells.forEach(([c, k, col]) => {
            const x = col * (w + gap); y = y0;
            if (caption && isImg(c)) {
              const { iw, ih } = imgSize(c, w);
              ops.push({ t: 'img', src: c.img, x: x + (w - iw) / 2, y: y0 + (box - ih) / 2, w: iw, h: ih });
              y = y0 + box + 0.03; const lw = widthIn(`(${k + 1})`, pt); y += lh; label(k, x + (w - lw) / 2, y - (lh - asc) / 2 - 0.02);
            } else stackedChoice(c, k, x, w);
            yMax = Math.max(yMax, y);
          });
          y = yMax;
        };
        if (layout === 'row') cellRow(shown.map((c, k) => [c, k, k]), rowColW, rowGap);
        else if (layout === 'grid') {
          for (const r of [0, 1]) { cellRow([[shown[r], r, 0], [shown[r + 2], r + 2, 1]], gridColW, gridGap); y += 0.01; }
        } else {
          shown.forEach((c, k) => { stackedChoice(c, k, 0, wIn); y += 0.01; });
        }
      }
      return { ops, h: y + 0.04, w: wIn, base0: base0 == null ? asc : base0 };
    }

    // ------------------------------------------------------------ worksheet items
    /**
     * picked: ids in worksheet order. o.bank: bank.json object (answers, exams, types, units, stimuli); o.text: {id -> text record}
     * (questions and stimuli); o.cols 1|2; o.pt body size; o.blank answer blanks (widens the column gap).
     */
    function buildItems(picked, o) {
      const COLGAP = o.blank ? 0.55 : 0.3, halfW = (PAGE_W - COLGAP) / 2;
      const B = o.bank, byId = B._byId || (B._byId = Object.fromEntries(B.questions.map(q => [q.id, q])));
      const stimById = B._stimById || (B._stimById = Object.fromEntries((B.stimuli || []).map(s => [s.id, s])));
      const items = [], shown = new Set();
      const widthFor = full => (full || o.cols === 1 ? PAGE_W : halfW) - GUTTER;
      const addQ = (q, i) => {
        const t = o.text[q.id]; if (!t) return;
        const full = o.cols === 1 || q.width === 'full';
        const w = widthFor(full);
        const lay = layoutBlocks(t, w, o.pt, { id: q.id });
        const permB = q.b && q.b.perm && t.choices.length === 4 ? q.b.perm : null;
        const layB = permB ? layoutBlocks(t, w, o.pt, { id: q.id, perm: permB }) : lay;
        items.push({ kind: 'q', q, t, i, lay, layB, pt: o.pt, w, h: Math.min(PAGE_H - 0.2, Math.max(lay.h, layB.h)), full, block: q.stimulus || null });
      };
      picked.forEach((id, i) => {
        const q = byId[id]; if (!q) return;
        if (q.stimulus) {
          if (shown.has(q.stimulus)) return;
          shown.add(q.stimulus);
          const s = stimById[q.stimulus], ts = o.text[q.stimulus];
          if (ts) {
            const w = widthFor(true), lay = layoutBlocks(ts, w, o.pt, { id: ts.id, nums: { a: '00', b: '00' } });
            items.push({ kind: 'stim', stim: s, t: ts, i, lay, pt: o.pt, w, h: Math.min(PAGE_H - 0.2, lay.h), full: true, block: q.stimulus });
          }
          picked.forEach((id2, i2) => { const q2 = byId[id2]; if (q2 && q2.stimulus === q.stimulus) addQ(q2, i2); });
          return;
        }
        addQ(q, i);
      });
      return items;
    }

    // ------------------------------------------------------------ the column packer
    // Same rules as the image builder (column-major reading order, full-width items wait for an empty band), plus one
    // improvement: an item that fits neither column is parked and placed first on the next page, so the items after it
    // fill the space it left. Numbering follows placement, so the printed order stays top-to-bottom, left-to-right.
    function layout(items, opts) {
      const cols = opts.cols || 2, COLGAP = opts.colgap;
      const colW = cols === 2 ? (PAGE_W - COLGAP) / 2 : PAGE_W;
      const pages = []; let page, y0, col, colY, bandTop, parkedFull = [], parkedHalf = [], headDone = false;
      function newPage() {
        page = { items: [], rules: [] }; pages.push(page);
        y0 = (!headDone || opts.headAll) ? (opts.headH || 0) : 0; headDone = true;
        col = 0; colY = [y0, y0]; bandTop = y0;
        const list = parkedHalf; parkedHalf = [];
        list.forEach(it => { if (!placeHalf(it)) parkedHalf.push(it); });     // an empty page takes any single item
      }
      function closeBand() {
        const bottom = Math.max(colY[0], colY[1]);
        const inBand = page.items.filter(p => p.y >= bandTop && !p.item.full && p.item.kind !== 'brk');
        if (cols === 2 && inBand.length && (inBand.some(p => p.x > 0) || bottom - bandTop > 3))
          page.rules.push({ x: colW + COLGAP / 2, y: bandTop, h: bottom - bandTop - ITEM_GAP });
        return bottom;
      }
      function placeFull(it) {
        let y = closeBand();
        if (y + it.h > PAGE_H && page.items.length) { newPage(); y = closeBand(); }
        page.items.push({ item: it, x: 0, y });
        colY = [y + it.h + ITEM_GAP, y + it.h + ITEM_GAP]; bandTop = colY[0]; col = 0;
      }
      /** true when placed; false when it fits neither column (the caller decides what to do) */
      function placeHalf(it) {
        while (col < 2) {
          if (colY[col] + it.h <= PAGE_H + 1e-6) { page.items.push({ item: it, x: col * (colW + COLGAP), y: colY[col] }); colY[col] += it.h + ITEM_GAP; return true; }
          if (col === 1) return false;
          col = 1;
        }
        return false;
      }
      function placeBlock(block) {
        const [first, ...rest] = block;
        const need = first.h + ITEM_GAP + (first.kind === 'stim' && rest.length ? rest[0].h + ITEM_GAP : 0);
        let y = closeBand();
        if (y + need > PAGE_H && page.items.length) { newPage(); y = closeBand(); }
        if (first.full || cols === 1) { placeFull(first); }
        else { page.items.push({ item: first, x: 0, y }); colY = [y + first.h + ITEM_GAP, y]; bandTop = y; col = 0; }
        rest.forEach(q => { if (q.full || cols === 1) placeFull(q); else if (!placeHalf(q)) { closeBand(); newPage(); placeHalf(q); } });
      }
      const remaining = () => PAGE_H - colY[Math.min(col, 1)];
      const fits1 = u => (Array.isArray(u) ? u.reduce((s, it) => s + it.h + ITEM_GAP, 0) - ITEM_GAP : u.h) <= PAGE_H - colY[0] + 1e-6;
      // parked full-width items go out in order; in one-column mode one that still does not fit waits for the next page
      function flushFull() {
        const list = parkedFull; parkedFull = [];
        for (const u of list) { if (cols === 1 && page.items.length && !fits1(u)) parkedFull.push(u); else Array.isArray(u) ? placeBlock(u) : placeFull(u); }
      }
      newPage();
      const units = [];
      items.forEach(it => {
        const last = units[units.length - 1];
        if (it.block && Array.isArray(last) && last[0].block === it.block) last.push(it);
        else units.push(it.block ? [it] : it);
      });
      units.forEach(u => {
        if (cols === 1) {
          if (fits1(u) || !page.items.length) { Array.isArray(u) ? placeBlock(u) : placeFull(u); return; }
          parkedFull.push(u);
          if (remaining() < 1.2) { closeBand(); newPage(); flushFull(); }
          return;
        }
        const bandEmpty = colY[0] === y0 && colY[1] === y0 && !parkedHalf.length;
        if (Array.isArray(u)) { if (bandEmpty) placeBlock(u); else parkedFull.push(u); return; }
        if (u.full) { if (bandEmpty) placeFull(u); else parkedFull.push(u); return; }
        if (placeHalf(u)) return;
        // both columns are full for this one: first let waiting full-width items use the space under the band
        if (parkedFull.length) { flushFull(); if (placeHalf(u)) return; }
        parkedHalf.push(u);
        if (remaining() < 1.2) { closeBand(); newPage(); }
      });
      if (cols === 1) { while (parkedFull.length) { flushFull(); if (parkedFull.length) { closeBand(); newPage(); } } }
      else { while (parkedHalf.length || parkedFull.length) { if (parkedHalf.length) { closeBand(); newPage(); } flushFull(); } }
      closeBand();
      while (pages.length > 1 && !pages[pages.length - 1].items.length) pages.pop();
      return pages;
    }

    /** M = buildModel(items, {cols, pt, start, blank, note, bank}) */
    function buildModel(items, o) {
      const headH = 0.5 + (o.note ? 0.32 : 0.1), start = o.start || 1;
      const pages = layout(items, { cols: o.cols || 2, headH, colgap: o.blank ? 0.55 : 0.3 });
      const B = o.bank, T = (B && B.types) || {};
      let n = start; const order = [];
      pages.forEach(pg => pg.items.forEach(p => {
        if (p.item.kind !== 'q') return;
        p.item.n = n++; const q = p.item.q;
        order.push({ n: p.item.n, q, answer: q.answer, answerB: q.b ? q.b.answer : q.answer, tables: q.tables || [], ref: q.ref,
                     src: `${q.session} ${q.year} Q${q.q} · U${q.unit} · ${(T[q.type] || {}).name || ''}` });
      }));
      const tabs = {};
      order.forEach(x => (x.tables || []).forEach(t => { tabs[t] = tabs[t] || { nums: [], old: false }; tabs[t].nums.push(x.n); if (x.ref === 'old' || x.ref === 'partial') tabs[t].old = true; }));
      return { items, pages, order, tabs, start, headH, nq: order.length, blank: !!o.blank, cols: o.cols || 2, pt: o.pt };
    }

    // ------------------------------------------------------------ PDF
    async function makePDF(M, mode, version, o) {
      o = o || {}; version = version || 'A';
      const doc = await PDFDocument.create(); doc.registerFontkit(env.fontkit);
      const F = await doc.embedFont(env.fonts.serif, { subset: true }), FB = await doc.embedFont(env.fonts.bold, { subset: true }), FI = await doc.embedFont(env.fonts.italic, { subset: true });
      const FONT = { r: F, b: FB, i: FI };
      if (env.fonts.symbol && mode === 'sheet') FONT.m = await doc.embedFont(env.fonts.symbol, { subset: false });   // already a small subset; fontkit cannot re-subset CFF
      const imgCache = {};
      async function image(path) {
        if (imgCache[path]) return imgCache[path];
        const bytes = await env.image(path);
        return (imgCache[path] = await doc.embedPng(bytes));
      }
      const X = xin => MARGIN + xin * PT, Y = (yin, hin) => PH - MARGIN - yin * PT - (hin || 0) * PT;
      const text = (page, s, xin, baseIn, size, font, opts) => page.drawText(clean(s, null, font === FONT.m ? 'm' : null), Object.assign({ x: X(xin), y: PH - MARGIN - baseIn * PT, size, font, color: rgb(0, 0, 0) }, opts || {}));
      const textRight = (page, s, xRightIn, baseIn, size, font) => page.drawText(clean(s), { x: X(xRightIn) - font.widthOfTextAtSize(clean(s), size), y: PH - MARGIN - baseIn * PT, size, font });
      const line = (page, x0, y0, x1, y1, t) => page.drawLine({ start: { x: X(x0), y: PH - MARGIN - y0 * PT }, end: { x: X(x1), y: PH - MARGIN - y1 * PT }, thickness: t || 1, color: rgb(0, 0, 0) });
      const harpoon = (page, xin, baseIn, pt) => {
        // ⇌ : two half-arrows, drawn (the text face has no such glyph). Math axis 0.27 em above the baseline.
        const em = pt / PT, x0 = xin + 0.08 * em, x1 = xin + (HARP_W - 0.08) * em, ax = baseIn - 0.27 * em, g = 0.09 * em, hd = 0.16 * em, t = Math.max(0.6, pt / 16);
        line(page, x0, ax - g, x1, ax - g, t); line(page, x1, ax - g, x1 - hd, ax - g - hd * 0.75, t);            // top: points right
        line(page, x0, ax + g, x1, ax + g, t); line(page, x0, ax + g, x0 + hd, ax + g + hd * 0.75, t);            // bottom: points left
      };
      const title = o.title || 'Worksheet';
      const numPt = 11 * Math.max(1, (M.pt || BASE_PT) / BASE_PT);
      const numAt = (page, n, xin, baseIn) => textRight(page, String(n), xin + GUTTER - 0.06, baseIn, numPt, F);
      async function drawLay(page, lay, xin, yin) {
        for (const op of lay.ops) {
          if (op.t === 'img') { const im = await image(op.src); page.drawImage(im, { x: X(xin + op.x), y: Y(yin + op.y, op.h), width: op.w * PT, height: op.h * PT }); }
          else if (op.t === 'harp') harpoon(page, xin + op.x, yin + op.y, op.pt);
          else text(page, op.s, xin + op.x, yin + op.y, op.pt, FONT[op.f] || F);
        }
      }
      const groupNums = (block) => { const ns = []; M.pages.forEach(pg => pg.items.forEach(p => { if (p.item.kind === 'q' && p.item.block === block) ns.push(p.item.n); })); return ns; };
      if (mode === 'sheet') {
        for (let pi = 0; pi < M.pages.length; pi++) {
          const pg = M.pages[pi], page = doc.addPage([612, PH]);
          if (pi === 0) {
            text(page, title, 0, 0.3, 14, FB);
            if (o.label) text(page, o.label, FB.widthOfTextAtSize(clean(title), 14) / PT + 0.2, 0.3, 11, F);
            if (o.blanks) textRight(page, 'Name ____________________________   Date __________   Period _____', PAGE_W, 0.3, 11, F);
            line(page, 0, 0.4, PAGE_W, 0.4, 1.5);
            if (o.note) text(page, 'Some questions may require the use of the Reference Tables for Physical Setting/Chemistry.', 0, 0.62, 10, FI);
          }
          pg.rules.forEach(r => { if (r.h > 0) line(page, r.x, r.y, r.x, r.y + r.h, 0.8); });
          for (const p of pg.items) {
            const it = p.item;
            if (it.kind === 'stim') {
              const ns = groupNums(it.block), nums = { a: ns.length ? Math.min(...ns) : '', b: ns.length ? Math.max(...ns) : '' };
              const lay = layoutBlocks(it.t, it.w, it.pt, { id: it.t.id, nums });
              await drawLay(page, lay, p.x + GUTTER, p.y);
              continue;
            }
            const lay = version === 'B' ? it.layB : it.lay;
            await drawLay(page, lay, p.x + GUTTER, p.y);
            numAt(page, it.n, p.x, p.y + lay.base0);
            if (M.blank) line(page, p.x + BLANK_IN - BLANK_W, p.y + lay.base0 + 0.01, p.x + BLANK_IN, p.y + lay.base0 + 0.01, 0.7);
          }
          text(page, String(pi + 1), PAGE_W / 2 - 0.05, PAGE_H + 0.3, 9, F, { color: rgb(.27, .27, .27) });
        }
      } else {
        const page = doc.addPage([612, PH]);
        text(page, `${title} — Answer Key`, 0, 0.22, 13, FB);
        const src = !!o.src, rowH = 0.21, colW = src ? 3.9 : 1.6; let x = 0;
        for (let i = 0; i < M.order.length; i += 40) {
          const ch = M.order.slice(i, i + 40); let y = 0.45;
          const cols = src ? [0.5, 1.1, colW - 1.6] : [0.5, 1.1];
          const cell = (s, cx, cw, yy, font, size, color) => { const w = font.widthOfTextAtSize(clean(s), size) / PT; text(page, s, x + cx + (cw - w) / 2, yy + 0.15, size, font, color ? { color } : {}); };
          const rowLines = yy => { line(page, x, yy, x + colW, yy, 0.6); };
          rowLines(y); cell('#', 0, cols[0], y, FB, 10.5); cell('Answer', cols[0], cols[1], y, FB, 10.5); if (src) cell('Source', cols[0] + cols[1], cols[2], y, FB, 10.5);
          y += rowH; rowLines(y);
          ch.forEach(r => {
            cell(String(r.n), 0, cols[0], y, F, 10.5);
            cell(String((version === 'B' ? r.answerB : r.answer) ?? '?'), cols[0], cols[1], y, F, 10.5);
            if (src) { let s = r.src; while (F.widthOfTextAtSize(clean(s), 8) / PT > cols[2] - 0.1 && s.length > 4) s = s.slice(0, -2); cell(s, cols[0] + cols[1], cols[2], y, F, 8, rgb(.33, .33, .33)); }
            y += rowH; rowLines(y);
          });
          [0, cols[0], cols[0] + cols[1], colW].forEach(v => line(page, x + v, 0.45, x + v, y, 0.6));
          x += colW + 0.25;
        }
        if (o.refBlock) {
          const keys = Object.keys(M.tabs).sort((a, b) => (a.startsWith('PT') - b.startsWith('PT')) || a.localeCompare(b));
          const lines = keys.map(t => ({ label: tableLabel(t), nums: M.tabs[t].nums, old: M.tabs[t].old }));
          let y = 0.45 + rowH * (Math.min(40, M.order.length) + 1) + 0.3;
          line(page, 0, y, PAGE_W, y, 0.8); y += 0.22;
          text(page, 'Reference tables needed', 0, y, 10.5, FB); text(page, '(2011 edition letters; bold = not on the 2025 edition)', 1.75, y, 10.5, F); y += 0.24;
          const parts = lines.length ? lines.map(l => ({ s: `${l.label}: ${l.nums.join(', ')}`, old: l.old })) : [{ s: 'none beyond the periodic table', old: false }];
          let cx = 0;
          for (const part of parts) {
            const font = part.old ? FB : F, w = font.widthOfTextAtSize(clean(part.s), 10.5) / PT + 0.3;
            if (cx + w > PAGE_W && cx > 0) { cx = 0; y += 0.2; }
            text(page, part.s, cx, y, 10.5, font); cx += w;
          }
        }
      }
      return doc.save();
    }

    return { layoutBlocks, buildItems, layout, buildModel, makePDF, missing, clean,
             consts: { PAGE_H, PAGE_W, ITEM_GAP, GUTTER, LH, LABEL_W, BASE_PT } };
  }

  return { create };
});

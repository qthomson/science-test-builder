/* textpdf.js v3 — typesets Text Bank questions into pdf-lib pages and drawing ops (for the on-screen preview).
 * Works in Node (module.exports) and in the browser (window.TextPDF). Geometry is in inches.
 *
 *   const eng = await TextPDF.create({ PDFLib, fontkit, fonts: { serif, bold, italic, symbol? }, image: path => bytes });
 *   eng.setPage(landscape)                        // letter portrait (7.5 x 10 in body) or landscape (10 x 7.5)
 *   const items = eng.buildItems(picked, { bank, bankNew, text, custom, extras, dropped, cols, pt, wide, blank });
 *   const M = eng.buildModel(items, { cols, pt, start, blank, note, crKey });
 *   const bytes = await eng.makePDF(M, 'sheet' | 'key', 'A' | 'B', { title, blanks, note, key, crKey, refBlock, src, label });
 *
 * Content model (from the Text Bank): blocks p | eq | img | list | passage; runs {s, sub, sup, i, b, u, stack{top,bot},
 * frac{num,den} (num/den strings or runs; display size in eq blocks), sqrt[runs], br, over}; choices {runs} | {img} | {cells}; choice_layout stacked | grid | row | table;
 * resp lines | blank | labelled-blank | box | template. Layout constants match the image-based Chem Test Builder.
 *
 * ops: text {s,x,y(base),pt,f} | img {src,x,y,w,h} | line {x0,y0,x1,y1,tk} | rect {x,y,w,h,tk} | harp {x,y,pt}
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.TextPDF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const PT = 72, MARGIN = 36;
  let PAGE_W = 7.5, PAGE_H = 10, LANDSCAPE = false;
  const ITEM_GAP = 0.16, GUTTER = 0.36;
  const BLANK_W = 0.3, BLANK_GAP = 0.03, BLANK_IN = 0.1;
  const LH = 1.2, ASC = 0.891, LABEL_W = 0.3;
  const SUB_K = 0.65, SUB_DY = 0.17, SUP_DY = -0.36;      // script size and baseline shift, in em of the body size
  const RANGE_GX = 0.34;                                   // extra number-column width for a two-number item ("52–53"), inches at body size
  const numLabel = it => it.nEnd ? `${it.n}–${it.nEnd}` : String(it.n);
  const BASE_PT = 11.5;                                    // the exams' body size; figures are stored at printed size
  const HARP_W = 0.9;                                      // ⇌ advance, em (only when no symbol font is given)
  const SYMBOL_ALWAYS = /[←-⇿∀-⋿]/;   // arrows and operators always come from the symbol font: the text face's are too light
  // subject strings (chemistry defaults); TextPDF.setSubject({...}) overrides them for another subject
  const SUBJ = { tableNames: { 'PT-ox': 'Periodic Table oxidation states', 'PT-config': 'Periodic Table electron configurations', 'PT-mass': 'Periodic Table masses' },
                 note: 'Some questions may require the use of the Reference Tables for Physical Setting/Chemistry.',
                 refHeader: '(2011 edition letters; bold = not on the 2025 edition)', refNone: 'none beyond the periodic table', refFirst: 'PT', refSkip: null };   // refSkip: code prefix left out of the key block (physics: 'EQ-')
  const setSubject = o => Object.assign(SUBJ, o || {});
  const tableLabel = t => SUBJ.tableNames[t] || `Table ${t}`;
  const uLab = u => SUBJ.unitCodes && SUBJ.unitCodes[u] != null ? SUBJ.unitCodes[u] : u;   // unit id -> displayed unit code (physics: 4 -> 2.5)
  const PERMS = []; (function gen(a, k) { if (k === a.length) { if (a.join() !== '1,2,3,4') PERMS.push(a.slice()); return; } for (let i = k; i < a.length; i++) { [a[k], a[i]] = [a[i], a[k]]; gen(a, k + 1); [a[k], a[i]] = [a[i], a[k]]; } })([1, 2, 3, 4], 0);
  const hashPerm = id => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PERMS[h % PERMS.length]; };

  function setPage(landscape) { LANDSCAPE = !!landscape; PAGE_W = landscape ? 10 : 7.5; PAGE_H = landscape ? 7.5 : 10; }

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
    // width of a fragment row and its extent above (up) and below (dn) the baseline, in inches
    const fragsW = frs => frs.reduce((s, fr) => s + fr.w, 0);
    const fragsUp = (frs, pt) => Math.max(pt / PT * ASC, ...frs.map(fr => fr.up != null ? fr.up : fr.pt / PT * ASC - fr.dy * pt / PT));
    const fragsDn = (frs, pt) => Math.max(pt / PT * (LH - ASC), ...frs.map(fr => fr.dn != null ? fr.dn : fr.pt / PT * (LH - ASC) + fr.dy * pt / PT));
    const partFrags = (part, pt, ctx, disp) => fragsOf(Array.isArray(part) ? part : [{ s: String(part == null ? '' : part) }], pt, ctx, disp)
      .map(fr => fr.w != null ? fr : Object.assign(fr, { w: widthIn(fr.s, fr.pt, fr.f) }));
    /** disp: inside a displayed equation (eq block), where fractions are set at nearly full size */
    function fragsOf(runs, pt, ctx, disp) {
      const out = [];
      for (const r of runs) {
        const k = (r.sub || r.sup) ? SUB_K : 1, dy = r.sub ? SUB_DY : r.sup ? SUP_DY : 0, f = fontOf(r);
        if (r.stack) {                       // mass number over atomic number, drawn as two small right-aligned numbers
          const w = Math.max(widthIn(r.stack.top, pt * SUB_K), widthIn(r.stack.bot, pt * SUB_K)) + 0.02;
          out.push({ special: 'stack', top: clean(r.stack.top, ctx), bot: clean(r.stack.bot, ctx), w, k: 1, dy: 0, f, pt, s: '' }); continue;
        }
        if (r.br) { out.push({ special: 'br', w: 0, k: 1, dy: 0, f, pt, s: '' }); continue; }
        if (r.frac) {
          // numerator and denominator (strings or runs, nested fractions allowed) are fragment rows at 0.85 of the
          // body size in a displayed equation, 0.8 inline; the line grows to make room
          const fk = disp ? 0.85 : 0.8, fpt = pt * fk, em = pt / PT;
          const num = partFrags(r.frac.num, fpt, ctx, disp), den = partFrags(r.frac.den, fpt, ctx, disp);
          const wn = fragsW(num), wd = fragsW(den), w = Math.max(wn, wd) + 0.1 * em;
          const ax = -0.27 * em;                                              // the math axis, relative to the baseline
          const numBase = ax - 0.16 * em - (fragsDn(num, fpt) - fpt / PT * (LH - ASC) * 0.55), denBase = ax + 0.1 * em + fragsUp(den, fpt);
          out.push({ special: 'rfrac', num, den, wn, wd, numBase, denBase, ax, w, k: 1, dy: 0, f, pt, s: '',
                     up: -(numBase - fragsUp(num, fpt)), dn: denBase + fragsDn(den, fpt) });
          continue;
        }
        if (r.sqrt) {                        // a radical sign and a rule over a fragment row
          const em = pt / PT, body = partFrags(r.sqrt, pt, ctx, disp), wb = fragsW(body), up = fragsUp(body, pt) + 0.1 * em;
          const rad = '√', rf = isSym(rad) ? 'm' : 'r', rs = clean(rad, ctx, rf), wr = widthIn(rs, pt, rf);
          const dn = fragsDn(body, pt), kk = Math.max(1, (up + dn) / (1.187 * em));  // STIX √ spans −0.265…0.922 em: scale it to the body's height
          out.push({ special: 'sqrt', body, wb, rad: rs, rf, wr, w: wr * kk + wb + 0.06 * em, k: 1, dy: 0, f, pt, s: '', up, dn });
          continue;
        }
        if (r.over) {                        // a word set over an arrow
          const af = isSym(String(r.s)[0]) ? 'm' : 'r', arrow = clean(r.s, ctx, af), w = Math.max(widthIn(arrow, pt, af) + 0.06, widthIn(r.over, pt * SUB_K) + 0.04);
          out.push({ special: 'over', s: arrow, top: clean(r.over, ctx), w, k: 1, dy: 0, f: af, pt }); continue;
        }
        let buf = '', bufSym = null;
        const flush = () => { if (buf) out.push({ s: clean(buf, ctx, bufSym ? 'm' : f), f: bufSym ? 'm' : f, k, dy, pt: pt * k, u: !!r.u }); buf = ''; };
        // a stacked pair belongs to the symbol after it: drop the space the PDF sometimes puts between them
        const src = out.length && out[out.length - 1].special === 'stack' ? String(r.s).replace(/^ +/, '') : String(r.s);
        for (const ch of src) {
          if (ch === '⇌' && !MF.m) { flush(); out.push({ harp: true, w: HARP_W * pt / PT, k: 1, dy: 0, f: 'r', s: '' }); continue; }
          const sym = isSym(ch);
          if (buf && sym !== bufSym) flush();
          buf += ch; bufSym = sym;
        }
        flush();
      }
      return out;
    }
    const JOINS = { stack: 1, frac: 1, rfrac: 1, sqrt: 1 };      // specials that stay inside the word around them
    function atomsOf(runs, pt, ctx, disp) {
      const atoms = []; let cur = [];
      const flush = () => { if (cur.length) atoms.push(cur); cur = []; };
      for (const fr of fragsOf(runs, pt, ctx, disp)) {
        if (fr.harp || fr.special) { if (JOINS[fr.special]) cur.push(fr); else { flush(); atoms.push([fr]); } continue; }
        const parts = fr.s.split(' ');
        parts.forEach((p, i) => {
          if (i > 0) flush();
          if (p) cur.push({ s: p, f: fr.f, k: fr.k, dy: fr.dy, pt: fr.pt, u: fr.u, w: widthIn(p, fr.pt, fr.f) });
        });
      }
      flush();
      return atoms;
    }
    const atomW = a => a.reduce((s, fr) => s + fr.w, 0);
    function wrapAtoms(atoms, wIn, pt) {
      const sp = widthIn(' ', pt), lines = []; let line = [], lw = 0;
      for (const a of atoms) {
        if (a.length === 1 && a[0].special === 'br') { lines.push(line); line = []; lw = 0; continue; }   // forced line break
        const aw = atomW(a);
        if (line.length && lw + sp + aw > wIn + 1e-6) { lines.push(line); line = []; lw = 0; }
        if (!line.length && aw > wIn) {                       // an unbreakable word wider than the column: cut by characters
          let rest = a.slice();
          while (rest.length) {
            const piece = []; let pw = 0;
            while (rest.length) {
              const fr = rest[0];
              if (fr.special || pw + fr.w <= wIn || (!piece.length && fr.s.length <= 1)) { piece.push(fr); pw += fr.w; rest.shift(); continue; }
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
    const oneLineW = (runs, pt, ctx, disp) => { const at = atomsOf(runs || [], pt, ctx, disp); return at.length ? lineW(wrapAtoms(at, 99, pt)[0], pt) : 0; };

    // ------------------------------------------------------------ the composer: blocks, choices, responses -> ops
    function Composer(wIn, pt, o) {
      o = o || {};
      const ops = []; let y = 0;
      const lh = pt / PT * LH, asc = pt / PT * ASC, sp = widthIn(' ', pt), kImg = pt / BASE_PT, LW = LABEL_W * kImg, em = pt / PT;
      let base0 = null;
      const C = { ops, kImg, lh };
      const emitFrag = (fr, cx, base) => {
        if (fr.harp) { ops.push({ t: 'harp', x: cx, y: base, pt }); return; }
        if (fr.special === 'stack' || fr.special === 'frac') {
          const spt = pt * SUB_K, wt = widthIn(fr.top, spt), wb = widthIn(fr.bot, spt);
          if (fr.special === 'stack') {         // right-aligned against the symbol that follows
            ops.push({ t: 'text', s: fr.top, x: cx + fr.w - 0.01 - wt, y: base + SUP_DY * em, pt: spt, f: 'r' });
            ops.push({ t: 'text', s: fr.bot, x: cx + fr.w - 0.01 - wb, y: base + SUB_DY * em, pt: spt, f: 'r' });
          } else {                              // centred over a bar on the math axis
            const ax = base - 0.27 * em;
            ops.push({ t: 'text', s: fr.top, x: cx + (fr.w - wt) / 2, y: ax - 0.12 * em, pt: spt, f: 'r' });
            ops.push({ t: 'text', s: fr.bot, x: cx + (fr.w - wb) / 2, y: ax + 0.5 * em, pt: spt, f: 'r' });
            ops.push({ t: 'line', x0: cx + 0.01, y0: ax, x1: cx + fr.w - 0.01, y1: ax, tk: 0.5 });
          }
          return;
        }
        if (fr.special === 'rfrac') {          // numerator row over the bar, denominator row under it, both centred
          const ax = base + fr.ax;
          let nx = cx + (fr.w - fr.wn) / 2; for (const g of fr.num) { emitFrag(g, nx, base + fr.numBase); nx += g.w; }
          let dx = cx + (fr.w - fr.wd) / 2; for (const g of fr.den) { emitFrag(g, dx, base + fr.denBase); dx += g.w; }
          ops.push({ t: 'line', x0: cx + 0.01, y0: ax, x1: cx + fr.w - 0.01, y1: ax, tk: Math.max(0.5, pt / 20) });
          return;
        }
        if (fr.special === 'sqrt') {           // radical sign scaled to the height of its body, then the body under a rule
          const top = base - fr.up + 0.03 * em, k = Math.max(1, (fr.up + fr.dn) / (1.187 * em)), rpt = pt * k;
          ops.push({ t: 'text', s: fr.rad, x: cx, y: top + 0.922 * rpt / PT, pt: rpt, f: fr.rf });  // the sign's top (0.922 em) meets the rule
          let bx = cx + fr.wr * k + 0.02 * em; for (const g of fr.body) { emitFrag(g, bx, base); bx += g.w; }
          ops.push({ t: 'line', x0: cx + fr.wr * k - 0.02 * em, y0: top, x1: cx + fr.w + fr.wr * (k - 1), y1: top, tk: Math.max(0.5, pt / 20) });
          return;
        }
        if (fr.special === 'over') {
          const aw = widthIn(fr.s, pt, fr.f), spt = pt * SUB_K, wt = widthIn(fr.top, spt);
          ops.push({ t: 'text', s: fr.s, x: cx + (fr.w - aw) / 2, y: base, pt, f: fr.f });
          ops.push({ t: 'text', s: fr.top, x: cx + (fr.w - wt) / 2, y: base - 0.72 * em, pt: spt, f: 'r' });
          return;
        }
        ops.push({ t: 'text', s: fr.s, x: cx, y: base + fr.dy * em, pt: fr.pt, f: fr.f });
        if (fr.u) ops.push({ t: 'line', x0: cx, y0: base + 0.06 * em, x1: cx + fr.w, y1: base + 0.06 * em, tk: 0.5 });
      };
      const emit = (lines, x, w, align) => {
        for (const line of lines) {
          let up = 0, dn = 0;                  // tall fragments (display fractions, radicals) grow the line above and below
          for (const a of line) for (const fr of a) if (fr.up != null) { up = Math.max(up, fr.up - asc); dn = Math.max(dn, fr.dn - (lh - asc)); }
          y += lh + up; const base = y - (lh - asc) / 2 - 0.02; if (base0 === null) base0 = base;
          let cx = x + (align === 'center' ? Math.max(0, (w - lineW(line, pt)) / 2) : 0);
          for (const a of line) { for (const fr of a) { emitFrag(fr, cx, base); cx += fr.w; } cx += sp; }
          y += dn;
        }
      };
      const subst = runs => o.nums ? runs.map(r => Object.assign({}, r, { s: String(r.s).replace('{a}', o.nums.a).replace('{b}', o.nums.b) })) : runs;
      C.para = (runs, x, w, align, disp) => emit(wrapAtoms(atomsOf(subst(runs || []), pt, o.id, disp), w, pt), x, w, align);
      C.image = (b, x, w, maxH) => {
        let iw = b.w_in * kImg, ih = b.h_in * kImg;
        const fit = Math.min(1, w / iw, (maxH || (PAGE_H - 0.6)) / ih); iw *= fit; ih *= fit;
        ops.push({ t: 'img', src: b.src || b.img, x: x + (w - iw) / 2, y, w: iw, h: ih });
        y += ih;
      };
      C.gap = d => { y += d; };
      C.blocks = (blocks, x, w) => {
        x = x || 0; w = w || wIn;
        const flat = [];
        (blocks || []).forEach(b => { if (b.t === 'passage') flat.push(...(b.blocks || [])); else flat.push(b); });
        flat.forEach((b, bi) => {
          if (bi) { const prev = flat[bi - 1]; y += (b.t === 'img' || prev.t === 'img') ? 0.08 : (b.t === 'eq' || prev.t === 'eq') ? 0.08 : (b.role === 'heading' || b.role === 'caption') ? 0.06 : 0.05; }
          if (b.t === 'p') C.para(b.runs, x, w, (b.role === 'heading' || b.role === 'caption') ? 'center' : 'left');
          else if (b.t === 'eq') C.para(b.runs, x, w, 'center', true);
          else if (b.t === 'img') C.image(b, x, w);
          else if (b.t === 'list') {
            const ind = 0.25 * kImg;
            (b.items || []).forEach(item => {
              const labeled = /^(?:[A-Za-z]|[IVX]+|\d+|[A-Za-z]+ \d+)[:.)]/.test(item.map(r => r.s).join('').trim());
              const y0 = y;
              if (!labeled) { emit([[[{ s: '•', f: 'r', k: 1, dy: 0, pt, w: widthIn('•', pt) }]]], x + ind - 0.14 * kImg, 0.14, 'left'); y = y0; }
              C.para(item, x + ind, w - ind, 'left');
            });
          }
        });
      };
      // ---- choices
      C.choices = (q, perm) => {
        const choices = q.choices || []; if (!choices.length) return;
        y += 0.08;
        const order = perm || [1, 2, 3, 4], shown = order.map(n => choices[n - 1]).filter(Boolean);
        const isImg = c => c && c.img, isCells = c => c && c.cells;
        const label = (k, x, base) => ops.push({ t: 'text', s: `(${k + 1})`, x, y: base, pt, f: 'r' });
        if (q.choice_layout === 'table' || shown.some(isCells)) { tableChoices(q, shown, label); return; }
        const imgSize = (c, w) => { let iw = c.w_in * kImg, ih = c.h_in * kImg; const fit = Math.min(1, w / iw); return { iw: iw * fit, ih: ih * fit }; };
        const textFits = (c, w) => !isImg(c) && oneLineW(c.runs, pt, o.id) <= w;
        const imgFits = (c, w) => isImg(c) && c.w_in * kImg * 0.8 <= w;
        const cellNeed = c => isImg(c) ? c.w_in * kImg : oneLineW(c.runs, pt, o.id) + LW;
        const gridGap = 0.06 * kImg, rowGap = 0.12 * kImg;
        const rowColW = Math.min((wIn - 3 * rowGap) / 4, Math.max(...shown.map(c => cellNeed(c) || 0)) + 0.45 * kImg);
        const gridColW = shown.every(isImg) ? Math.min((wIn - gridGap) / 2, Math.max(...shown.map(cellNeed)) + 1.0 * kImg) : (wIn - gridGap) / 2;
        let layout = q.choice_layout || 'stacked';
        if (layout === 'row' && !shown.every(c => imgFits(c, rowColW) || textFits(c, rowColW - LW))) layout = 'grid';
        if (layout === 'grid' && !shown.every(c => imgFits(c, gridColW) || textFits(c, gridColW - LW))) layout = 'stacked';
        const stackedChoice = (c, k, x, w) => {
          if (isImg(c)) {
            let iw = c.w_in * kImg, ih = c.h_in * kImg; const fit = Math.min(1, (w - LW) / iw); iw *= fit; ih *= fit;
            const base = ih <= lh ? y + (lh - asc) / 2 + asc - 0.02 : y + ih / 2 + asc * 0.35;
            label(k, x, base);
            ops.push({ t: 'img', src: c.img, x: x + LW, y: y + (ih <= lh ? (lh - ih) / 2 : 0), w: iw, h: ih });
            y += Math.max(ih, lh);
          } else {
            const y0 = y; C.para(c.runs, x + LW, w - LW, 'left');
            label(k, x, y0 + lh - (lh - asc) / 2 - 0.02);
          }
        };
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
        else if (layout === 'grid') { for (const r of [0, 1]) { cellRow([[shown[r], r, 0], [shown[r + 2], r + 2, 1]].filter(x => x[0]), gridColW, gridGap); y += 0.01; } }
        else shown.forEach((c, k) => { stackedChoice(c, k, 0, wIn); y += 0.01; });
      };
      // "Which row …?" choices: a ruled table, label column then one column per cell
      function tableChoices(q, shown, label) {
        const head = q.table_head || [], ncol = Math.max(head.length, ...shown.map(c => (c.cells || []).length));
        const labW = widthIn('(4)', pt) + 0.16 * kImg, pad = 0.06 * kImg;
        const cellW = c => !c ? 0 : c.runs ? oneLineW(c.runs, pt, o.id) : (c.w_in || 0) * kImg;
        const need = Math.max(...Array.from({ length: ncol }, (_, j) => Math.max(cellW(head[j]), ...shown.map(c => cellW((c.cells || [])[j])))));
        const tw = Math.min(wIn, labW + ncol * (need + 2 * pad + 0.05)), colW = (tw - labW) / ncol, x0 = (wIn - tw) / 2;
        const rowsY = [y];
        const row = (cells, lab) => {
          const yTop = y; let yMax = yTop + pad + lh;
          if (lab != null) label(lab, x0 + pad, yTop + pad + lh - (lh - asc) / 2 - 0.02);
          cells.forEach((c, j) => {
            y = yTop + pad; if (!c) return;
            if (c.runs) C.para(c.runs, x0 + labW + j * colW + pad, colW - 2 * pad, 'center');
            else if (c.img) C.image(c, x0 + labW + j * colW + pad, colW - 2 * pad, 2);
            yMax = Math.max(yMax, y);
          });
          y = yMax + pad; rowsY.push(y);
        };
        if (head.length) row(head, null);
        shown.forEach((c, k) => row(c.cells || [], k));
        rowsY.forEach(ry => ops.push({ t: 'line', x0, y0: ry, x1: x0 + tw, y1: ry, tk: 0.6 }));
        [x0, x0 + labW].concat(Array.from({ length: ncol }, (_, j) => x0 + labW + (j + 1) * colW)).forEach(vx => ops.push({ t: 'line', x0: vx, y0: rowsY[0], x1: vx, y1: rowsY[rowsY.length - 1], tk: 0.6 }));
      }
      // one row of text pieces on a shared baseline (labels beside blanks or boxes)
      const inlineText = (runs, x, base) => { const w = oneLineW(runs, pt, o.id); const save = y; y = base - asc; C.para(runs, x, Math.max(w + 0.05, 0.2), 'left'); y = save; return w; };
      // ---- constructed-response answer space
      C.resp = r => {
        if (!r) return;
        y += 0.06;
        const kind = r.kind;
        if (kind === 'blank') { y += (r.h_in || 0.5) * kImg; return; }
        if (kind === 'template' && r.img) { y += 0.04; C.image({ src: r.img, w_in: r.w_in, h_in: r.h_in }, 0, wIn); y += 0.04; return; }
        if (kind === 'box') { const bw = Math.min(wIn, (r.w_in || wIn) * kImg), bh = (r.box_h_in || r.h_in || 2) * kImg; y += 0.06; ops.push({ t: 'rect', x: (wIn - bw) / 2, y, w: bw, h: bh, tk: 0.8 }); y += bh + 0.06; return; }
        if (kind === 'labelled-blank') {         // one row of label / blank parts, or several rows ("Age: ____" / "Polarity: ____")
          const rows = r.rows && r.rows.length ? r.rows.map(x => x.parts || x) : [r.parts || []];
          rows.forEach(parts => {
            y += lh * 0.6; const base = y + asc; let cx = 0;
            parts.forEach(p => {
              if (p.blank_in != null) { const bw = Math.min(p.blank_in * kImg, Math.max(0.3, wIn - cx)); ops.push({ t: 'line', x0: cx, y0: base + 0.02, x1: cx + bw, y1: base + 0.02, tk: 0.7 }); cx += bw + sp; }
              else { cx += inlineText(p.runs, cx, base) + sp; }
            });
            y = base + 0.12;
          });
          return;
        }
        // ruled lines, with optional labels at the left of some lines and check boxes above
        const n = r.lines === 0 ? 0 : (r.lines || Math.max(1, Math.round((r.h_in || 0.5) / 0.47)));
        const pitch = Math.max(0.36 * kImg, ((r.h_in || 0.47 * n) / n) * kImg);
        if (r.boxes && r.boxes.length && r.boxes_stack) {                 // one check box per line
          r.boxes.forEach(bx => { y += lh * 0.5; const base = y + asc, s = 0.75 * em; ops.push({ t: 'rect', x: 0, y: base - s + 0.02, w: s, h: s, tk: 0.7 }); inlineText(bx.runs, s + sp, base); y = base + 0.08; });
        } else if (r.boxes && r.boxes.length) {
          y += lh * 0.4; const base = y + asc; let cx = 0;
          if (r.boxes_prompt) cx = inlineText(r.boxes_prompt.runs || r.boxes_prompt, 0, base) + 3 * sp;
          r.boxes.forEach(bx => {
            const s = 0.75 * em; ops.push({ t: 'rect', x: cx, y: base - s + 0.02, w: s, h: s, tk: 0.7 }); cx += s + 0.6 * sp;
            cx += inlineText(bx.runs, cx, base) + 3 * sp;
          });
          y = base + 0.06;
        }
        for (let i = 1; i <= n; i++) {
          const lab = (r.labels || []).find(l => l.line === i);
          let lx = 0;
          if (lab) lx = inlineText(lab.runs, 0, y + pitch - 0.04) + sp;
          y += pitch; ops.push({ t: 'line', x0: lx, y0: y - 0.02, x1: wIn, y1: y - 0.02, tk: 0.6 });
        }
        y += 0.02;
      };
      C.result = () => ({ ops, h: y + 0.04, w: wIn, base0: base0 == null ? asc : base0 });
      return C;
    }

    /** a whole MC question (blocks + choices), a CR stem with its answer space (o.credit, o.resp), or a stimulus / passage */
    function layoutBlocks(q, wIn, pt, o) {
      const c = Composer(wIn, pt, o);
      const blocks = (q.blocks || []).slice();
      if (o && o.credit && blocks.length) {           // "[1]" at the end of a constructed-response stem, as printed
        let li = -1; blocks.forEach((b, i) => { if (b.t === 'p') li = i; });
        if (li >= 0) blocks[li] = Object.assign({}, blocks[li], { runs: (blocks[li].runs || []).concat([{ s: `   [${o.credit}]` }]) });
      }
      c.blocks(blocks);
      if (q.choices && q.choices.length) c.choices(q, o && o.perm);
      if (o && o.resp) c.resp(o.resp);
      return c.result();
    }
    function layoutKey(key, wIn, pt, o) { const c = Composer(wIn, pt, o); c.blocks(key.blocks || []); return c.result(); }
    /** blocks with the exam's question numbers replaced by the worksheet's: the "52: " rule prefixes of a two-number
     *  item's key, and "question 51" / "questions 52 and 53" / "questions 74–75" references to kept questions of the
     *  same cluster (qmap: exam number -> worksheet number) */
    const REF_RE = /\b(questions?\s+)(\d+(?:\s*(?:,|and|through|to|\u2013|-)\s*\d+)*)/g;
    const DIR_RE = /\b(Directions\s*\()(\d+(?:\s*(?:,|and|through|to|–|-)\s*\d+)*)(?=\))/g;
    const NUMREF = /\bquestions?\s+\d|\bDirections\b/;
    const hasNumRef = blocks => (blocks || []).some(b => (b.runs && b.runs.some(r => NUMREF.test(r.s || ''))) || (b.t === 'passage' && hasNumRef(b.blocks)) || (b.t === 'list' && (b.items || []).some(it => it.some(r => NUMREF.test(r.s || '')))));
    function renumberBlocks(blocks, qmap) {
      const num = t => t.replace(/\d+/g, d => qmap[d] != null ? String(qmap[d]) : d);
      const fix = (runs, first) => (runs || []).map((r, i) => {
        if (r.s == null || r.frac || r.stack || r.sqrt) return r;
        let t = String(r.s);
        if (first && i === 0) t = t.replace(/^(\d+)(: )$/, (m, d, c) => qmap[d] != null ? qmap[d] + c : m);
        t = t.replace(REF_RE, (m, w, list) => w + num(list)).replace(DIR_RE, (m, w, list) => w + num(list));   // also "Directions (44–45):" of a graphing set
        if (i > 0 && /Directions\s*$/.test(runs[i - 1].s || '')) t = t.replace(/^(\s*\()(\d+(?:\s*(?:,|and|through|to|–|-)\s*\d+)*)(?=\))/, (m, w, list) => w + num(list));   // "Directions" set in italics, the numbers in the next run
        return t === r.s ? r : Object.assign({}, r, { s: t });
      });
      const walk = (b, first) => {
        if (b.t === 'passage') return Object.assign({}, b, { blocks: (b.blocks || []).map(x => walk(x, false)) });
        if (b.t === 'list') return Object.assign({}, b, { items: (b.items || []).map(it => fix(it, false)) });
        return b.runs ? Object.assign({}, b, { runs: fix(b.runs, first) }) : b;
      };
      return (blocks || []).map(b => walk(b, b.t === 'p'));
    }
    const renumberKey = (key, qmap) => Object.assign({}, key, { blocks: renumberBlocks(key.blocks, qmap) });

    // ------------------------------------------------------------ worksheet items
    /** a teacher-written question (intro, optional diagram, stem, four choices each text or a picture) as Text Bank blocks */
    function customBlocks(q) {
      const dw = q.diagram && q.dW && q.dH ? Math.min(q.dW / 150, 3.6 * q.dW / q.dH) : 0;
      const cimgs = q.cimgs || [];
      const choices = (q.choices || []).map((s, k) => {
        const c = cimgs[k];
        if (c && c.src && c.w && c.h) { const cw = Math.min(c.w / 150, 1.6, 1.4 * c.w / c.h); return { img: c.src, w_in: cw, h_in: cw * c.h / c.w, caption: s || '' }; }
        return { runs: [{ s: s || '' }] };
      });
      const allImg = choices.length && choices.every(c => c.img), anyImg = choices.some(c => c.img);
      return { blocks: [].concat(q.intro ? [{ t: 'p', runs: [{ s: q.intro }] }] : [], dw ? [{ t: 'img', src: q.diagram, w_in: dw, h_in: dw * q.dH / q.dW }] : [], q.stem ? [{ t: 'p', runs: [{ s: q.stem }] }] : []),
               choices, choice_layout: allImg ? 'grid' : anyImg ? 'stacked' : (q.choices || []).every(s => s.length <= 18) ? 'grid' : 'stacked' };
    }
    // ---- reference-table inserts: RT = window.REFTABLES-style { constants: [codes], items: { code: {title, kind:'img', png, w_in, h_in, full} | {kind:'blocks', blocks} | {alias} } }
    const runsText = runs => (runs || []).map(r => r.s || '').join('');
    const blocksText = blocks => (blocks || []).map(b => b.t === 'passage' ? blocksText(b.blocks) : b.t === 'list' ? (b.items || []).map(runsText).join(' ') : runsText(b.runs)).join(' ');
    const questionText = it => { const rec = it.kind === 'q' ? it.t : (it.ti || it.b); return rec ? blocksText(rec.blocks) + ' ' + (rec.choices || []).map(c => runsText(c.runs)).join(' ') : ''; };
    /** constants are written out: "Needed constants: Mass of Earth = 5.98 × 10²⁴ kg; …" with only the rows whose keywords
     *  appear in the question (all rows when none match or when grouped at the start/end) */
    function constBlocks(it, heading, qtext) {
      let rows = qtext ? it.rows.filter(r => new RegExp(r.keys, 'i').test(qtext)) : []; if (!rows.length) rows = it.rows;
      const runs = heading ? [{ s: heading + ': ', b: true }] : [];
      rows.forEach((r, k) => { if (k) runs.push({ s: ';  ' }); runs.push({ s: r.label + ' = ' }, ...r.value); });
      return [{ t: 'p', role: 'refhead', runs }];
    }
    function refItem(RT, code, o, geo, heading, qtext) {
      const raw = RT.items[code]; if (!raw) return null;
      const key = raw.alias || code, it = raw.alias ? RT.items[raw.alias] : raw; if (!it) return null;
      const kImg = o.pt / BASE_PT;
      if (it.kind === 'consts') {
        const w = geo.widthFor(geo.wide), blocks = constBlocks(it, heading, qtext), lay = layoutBlocks({ blocks }, w, o.pt, { id: 'ref:' + key });
        return { kind: 'ref', code: key, title: it.title, blocks, lay, layB: lay, pt: o.pt, w, h: lay.h, full: !!geo.wide, block: null };
      }
      // a table a little wider than a column is scaled down to fit it; only clearly page-wide items force the page width
      const full = geo.wide || !!it.full || (it.kind === 'img' && it.w_in * kImg > 1.4 * (geo.halfW - GUTTER));
      const w = geo.widthFor(full), blocks = [];
      if (heading) blocks.push({ t: 'p', role: 'refhead', runs: [{ s: heading, b: true }] });
      if (it.kind === 'img') blocks.push({ t: 'img', src: 'data:image/png;base64,' + it.png, w_in: it.w_in, h_in: it.h_in });
      else blocks.push(...(it.blocks || []));
      const lay = layoutBlocks({ blocks }, w, o.pt, { id: 'ref:' + key });
      return { kind: 'ref', code: key, title: it.title, blocks, lay, layB: lay, pt: o.pt, w, h: Math.min(PAGE_H - 0.2, lay.h), full, block: null };
    }
    const shiftOps = (ops, dy) => ops.map(op => op.t === 'line' ? Object.assign({}, op, { y0: op.y0 + dy, y1: op.y1 + dy }) : Object.assign({}, op, { y: op.y + dy }));
    /** an inline insert becomes part of its question item (stacked above the stem) so the packer can never part them;
     *  a page-wide table widens the question to the page */
    function widen(it, geo) {                 // re-typeset a half-width question at the page width
      if (it.full) return;
      const w = geo.widthFor(true);
      if (it.kind === 'q') { const id = it.q ? it.q.id : ''; it.lay = layoutBlocks(it.t, w, it.pt, { id }); it.layB = it.perm ? layoutBlocks(it.t, w, it.pt, { id, perm: it.perm }) : it.lay; }
      else { it.lay = layoutBlocks({ blocks: (it.ti || it.b).blocks }, w - (it.gx || 0), it.pt, it.lo); it.layB = it.lay; }
      it.w = w; it.full = true; it.h = Math.min(PAGE_H - 0.2, it.lay.h);
    }
    function mergeRefInto(it, refs, o, geo) {
      const full = it.full || refs.some(r => r.full);
      if (full) widen(it, geo);
      const refLays = refs.map(r => r.full === full && r.w === it.w ? r.lay : layoutBlocks({ blocks: r.blocks }, it.w, it.pt, { id: 'ref:' + r.code }));
      const stack = base => { const ops = []; let y = 0; refLays.forEach(l => { ops.push(...shiftOps(l.ops, y)); y += l.h + 0.08; }); ops.push(...shiftOps(base.ops, y)); return { ops, w: it.w, h: y + base.h, base0: y + base.base0 }; };
      const sameB = it.layB === it.lay;
      it.lay = stack(it.lay); it.layB = sameB ? it.lay : stack(it.layB);
      it.refs = refs.map(r => r.code); it.refBlocks = refs.flatMap(r => r.blocks); it.h = Math.min(PAGE_H - 0.2, it.lay.h);
    }
    /** a text block the teacher typed (extras[id] = {kind:'text', text, style: plain | bold | heading, width: wide | column}):
     *  directions, a section heading, a word bank. Each typed line is its own paragraph; it carries no question number. */
    function textItem(ex, o, geo) {
      const full = geo.wide || ex.width !== 'column', w = geo.widthFor(full);
      const lines = String(ex.text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      const blocks = (lines.length ? lines : ['(empty text block)']).map(ln => ex.style === 'heading' ? { t: 'p', role: 'heading', runs: [{ s: ln, b: true }] } : { t: 'p', runs: [ex.style === 'bold' ? { s: ln, b: true } : { s: ln }] });
      const lay = layoutBlocks({ blocks }, w, o.pt, { id: 'text' });
      return { kind: 'ref', manual: true, textBlock: true, blocks, lay, layB: lay, pt: o.pt, w, h: Math.min(PAGE_H - 0.2, lay.h + 0.04), full, block: null };
    }
    /** a reference table the teacher inserted by hand (extras[id] = {kind:'reftab', code, title}); the picture comes from
     *  the library (o.reflib: id -> {png, w_in, h_in}); until the library has loaded a labelled placeholder holds its place */
    function manualRef(ex, o, geo) {
      const e = (o.reflib || {})[ex.code], kImg = o.pt / BASE_PT;
      const full = geo.wide || !e || e.w_in * kImg > 1.4 * (geo.halfW - GUTTER);
      const w = geo.widthFor(full);
      const blocks = e ? [{ t: 'img', src: 'data:image/png;base64,' + e.png, w_in: e.w_in, h_in: e.h_in }]
                       : [{ t: 'p', runs: [{ s: `[Reference table: ${ex.title || ex.code}]`, i: true }] }];
      const lay = layoutBlocks({ blocks }, w, o.pt, { id: 'reftab:' + ex.code });
      return { kind: 'ref', manual: true, code: ex.code, title: ex.title, blocks, lay, layB: lay, pt: o.pt, w, h: Math.min(PAGE_H - 0.2, lay.h), full, block: null };
    }
    function splitRef(r, o) {
      if (!r) return [];
      const imgs = r.blocks.filter(b => b.t === 'img');
      if (imgs.length < 2 || r.lay.h <= PAGE_H - 0.2) return [r];
      const out = []; let cur = [];
      r.blocks.forEach(b => { cur.push(b); if (b.t === 'img') { out.push(cur); cur = []; } });
      if (cur.length && out.length) out[out.length - 1].push(...cur);
      return out.map((blocks, k) => { const lay = layoutBlocks({ blocks }, r.w, o.pt, { id: 'ref:' + r.code + ':' + k });
        return Object.assign({}, r, { blocks, lay, layB: lay, h: Math.min(PAGE_H - 0.2, lay.h) }); });
    }
    /** modes: { tables, consts } each off | start | once | always | end. Inline modes put the item right before the first
     *  question that needs it (before its stimulus when one directly precedes); "once" never repeats, "always" repeats
     *  unless the previous question needed the same item. start/end collect everything into one group. */
    function insertRefs(items, RT, modes, o, geo) {
      const isConst = c => (RT.constants || []).includes(c);
      const resolve = c => RT.items[c] ? (RT.items[c].alias || c) : null;
      const codesOf = it => [...new Set(((it.ord && it.ord.tables) || []).map(resolve).filter(Boolean))];
      const KINDS = ['consts', 'tables'], title = { consts: 'Needed constants', tables: 'Needed tables' };
      const groups = { consts: [], tables: [] }, shown = { consts: new Set(), tables: new Set() }, prev = { consts: new Set(), tables: new Set() };
      const out = [], clusterDone = new Set(), sheet = [];
      for (const it of items) {
        if (it.kind !== 'q' && it.kind !== 'cq') { out.push(it); continue; }
        const codes = codesOf(it);
        for (const kind of KINDS) {
          const mode = modes[kind]; if (!mode || mode === 'off') continue;
          const mine = codes.filter(c => isConst(c) === (kind === 'consts'));
          if (mode === 'start' || mode === 'end' || mode === 'sheet') { mine.forEach(c => { if (!groups[kind].includes(c)) groups[kind].push(c); }); continue; }
          // constants in line: an old constructed-response cluster gets them once, before its passage, for all of its questions
          let all = mine, qAll = null;
          if (kind === 'consts' && mode === 'always' && it.c && it.block) {
            if (clusterDone.has(it.block)) continue;
            clusterDone.add(it.block);
            const sibs = items.filter(x => x.block === it.block && (x.kind === 'q' || x.kind === 'cq'));
            all = [...new Set(sibs.flatMap(codesOf))].filter(isConst); qAll = sibs.map(questionText).join(' ');
          }
          const need = qAll != null ? all : mine.filter(c => mode === 'once' ? !shown[kind].has(c) : !prev[kind].has(c));
          if (need.length) {
            const qtext = qAll != null ? qAll : questionText(it), refs = need.flatMap((c, k) => splitRef(refItem(RT, c, o, geo, k === 0 ? title[kind] : null, qtext), o));
            let at = out.length; while (at > 0 && out[at - 1].kind === 'stim' && out[at - 1].block && out[at - 1].block === it.block) at--;
            const tall = refs.some(r => r.lay.h > 5.5);                  // a page-sized table (Table S, the periodic table) stays its own item
            if (at < out.length) out.splice(at, 0, ...refs);            // a shared stimulus precedes: the insert goes before it
            else if (tall) { widen(it, geo); out.push(...refs); }        // both page-wide, so the packer keeps them in order
            else mergeRefInto(it, refs, o, geo);                         // otherwise it travels with the question
            need.forEach(c => shown[kind].add(c));
          }
          prev[kind] = new Set(all);
        }
        out.push(it);
      }
      const head = [];
      for (const kind of KINDS) {
        const mode = modes[kind], list = groups[kind]; if (!list.length || (mode !== 'start' && mode !== 'end' && mode !== 'sheet')) continue;
        // "on a separate sheet": page-wide items kept apart (items.refSheet), typeset as their own document
        const g = mode === 'sheet' ? { halfW: geo.halfW, wide: true, widthFor: () => PAGE_W - GUTTER } : geo;
        const ins = list.flatMap((c, k) => splitRef(refItem(RT, c, o, g, k === 0 ? title[kind] : null, ''), o));
        if (mode === 'start') head.push(...ins); else if (mode === 'sheet') sheet.push(...ins); else out.push(...ins);
      }
      items.length = 0; items.push(...head, ...out); items.refSheet = sheet;
    }
    const permFor = (meta, id, nChoices) => nChoices === 4 ? ((meta && meta.b && meta.b.perm) || hashPerm(id)) : null;
    const answerB = (perm, answer) => perm && answer ? perm.indexOf(answer) + 1 : answer;
    /**
     * picked: ids in worksheet order (questions, CR clusters, new-format clusters, extras).
     * o: { bank, bankNew, text: id -> text record, custom: id -> custom question, extras: id -> {kind:'brk'|'pdf',...},
     *      dropped: clusterId -> [q numbers left out], cols 1|2, pt, wide (all items full width), blank, note,
     *      reftables: REFTABLES data, refTables / refConst: off | start | once | always | end }
     */
    function buildItems(picked, o) {
      const COLGAP = o.blank ? 0.55 : 0.3, halfW = (PAGE_W - COLGAP) / 2;
      const B = o.bank, byId = B._byId || (B._byId = Object.fromEntries(B.questions.map(q => [q.id, q])));
      const clById = B._clById || (B._clById = Object.fromEntries((B.clusters || []).map(c => [c.id, c])));
      const NC = (o.bankNew && o.bankNew.clusters) || [], nclById = Object.fromEntries(NC.map(c => [c.id, c]));
      const T = B.types || {};
      const text = o.text || {}, custom = o.custom || {}, extras = o.extras || {}, dropped = o.dropped || {};
      const items = [], shown = new Set();
      const wide = o.cols === 1 || o.wide;
      const widthFor = full => (full || wide ? PAGE_W : halfW) - GUTTER;
      const cap = h => Math.min(PAGE_H - 0.2, h);
      const addMC = (q, i) => {
        const t = text[q.id]; if (!t) return;
        const full = wide || q.width === 'full', w = widthFor(full);
        const perm = permFor(q, q.id, (t.choices || []).length);
        const lay = layoutBlocks(t, w, o.pt, { id: q.id }), layB = perm ? layoutBlocks(t, w, o.pt, { id: q.id, perm }) : lay;
        items.push({ kind: 'q', mc: true, q, t, i, lay, layB, perm, pt: o.pt, w, h: cap(Math.max(lay.h, layB.h)), full, block: q.stimulus || null,
                     ord: { q, answer: q.answer, answerB: answerB(perm, q.answer), tables: q.tables || [], ref: q.ref, refnote: q.refnote, src: `${q.session} ${q.year} Q${q.q} · U${uLab(q.unit)} · ${(T[q.type] || {}).name || ''}` } });
      };
      const addCustom = (q, i) => {
        const full = wide || q.width === 'full', w = widthFor(full);
        const t = customBlocks(q);
        const perm = hashPerm(q.id);
        const lay = layoutBlocks(t, w, o.pt, { id: q.id }), layB = layoutBlocks(t, w, o.pt, { id: q.id, perm });
        items.push({ kind: 'q', mc: true, q, t, i, custom: true, lay, layB, perm, pt: o.pt, w, h: cap(Math.max(lay.h, layB.h)), full, block: null,
                     ord: { q, answer: q.answer, answerB: answerB(perm, q.answer), tables: q.tables || [], ref: q.ref, src: `Custom question${q.author ? ' · ' + q.author : ''}` } });
      };
      const addStim = (id, t, i, block, ctl) => {
        const w = widthFor(true), lay = layoutBlocks(t, w, o.pt, { id, nums: { a: '000', b: '000' } });
        items.push({ kind: 'stim', id, t, i: ctl ? i : undefined, lay, pt: o.pt, w, h: cap(lay.h), full: true, block });
      };
      const addCR = (c, i) => {
        const tc = text[c.id]; if (!tc) return;
        const drop = new Set(dropped[c.id] || []);
        const kept = c.items.filter(it => !drop.has(it.q));
        if (!kept.length) return;
        const w = widthFor(true);
        const pblocks = [].concat(tc.lead ? [{ t: 'p', runs: tc.lead.runs }] : [], tc.blocks || []);
        if (pblocks.length) addStim(c.id, { id: c.id, blocks: pblocks }, i, c.id, true);
        kept.forEach((meta, k) => {
          const ti = (tc.items || []).find(x => x.q === meta.q); if (!ti) return;
          if (ti.pre && ti.pre.length) addStim(`${c.id}_P${meta.q}`, { id: c.id, blocks: ti.pre }, i, c.id, false);   // teacher-written clusters: a passage between questions
          const span = ti.q_end && ti.q_end > ti.q ? ti.q_end - ti.q + 1 : 1, gx = span > 1 ? RANGE_GX * (o.pt / BASE_PT) : 0;   // "52–53" needs a wider number column
          if (ti.mc) {                                               // a multiple-choice item inside an old-format cluster (Living Environment Parts B-2 and D)
            const qid = `${c.id}_Q${meta.q}`, ans = (ti.key && ti.key.mc_answer) || meta.answer, perm = permFor(meta, qid, (ti.choices || []).length);
            const lay = layoutBlocks(ti, w, o.pt, { id: qid }), layB = perm ? layoutBlocks(ti, w, o.pt, { id: qid, perm }) : lay;
            items.push({ kind: 'q', mc: true, crq: true, c, meta, t: ti, qnum: meta.q, i, lay, layB, perm, pt: o.pt, w, h: cap(Math.max(lay.h, layB.h)), full: true, block: c.id,
                         ord: { answer: ans, answerB: answerB(perm, ans), tables: meta.tables || [], ref: meta.ref, refnote: meta.refnote, src: `${c.session} ${c.year} Q${meta.q} · U${uLab(meta.unit)} · ${(T[meta.type] || {}).name || ''}` } });
            return;
          }
          const lo = { id: `${c.id}_Q${meta.q}`, credit: ti.credit, resp: ti.resp && ti.resp.shared_with != null && kept.some(x => x.q === ti.resp.shared_with) ? null : ti.resp };
          const lay = layoutBlocks({ blocks: ti.blocks }, w - gx, o.pt, lo);
          items.push({ kind: 'cq', c, meta, ti, lo, qnum: meta.q, span, gx, i: pblocks.length || k ? i : i, lay, layB: lay, pt: o.pt, w, h: cap(lay.h), full: true, block: c.id,
                       ord: { cr: true, c, q: meta.q, key: ti.key, credit: ti.credit, tables: meta.tables || [], ref: meta.ref, refnote: meta.refnote, src: `${c.session} ${c.year} Q${meta.q} · U${uLab(meta.unit)} · ${(T[meta.type] || {}).name || ''}` } });
        });
      };
      const addNew = (c, i) => {
        const tc = text[c.id]; if (!tc) return;
        const w = widthFor(true);
        const lead = [].concat(tc.lead ? [{ t: 'p', runs: tc.lead.runs }] : [], tc.tables_note && o.note !== false ? [{ t: 'p', runs: tc.tables_note.runs }] : []);
        if (lead.length) addStim(c.id, { id: c.id, blocks: lead }, i, c.id, true);
        (tc.blocks || []).forEach((b, bi) => {
          if (b.t === 'passage') { addStim(`${c.id}_P${bi}`, { id: c.id, blocks: b.blocks }, i, c.id, !lead.length && bi === 0); return; }
          if (b.t !== 'q') return;
          const meta = (c.questions || []).find(x => x.q === b.q) || {};
          const nsrc = `New Regents ${c.sample ? 'sample' : c.session + ' ' + c.year} · ${c.title || ''} Q${b.q}${meta.type ? ' · N' + meta.type : ''}`;
          if (b.mc) {
            const perm = permFor(meta, `${c.id}_Q${b.q}`, (b.choices || []).length);
            const lay = layoutBlocks(b, w, o.pt, { id: `${c.id}_Q${b.q}` }), layB = perm ? layoutBlocks(b, w, o.pt, { id: `${c.id}_Q${b.q}`, perm }) : lay;
            items.push({ kind: 'q', mc: true, ncl: c, b, t: b, i, lay, layB, perm, pt: o.pt, w, h: cap(Math.max(lay.h, layB.h)), full: true, block: c.id,
                         ord: { ncl: c, qq: meta, answer: meta.answer, answerB: answerB(perm, meta.answer), tables: [], ref: 'none', src: nsrc } });
          } else {
            const lo = { id: `${c.id}_Q${b.q}`, credit: b.credit, resp: b.resp }, lay = layoutBlocks({ blocks: b.blocks }, w, o.pt, lo);
            items.push({ kind: 'cq', ncl: c, b, lo, qnum: b.q, i, lay, layB: lay, pt: o.pt, w, h: cap(lay.h), full: true, block: c.id,
                         ord: { cr: true, ncl: c, q: b.q, key: b.key, credit: b.credit, tables: [], ref: 'none', src: nsrc } });
          }
        });
      };
      picked.forEach((id, i) => {
        if (extras[id] && extras[id].kind === 'text') { items.push(Object.assign(textItem(extras[id], o, { halfW, wide, widthFor }), { i, id })); return; }
        if (extras[id] && extras[id].kind === 'reftab') { items.push(Object.assign(manualRef(extras[id], o, { halfW, wide, widthFor }), { i, id })); return; }
        if (extras[id]) { items.push(Object.assign({ i, id, h: 0, w: 0 }, extras[id])); return; }
        if (custom[id]) { addCustom(custom[id], i); return; }
        if (clById[id]) { addCR(clById[id], i); return; }
        if (nclById[id]) { addNew(nclById[id], i); return; }
        const q = byId[id]; if (!q) return;
        if (q.stimulus) {
          if (shown.has(q.stimulus)) return;
          shown.add(q.stimulus);
          const ts = text[q.stimulus];
          if (ts) addStim(q.stimulus, ts, i, q.stimulus, false);
          picked.forEach((id2, i2) => { const q2 = byId[id2]; if (q2 && q2.stimulus === q.stimulus) addMC(q2, i2); });
          return;
        }
        addMC(q, i);
      });
      if (o.reftables && o.reftables.items && ((o.refTables && o.refTables !== 'off') || (o.refConst && o.refConst !== 'off')))
        insertRefs(items, o.reftables, { tables: o.refTables || 'off', consts: o.refConst || 'off' }, o, { halfW, wide, widthFor });
      return items;
    }

    // ------------------------------------------------------------ the column packer
    // Same rules as the image builder (column-major reading order, full-width items wait for an empty band), plus:
    // an item that fits neither column is parked and placed first on the next page while the items after it fill the gap.
    function layout(items, opts) {
      const cols = opts.cols || 2, COLGAP = opts.colgap;
      const colW = cols === 2 ? (PAGE_W - COLGAP) / 2 : PAGE_W;
      const pages = []; let page, y0, col, colY, bandTop, parkedFull = [], parkedHalf = [], headDone = false;
      function newPage(pdf) {
        page = { items: [], rules: [], pdf: pdf || null }; pages.push(page);
        y0 = pdf ? 0 : ((!headDone || opts.headAll) ? (opts.headH || 0) : 0); if (!pdf) headDone = true;
        col = 0; colY = [y0, y0]; bandTop = y0;
        if (!pdf) { const list = parkedHalf; parkedHalf = []; list.forEach(it => { if (!placeHalf(it)) parkedHalf.push(it); }); }
      }
      // before a band closes under a full-width item (or a break), spread the half items of a one-column band over
      // both columns: reading order is kept (the first k stay left, the rest move right), the band gets shorter
      function balance() {
        if (cols !== 2 || opts.balance === false) return;
        const band = page.items.filter(p => p.y >= bandTop && !p.item.full && p.item.kind !== 'brk');
        if (band.length < 2 || band.some(p => p.x > 0)) return;
        const hs = band.map(p => p.item.h + ITEM_GAP);
        let best = -1, bestH = Math.max(colY[0], colY[1]) - bandTop;
        for (let k = 1; k < band.length; k++) {
          const l = hs.slice(0, k).reduce((a, b) => a + b, 0), r = hs.slice(k).reduce((a, b) => a + b, 0);
          if (Math.max(l, r) < bestH - 1e-6) { best = k; bestH = Math.max(l, r); }
        }
        if (best < 0) return;
        let yl = bandTop, yr = bandTop;
        band.forEach((p, i) => { if (i < best) { p.x = 0; p.y = yl; yl += hs[i]; } else { p.x = colW + COLGAP; p.y = yr; yr += hs[i]; } });
        colY = [yl, yr]; col = 1;
      }
      function closeBand() {
        balance();
        const bottom = Math.max(colY[0], colY[1]);
        const inBand = page.items.filter(p => p.y >= bandTop && !p.item.full && p.item.kind !== 'brk');
        if (cols === 2 && inBand.length && (inBand.some(p => p.x > 0) || bottom - bandTop > 3))
          page.rules.push({ x: colW + COLGAP / 2, y: bandTop, h: bottom - bandTop - ITEM_GAP });
        return bottom;
      }
      /** returns false when the item was deferred: a fresh page started with parked half items in the left column only,
       *  and opts.fill lets the following half items fill the right column before this full item goes underneath */
      function placeFull(it, canDefer) {
        let y = closeBand();
        while (y + it.h > PAGE_H && page.items.length) {
          newPage(); y = closeBand();
          if (canDefer && cols === 2 && opts.fill !== false && page.items.length && colY[1] === bandTop && colY[0] > bandTop) { parkedFull.unshift(it); return false; }
        }
        page.items.push({ item: it, x: 0, y });
        colY = [y + it.h + ITEM_GAP, y + it.h + ITEM_GAP]; bandTop = colY[0]; col = 0;
        return true;
      }
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
        while (y + need > PAGE_H && page.items.length) { newPage(); y = closeBand(); }
        if (first.full || cols === 1) { placeFull(first); }
        else { page.items.push({ item: first, x: 0, y }); colY = [y + first.h + ITEM_GAP, y]; bandTop = y; col = 0; }
        rest.forEach(q => { if (q.full || cols === 1) placeFull(q); else if (!placeHalf(q)) { closeBand(); newPage(); placeHalf(q); } });
      }
      const remaining = () => PAGE_H - colY[Math.min(col, 1)];
      const fits1 = u => (Array.isArray(u) ? u.reduce((s, it) => s + it.h + ITEM_GAP, 0) - ITEM_GAP : u.h) <= PAGE_H - colY[0] + 1e-6;
      function flushFull(canDefer) {
        const list = parkedFull; parkedFull = [];
        for (let i = 0; i < list.length; i++) {
          const u = list[i];
          if (cols === 1 && page.items.length && !fits1(u)) { parkedFull.push(u); continue; }
          if (Array.isArray(u)) { placeBlock(u); continue; }
          if (!placeFull(u, canDefer)) { parkedFull.push(...list.slice(i + 1)); return false; }   // deferred: keep the rest parked, in order
        }
        return true;
      }
      const hasContent = () => page.items.some(p => p.item.kind !== 'brk');
      newPage();
      const units = [];
      items.forEach(it => {
        const last = units[units.length - 1];
        if (it.block && Array.isArray(last) && last[0].block === it.block) last.push(it);
        else units.push(it.block ? [it] : it);
      });
      units.forEach(u => {
        if (!Array.isArray(u) && u.kind === 'brk') {
          if (u.type === 'col' && cols === 2) {
            if (col === 0) { page.items.push({ item: u, x: 0, y: colY[0] }); col = 1; }
            else { page.items.push({ item: u, x: colW + COLGAP, y: colY[1] }); flushFull(); closeBand(); const b = Math.max(colY[0], colY[1]); colY = [b, b]; bandTop = b; col = 0; }
          } else {
            const empty = !hasContent() && !page.pdf;
            page.items.push({ item: u, x: col * (colW + COLGAP), y: colY[Math.min(col, 1)], atTop: empty });
            flushFull(); closeBand();
            if (!empty) newPage(); else { colY = [y0, y0]; bandTop = y0; col = 0; }
          }
          return;
        }
        if (!Array.isArray(u) && u.kind === 'pdf') {
          flushFull(); closeBand();
          if (hasContent()) newPage(u);
          else { page.items = []; page.rules = []; page.pdf = u; if (pages.length === 1) headDone = false; }
          newPage();
          return;
        }
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
        if (parkedFull.length) { flushFull(true); if (placeHalf(u)) return; }
        parkedHalf.push(u);
        if (remaining() < 1.2) { closeBand(); newPage(); }
      });
      if (cols === 1) { while (parkedFull.length) { flushFull(); if (parkedFull.length) { closeBand(); newPage(); } } }
      else { while (parkedHalf.length || parkedFull.length) { if (parkedHalf.length) { closeBand(); newPage(); } flushFull(); } }
      closeBand();
      while (pages.length > 1 && !pages[pages.length - 1].pdf && !pages[pages.length - 1].items.some(p => p.item.kind !== 'brk')) pages.pop();
      return pages;
    }

    /** M = buildModel(items, {cols, pt, start, blank, note, crKey, fill}); fill=false keeps strict order (no column balancing / deferral) */
    function buildModel(items, o) {
      const headH = 0.5 + (o.note ? 0.32 : 0.1), start = o.start || 1;
      const pages = layout(items, { cols: o.cols || 2, headH, colgap: o.blank ? 0.55 : 0.3, fill: o.fill !== false, balance: o.fill !== false });
      let n = start; const order = [];
      pages.forEach(pg => pg.items.forEach(p => {
        const it = p.item;
        if (it.kind !== 'q' && it.kind !== 'cq') return;
        it.n = n; it.nEnd = it.span > 1 ? n + it.span - 1 : null; n += it.span || 1;    // a two-number item uses two numbers
        order.push(Object.assign({ n: it.n, nEnd: it.nEnd, label: numLabel(it), item: it, kind: it.custom ? 'custom' : undefined }, it.ord));
      }));
      // exam question number -> worksheet number, per cluster (for cross-references in stems and keys)
      const qmap = {};
      order.forEach(x => { const it = x.item, q0 = it.qnum != null ? it.qnum : it.b ? it.b.q : null; if (q0 == null || !it.block) return;
        const m = qmap[it.block] = qmap[it.block] || {}; for (let k = 0; k < (it.span || 1); k++) m[q0 + k] = it.n + k; });
      const tabs = {};
      order.forEach(x => (x.tables || []).forEach(t => { tabs[t] = tabs[t] || { nums: [], old: false }; tabs[t].nums.push(x.n); if (x.ref === 'old' || x.ref === 'partial') tabs[t].old = true; }));
      const keyItems = [];
      if (o.crKey !== false) order.filter(x => x.cr && x.key && x.key.blocks && x.key.blocks.length).forEach(x => {
        const gx = x.item.gx || 0, key = qmap[x.item.block] ? renumberKey(x.key, qmap[x.item.block]) : x.key;
        const lay = layoutKey(key, PAGE_W - GUTTER - gx, o.pt || BASE_PT, { id: 'key' + x.n });
        keyItems.push({ kind: 'key', n: x.n, nEnd: x.nEnd, gx, credit: x.credit, lay, w: PAGE_W - GUTTER, h: Math.min(PAGE_H - 0.6, lay.h), full: true });
      });
      const keyPages = keyItems.length ? layout(keyItems, { cols: 1, headH: 0.5, headAll: true, colgap: 0.3 }) : [];
      return { items, pages, order, tabs, keyPages, qmap, start, headH, nq: order.length, blank: !!o.blank, cols: o.cols || 2, pt: o.pt, landscape: LANDSCAPE };
    }

    /** the numbered answer table split into pages of columns that fit: [{chunks:[[order rows]...]}, ...] */
    function keyTablePages(M, src) {
      const perCol = LANDSCAPE ? 28 : 40, colW = src ? 3.6 : 1.6, gap = 0.25;   // two source columns fit a portrait page
      const perPage = Math.max(1, Math.floor((PAGE_W + gap) / (colW + gap)));
      const chunks = []; for (let i = 0; i < M.order.length; i += perCol) chunks.push(M.order.slice(i, i + perCol));
      const pages = []; for (let i = 0; i < chunks.length; i += perPage) pages.push({ chunks: chunks.slice(i, i + perPage), colW, perCol });
      return pages.length ? pages : [{ chunks: [[]], colW, perCol }];
    }
    const groupNums = (M, block) => { const ns = []; M.pages.forEach(pg => pg.items.forEach(p => { if ((p.item.kind === 'q' || p.item.kind === 'cq') && p.item.block === block) { ns.push(p.item.n); if (p.item.nEnd) ns.push(p.item.nEnd); } })); return ns; };
    /** the drawing ops of an item as it goes on the page (stimuli get their real question numbers) */
    function itemLay(M, it, version) {
      if (it.kind === 'stim') {
        const ns = groupNums(M, it.block), nums = { a: ns.length ? Math.min(...ns) : '', b: ns.length ? Math.max(...ns) : '' };
        const t = M.qmap && M.qmap[it.block] && hasNumRef(it.t.blocks) ? Object.assign({}, it.t, { blocks: renumberBlocks(it.t.blocks, M.qmap[it.block]) }) : it.t;   // "Directions (44–45)" inside a passage
        return layoutBlocks(t, it.w, it.pt, { id: it.t.id, nums });
      }
      if (it.kind === 'cq' && it.lo && !it.refs && M.qmap && M.qmap[it.block]) {   // a CR stem with its cross-references renumbered
        const blocks = (it.ti || it.b).blocks;
        if (blocks && hasNumRef(blocks))
          return it.layN || (it.layN = layoutBlocks({ blocks: renumberBlocks(blocks, M.qmap[it.block]) }, it.w - (it.gx || 0), it.pt, it.lo));
      }
      return version === 'B' ? it.layB : it.lay;
    }

    /** the write-on line at the top right: o.blanks true (all three), false, or { name, date, period } */
    const blanksLine = b => { if (!b) return ''; const on = b === true ? { name: true, date: true, period: true } : b;
      return [on.name && 'Name ____________________________', on.date && 'Date __________', on.period && 'Period _____'].filter(Boolean).join('   '); };
    // ------------------------------------------------------------ PDF
    async function makePDF(M, mode, version, o) {
      o = o || {}; version = version || 'A';
      const b64bytes = b64 => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
      const doc = await PDFDocument.create(); doc.registerFontkit(env.fontkit);
      const F = await doc.embedFont(env.fonts.serif, { subset: true }), FB = await doc.embedFont(env.fonts.bold, { subset: true }), FI = await doc.embedFont(env.fonts.italic, { subset: true });
      const FONT = { r: F, b: FB, i: FI };
      if (env.fonts.symbol) FONT.m = await doc.embedFont(env.fonts.symbol, { subset: false });   // already a small subset; fontkit cannot re-subset CFF
      const PW = PAGE_W * PT + 2 * MARGIN, PH = PAGE_H * PT + 2 * MARGIN;
      const imgCache = {};
      async function image(path) {
        if (imgCache[path]) return imgCache[path];
        let im;
        if (String(path).startsWith('data:')) { const b = b64bytes(path.split(',')[1]); im = /^data:image\/jpe?g/i.test(path) ? await doc.embedJpg(b) : await doc.embedPng(b); }
        else { const bytes = await env.image(path); if (!bytes) { (missing['img:' + path] = missing['img:' + path] || new Set()).add('pdf'); return (imgCache[path] = null); } im = await doc.embedPng(bytes); }
        return (imgCache[path] = im);
      }
      const X = xin => MARGIN + xin * PT, Y = (yin, hin) => PH - MARGIN - yin * PT - (hin || 0) * PT;
      const text = (page, s, xin, baseIn, size, font, opts) => page.drawText(clean(s, null, font === FONT.m ? 'm' : null), Object.assign({ x: X(xin), y: PH - MARGIN - baseIn * PT, size, font, color: rgb(0, 0, 0) }, opts || {}));
      const textRight = (page, s, xRightIn, baseIn, size, font) => page.drawText(clean(s), { x: X(xRightIn) - font.widthOfTextAtSize(clean(s), size), y: PH - MARGIN - baseIn * PT, size, font });
      const line = (page, x0, y0, x1, y1, t) => page.drawLine({ start: { x: X(x0), y: PH - MARGIN - y0 * PT }, end: { x: X(x1), y: PH - MARGIN - y1 * PT }, thickness: t || 1, color: rgb(0, 0, 0) });
      const harpoon = (page, xin, baseIn, pt) => {
        const em = pt / PT, x0 = xin + 0.08 * em, x1 = xin + (HARP_W - 0.08) * em, ax = baseIn - 0.27 * em, g = 0.09 * em, hd = 0.16 * em, t = Math.max(0.6, pt / 16);
        line(page, x0, ax - g, x1, ax - g, t); line(page, x1, ax - g, x1 - hd, ax - g - hd * 0.75, t);
        line(page, x0, ax + g, x1, ax + g, t); line(page, x0, ax + g, x0 + hd, ax + g + hd * 0.75, t);
      };
      const title = o.title || 'Worksheet';
      const numPt = 11 * Math.max(1, (M.pt || BASE_PT) / BASE_PT);
      const numAt = (page, n, xin, baseIn) => textRight(page, String(n), xin + GUTTER - 0.06, baseIn, numPt, F);
      async function drawLay(page, lay, xin, yin) {
        for (const op of lay.ops) {
          if (op.t === 'img') { const im = await image(op.src); if (im) page.drawImage(im, { x: X(xin + op.x), y: Y(yin + op.y, op.h), width: op.w * PT, height: op.h * PT }); else page.drawRectangle({ x: X(xin + op.x), y: Y(yin + op.y, op.h), width: op.w * PT, height: op.h * PT, borderWidth: 0.5, borderColor: rgb(.6, .6, .6), borderDashArray: [3, 3] }); }
          else if (op.t === 'harp') harpoon(page, xin + op.x, yin + op.y, op.pt);
          else if (op.t === 'line') line(page, xin + op.x0, yin + op.y0, xin + op.x1, yin + op.y1, op.tk || 0.6);
          else if (op.t === 'rect') page.drawRectangle({ x: X(xin + op.x), y: Y(yin + op.y, op.h), width: op.w * PT, height: op.h * PT, borderWidth: op.tk || 0.8, borderColor: rgb(0, 0, 0) });
          else text(page, op.s, xin + op.x, yin + op.y, op.pt, FONT[op.f] || F);
        }
      }
      if (mode === 'answers') {                      // the student answer sheet: a numbered blank for every multiple-choice question
        const rows = M.order.filter(x => x.item && x.item.mc), others = M.order.length - rows.length;
        const perCol = LANDSCAPE ? 22 : 30, colW = 1.45, perPage = Math.max(1, Math.floor(PAGE_W / colW)) * perCol;
        for (let s0 = 0; s0 < Math.max(1, rows.length); s0 += perPage) {
          const page = doc.addPage([PW, PH]);
          text(page, title, 0, 0.3, 14, FB);
          textRight(page, 'Name ____________________________   Date __________   Period _____', PAGE_W, 0.3, 11, F);
          line(page, 0, 0.4, PAGE_W, 0.4, 1.5);
          text(page, 'Answer sheet. Write the number of your answer on the line.' + (others ? ' Answer the other questions on the worksheet.' : ''), 0, 0.62, 10, FI);
          rows.slice(s0, s0 + perPage).forEach((x, k) => { const c = Math.floor(k / perCol), r = k % perCol, bx = c * colW, by = 1.05 + r * 0.29;
            textRight(page, String(x.n), bx + 0.42, by, 12, F); line(page, bx + 0.5, by + 0.02, bx + 1.15, by + 0.02, 0.8); });
        }
        return doc.save();
      }
      if (mode === 'sheet') {
        let first = true;
        for (let pi = 0; pi < M.pages.length; pi++) {
          const pg = M.pages[pi];
          if (pg.pdf) { const src = await PDFDocument.load(b64bytes(pg.pdf.pdf)); const [cp] = await doc.copyPages(src, [0]); doc.addPage(cp); continue; }
          const page = doc.addPage([PW, PH]);
          if (first) {
            first = false;
            text(page, title, 0, 0.3, 14, FB);
            let hx = FB.widthOfTextAtSize(clean(title), 14) / PT + 0.2;
            if (o.teacher) { text(page, o.teacher, hx, 0.3, 11, F); hx += F.widthOfTextAtSize(clean(o.teacher), 11) / PT + 0.2; }   // the teacher's name sits beside the title
            if (o.label) text(page, o.label, hx, 0.3, 11, F);
            if (blanksLine(o.blanks)) textRight(page, blanksLine(o.blanks), PAGE_W, 0.3, 11, F);
            line(page, 0, 0.4, PAGE_W, 0.4, 1.5);
            if (o.note) text(page, SUBJ.note, 0, 0.62, 10, FI);
          }
          pg.rules.forEach(r => { if (r.h > 0) line(page, r.x, r.y, r.x, r.y + r.h, 0.8); });
          for (const p of pg.items) {
            const it = p.item;
            if (it.kind === 'brk') continue;
            const lay = itemLay(M, it, version), gx = it.gx || 0;
            await drawLay(page, lay, p.x + GUTTER + gx, p.y);
            if (it.kind === 'q' || it.kind === 'cq') {
              numAt(page, numLabel(it), p.x + gx, p.y + lay.base0);
              if (M.blank && it.mc) line(page, p.x + BLANK_IN - BLANK_W, p.y + lay.base0 + 0.01, p.x + BLANK_IN, p.y + lay.base0 + 0.01, 0.7);
            }
          }
          text(page, String(pi + 1), PAGE_W / 2 - 0.05, PAGE_H + 0.3, 9, F, { color: rgb(.27, .27, .27) });
        }
      } else {
        const crPages = o.crKey !== false && M.keyPages.length;
        if (o.key !== false) {
          const src = !!o.src, rowH = 0.21;
          const kpages = keyTablePages(M, src);
          let page, x, yEnd = 0;
          for (let kp = 0; kp < kpages.length; kp++) {
          page = doc.addPage([PW, PH]);
          text(page, `${title} — Answer Key${kp ? ' (continued)' : ''}`, 0, 0.22, 13, FB);
          const colW = kpages[kp].colW, perCol = kpages[kp].perCol; x = 0; yEnd = 0.45;
          for (const ch of kpages[kp].chunks) {
            let y = 0.45;
            const cols = src ? [0.5, 1.0, colW - 1.5] : [0.5, 1.1];
            const cell = (s, cx, cw, yy, font, size, color) => { const w = font.widthOfTextAtSize(clean(s), size) / PT; text(page, s, x + cx + (cw - w) / 2, yy + 0.15, size, font, color ? { color } : {}); };
            const rowLines = yy => { line(page, x, yy, x + colW, yy, 0.6); };
            rowLines(y); cell('#', 0, cols[0], y, FB, 10.5); cell('Answer', cols[0], cols[1], y, FB, 10.5); if (src) cell('Source', cols[0] + cols[1], cols[2], y, FB, 10.5);
            y += rowH; rowLines(y);
            ch.forEach(r => {
              cell(r.label || String(r.n), 0, cols[0], y, F, r.nEnd ? 9 : 10.5);
              const a = r.cr ? (crPages ? 'see scoring pages' : 'see rating guide') : String((version === 'B' ? r.answerB : r.answer) ?? '?');
              cell(a, cols[0], cols[1], y, F, r.cr ? 8 : 10.5, r.cr ? rgb(.33, .33, .33) : null);
              if (src) { let s = r.src; while (F.widthOfTextAtSize(clean(s), 8) / PT > cols[2] - 0.1 && s.length > 4) s = s.slice(0, -2); cell(s, cols[0] + cols[1], cols[2], y, F, 8, rgb(.33, .33, .33)); }
              y += rowH; rowLines(y);
            });
            [0, cols[0], cols[0] + cols[1], colW].forEach(v => line(page, x + v, 0.45, x + v, y, 0.6));
            x += colW + 0.25; yEnd = Math.max(yEnd, y);
          }
          }
          if (o.refBlock) {
            const keys = Object.keys(M.tabs).filter(k => !(SUBJ.refSkip && k.startsWith(SUBJ.refSkip))).sort((a, b) => (a.startsWith(SUBJ.refFirst) - b.startsWith(SUBJ.refFirst)) || a.localeCompare(b));
            const lines = keys.map(t => ({ label: tableLabel(t), nums: M.tabs[t].nums, old: M.tabs[t].old }));
            let y = yEnd + 0.3;
            if (y + 0.8 + 0.2 * Math.ceil(lines.length / 3) > PAGE_H) { page = doc.addPage([PW, PH]); text(page, `${title} — Answer Key (continued)`, 0, 0.22, 13, FB); y = 0.5; }
            line(page, 0, y, PAGE_W, y, 0.8); y += 0.22;
            text(page, 'Reference tables needed', 0, y, 10.5, FB); text(page, SUBJ.refHeader, 1.75, y, 10.5, F); y += 0.24;
            const parts = lines.length ? lines.map(l => ({ s: `${l.label}: ${l.nums.join(', ')}`, old: l.old })) : [{ s: SUBJ.refNone, old: false }];
            let cx = 0;
            for (const part of parts) {
              const font = part.old ? FB : F, w = font.widthOfTextAtSize(clean(part.s), 10.5) / PT + 0.3;
              if (cx + w > PAGE_W && cx > 0) { cx = 0; y += 0.2; }
              text(page, part.s, cx, y, 10.5, font); cx += w;
            }
            yEnd = y;
          }
          if (o.standards && (o.standards.rows.length || o.standards.none)) {     // how many questions sit on each performance expectation
            const st = o.standards, parts = st.rows.map(r => `${r.pe}: ${r.nums.length} (${r.nums.join(', ')})`);
            if (st.none) parts.push(`No standard listed: ${st.none}`);
            let y = yEnd + 0.3;
            if (y + 0.8 + 0.2 * Math.ceil(parts.length / 2) > PAGE_H) { page = doc.addPage([PW, PH]); text(page, `${title} — Answer Key (continued)`, 0, 0.22, 13, FB); y = 0.5; }
            line(page, 0, y, PAGE_W, y, 0.8); y += 0.22;
            text(page, 'Standards on this sheet', 0, y, 10.5, FB); text(page, '(performance expectation: number of questions, then which ones)', 1.75, y, 10.5, F); y += 0.24;
            let cx = 0;
            for (const s of parts) {
              const w = F.widthOfTextAtSize(clean(s), 10.5) / PT + 0.3;
              if (cx + w > PAGE_W && cx > 0) { cx = 0; y += 0.2; }
              text(page, s, cx, y, 10.5, F); cx += w;
            }
            yEnd = y;
          }
        }
        if (crPages) for (let ki = 0; ki < M.keyPages.length; ki++) {
          const pg = M.keyPages[ki], page = doc.addPage([PW, PH]);
          text(page, `${title} — Constructed-response scoring (from the NYSED rating guides)${ki ? ', continued' : ''}`, 0, 0.22, 12, FB);
          for (const p of pg.items) { const it = p.item, gx = it.gx || 0; numAt(page, numLabel(it), gx, p.y + it.lay.base0); await drawLay(page, it.lay, GUTTER + gx, p.y); }
        }
        if (!doc.getPageCount()) { const page = doc.addPage([PW, PH]); text(page, `${title} — Answer Key`, 0, 0.22, 13, FB); text(page, 'No key pages were selected in Worksheet settings.', 0, 0.5, 11, F); }
      }
      return doc.save();
    }

    return { blanksLine, setPage, layoutBlocks, layoutKey, buildItems, layout, buildModel, makePDF, itemLay, groupNums, keyTablePages, customBlocks, missing, clean, hashPerm, tableLabel, numLabel, renumberKey, renumberBlocks, setSubject, get subject() { return SUBJ; },
             get consts() { return { PAGE_H, PAGE_W, ITEM_GAP, GUTTER, LH, LABEL_W, BASE_PT, ASC, LANDSCAPE, BLANK_W, BLANK_IN, RANGE_GX }; } };
  }

  return { create, setPage };   // per-subject strings: eng.setSubject({ tableNames, note, refHeader, refNone, refFirst })
});

/* textdocx.js v2 — Word (.docx) export of a worksheet model built by textpdf.js, using the `docx` library.
 * Word reflows the text, so this walks the content model (blocks, runs, choices, answer spaces) rather than the
 * drawing ops: questions are numbered paragraphs with hanging indents, two-across choices are borderless tables,
 * pictures are inline images at printed size, isotope notation is Office math (a pre-sub/superscript).
 *
 *   const ex = TextDOCX.create({ docx, image: path => bytes, engine });
 *   const bytes = await ex.makeDOCX(M, 'sheet' | 'key', 'A' | 'B', { title, blanks, note, label, layout: 'default'|'wide' });
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.TextDOCX = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const BASE_PT = 11.5, SYM = /[←-⇿∀-⋿ℓ☐✓]/;
  const IN = 1440;                                   // twips per inch
  const px = inches => Math.round(inches * 96);

  function create(env) {
    const D = env.docx, ENG = env.engine;
    const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, SectionType, Math: MathEl, MathRun,
            MathPreSubSuperScript, MathFraction, MathSubScript, MathSuperScript, MathRadical, BorderStyle, AlignmentType, WidthType, TabStopType, PageOrientation, Footer,
            PageNumber, UnderlineType, HeightRule, PageBreak, ColumnBreak, VerticalAlign } = D;
    let DOCS = false;                                // true while building for Google Docs (see makeDOCX)
    const gap = s => DOCS ? s + '  ' : s + '\t';     // what separates a number or choice label from its text
    const NOB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const noBorders = { top: NOB, bottom: NOB, left: NOB, right: NOB, insideHorizontal: NOB, insideVertical: NOB };
    const rule = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
    const allBorders = { top: rule, bottom: rule, left: rule, right: rule, insideHorizontal: rule, insideVertical: rule };

    // ---------------------------------------------------------------- runs
    const symbolChunks = s => String(s).split(/([←-⇿∀-⋿ℓ☐✓]+)/).filter(Boolean);
    /** runs (or a plain string) as Office math elements: italics are Word's default for letters; scripts attach to the
     *  run before them; fractions and radicals nest */
    const mathOf = part => {
      const out = [];
      for (const r of (Array.isArray(part) ? part : [{ s: String(part == null ? '' : part) }])) {
        if (r.frac) { out.push(new MathFraction({ numerator: mathOf(r.frac.num), denominator: mathOf(r.frac.den) })); continue; }
        if (r.sqrt) { out.push(new MathRadical({ children: mathOf(r.sqrt) })); continue; }
        if (r.stack) { out.push(new MathPreSubSuperScript({ children: [new MathRun(' ')], subScript: [new MathRun(r.stack.bot)], superScript: [new MathRun(r.stack.top)] })); continue; }
        const t = String(r.s == null ? '' : r.s); if (!t) continue;
        if (r.sub || r.sup) {
          const base = out.length && out[out.length - 1] instanceof MathRun ? out.pop() : new MathRun('');
          out.push(r.sub ? new MathSubScript({ children: [base], subScript: [new MathRun(t)] }) : new MathSuperScript({ children: [base], superScript: [new MathRun(t)] }));
          continue;
        }
        out.push(new MathRun(t));
      }
      return out;
    };
    const runsToDocx = (runs, pt, nums) => {
      const out = [], hp = Math.round(pt * 2);
      const list = runs.slice();
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        let s = String(r.s == null ? '' : r.s);
        if (nums) s = s.replace('{a}', nums.a).replace('{b}', nums.b);
        if (r.br) { out.push(new TextRun({ break: 1 })); continue; }
        if (r.sqrt) { out.push(new MathEl({ children: [new MathRadical({ children: mathOf(r.sqrt) })] })); continue; }
        if (r.frac) { out.push(new MathEl({ children: [new MathFraction({ numerator: mathOf(r.frac.num), denominator: mathOf(r.frac.den) })] })); continue; }
        if (r.stack) {
          // the element symbol after a stack becomes the base of the pre-sub/superscript
          let base = '';
          if (r.stack && list[i + 1] && !list[i + 1].stack && !list[i + 1].frac) {
            const nxt = String(list[i + 1].s || '').replace(/^ +/, ''); const m = nxt.match(/^(β|α|γ|[A-Z][a-z]?|[a-z])/);
            if (m) { base = m[1]; list[i + 1] = Object.assign({}, list[i + 1], { s: nxt.slice(m[1].length) }); }
          }
          out.push(new MathEl({ children: [new MathPreSubSuperScript({ children: [new MathRun(base || ' ')], subScript: [new MathRun(r.stack.bot)], superScript: [new MathRun(r.stack.top)] })] }));
          continue;
        }
        if (!s) continue;
        for (const piece of symbolChunks(s)) {
          out.push(new TextRun({ text: piece, bold: !!r.b, italics: !!r.i, subScript: !!r.sub, superScript: !!r.sup,
            underline: r.u ? { type: UnderlineType.SINGLE } : undefined, size: hp, font: SYM.test(piece) ? 'Cambria Math' : undefined }));
        }
      }
      return out;
    };
    const text = (s, pt, extra) => new TextRun(Object.assign({ text: s, size: Math.round(pt * 2) }, extra || {}));

    // ---------------------------------------------------------------- pictures
    const imgCache = {};
    async function picture(src, wIn, hIn) {
      let bytes;
      if (String(src).startsWith('data:')) { const b64 = src.split(',')[1], bin = atob(b64); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); }
      else bytes = imgCache[src] || (imgCache[src] = await env.image(src));
      if (!bytes) return text('[missing figure]', 9, { italics: true });
      const type = /^data:image\/jpe?g/i.test(src) ? 'jpg' : 'png';
      return new ImageRun({ type, data: bytes, transformation: { width: px(wIn), height: px(hIn) } });
    }

    // ---------------------------------------------------------------- blocks -> paragraphs
    /** o: {pt, k (figure scale), nums, indent (twips), colW (inches available)} */
    async function blocksToParas(blocks, o) {
      const paras = [], ind = o.indent || 0, pt = o.pt, k = o.k || 1;
      const flat = []; (blocks || []).forEach(b => { if (b.t === 'passage') flat.push(...(b.blocks || [])); else flat.push(b); });
      for (const b of flat) {
        if (b.t === 'p' || b.t === 'eq') {
          const center = b.t === 'eq' || b.role === 'heading' || b.role === 'caption';
          paras.push(new Paragraph({ children: runsToDocx(b.runs || [], pt, o.nums), indent: { left: ind }, alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { after: 60 }, keepNext: b.role === 'refhead' || b.role === 'heading' }));
        } else if (b.t === 'img') {
          let w = (b.w_in || 1) * k, h = (b.h_in || 1) * k; const maxW = (o.colW || 7) - ind / IN; if (w > maxW) { h *= maxW / w; w = maxW; }
          paras.push(new Paragraph({ children: [await picture(b.src || b.img, w, h)], indent: { left: ind }, alignment: AlignmentType.CENTER, spacing: { before: 60, after: 80 } }));
        } else if (b.t === 'list') {
          for (const item of (b.items || [])) {
            const labeled = /^(?:[A-Za-z]|[IVX]+|\d+|[A-Za-z]+ \d+)[:.)]/.test(item.map(r => r.s).join('').trim());
            paras.push(new Paragraph({ children: (labeled ? [] : [text('•\t', pt)]).concat(runsToDocx(item, pt, o.nums)), indent: { left: ind + 360, hanging: labeled ? 0 : 240 }, tabStops: [{ type: TabStopType.LEFT, position: ind + 360 }], spacing: { after: 20 } }));
          }
        }
      }
      return paras;
    }

    // ---------------------------------------------------------------- choices
    const label = k => `(${k + 1})`;
    async function choiceCell(c, k, pt, sc, cellW, caption, ind) {
      ind = ind || 0;
      const kids = [];
      if (c.cells) return kids;
      if (c.img) {
        let w = c.w_in * sc, h = c.h_in * sc; if (w > cellW - 0.1) { h *= (cellW - 0.1) / w; w = cellW - 0.1; }
        if (caption) { kids.push(new Paragraph({ children: [await picture(c.img, w, h)], alignment: AlignmentType.CENTER, spacing: { after: 20 } })); kids.push(new Paragraph({ children: [text(label(k), pt)], alignment: AlignmentType.CENTER, spacing: { after: 60 } })); }
        else kids.push(new Paragraph({ children: [text(gap(label(k)), pt), await picture(c.img, w, h)], indent: { left: ind + 360, hanging: 360 }, tabStops: [{ type: TabStopType.LEFT, position: ind + 360 }], spacing: { after: 40 } }));
      } else kids.push(new Paragraph({ children: [text(gap(label(k)), pt)].concat(runsToDocx(c.runs || [], pt)), indent: { left: ind + 360, hanging: 360 }, tabStops: [{ type: TabStopType.LEFT, position: ind + 360 }], spacing: { after: 40 } }));
      return kids;
    }
    async function choicesToBlocks(q, perm, o) {
      const pt = o.pt, sc = o.k || 1, choices = q.choices || []; if (!choices.length) return [];
      const shown = (perm || [1, 2, 3, 4]).map(n => choices[n - 1]).filter(Boolean);
      const ind = o.indent || 0, colW = (o.colW || 7) - ind / IN;
      const out = [];
      if (q.choice_layout === 'table' || shown.some(c => c.cells)) {
        const head = q.table_head || [], ncol = Math.max(head.length, ...shown.map(c => (c.cells || []).length));
        const rows = [];
        const cellOf = async (c, center) => new TableCell({ children: [new Paragraph({ children: c ? (c.runs ? runsToDocx(c.runs, pt) : c.img ? [await picture(c.img, c.w_in * sc, c.h_in * sc)] : []) : [], alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT })], verticalAlign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 80, right: 80 } });
        if (head.length) { const cells = [new TableCell({ children: [new Paragraph('')] })]; for (let j = 0; j < ncol; j++) cells.push(await cellOf(head[j], true)); rows.push(new TableRow({ children: cells, tableHeader: true })); }
        for (let k = 0; k < shown.length; k++) { const cells = [new TableCell({ children: [new Paragraph({ children: [text(label(k), pt)] })], verticalAlign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 80, right: 80 } })]; for (let j = 0; j < ncol; j++) cells.push(await cellOf((shown[k].cells || [])[j], true)); rows.push(new TableRow({ children: cells })); }
        out.push(new Table({ rows, width: { size: Math.round(colW * IN * 0.9), type: WidthType.DXA }, indent: { size: ind + 360, type: WidthType.DXA }, borders: allBorders }));
        out.push(new Paragraph({ spacing: { after: 60 } }));
        return out;
      }
      const isImg = c => !!c.img, allImg = shown.every(isImg);
      let layout = q.choice_layout || 'stacked';
      if (layout === 'row' && shown.some(c => !isImg(c) && oneLine(c) > colW / 4 - 0.4)) layout = 'grid';
      if (layout === 'grid' && shown.some(c => !isImg(c) && oneLine(c) > colW / 2 - 0.45)) layout = 'stacked';
      if (layout === 'stacked') { for (let k = 0; k < shown.length; k++) out.push(...await choiceCell(shown[k], k, pt, sc, colW - 0.6, false, ind)); return out; }
      const ncol = layout === 'row' ? 4 : 2, cellW = colW / ncol;
      const rowsIdx = layout === 'row' ? [[0, 1, 2, 3]] : [[0, 2], [1, 3]];
      const rows = [];
      for (const idx of rowsIdx) {
        const cells = [];
        for (const k of idx) { const c = shown[k]; cells.push(new TableCell({ children: c ? await choiceCell(c, k, pt, sc, cellW, allImg) : [new Paragraph('')], width: { size: Math.round(cellW * IN), type: WidthType.DXA }, margins: { top: 20, bottom: 20, left: 0, right: 80 } })); }
        rows.push(new TableRow({ children: cells }));
      }
      out.push(new Table(Object.assign({ rows, width: { size: Math.round(colW * IN), type: WidthType.DXA }, borders: noBorders, columnWidths: idxWidths(ncol, cellW) }, DOCS ? {} : { indent: { size: ind, type: WidthType.DXA } })));
      out.push(new Paragraph({ spacing: { after: 40 } }));
      return out;
    }
    const idxWidths = (n, w) => Array.from({ length: n }, () => Math.round(w * IN));
    // rough single-line width of a text choice (inches at 11.5 pt Times: ~0.075 in per character)
    const oneLine = c => (c.runs || []).map(r => r.s || '').join('').length * 0.075 + 0.35;

    // ---------------------------------------------------------------- answer spaces
    const blanks = n => '_'.repeat(Math.max(3, Math.round(n)));
    async function respToBlocks(r, o) {
      if (!r) return [];
      const pt = o.pt, sc = o.k || 1, ind = o.indent || 0, colW = (o.colW || 7) - ind / IN, out = [];
      const kind = r.kind;
      if (kind === 'blank') { out.push(new Paragraph({ spacing: { after: Math.round((r.h_in || 0.5) * sc * IN) } })); return out; }
      if (kind === 'template' && r.img) { let w = r.w_in * sc, h = r.h_in * sc; if (w > colW) { h *= colW / w; w = colW; } out.push(new Paragraph({ children: [await picture(r.img, w, h)], indent: { left: ind }, alignment: AlignmentType.CENTER, spacing: { before: 80, after: 120 } })); return out; }
      if (kind === 'box') {
        const bw = Math.min(colW, (r.w_in || colW) * sc), bh = (r.box_h_in || r.h_in || 2) * sc;
        out.push(new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph('')], borders: { top: rule, bottom: rule, left: rule, right: rule } })], height: { value: Math.round(bh * IN), rule: HeightRule.EXACT } })], width: { size: Math.round(bw * IN), type: WidthType.DXA }, indent: { size: ind + Math.round((colW - bw) / 2 * IN), type: WidthType.DXA }, borders: allBorders }));
        out.push(new Paragraph({ spacing: { after: 120 } })); return out;
      }
      if (kind === 'labelled-blank') {
        const rows = r.rows && r.rows.length ? r.rows.map(x => x.parts || x) : [r.parts || []];
        rows.forEach(parts => {
          const kids = [];
          parts.forEach(p => { if (p.blank_in != null) kids.push(text(blanks(p.blank_in * 72 / (0.5 * pt)) + ' ', pt)); else kids.push(...runsToDocx(p.runs || [], pt), text(' ', pt)); });
          out.push(new Paragraph({ children: kids, indent: { left: ind + 360 }, spacing: { before: 120, after: 160 } }));
        });
        return out;
      }
      // ruled lines
      const n = r.lines === 0 ? 0 : (r.lines || Math.max(1, Math.round((r.h_in || 0.5) / 0.47))), pitch = Math.max(0.36, ((r.h_in || 0.47 * n) / n)) * sc;
      if (r.boxes && r.boxes.length && r.boxes_stack) r.boxes.forEach(bx => out.push(new Paragraph({ children: [text('☐ ', pt, { font: 'Segoe UI Symbol' }), ...runsToDocx(bx.runs || [], pt)], indent: { left: ind + 360 }, spacing: { before: 60, after: 20 } })));
      else if (r.boxes && r.boxes.length) {
        const kids = []; if (r.boxes_prompt) kids.push(...runsToDocx(r.boxes_prompt.runs || r.boxes_prompt, pt), text('   ', pt));
        r.boxes.forEach(bx => { kids.push(text('☐ ', pt, { font: 'Segoe UI Symbol' }), ...runsToDocx(bx.runs || [], pt), text('    ', pt)); });
        out.push(new Paragraph({ children: kids, indent: { left: ind + 360 }, spacing: { before: 120, after: 60 } }));
      }
      for (let i = 1; i <= n; i++) {
        const lab = (r.labels || []).find(l => l.line === i);
        out.push(new Paragraph({ children: lab ? runsToDocx(lab.runs, pt) : [], indent: { left: ind + 360 }, spacing: { before: Math.round((pitch - 0.2) * IN), after: 0 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: i % 2 ? 1 : 2 } } }));
      }
      out.push(new Paragraph({ spacing: { after: 100 } }));
      return out;
    }

    // ---------------------------------------------------------------- items
    const numPara = (n, runs, pt, ind) => { const wide = String(n).length > 3, hang = wide ? 720 : 360;
      return new Paragraph({ children: [text(gap(String(n)), pt)].concat(runs), indent: { left: ind + hang, hanging: hang }, tabStops: [{ type: TabStopType.LEFT, position: ind + hang }], spacing: { before: 140, after: 60 }, keepNext: true }); };
    async function itemToBlocks(M, it, version, o) {
      const pt = o.pt, out = [];
      if (it.kind === 'brk') { out.push(new Paragraph({ children: [it.type === 'page' || o.cols === 1 ? new PageBreak() : new ColumnBreak()] })); return out; }
      if (it.kind === 'pdf') { out.push(new Paragraph({ children: [text(`[Inserted PDF page: ${it.name} p. ${it.page} — not included in the Word file]`, 9, { italics: true, color: '888888' })] })); return out; }
      if (it.kind === 'ref') { out.push(...await blocksToParas(it.blocks, Object.assign({}, o, { indent: 0 }))); return out; }
      if (it.kind === 'stim') {
        const ns = ENG.groupNums(M, it.block), nums = { a: ns.length ? Math.min(...ns) : '', b: ns.length ? Math.max(...ns) : '' };
        const sb = M.qmap && M.qmap[it.block] && ENG.renumberBlocks ? ENG.renumberBlocks(it.t.blocks, M.qmap[it.block]) : it.t.blocks;
        out.push(...await blocksToParas(sb, Object.assign({}, o, { nums, indent: 360 })));
        return out;
      }
      if (it.refBlocks) out.push(...await blocksToParas(it.refBlocks, Object.assign({}, o, { indent: 0 })));   // reference-table insert carried by this question
      const rec = it.kind === 'q' ? (it.custom ? ENG.customBlocks(it.q) : it.t) : (it.ti || it.b);
      const qmap = it.kind === 'cq' && M.qmap && M.qmap[it.block];
      const blocks = (qmap && ENG.renumberBlocks ? ENG.renumberBlocks(rec.blocks, qmap) : (rec.blocks || [])).slice();
      const label = ENG.numLabel ? ENG.numLabel(it) : it.n;
      const credit = it.kind === 'cq' ? (it.ti ? it.ti.credit : it.b && it.b.credit) : null;
      // first paragraph carries the number
      let first = blocks.findIndex(b => b.t === 'p');
      if (first < 0) { const fi = blocks.findIndex(b => b.t === 'img'); if (fi >= 0) { const b = blocks[fi]; let w = (b.w_in || 1) * o.k, h = (b.h_in || 1) * o.k; const maxW = (o.colW || 7) - 0.4; if (w > maxW) { h *= maxW / w; w = maxW; } out.push(numPara(label, [await picture(b.src || b.img, w, h)], pt, 0)); blocks.splice(fi, 1); } else out.push(numPara(label, [], pt, 0)); }
      const body = [];
      for (let i = 0; i < blocks.length; i++) {
        let b = blocks[i];
        if (credit && i === blocks.map((x, j) => x.t === 'p' ? j : -1).filter(j => j >= 0).pop()) b = Object.assign({}, b, { runs: (b.runs || []).concat([{ s: `   [${credit}]` }]) });
        if (i === first) { out.push(numPara(label, runsToDocx(b.runs || [], pt), pt, 0)); continue; }
        body.push(b);
      }
      out.push(...await blocksToParas(body, Object.assign({}, o, { indent: 360 })));
      if (it.kind === 'q') out.push(...await choicesToBlocks(rec, version === 'B' ? it.perm : null, Object.assign({}, o, { indent: 360 })));
      else out.push(...await respToBlocks(it.ti ? (it.ti.resp && it.ti.resp.shared_with != null ? null : it.ti.resp) : it.b && it.b.resp, Object.assign({}, o, { indent: 360 })));
      return out;
    }

    // ---------------------------------------------------------------- document
    async function makeDOCX(M, mode, version, o) {
      DOCS = !!(o && o.docs);
      o = o || {}; version = version || 'A';
      const pt = M.pt || BASE_PT, k = pt / BASE_PT, landscape = !!M.landscape;
      const pageW = landscape ? 11 : 8.5, pageH = landscape ? 8.5 : 11, bodyW = pageW - 1;
      const page = { size: { orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT, width: Math.round(pageW * IN), height: Math.round(pageH * IN) }, margin: { top: 720, bottom: 720, left: 720, right: 720 } };
      const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '444444' })] })] });
      const sections = [];
      const title = o.title || 'Worksheet';
      if (mode === 'sheet') {
        const head = [];
        const titleRuns = [text(title, 14, { bold: true }), text(o.teacher ? '   ' + o.teacher : '', 11), text(o.label ? '   ' + o.label : '', 11)], blanksText = ENG.blanksLine ? ENG.blanksLine(o.blanks) : '';
        if (DOCS) {                                                      // Google Docs keeps a two-cell table where it drops a right tab stop
          const wL = Math.round(bodyW * IN * 0.36), wR = Math.round(bodyW * IN) - wL, cell = (kids, align, w) => new TableCell({ children: [new Paragraph({ children: kids, alignment: align })], width: { size: w, type: WidthType.DXA }, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
          head.push(new Table({ rows: [new TableRow({ children: [cell(titleRuns, AlignmentType.LEFT, wL), cell([text(blanksText, 11)], AlignmentType.RIGHT, wR)] })], width: { size: Math.round(bodyW * IN), type: WidthType.DXA }, columnWidths: [wL, wR], borders: Object.assign({}, noBorders, { bottom: { style: BorderStyle.SINGLE, size: 12, color: '000000' } }) }));
          head.push(new Paragraph({ spacing: { after: 60 } }));
        } else head.push(new Paragraph({ children: titleRuns.concat([text('\t' + blanksText, 11)]), tabStops: [{ type: TabStopType.RIGHT, position: Math.round(bodyW * IN) }], border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '000000', space: 4 } }, spacing: { after: 80 } }));
        if (o.note) head.push(new Paragraph({ children: [text((ENG.subject || {}).note || 'Some questions may require the use of the Reference Tables.', 10, { italics: true })], spacing: { after: 120 } }));
        // items in reading order, grouped into one- and two-column sections
        const seq = []; M.pages.forEach(pg => pg.items.forEach(p => seq.push(p.item)));
        const twoCol = (M.cols || 2) === 2;
        const groups = [];
        seq.forEach(it => {
          const wide = !twoCol || it.full || it.kind === 'stim' || it.kind === 'cq' || it.kind === 'pdf' || (it.kind === 'ref' && it.full);
          const last = groups[groups.length - 1];
          if (it.kind === 'brk') { if (last) last.items.push(it); return; }
          if (last && last.wide === wide) last.items.push(it); else groups.push({ wide, items: [it] });
        });
        sections.push({ properties: { page }, footers: { default: footer }, children: head });
        for (let gi = 0; gi < groups.length; gi++) {
          const g = groups[gi], colW = g.wide ? bodyW : (bodyW - 0.3) / 2;
          const children = [];
          for (const it of g.items) children.push(...await itemToBlocks(M, it, version, { pt, k, colW, cols: g.wide ? 1 : 2 }));
          if (!children.length) continue;
          sections.push({ properties: { type: SectionType.CONTINUOUS, page, column: g.wide ? undefined : { count: 2, space: Math.round(0.3 * IN), separate: true } }, children });
        }
      } else {
        const children = [new Paragraph({ children: [text(`${title} — Answer Key`, 13, { bold: true })], spacing: { after: 160 } })];
        const rows = [new TableRow({ tableHeader: true, children: ['#', 'Answer', o.src ? 'Source' : null].filter(Boolean).map(h => new TableCell({ children: [new Paragraph({ children: [text(h, 10.5, { bold: true })], alignment: AlignmentType.CENTER })], shading: { fill: 'EEEEEE' } })) })];
        M.order.forEach(r => {
          const a = r.cr ? 'scoring below' : String((version === 'B' ? r.answerB : r.answer) ?? '?');
          const cells = [text(r.label || String(r.n), 10.5), text(a, r.cr ? 8 : 10.5, r.cr ? { color: '555555' } : {})];
          if (o.src) cells.push(text(r.src || '', 8, { color: '555555' }));
          rows.push(new TableRow({ children: cells.map(c => new TableCell({ children: [new Paragraph({ children: [c], alignment: AlignmentType.CENTER })], margins: { top: 20, bottom: 20, left: 100, right: 100 } })) }));
        });
        children.push(new Table({ rows, borders: allBorders, width: { size: Math.round((o.src ? 6.3 : 2.1) * IN), type: WidthType.DXA }, columnWidths: o.src ? [720, 1800, Math.round(4.55 * IN)] : [720, 2300] }));
        if (o.refBlock) {
          const SJ = ENG.subject || { refFirst: 'PT', refHeader: '(2011 edition letters; bold = not on the 2025 edition)', refNone: 'none beyond the periodic table' }, keys = Object.keys(M.tabs).filter(k => !(SJ.refSkip && k.startsWith(SJ.refSkip))).sort((a, b) => (a.startsWith(SJ.refFirst) - b.startsWith(SJ.refFirst)) || a.localeCompare(b));
          children.push(new Paragraph({ children: [text('Reference tables needed ', 10.5, { bold: true }), text(SJ.refHeader, 10.5)], spacing: { before: 240, after: 80 }, border: { top: { style: BorderStyle.SINGLE, size: 8, color: '000000', space: 6 } } }));
          const parts = keys.length ? keys.map(t => text(`${ENG.tableLabel(t)}: ${M.tabs[t].nums.join(', ')}      `, 10.5, { bold: M.tabs[t].old })) : [text(SJ.refNone, 10.5)];
          children.push(new Paragraph({ children: parts }));
        }
        if (o.standards && (o.standards.rows.length || o.standards.none)) {
          children.push(new Paragraph({ children: [text('Standards on this sheet ', 10.5, { bold: true }), text('(performance expectation: number of questions, then which ones)', 10.5)], spacing: { before: 240, after: 80 }, border: { top: { style: BorderStyle.SINGLE, size: 8, color: '000000', space: 6 } } }));
          children.push(new Paragraph({ children: o.standards.rows.map(r => text(`${r.pe}: ${r.nums.length} (${r.nums.join(', ')})      `, 10.5)).concat(o.standards.none ? [text(`No standard listed: ${o.standards.none}`, 10.5)] : []) }));
        }
        const crs = M.order.filter(r => r.cr && r.key && r.key.blocks && r.key.blocks.length);
        if (o.crKey !== false && crs.length) {
          children.push(new Paragraph({ children: [new PageBreak()] }));
          children.push(new Paragraph({ children: [text(`${title} — Constructed-response scoring (from the NYSED rating guides)`, 12, { bold: true })], spacing: { after: 160 } }));
          for (const r of crs) {
            const qmap = M.qmap && r.item && M.qmap[r.item.block];
            const kb = (qmap && ENG.renumberBlocks ? ENG.renumberBlocks(r.key.blocks, qmap) : (r.key.blocks || [])).slice(); const fp = kb.findIndex(b => b.t === 'p');
            const lab = r.label || String(r.n);
            if (fp >= 0) { children.push(numPara(lab, runsToDocx(kb[fp].runs || [], pt), pt, 0)); kb.splice(fp, 1); } else children.push(numPara(lab, [], pt, 0));
            children.push(...await blocksToParas(kb, { pt, k, colW: bodyW, indent: 360 }));
          }
        }
        sections.push({ properties: { page }, footers: { default: footer }, children });
      }
      const doc = new Document({
        creator: 'Chem Test Builder (text edition)', title,
        styles: { default: { document: { run: { font: 'Times New Roman', size: Math.round(pt * 2) }, paragraph: { spacing: { line: 264 } } } } },
        sections,
      });
      return typeof Blob !== 'undefined' && typeof window !== 'undefined' ? Packer.toBlob(doc) : Packer.toBuffer(doc);
    }
    return { makeDOCX };
  }
  return { create };
});

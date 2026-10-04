/* appui.js — the interface layer of the Science Test Builder (Oct 2026).
 *
 * The app (index.html) keeps the question logic, typesetting and storage. This file rearranges what is on screen and
 * adds the everyday conveniences, through a small set of hooks the app calls (APPUI.onList / onChange / onSheet /
 * onSaved / onLoaded / hide / libFilter / report) and the API it hands over in APPUI.init(app):
 *   home page (subject tiles, continue strip, tour), top bar (title, type, saved status, counts, File and Export
 *   menus), sidebar (More filters, hide dropdown, card / list view, used marks), tabbed Worksheet
 *   settings with defaults per worksheet type, unsaved-changes prompts, undo / redo, the Reorder list, problem
 *   reports, the Mine / Department tabs of the Open dialog, dark mode, and the guided tours.
 * Signed-in features (sharing, used marks, the reports list, synced preferences) need the Apps Script backend
 * (app.SHARED); on the plain website they are simply absent.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = (tag, attrs, html) => { const e = document.createElement(tag); if (attrs) for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k === 'style') e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); } if (html != null) e.innerHTML = html; return e; };
  const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KIND = { worksheet: 'Worksheet', practice: 'Practice', quiz: 'Quiz', test: 'Test', lab: 'Lab' };
  const KINDS = { worksheet: 'worksheets', practice: 'practice sheets', quiz: 'quizzes', test: 'tests', lab: 'labs' };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const rel = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  const short = email => String(email || '').split('@')[0];

  let A = null;                                   // the app's API (window.CTB), set in init
  let PREFS = LS.get('stb.prefs', {});            // per teacher: { dark, defaults: {kind: opts}, toured: {name: true} }
  const savePrefs = () => { LS.set('stb.prefs', PREFS); if (A && A.SHARED) A.call('setPrefs', PREFS).catch(() => { }); };
  const applyDark = () => { if (document.body) document.body.classList.toggle('dark', !!PREFS.dark); const c = $('chooser'); if (c) c.classList.toggle('dark', !!PREFS.dark); };

  if (/[?&]dark=1/.test(location.search || '')) PREFS.dark = true;        // a look at dark mode without changing the saved preference
  /** a backend call that works on the home page too (the app's own `call` exists only inside a subject) */
  const rpc = (name, args) => new Promise((res, rej) => { const g = window.google && google.script && google.script.run; if (!g) { rej(new Error('not signed in')); return; }
    g.withSuccessHandler(res).withFailureHandler(rej).rpc(name, args || [], window.SUBJECT_ID || ''); });
  const svg = (d, size) => `<svg viewBox="0 0 24 24" width="${size || 24}" height="${size || 24}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    chemistry: '<path d="M9 3h6"/><path d="M10 3v6.2L5.2 17.6A2.3 2.3 0 0 0 7.2 21h9.6a2.3 2.3 0 0 0 2-3.4L14 9.2V3"/><path d="M7.6 14.5h8.8"/>',
    physics: '<circle cx="12" cy="12" r="1.4"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>',
    earth: '<ellipse cx="12" cy="12" rx="10.5" ry="3.6" transform="rotate(-18 12 12)"/><circle cx="12" cy="12" r="5.6" fill="var(--icbg, #fff)"/><path d="M2.01 15.24A10.5 3.6 -18 0 0 21.99 8.76"/>',
    biology: '<path d="M8 2c0 5 8 6 8 10s-8 5-8 10"/><path d="M16 2c0 5-8 6-8 10s8 5 8 10"/><path d="M9.3 5.5h5.4M9.3 18.5h5.4M10.5 12h3"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 4v4.5H8"/><path d="M12 7.5V12l3 2"/>',
    sort: '<path d="M7 4v16M7 4L4 7M7 4l3 3"/><path d="M17 20V4M17 20l-3-3M17 20l3-3"/>',
    moon: '<path d="M20 14.3A8.3 8.3 0 0 1 9.7 4a7.6 7.6 0 1 0 10.3 10.3z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  };
  const darkIcon = () => svg(PREFS.dark ? ICON.sun : ICON.moon, 18);
  function toggleDark() {
    PREFS.dark = !PREFS.dark; LS.set('stb.prefs', PREFS); rpc('setPrefs', [PREFS]).catch(() => { }); applyDark();
    ['hDark', 'uiDark'].forEach(id => { const b = $(id); if (b) { b.innerHTML = darkIcon(); b.title = PREFS.dark ? 'Switch to light mode' : 'Switch to dark mode'; } });
  }

  // ------------------------------------------------------------------------------------------------ styles
  const CSS = `
  .legacy { display: none !important; }
  header { flex-wrap: nowrap; gap: 10px; }
  header h1 { white-space: nowrap; }
  header button.ghost { background: transparent; color: #fff; border-color: rgba(255,255,255,.6); }
  header button { white-space: nowrap; }
  #oTitle.intitle { background: transparent; color: #fff; border: 0; border-bottom: 1.5px solid rgba(255,255,255,.55); border-radius: 0; font-family: Georgia, serif; font-size: 16px; padding: 3px 4px; width: 230px; min-width: 90px; flex: 0 1 230px; }
  #oTitle.intitle:focus { border-bottom-color: #fff; }
  .uichip { font-size: 12px; padding: 2px 10px !important; border-radius: 999px; border: 1px solid rgba(255,255,255,.6) !important; background: transparent !important; color: #fff !important; cursor: pointer; }
  #uiSaved { font-size: 12px; opacity: .9; white-space: nowrap; }
  #uiCounts { font-size: 12.5px; white-space: nowrap; flex: 0 1 auto; margin: 0 auto; padding: 0 10px; overflow: hidden; text-overflow: ellipsis; }
  .uimenu { position: fixed; z-index: 210; background: #fff; color: #1a1414; border: 1px solid #ddd9d9; border-radius: 10px; padding: 6px 0; min-width: 230px; box-shadow: 0 6px 20px rgba(0,0,0,.18); }
  .uimenu button { display: flex; width: 100%; border: 0; border-radius: 0; background: transparent; text-align: left; padding: 7px 14px; justify-content: space-between; gap: 16px; color: inherit; font-size: 13.5px; }
  .uimenu button:hover { background: #f4e9ea; }
  .uimenu button:disabled { opacity: .45; background: transparent; }
  .uimenu .sep { border-top: 1px solid #ddd9d9; margin: 5px 0; }
  .uimenu .foot { font-size: 11px; color: #5b5454; padding: 6px 14px 2px; max-width: 260px; }
  .uimenu kbd { font: 11px Arial, Helvetica, sans-serif; color: #5b5454; }
  #bankswitch button .n { opacity: .75; font-size: 11px; margin-left: 5px; }
  #uiMoreRow { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; color: var(--soft); }
  #uiMoreRow button { padding: 2px 10px; font-size: 12px; }
  .fchip { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--maroon-tint); color: var(--maroon-deep); border: 1px solid var(--tint-line); cursor: pointer; white-space: nowrap; }
  #uiClearF { cursor: pointer; text-decoration: underline; }
  #uiMore { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
  #uiMore[hidden] { display: none; }
  #count { gap: 8px; }
  #count select { font-size: 12px; padding: 2px 6px; max-width: 190px; margin-left: auto; }
  .viewtog { display: inline-flex; gap: 3px; }
  .viewtog button { padding: 1px 7px; font-size: 13px; border-radius: 6px; line-height: 18px; }
  .viewtog button.on { background: var(--maroon-deep); color: #fff; border-color: var(--maroon-deep); }
  #list.listview .card .thumb { display: none; }
  #list.listview .card { margin: 4px 0; border-radius: 8px; }
  .card .snip { display: none; padding: 0 12px 8px; font-size: 12.5px; color: #1a1414; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #list.listview .card .snip { display: block; }
  .umark { display: inline-flex; gap: 3px; align-items: center; }
  .umark i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; border: 1.5px solid #5a0a11; }
  .umark i.y { background: #5a0a11; } .umark i.d { border-radius: 2px; border-color: #1f5f8b; background: #1f5f8b; }
  .card .flag { border: 0; background: transparent; padding: 0 2px; font-size: 13px; color: #a79f9f; cursor: pointer; }
  .card .flag:hover { color: #5a0a11; }
  #settings .dialog { width: min(720px, 94vw); }
  .stabs { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 18px; min-height: 240px; }
  .stabs nav button { display: block; width: 100%; text-align: left; border: 0; border-radius: 8px; background: transparent; padding: 7px 10px; margin-bottom: 2px; }
  .stabs nav button.on { background: var(--maroon-tint); color: var(--maroon-deep); }
  .stabs .pane[hidden] { display: none; }
  .stabs .row { align-items: flex-start; padding: 6px 0; }
  .stabs .row label { line-height: 1.35; }
  .stabs .row > label:first-child:not([for]) { width: 150px; flex: none; padding-top: 6px; }
  .stabs .row select { flex: 1; min-width: 0; }
  .libtabs { display: flex; gap: 6px; margin: 2px 0 8px; }
  .libtabs button { border-radius: 10px; padding: 5px 16px; }
  .libtabs button.on { background: var(--maroon-deep); color: #fff; border-color: var(--maroon-deep); }
  .kindgrid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 10px 0 4px; }
  .kindgrid button { border-radius: 12px; padding: 14px 4px; }
  .olist { max-height: 60vh; overflow: auto; margin: 8px 0; border: 1px solid var(--line); border-radius: 10px; }
  .olist .orow { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--line); background: var(--panel); cursor: grab; font-size: 13px; }
  .olist .orow:last-child { border-bottom: 0; }
  .olist .orow.over { box-shadow: inset 0 3px 0 var(--maroon); }
  .olist .orow.extra { color: var(--soft); font-style: italic; }
  .olist .orow .h { color: var(--soft); letter-spacing: -2px; user-select: none; }
  .olist .orow .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .olist .orow button { padding: 0 7px; font-size: 11px; line-height: 18px; }
  .rpwhat { background: var(--maroon-tint); border: 1px solid var(--tint-line); border-radius: 8px; padding: 8px 10px; font-size: 12.5px; margin-bottom: 8px; }
  .tourdim { position: fixed; background: rgba(20,14,14,.58); z-index: 200; }
  .tourring { position: fixed; border: 3px solid #e0b100; border-radius: 10px; z-index: 201; pointer-events: none; }
  .tourbox { position: fixed; z-index: 202; width: 330px; max-width: 92vw; background: #fff; color: #1a1414; border-radius: 12px; padding: 14px 16px; box-shadow: 0 8px 28px rgba(0,0,0,.35); font-size: 13.5px; line-height: 1.45; }
  .tourbox h4 { margin: 0 0 6px; font-family: Georgia, serif; font-size: 16px; color: #3d070b; font-weight: normal; }
  .tourbox .do { color: #5a0a11; font-weight: bold; }
  .tourbox .nav { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
  .tourbox .nav .n { font-size: 11px; color: #5b5454; margin-right: auto; }
  .tourbox button { background: #fff; color: #1a1414; border-color: #ddd9d9; }
  .tourbox button.primary { background: #3d070b; color: #fff; border-color: #3d070b; }
  /* ---- home ---- */
  #chooser { position: fixed; inset: 0; background: #f5f3f2; z-index: 9999; font-family: Arial, Helvetica, sans-serif; color: #1a1414; overflow: auto; }
  #chooser .hbar { background: #5a0a11; color: #fff; padding: 10px 24px; font-family: Georgia, serif; font-size: 20px; display: flex; align-items: center; gap: 12px; }
  #chooser .hop { width: 34px; height: 34px; border-radius: 50%; background: #3d070b; border: 2px solid #fff; display: grid; place-items: center; font-size: 12px; letter-spacing: .5px; flex: none; }
  #chooser .hwho { margin-left: auto; font: 12.5px Arial, Helvetica, sans-serif; opacity: .9; }
  #chooser .hdark, header #uiDark { width: 32px; height: 32px; padding: 0; border-radius: 50%; background: transparent; color: #fff; border: 1.5px solid rgba(255,255,255,.6); display: grid; place-items: center; cursor: pointer; flex: none; }
  #chooser .hdark:hover, header #uiDark:hover { border-color: #fff; }
  #chooser .ic { color: #5a0a11; flex: none; display: grid; place-items: center; }
  #chooser .tile { --icbg: #fff; }
  #chooser.dark .tile { --icbg: #262020; }
  #chooser.dark .ic { color: #f0c9ce; }
  #chooser.dark .hcont .ic { color: #b5abab; }
  #chooser .hmain { max-width: 900px; margin: 36px auto 60px; padding: 0 16px; }
  #chooser h2 { font-family: Georgia, serif; color: #3d070b; font-weight: normal; font-size: 20px; margin: 22px 0 10px; }
  #chooser .hcont .ic { color: #5b5454; }
  #chooser .hcont { display: flex; align-items: center; gap: 14px; background: #fff; border: 1px solid #ddd9d9; border-radius: 12px; padding: 14px 18px; color: #1a1414; text-decoration: none; }
  #chooser .hcont:hover, #chooser .tile:hover { border-color: #5a0a11; }
  #chooser .hcont b { font-family: Georgia, serif; font-size: 16px; color: #3d070b; }
  #chooser .hcont .go { margin-left: auto; background: #5a0a11; color: #fff; border-radius: 999px; padding: 6px 16px; font-size: 13px; white-space: nowrap; }
  #chooser .s { font-size: 12.5px; color: #5b5454; }
  #chooser .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  #chooser .tile { display: flex; background: #fff; border: 1px solid #ddd9d9; border-radius: 12px; overflow: hidden; min-height: 96px; }
  #chooser .tile a.main { flex: 1; padding: 16px 18px; color: #3d070b; text-decoration: none; display: flex; align-items: center; gap: 14px; }
  #chooser .tile a.main .tx { display: flex; flex-direction: column; gap: 5px; }
  #chooser .tile a.main b { font-family: Georgia, serif; font-size: 17px; font-weight: bold; }
  #chooser .tile a.sub { flex: 0 0 86px; display: flex; flex-direction: column; gap: 4px; align-items: center; justify-content: center; text-align: center; font-size: 12.5px; color: #3d070b; text-decoration: none; background: #f4e9ea; border-left: 1px solid #ecd9da; padding: 6px; }
  #chooser .tile a.sub:hover { background: #ecd9da; }
  #chooser .tile.soon { background: #f0eeee; color: #9a9292; padding: 16px 18px; flex-direction: column; justify-content: center; }
  #chooser .hfoot { display: flex; justify-content: center; gap: 10px; margin-top: 26px; flex-wrap: wrap; }
  #chooser .pill { display: inline-block; background: #fff; border: 1px solid #ddd9d9; border-radius: 999px; padding: 6px 16px; color: #3d070b; text-decoration: none; font-size: 13px; cursor: pointer; }
  #chooser .pill:hover { border-color: #5a0a11; }
  #chooser .tourpick { text-align: center; margin-top: 12px; font-size: 13px; color: #5b5454; }
  #chooser .tourpick[hidden] { display: none; }
  @media (max-width: 640px) { #chooser .tiles { grid-template-columns: 1fr; } }
  #chooser.dark { background: #1c1717; color: #ece7e7; }
  #chooser.dark .hcont, #chooser.dark .tile, #chooser.dark .pill { background: #262020; border-color: #4a4040; color: #ece7e7; }
  #chooser.dark h2, #chooser.dark .tile a.main, #chooser.dark .hcont b, #chooser.dark .pill { color: #f0c9ce; }
  #chooser.dark .s, #chooser.dark .tourpick { color: #b5abab; }
  #chooser.dark .tile a.sub { background: #3a2226; border-color: #5a3238; color: #f0c9ce; }
  /* ---- dark mode: the bars, the sidebar and the dialogs; question cards and worksheet pages stay as printed ---- */
  body.dark { --bg: #1c1717; --panel: #262020; --ink: #ece7e7; --soft: #b5abab; --line: #4a4040; --maroon-tint: #3a2226; --tint-line: #5a3238; --maroon-deep: #f0c9ce; }
  body.dark header { background: #3d070b; }
  body.dark header .badge { background: #2a0508; }
  body.dark #progress { background: #7a1420; }
  body.dark button { background: #332b2b; color: #ece7e7; border-color: #4a4040; }
  body.dark header button { background: #fff; color: #3d070b; border-color: #fff; }
  body.dark header button.ghost, body.dark header #uiDark { background: transparent; color: #fff; border-color: rgba(255,255,255,.6); }
  body.dark button.primary { background: #7a1420; color: #fff; border-color: #7a1420; }
  body.dark #bankswitch button.on, body.dark .viewtog button.on, body.dark .libtabs button.on { background: #7a1420; color: #fff; border-color: #7a1420; }
  body.dark input, body.dark select, body.dark textarea { background: #1f1a1a; color: #ece7e7; border-color: #4a4040; }
  body.dark #oTitle.intitle { background: transparent; color: #fff; }
  body.dark .dialog { background: #262020; color: #ece7e7; border-color: #4a4040; }
  body.dark .uimenu { background: #2b2424; color: #ece7e7; border-color: #4a4040; }
  body.dark .uimenu button:hover { background: #3a2226; }
  body.dark .uimenu .foot, body.dark .uimenu kbd { color: #b5abab; }
  body.dark .uimenu .sep { border-color: #4a4040; }
  body.dark .card, body.dark .page, body.dark #pvBody, body.dark .dialog .preview, body.dark .tourbox {
    --bg: #f5f3f2; --panel: #ffffff; --ink: #1a1414; --soft: #5b5454; --line: #ddd9d9; --maroon-tint: #f4e9ea; --tint-line: #ecd9da; --maroon-deep: #3d070b; color: #1a1414; }
  body.dark .card button, body.dark .page button, body.dark #pvBody button { background: #fff; color: #1a1414; border-color: #ddd9d9; }
  body.dark .card .flag { background: transparent; border: 0; color: #a79f9f; }
  body.dark #pvBody input { background: #fff; }
  @media print { .uimenu, .tourdim, .tourring, .tourbox { display: none !important; } }
  `;
  const style = document.createElement('style'); style.textContent = CSS; (document.head || document.documentElement).appendChild(style);

  // ------------------------------------------------------------------------------------------------ home page
  window.APPUI_HOME = function (S, ROOT, HOME) {
    const last = LS.get('stb.last', null), lastS = last && S.find(s => s.id === last.subject && s.ready);
    const mapper = s => window.HOME_URL ? HOME + '?page=mapper&subject=' + s.id : s.id + '/unit-mapper.html';
    const tile = s => s.ready
      ? `<div class="tile"><a class="main" href="${HOME}?subject=${s.id}" title="Open the ${esc(s.name)} test builder">${ICON[s.id] ? `<span class="ic">${svg(ICON[s.id], 30)}</span>` : ''}<span class="tx"><b>${esc(s.name)}</b>${s.updated ? `<span class="s">Updated through ${esc(s.updated)}</span>` : ''}</span></a>` +
        `<a class="sub" href="${mapper(s)}" title="Reorder the units and move question types between them">${svg(ICON.sort, 16)}Edit unit order</a></div>`
      : `<div class="tile soon"><b>${esc(s.name)}</b><span class="s">coming soon</span></div>`;
    document.write(`<div id="chooser"${PREFS.dark ? ' class="dark"' : ''}><div class="hbar"><span class="hop" title="Orchard Park CSD — Science">OP</span><span>Science Test Builder</span><span class="hwho" id="hWho"></span>` +
      `<button class="hdark" id="hDark" title="${PREFS.dark ? 'Switch to light mode' : 'Switch to dark mode'}">${darkIcon()}</button></div><div class="hmain">` +
      (lastS && last.n ? `<a class="hcont" href="${HOME}?subject=${lastS.id}"><span class="ic">${svg(ICON.history, 26)}</span><div><b>${esc(last.title || 'Worksheet')}</b><div class="s">${esc(last.name || lastS.name)} · ${plural(last.n, 'question')} · edited ${rel(last.when)}</div></div><span class="go">Continue</span></a>` : '') +
      `<h2>Choose a subject</h2><div class="tiles">${S.map(tile).join('')}</div>` +
      `<div class="hfoot"><a class="pill" href="${ROOT}question-data.html"${window.HOME_URL ? ' target="_blank" rel="noopener"' : ''}>Question data</a><span class="pill" id="hTour">Take the tour</span></div>` +
      `<div class="tourpick" id="hTourPick" hidden>Tour which subject? ${S.filter(s => s.ready).map(s => `<span class="pill" data-tour="${s.id}" style="margin:4px">${esc(s.name)}</span>`).join('')}</div>` +
      `</div></div>`);
    document.title = 'Science Test Builder';
    $('hDark').onclick = toggleDark;
    rpc('whoAmI').then(me => { if (me && me.email) $('hWho').textContent = 'Signed in as ' + short(me.email); }).catch(() => { });
    rpc('getPrefs').then(p => { if (p && Object.keys(p).length) { PREFS = Object.assign({}, PREFS, p); LS.set('stb.prefs', PREFS); applyDark(); $('hDark').innerHTML = darkIcon(); } }).catch(() => { });
    const t = $('hTour'); if (t) t.onclick = () => { $('hTourPick').hidden = !$('hTourPick').hidden; };
    document.querySelectorAll('#hTourPick [data-tour]').forEach(b => { b.onclick = () => { LS.set('stb.tour', 'basics'); window.open(HOME + '?subject=' + b.dataset.tour, '_top'); }; });
  };

  // ------------------------------------------------------------------------------------------------ menus
  let openMenu = null;
  const closeMenu = () => { if (openMenu) { openMenu.remove(); openMenu = null; } };
  function showMenu(anchor, items) {
    const was = openMenu && openMenu._anchor === anchor; closeMenu(); if (was) return;
    const m = el('div', { class: 'uimenu' }); m._anchor = anchor;
    items.filter(Boolean).forEach(it => {
      if (it.sep) { m.append(el('div', { class: 'sep' })); return; }
      if (it.foot) { m.append(el('div', { class: 'foot' }, esc(it.foot))); return; }
      const b = el('button', null, `<span>${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}`);
      if (it.disabled) b.disabled = true;
      b.onclick = () => { closeMenu(); it.on(); };
      m.append(b);
    });
    document.body.append(m);
    const r = anchor.getBoundingClientRect(), w = m.offsetWidth;
    m.style.top = (r.bottom + 6) + 'px'; m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
    openMenu = m;
  }
  document.addEventListener('click', e => { if (openMenu && !openMenu.contains(e.target) && e.target !== openMenu._anchor && !openMenu._anchor.contains(e.target)) closeMenu(); });

  // ------------------------------------------------------------------------------------------------ saved status, unsaved prompts, undo
  let dirty = false, savedAt = 0, lastSig = '', pending = null;
  let lastM = null, addSeq = {}, seqN = 0;      // last typeset model; when each worksheet item was added (newest = highest)
  let undoStack = [], redoStack = [], cur = null, lastS = '', restoring = false;
  const sig = () => JSON.stringify([A.picked, A.state.dropped, $('oTitle').value, A.getOpts()]);
  const ssig = () => JSON.stringify([A.picked, A.state.dropped]);
  function updateSaved() {
    const s = $('uiSaved'); if (!s) return;
    s.textContent = !A.picked.length ? '' : dirty ? 'Unsaved changes' : (A.SHARED && !A.currentWs) ? 'Not saved yet' : savedAt ? 'Saved ' + rel(savedAt) : '';
    s.title = A.SHARED ? (A.currentWs ? `In your library as "${A.currentWs.title}"${A.currentWs.shared ? ', shared with the department' : ''}` : 'Not in your library yet') : 'This copy saves worksheets as files';
    const u = $('uiUndo'); if (u) u.disabled = !undoStack.length;
  }
  function markClean(when) { dirty = false; savedAt = when || Date.now(); LS.set(A.SK + 'dirty', false); LS.set(A.SK + 'savedAt', savedAt); lastSig = sig(); updateSaved(); }
  function onChange() {
    if (!A) return;
    A.picked.forEach(id => { if (!(id in addSeq)) addSeq[id] = ++seqN; });
    const s = sig();
    if (s !== lastSig) { lastSig = s; if (!dirty) { dirty = true; LS.set(A.SK + 'dirty', true); } }
    const t = ssig();
    if (t !== lastS) { if (!restoring && cur) { undoStack.push(cur); if (undoStack.length > 60) undoStack.shift(); redoStack.length = 0; } cur = A.state; lastS = t; }
    writeLast(null, true);
    updateSaved(); syncKind();
  }
  /** what the home page offers to continue: the subject, title and question count of the worksheet in progress */
  function writeLast(nq, touched) {
    const old = LS.get('stb.last', null) || {}, same = old.subject === window.SUBJECT_ID;
    if (!A.picked.length) { if (same) LS.set('stb.last', null); return; }
    LS.set('stb.last', { subject: window.SUBJECT_ID, name: A.SUBJECT.name, title: $('oTitle').value, n: nq != null ? nq : (same && old.n) || A.picked.filter(id => A.byId[id]).length, when: touched || !same || !old.when ? Date.now() : old.when });
  }
  function undo() { if (!undoStack.length) return; redoStack.push(cur); const s = undoStack.pop(); restoring = true; A.setState(s); restoring = false; updateSaved(); }
  function redo() { if (!redoStack.length) return; undoStack.push(cur); const s = redoStack.pop(); restoring = true; A.setState(s); restoring = false; updateSaved(); }
  function onSaved(r) { markClean(); if (r && r.shared && window.WRITER) WRITER.shareUsed(); if (A.SHARED) loadUsage(); if (pending) { const f = pending; pending = null; f(); } }
  function onLoaded(d) { undoStack = []; redoStack = []; cur = A.state; lastS = ssig(); markClean(d && d.saved ? new Date(d.saved).getTime() || Date.now() : Date.now()); syncKind(); if (A.SHARED) loadUsage(); }

  /** run fn now, or after asking what to do with unsaved changes */
  function guard(fn) {
    if (!dirty || !A.picked.length) { fn(); return; }
    const d = $('uiUnsaved'); $('uiUnsavedMsg').textContent = `"${$('oTitle').value || 'This worksheet'}" has changes that are not saved.`;
    d.hidden = false;
    $('uiUnsavedSave').onclick = () => { d.hidden = true; pending = fn; if (A.SHARED) $('btnSave').click(); else A.exportFile(); };
    $('uiUnsavedDrop').onclick = () => { d.hidden = true; fn(); };
    $('uiUnsavedCancel').onclick = () => { d.hidden = true; };
  }
  function clearNow(kind) {
    A.setCurrent(null);
    if (kind) { $('oTitle').value = A.SUBJECT.defaultTitle || 'Review'; setKind(kind, false); A.setOpt('oUnitTag', ''); A.setOpt('oStart', 1); if (PREFS.defaults && PREFS.defaults[kind]) applyDefaults(kind, true); }
    A.setState({ picked: [], extras: {}, dropped: {} });
    undoStack = []; redoStack = []; cur = A.state; lastS = ssig(); dirty = false; savedAt = 0; LS.set(A.SK + 'dirty', false); LS.set(A.SK + 'savedAt', 0); lastSig = sig(); updateSaved();
  }

  // ------------------------------------------------------------------------------------------------ worksheet type and defaults
  function syncKind() { const c = $('uiType'); if (c) c.textContent = KIND[A.opt('oKind')] || 'Worksheet'; const b = $('uiDefault'); if (b && !b.dataset.flash) b.textContent = `Save as my default for ${KINDS[A.opt('oKind')] || 'worksheets'}`; }
  function applyDefaults(kind, quiet) {
    const d = PREFS.defaults && PREFS.defaults[kind]; if (!d) return;
    Object.entries(d).forEach(([id, v]) => { if ($(id)) A.setOpt(id, v); });
    if (!quiet) { A.persist(); A.renderSheet(); }
  }
  function setKind(kind, ask) {
    if (A.opt('oKind') === kind) return;
    A.setOpt('oKind', kind); syncKind(); A.persist();
    if (ask && PREFS.defaults && PREFS.defaults[kind] && confirm(`Apply your ${KIND[kind].toLowerCase()} defaults to this worksheet?`)) applyDefaults(kind);
  }
  function saveDefault() {
    const kind = A.opt('oKind'), o = A.getOpts(); ['oKind', 'oUnitTag', 'oStart'].forEach(k => delete o[k]);
    PREFS.defaults = PREFS.defaults || {}; PREFS.defaults[kind] = o; savePrefs();
    const b = $('uiDefault'); b.dataset.flash = '1'; b.textContent = `Saved. New ${KINDS[kind]} start with these settings.`;
    setTimeout(() => { delete b.dataset.flash; syncKind(); }, 2600);
  }

  // ------------------------------------------------------------------------------------------------ top bar
  function buildHeader() {
    const header = document.querySelector('header');
    ['btnNew', 'btnSave', 'btnLoad', 'btnClear', 'btnWord', 'btnPDF', 'bankinfo', 'whoami'].forEach(id => { if ($(id)) $(id).classList.add('legacy'); });
    const sp = header.querySelector('.spacer'); if (sp) sp.classList.add('legacy');
    header.querySelector('h1').textContent = A.SUBJECT.name;
    const title = $('oTitle'); const oldLabel = title.closest('label');
    title.classList.add('intitle'); title.title = 'Worksheet title: printed at the top of the page and used for the file names';
    const chip = el('button', { id: 'uiType', class: 'uichip', title: 'What this is. It decides which of your default settings apply and how it is filed when saved.' });
    chip.onclick = () => showMenu(chip, Object.keys(KIND).map(k => ({ label: KIND[k] + (A.opt('oKind') === k ? '  ✓' : ''), on: () => setKind(k, true) })));
    const saved = el('span', { id: 'uiSaved' }), counts = el('span', { id: 'uiCounts' });
    const file = el('button', { id: 'uiFile', class: 'ghost' }, 'File ▾'), exp = el('button', { id: 'uiExport' }, '<b>Export ▾</b>');
    const print = $('btnPrint'); print.classList.add('ghost');
    const dk = el('button', { id: 'uiDark', title: PREFS.dark ? 'Switch to light mode' : 'Switch to dark mode' }, darkIcon()); dk.onclick = toggleDark;
    header.append(title, chip, saved, counts, dk, file, print, exp);
    if (oldLabel) oldLabel.classList.add('legacy');
    ['oKind', 'oUnitTag'].forEach(id => { const l = $(id).closest('label'); if (l) l.classList.add('legacy'); });
    file.onclick = () => showMenu(file, [
      { label: 'New…', on: () => guard(() => { $('uiNew').hidden = false; }) },
      { label: 'Open…', on: () => guard(() => $('btnLoad').click()) },
      { label: 'Save…', kbd: 'Ctrl+S', on: () => $('btnSave').click(), disabled: !A.picked.length },
      { label: 'Clear worksheet', on: () => guard(() => clearNow(null)), disabled: !A.picked.length },
      { sep: 1 },
      { label: 'Undo', kbd: 'Ctrl+Z', on: undo, disabled: !undoStack.length },
      { label: 'Redo', kbd: 'Ctrl+Y', on: redo, disabled: !redoStack.length },
      { label: 'My questions…', on: () => { if (window.WRITER) WRITER.open(); else $('btnNew').click(); } },
      { sep: 1 },
      { label: 'Guided tours…', on: () => setTimeout(() => showMenu(file, TOUR_ORDER.map(k => ({ label: TOURS[k].name + (PREFS.toured && PREFS.toured[k] ? '  ✓' : ''), on: () => startTour(k) })).concat([{ foot: 'Each tour takes a minute or two and gives your worksheet back when it ends.' }])), 0) },
      { label: 'Report a problem…', on: openReport },
      A.SHARED ? { label: 'Download problem reports', on: downloadReports } : null,
      { foot: A.SHARED ? (A.me && A.me.email ? 'Signed in as ' + A.me.email : 'Signed in') : 'Not signed in: worksheets save as files on this computer.' },
    ]);
    exp.onclick = () => showMenu(exp, [
      { label: 'PDF files', on: () => $('btnPDF').click(), disabled: !A.picked.length },
      { label: 'Word files', on: () => $('btnWord').click(), disabled: !A.picked.length },
      { foot: 'The key, versions, answer sheet and reference sheet follow Worksheet settings.' },
    ]);
    const badge = header.querySelector('.badge');                 // going home asks about unsaved changes first
    if (badge && badge.onclick) { const go = badge.onclick; badge.onclick = () => guard(() => go.call(badge)); }
    syncKind();
  }
  function onSheet(M) {
    if (!A) return;
    const c = $('uiCounts'); if (!c) return;
    if (!M) { c.textContent = ''; }
    else {
      const credits = M.order.reduce((s, x) => s + (x.cr ? (Number(x.credit) || 1) : 1), 0), v = A.opt('oVersion');
      c.textContent = `${plural(M.nq, 'question')} · ${plural(credits, 'credit')} · ${plural(M.pages.length, 'page')}` + (v === 'single' ? '' : v === 'decoy' ? ' · forms A and B' : ' · versions A and B');
    }
    if ($('uiOutline') && !$('uiOutline').hidden) renderOutline();
    lastM = M || null; if (M) writeLast(M.nq, false);
    updateSaved();
  }

  // ------------------------------------------------------------------------------------------------ sidebar
  let USAGE = null;                                // question id -> { y: [...], o: [...], d: [...] } sheet labels (this school year / earlier / colleagues)
  const MORE = ['fKind', 'fExam', 'fFig', 'fRef'];
  function buildSidebar() {
    $('swOld').innerHTML = `Old Regents <span class="n">${(A.Q.length + A.C.length).toLocaleString()}</span>`;
    $('swNew').innerHTML = `New clusters <span class="n">${A.NC.length.toLocaleString()}</span>`;
    const f = $('filters'), more = el('div', { id: 'uiMore' }), bar = el('div', { id: 'uiMoreRow' }, '<button id="uiMoreBtn" class="small"></button><span id="uiChips" style="display:contents"></span>');
    MORE.forEach(id => { const row = $(id) && $(id).parentElement; if (row && row.style.display !== 'none') more.append(row); });
    f.append(bar, more);
    const setOpen = open => { more.hidden = !open; $('uiMoreBtn').textContent = open ? 'Fewer filters ▴' : 'More filters ▾'; LS.set('stb.moreOpen', open); };
    $('uiMoreBtn').onclick = () => setOpen(more.hidden);
    setOpen(!!LS.get('stb.moreOpen', false));
    f.addEventListener('input', chips); f.addEventListener('change', chips);
    buildNewFilters();
    // hide dropdown and the card / list switch
    const lab = $('hidePicked').closest('label'); if (lab) lab.classList.add('legacy');
    const sel = el('select', { id: 'uiHide', title: 'Hide questions you do not want to see in the list' }, '<option value="">Show all</option><option value="picked">Hide ones on this worksheet</option>');
    sel.onchange = () => { $('hidePicked').checked = sel.value === 'picked'; A.renderList(); };
    const tog = el('span', { class: 'viewtog' }, '<button data-v="cards" title="Cards: each question as it prints">▦</button><button data-v="list" title="List: one line per question">☰</button>');
    const setView = v => { $('list').classList.toggle('listview', v === 'list'); tog.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); LS.set('stb.view', v); onList(); };
    tog.querySelectorAll('button').forEach(b => { b.onclick = () => setView(b.dataset.v); });
    $('count').append(sel, tog);
    setView(LS.get('stb.view', 'cards'));
    chips();
  }
  /** New clusters tab: Exam and Standard sit behind their own "More filters" */
  const PE_DOMAIN = { PS1: 'Matter and its interactions', PS2: 'Forces and interactions', PS3: 'Energy', PS4: 'Waves', LS1: 'From molecules to organisms', LS2: 'Ecosystems', LS3: 'Heredity', LS4: 'Biological evolution',
                      ESS1: "Earth's place in the universe", ESS2: "Earth's systems", ESS3: 'Earth and human activity', ETS1: 'Engineering design' };
  function buildNewFilters() {
    const f = $('nfilters'); if (!f || !$('nExam')) return;
    const n = {}; A.NC.forEach(c => c.questions.forEach(q => (q.pe || []).forEach(p => { n[p] = (n[p] || 0) + 1; })));
    const codes = Object.keys(n).sort((a, b) => a.replace(/\d+/g, d => d.padStart(3, '0')) < b.replace(/\d+/g, d => d.padStart(3, '0')) ? -1 : 1), groups = {};
    codes.forEach(p => { const d = (p.match(/^HS-([A-Z]+\d)/) || [])[1] || 'Other'; (groups[d] = groups[d] || []).push(p); });
    const more = el('div', { id: 'uiMoreN', style: 'grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px' });
    more.append($('nExam').parentElement);
    if (codes.length) more.append(el('div', null, '<label style="font-size:11px;color:var(--soft);display:block;margin-bottom:3px">Standard</label><select id="nPE" style="width:100%" title="Performance expectation, from the map at the end of each rating guide"><option value="">Any standard</option>' +
      Object.keys(groups).map(d => `<optgroup label="${esc(d + (PE_DOMAIN[d] ? ': ' + PE_DOMAIN[d] : ''))}">${groups[d].map(p => `<option value="${p}">${p} (${n[p]})</option>`).join('')}</optgroup>`).join('') + '</select>'));
    const bar = el('div', { id: 'uiMoreRowN', style: 'grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;color:var(--soft)' }, '<button id="uiMoreBtnN" class="small" style="padding:2px 10px;font-size:12px"></button><span id="uiChipsN" style="display:contents"></span>');
    f.append(bar, more);
    const setOpen = open => { more.style.display = open ? 'grid' : 'none'; $('uiMoreBtnN').textContent = open ? 'Fewer filters ▴' : 'More filters ▾'; LS.set('stb.moreOpenN', open); };
    $('uiMoreBtnN').onclick = () => setOpen(more.style.display === 'none');
    setOpen(!!LS.get('stb.moreOpenN', false));
    const fire = e => e.dispatchEvent(new Event('input', { bubbles: true }));
    const chipsN = () => { const act = ['nExam', 'nPE'].map(id => $(id)).filter(x => x && x.value);
      $('uiChipsN').innerHTML = act.map(x => `<span class="fchip" data-f="${x.id}" title="Remove this filter">${esc(x.options[x.selectedIndex].text)} ✕</span>`).join('');
      $('uiChipsN').querySelectorAll('.fchip').forEach(c => { c.onclick = () => { const x = $(c.dataset.f); x.value = ''; fire(x); }; }); };
    if ($('nPE')) $('nPE').addEventListener('input', () => A.renderList());
    f.addEventListener('input', chipsN); chipsN();
  }
  function chips() {
    const box = $('uiChips'); if (!box) return;
    const act = MORE.map(id => $(id)).filter(s => s && s.value && s.parentElement.style.display !== 'none');
    box.innerHTML = act.map(s => `<span class="fchip" data-f="${s.id}" title="Remove this filter">${esc(s.options[s.selectedIndex].text)} ✕</span>`).join('') +
      (act.length || $('fUnit').value || $('fType').value || $('fSearch').value ? '<span id="uiClearF">Clear filters</span>' : '');
    const fire = e => e.dispatchEvent(new Event('input', { bubbles: true }));
    box.querySelectorAll('.fchip').forEach(c => { c.onclick = () => { const s = $(c.dataset.f); s.value = ''; fire(s); }; });
    const cl = $('uiClearF'); if (cl) cl.onclick = () => { MORE.concat(['fSearch', 'fType', 'fSub', 'fUnit']).forEach(id => { const s = $(id); if (s && s.value) { s.value = ''; fire(s); } }); };
  }
  function hide(q) {
    if (q.kind === 'ncl') { const pe = $('nPE') && $('nPE').value; if (pe && !q.questions.some(x => (x.pe || []).includes(pe))) return true; }
    const m = $('uiHide') && $('uiHide').value; if (!m || m === 'picked' || !USAGE) return false;
    const u = USAGE[q.id]; if (!u) return false;
    return m === 'year' ? u.y.length > 0 : m === 'mine' ? u.y.length + u.o.length > 0 : u.d.length > 0;
  }
  async function loadUsage() {
    try {
      const rows = await A.call('listUsage'), now = new Date(), start = new Date(now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1, 6, 1).getTime();
      const curId = A.currentWs && A.currentWs.id, U = {};
      rows.forEach(r => { if (r.id === curId) return; const t = new Date(r.saved).getTime(), k = r.mine ? (t >= start ? 'y' : 'o') : 'd';
        const label = `${r.title} (${KIND[r.kind] || 'Worksheet'}, ${new Date(r.saved).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}${r.mine ? '' : ', ' + short(r.owner)})`;
        (r.questions || []).forEach(id => { (U[id] = U[id] || { y: [], o: [], d: [] })[k].push(label); }); });
      USAGE = U;
      const sel = $('uiHide');
      if (sel && sel.options.length < 3) sel.insertAdjacentHTML('beforeend', '<option value="year">Hide ones I used this year</option><option value="mine">Hide ones I have ever used</option><option value="dept">Hide ones in shared sheets</option>');
      onList();
    } catch (e) { /* the marks are a convenience: no usage, no marks */ }
  }
  function onList() {
    if (!A) return;
    const listView = $('list').classList.contains('listview');
    $('list').querySelectorAll('.card[data-id]').forEach(c => {
      const id = c.dataset.id, meta = c.querySelector('.meta'); if (!meta) return;
      const pe = $('nPE') && $('nPE').value, q0 = pe && A.byId[id];
      if (q0 && q0.kind === 'ncl' && !meta.querySelector('.petag')) { const qs = q0.questions.filter(x => (x.pe || []).includes(pe)).map(x => 'Q' + x.q);
        if (qs.length) meta.append(el('span', { class: 'ubadge petag', title: `${pe}: ${plural(qs.length, 'question')} in this cluster` }, esc(qs.join(', ') + ' · ' + pe))); }
      const u = USAGE && USAGE[id];
      if (u && !meta.querySelector('.umark')) {
        const m = el('span', { class: 'umark' },
          (u.y.length ? `<i class="y" title="On a sheet you saved this school year:\n${esc(u.y.join('\n'))}"></i>` : '') +
          (u.o.length ? `<i class="o" title="On a sheet you saved in an earlier year:\n${esc(u.o.join('\n'))}"></i>` : '') +
          (u.d.length ? `<i class="d" title="On a sheet a colleague shared:\n${esc(u.d.join('\n'))}"></i>` : ''));
        meta.insertBefore(m, meta.children[1] || null);
      }
      if (listView && !c.querySelector('.snip')) { const q = A.byId[id]; if (q) meta.insertAdjacentElement('afterend', el('div', { class: 'snip' }, esc(((q.kind === 'ncl' ? '' : '') + (q.text || q.stem || q.title || '')).replace(/\s+/g, ' ').slice(0, 160)))); }
    });
  }

  // ------------------------------------------------------------------------------------------------ toolbar: undo, reorder
  function buildToolbar() {
    const set = $('btnSettings'), st = $('status'); if (st) st.classList.add('legacy');
    const pdf = $('insPDF'), ref = $('insRef'), refOff = ref && ref.style.display === 'none';
    pdf.classList.add('legacy'); if (ref) ref.classList.add('legacy');
    const other = el('button', { class: 'small', id: 'uiInsOther', title: 'A page from your own PDF, a reference table, or a block of text' }, 'Other ▾');
    $('insPage').insertAdjacentElement('afterend', other);
    other.onclick = () => showMenu(other, [
      { label: 'Text block…', on: () => openText(null) },
      { label: 'PDF page…', on: () => pdf.click() },
      refOff || !ref ? null : { label: 'Reference table…', on: () => ref.click() },
      { foot: 'Each is added at the end of the worksheet. Move it like a question.' },
    ]);
    const u = el('button', { class: 'small', id: 'uiUndo', title: 'Undo the last change to the worksheet (Ctrl+Z)' }, 'Undo');
    const o = el('button', { class: 'small', id: 'uiOutlineBtn', title: 'See the worksheet as a list and drag questions into a new order' }, 'Reorder…');
    set.parentElement.insertBefore(u, set); set.parentElement.insertBefore(o, set);
    u.onclick = undo; o.onclick = () => { renderOutline(); $('uiOutline').hidden = false; };
  }
  function outlineLabel(id) {
    const x = A.state.extras[id];
    if (x && x.kind === 'text') return { extra: true, text: 'Text: ' + String(x.text || '').replace(/\s+/g, ' ').slice(0, 80) };
    if (x) return { extra: true, text: x.kind === 'brk' ? (x.type === 'page' ? 'Page break' : 'Column break') : x.kind === 'pdf' ? `PDF page: ${x.name || ''} p.${x.page || 1}` : x.kind === 'reftab' ? `Reference table: ${x.title || ''}` : x.kind };
    const q = A.byId[id]; if (!q) return { text: id };
    if (q.kind === 'cluster') { const n = q.items.length - ((A.state.dropped[id] || []).length); return { text: `¶ ${q.session} ${q.year} Q${q.group[0]}${q.group[1] !== q.group[0] ? '–' + q.group[1] : ''} · ${plural(n, 'question')}` + (q.text ? ' · ' + q.text.replace(/\s+/g, ' ').slice(0, 70) : '') }; }
    if (q.kind === 'ncl') return { text: `▣ ${q.sample ? 'Sample' : q.session + ' ' + q.year} · ${q.title || ''} · ${plural(q.questions.length, 'question')}` };
    if (q.kind === 'custom') return { text: `✎ ${String(q.stem || '').slice(0, 90)}` };
    return { text: `${q.session} ${q.year} Q${q.q} · ${(A.T[q.type] || {}).name || ''} · ${String(q.text || '').replace(/\s+/g, ' ').slice(0, 60)}` };
  }
  function renderOutline() {
    const box = $('uiOutlineList'), ids = A.picked.slice();
    box.innerHTML = ids.length ? ids.map((id, i) => { const l = outlineLabel(id); return `<div class="orow${l.extra ? ' extra' : ''}" draggable="true" data-i="${i}"><span class="h">⋮⋮</span><span class="t">${esc(l.text)}</span><button data-rm="${i}" title="Take off the worksheet">✕</button></div>`; }).join('')
      : '<div class="orow" style="cursor:default">Nothing on the worksheet yet.</div>';
    let from = null;
    const move = (a, b) => { if (a === b || a == null) return; const s = A.state, p = s.picked.slice(), [x] = p.splice(a, 1); p.splice(a < b ? b - 1 : b, 0, x); A.setState({ picked: p, extras: s.extras, dropped: s.dropped }); };
    box.querySelectorAll('.orow[draggable]').forEach(r => {
      r.ondragstart = e => { from = Number(r.dataset.i); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(from)); } catch (x) { } };
      r.ondragover = e => { e.preventDefault(); r.classList.add('over'); };
      r.ondragleave = () => r.classList.remove('over');
      r.ondrop = e => { e.preventDefault(); r.classList.remove('over'); move(from, Number(r.dataset.i)); };
    });
    box.querySelectorAll('button[data-rm]').forEach(b => { b.onclick = () => { const s = A.state, i = Number(b.dataset.rm), id = s.picked[i]; s.picked.splice(i, 1); delete s.extras[id]; delete s.dropped[id]; A.setState(s); }; });
  }

  // ------------------------------------------------------------------------------------------------ worksheet settings: tabs
  function buildSettings() {
    const dlg = $('settings').querySelector('.dialog'); dlg.classList.remove('narrow');
    const rowOf = id => { const e = $(id); return e ? e.closest('.row') : null; };
    const PANES = [['Layout', ['oLayout', 'oSize', 'oFill', 'oBlank', 'oStart']], ['Header', ['oBlanks', 'oBlDate', 'oBlPeriod', 'oTeacher', 'oNote']], ['Reference tables', ['oRefTables', 'oRefConst', 'oRefBlock']],
                   ['Answer key', ['oKey', 'oCRKey', 'oSrc', 'oStdSum', 'oAnsSheet']], ['Versions', ['oVersion']]];
    const wrap = el('div', { class: 'stabs' }), nav = el('nav'), body = el('div'); const tabs = [];
    PANES.forEach(([name, ids]) => {
      const pane = el('div', { class: 'pane' });
      ids.forEach(id => { const r = rowOf(id); if (r && r.style.display !== 'none') pane.append(r); });
      if (!pane.children.length) return;
      if (name === 'Versions' && $('versionHint')) pane.append($('versionHint'));
      const b = el('button', null, name); nav.append(b); body.append(pane); tabs.push([b, pane]);
      b.onclick = () => tabs.forEach(([bb, pp]) => { bb.classList.toggle('on', bb === b); pp.hidden = pp !== pane; });
    });
    dlg.querySelectorAll('h3').forEach(h => h.remove());
    const sr = $('subjectRow'); if (sr) sr.remove();
    wrap.append(nav, body); dlg.insertBefore(wrap, dlg.querySelector('.actions'));
    if (tabs.length) tabs[0][0].onclick();
    // shorter labels; the long explanations move to the tooltips
    const relabel = (id, text) => { const l = dlg.querySelector(`label[for="${id}"]`); if (l) { l.title = l.textContent; l.textContent = text; } };
    const first = (id, text) => { const r = rowOf(id); if (!r) return; const l = r.querySelector('label:not([for])'); if (l) l.textContent = text; else r.prepend(el('label', null, text)); };
    first('oLayout', 'Columns'); first('oSize', 'Text size'); first('oVersion', 'Versions');
    relabel('oFill', 'Fill columns evenly'); relabel('oBlank', 'Answer blank before each multiple-choice number');
    relabel('oNote', 'Reference tables note under the title'); relabel('oCRKey', 'Scoring pages for constructed response');
    relabel('oRefBlock', 'List of needed reference tables on the key'); relabel('oSrc', 'Source exam of each question on the key'); relabel('oAnsSheet', 'Student answer sheet (extra PDF)'); relabel('oStdSum', 'Standards summary on the key');
    const ot = (id, map) => { const s = $(id); if (s) [...s.options].forEach(o => { if (map[o.value]) { o.title = o.text; o.text = map[o.value]; } }); };
    ot('oLayout', { default: 'Two columns', wide: 'One column' });
    ot('oSize', { normal: '11.5 pt (as printed)', large: '14 pt', enlarged: 'Large print' });
    ot('oVersion', { single: 'One version', decoy: 'One version printed as Form A and Form B', ab: 'Two versions, labeled Form A and Form B', abnolabel: 'Two versions, no label' });
    const sizeRow = rowOf('oSize'), hint = el('div', { class: 'hint', id: 'uiSizeHint', style: 'margin:-2px 0 6px 158px' }, 'Large print changes the format a lot: 16 pt text on landscape pages, laid out like the Regents large-type edition. Expect many more pages.');
    if (sizeRow) { sizeRow.insertAdjacentElement('afterend', hint); const show = () => { hint.hidden = $('oSize').value !== 'enlarged'; }; $('oSize').addEventListener('input', show); $('btnSettings').addEventListener('click', show); show(); }
    // the teacher's name: remembered per teacher (not saved inside a worksheet), first filled from the sign-in
    const tn = $('oTeacherName');
    if (tn) {
      tn.value = PREFS.teacher || '';
      tn.addEventListener('input', () => { PREFS.teacher = tn.value.trim(); savePrefs(); if ($('oTeacher').checked) A.renderSheet(); });
      $('oTeacher').addEventListener('input', () => { if ($('oTeacher').checked && !tn.value) tn.focus(); });
    }
    const def = el('button', { class: 'small', id: 'uiDefault', title: 'New sheets of this type will start with the settings shown here' });
    def.onclick = saveDefault; dlg.querySelector('.actions').prepend(def);
    $('btnSettings').addEventListener('click', syncKind);
  }

  // ------------------------------------------------------------------------------------------------ Open dialog: Mine / Department
  let libTab = 'mine';
  const isMine = r => r.mine !== undefined ? !!r.mine : !!(A.me && r.owner === A.me.email);
  const libFilter = r => (libTab === 'mine') === isMine(r);
  function buildLibrary() {
    const dlg = $('lib').querySelector('.dialog'), hint = $('libHint');
    const tabs = el('div', { class: 'libtabs' }, '<button data-t="mine">Mine</button><button data-t="dept">Department</button>');
    dlg.insertBefore(tabs, hint);
    const set = t => { libTab = t; tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
      hint.textContent = t === 'mine' ? 'Worksheets you saved. Only you see them unless you ticked "Share with the department".' : 'Worksheets colleagues shared. Opening one starts your own copy; theirs is never changed.';
      $('lfOwner').style.display = t === 'mine' ? 'none' : ''; $('lfOwner').value = '';
      $('lfSearch').dispatchEvent(new Event('input', { bubbles: true })); };
    tabs.querySelectorAll('button').forEach(b => { b.onclick = () => set(b.dataset.t); });
    $('btnLoad').addEventListener('click', () => set('mine'));
    // Save dialog: the unit starts on the one most of the questions come from
    $('btnSave').addEventListener('click', () => { if (!$('savedlg').hidden && !$('svUnit').value) { const u = suggestUnit(); if (u != null && [...$('svUnit').options].some(o => o.value === String(u))) $('svUnit').value = String(u); } });
    $('svCancel').addEventListener('click', () => { pending = null; });
  }
  function suggestUnit() {
    const n = {}; const add = u => { if (u != null && u !== '') n[u] = (n[u] || 0) + 1; };
    A.picked.forEach(id => { const q = A.byId[id]; if (!q) return; if (q.kind === 'cluster') q.items.forEach(it => add(it.unit)); else if (q.kind === 'ncl') q.questions.forEach(x => add(x.unit)); else add(q.unit); });
    const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0]; return best ? best[0] : null;
  }

  // ------------------------------------------------------------------------------------------------ dialogs built here
  const REASONS = ['Wrong answer or key', 'Picture cut off or missing', 'Typo or garbled text', 'Wrong question type or unit', 'Reference table note is wrong', 'Other'];
  function buildDialogs() {
    const add = html => document.body.insertAdjacentHTML('beforeend', html);
    add(`<div id="uiUnsaved" class="modal" hidden><div class="dialog narrow"><h2>Save your changes?</h2><div id="uiUnsavedMsg"></div>
      <div class="actions"><span class="spacer"></span><button id="uiUnsavedCancel">Cancel</button><button id="uiUnsavedDrop">Don't save</button><button id="uiUnsavedSave" class="primary">Save</button></div></div></div>`);
    add(`<div id="uiNew" class="modal" hidden><div class="dialog narrow"><h2>What are you making?</h2><div class="hint">It starts with your default settings for that type. You can change the type later from the label beside the title.</div>
      <div class="kindgrid">${Object.keys(KIND).map(k => `<button data-k="${k}">${KIND[k]}</button>`).join('')}</div>
      <div class="actions"><span class="spacer"></span><button id="uiNewCancel">Cancel</button></div></div></div>`);
    add(`<div id="uiOutline" class="modal" hidden><div class="dialog narrow"><h2>Reorder the worksheet</h2><div class="hint">Drag a line to move it. Numbers on the page follow the new order.</div>
      <div class="olist" id="uiOutlineList"></div><div class="actions"><button id="uiOutlineUndo" class="small">Undo</button><span class="spacer"></span><button id="uiOutlineClose" class="primary">Done</button></div></div></div>`);
    add(`<div id="uiReport" class="modal" hidden><div class="dialog narrow"><h2>Report a problem</h2>
      <div class="row"><input type="radio" name="uiRpAbout" id="uiRpG"><label for="uiRpG">A general problem with the app</label></div>
      <div class="row"><input type="radio" name="uiRpAbout" id="uiRpQ"><label for="uiRpQ">A question on this worksheet</label></div>
      <div class="row" id="uiRpSelRow"><select id="uiRpSel" style="flex:1;min-width:0" title="The questions on the worksheet, the most recently added first"></select></div>
      <div class="hint" id="uiRpNone" hidden>To report a question, put it on the worksheet first, then come back here.</div>
      <div class="rpwhat" id="uiRpWhat" style="margin-top:8px"></div>
      <div id="uiRpReasons">${REASONS.map((r, i) => `<div class="row"><input type="checkbox" id="uiRp${i}" value="${esc(r)}"><label for="uiRp${i}">${esc(r)}</label></div>`).join('')}</div>
      <textarea id="uiRpNote" rows="4" style="width:100%;margin-top:8px" placeholder="What is wrong, and what should it be?"></textarea>
      <div class="actions"><span class="spacer"></span><button id="uiRpCancel">Cancel</button><button id="uiRpSend" class="primary">Send report</button></div></div></div>`);
    add(`<div id="uiText" class="modal" hidden><div class="dialog narrow"><h2 id="uiTextH">Text block</h2>
      <textarea id="uiTextBody" rows="5" style="width:100%" placeholder="Directions, a section heading, a word bank…"></textarea>
      <div class="row"><label style="width:60px">Style</label><select id="uiTextStyle"><option value="plain">Plain text</option><option value="bold">Bold</option><option value="heading">Heading (bold, centered)</option></select></div>
      <div class="row"><label style="width:60px">Width</label><label><input type="radio" name="uiTextW" id="uiTextWide"> Across the page</label><label style="margin-left:14px"><input type="radio" name="uiTextW" id="uiTextCol"> One column</label></div>
      <div class="hint">Each line you type is its own line on the page. A new block goes at the end of the worksheet; move it like a question.</div>
      <div class="actions"><span class="spacer"></span><button id="uiTextCancel">Cancel</button><button id="uiTextOk" class="primary">Insert</button></div></div></div>`);
    $('uiTextCancel').onclick = () => { $('uiText').hidden = true; };
    ['uiUnsaved', 'uiNew', 'uiOutline', 'uiReport', 'uiText'].forEach(id => $(id).addEventListener('click', e => { if (e.target === $(id)) $(id).hidden = true; }));
    $('uiNewCancel').onclick = () => { $('uiNew').hidden = true; };
    $('uiNew').querySelectorAll('button[data-k]').forEach(b => { b.onclick = () => { $('uiNew').hidden = true; clearNow(b.dataset.k); }; });
    $('uiOutlineClose').onclick = () => { $('uiOutline').hidden = true; };
    $('uiOutlineUndo').onclick = undo;
    $('uiRpCancel').onclick = () => { $('uiReport').hidden = true; };
  }

  // ------------------------------------------------------------------------------------------------ text blocks
  /** id null: a new block at the end of the worksheet; otherwise edit that block in place */
  function openText(id) {
    const x = id ? A.state.extras[id] : null;
    $('uiTextH').textContent = x ? 'Edit the text block' : 'Text block'; $('uiTextOk').textContent = x ? 'Save' : 'Insert';
    $('uiTextBody').value = x ? x.text || '' : ''; $('uiTextStyle').value = x ? x.style || 'plain' : 'plain';
    $('uiTextCol').checked = !!x && x.width === 'column'; $('uiTextWide').checked = !$('uiTextCol').checked;
    $('uiText').hidden = false; $('uiTextBody').focus();
    $('uiTextOk').onclick = () => {
      const text = $('uiTextBody').value.replace(/\s+$/, ''); if (!text.trim()) { alert('Type some text first.'); return; }
      const rec = { kind: 'text', text, style: $('uiTextStyle').value, width: $('uiTextCol').checked ? 'column' : 'wide' }, st = A.state;
      const key = id || ('text_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      st.extras[key] = rec; if (!id) st.picked.push(key);
      $('uiText').hidden = true; A.setState(st);
    };
  }
  const editText = id => openText(id);

  // ------------------------------------------------------------------------------------------------ earlier versions of a saved worksheet
  async function versions(id, anchor) {
    try {
      const rows = await A.call('listVersions', id);
      if (!rows.length) { alert('No earlier versions were found.'); return; }
      showMenu(anchor, rows.map((v, k) => ({ label: `${new Date(v.saved).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${plural(v.nq, 'item')}${k === 0 ? ' · newest' : ''}`,
        on: async () => { try { const d = await A.call('loadWorksheet', id, v.saved); A.applyLoaded(d); A.setCurrent({ id: d.id, title: d.title, shared: !!d.shared }); $('lib').hidden = true; onLoaded(d); if (k) { dirty = true; LS.set(A.SK + 'dirty', true); updateSaved(); } }
          catch (e) { alert('Could not open that version: ' + e.message); } } })).concat([{ foot: 'An older version becomes the newest only when you save it.' }]));
    } catch (e) { alert('Could not read the history: ' + e.message); }
  }

  // ------------------------------------------------------------------------------------------------ problem reports
  const reportText = r => `[${r.subject}] ${r.question}${r.exam ? ' · ' + r.exam + (r.q ? ' Q' + r.q : '') : ''}${r.type ? ' · type ' + r.type : ''}${r.unit !== '' && r.unit != null ? ' · unit ' + r.unit : ''}\n` +
    `Reported by ${short(r.by) || 'a teacher'}, ${String(r.saved || '').slice(0, 10)} · ${r.reasons || 'no reason ticked'}\n${r.note || '(no note)'}${r.id ? `\n(${r.id}${r.build ? ', build ' + r.build : ''})` : ''}\n`;
  const saveText = (text, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); };
  /** every question on the worksheet with its printed number, the most recently added first */
  function worksheetQuestions() {
    if (!lastM) return [];
    return lastM.order.map(x => {
      const it = x.item || {}; let id = null, qn = null;
      if (it.c) { id = it.c.id; qn = it.qnum; } else if (it.ncl) { id = it.ncl.id; qn = it.b ? it.b.q : null; } else if (it.q) { id = it.q.id; }
      const q = id && A.byId[id]; if (!q) return null;
      const src = it.c ? (q.items || []).find(z => String(z.q) === String(qn)) : it.ncl ? (q.questions || []).find(z => String(z.q) === String(qn)) : q;
      const tn = src && src.type ? ((it.ncl ? A.NT : A.T)[src.type] || {}).name : '';
      const where = q.kind === 'custom' ? 'your own question' : `${q.sample ? 'Sample' : (q.session || '') + ' ' + (q.year || '')} Q${qn != null ? qn : q.q}`;
      return { id, qn, n: x.n, seq: addSeq[id] || 0, label: `#${x.n}${x.nEnd ? '–' + x.nEnd : ''} · ${where}${tn ? ' · ' + tn : ''}` };
    }).filter(Boolean).sort((a, b) => (b.seq - a.seq) || (a.n - b.n));
  }
  /** the record a report carries and the summary shown in the dialog (id null = a general problem) */
  function describe(id, qn) {
    const q = id ? A.byId[id] : null;
    if (!q) return { rec: { subject: window.SUBJECT_ID || '', question: 'general', exam: '', q: '', type: '', unit: '' }, what: 'Something about the app itself: a button, a page, a file that came out wrong.' };
    const item = q.kind === 'cluster' && qn != null ? q.items.find(it => String(it.q) === String(qn)) : q.kind === 'ncl' && qn != null ? q.questions.find(x => String(x.q) === String(qn)) : null;
    const src = item || q, pre = q.kind === 'ncl' ? 'N' : 'T', tn = src.type ? ((q.kind === 'ncl' ? A.NT : A.T)[src.type] || {}).name : '';
    const rec = { subject: window.SUBJECT_ID || '', question: id + (item ? ' Q' + qn : ''), exam: q.exam || '', q: item ? qn : q.q != null ? q.q : q.group ? q.group.join('-') : '',
                  type: src.type ? pre + src.type : '', unit: src.unit != null ? A.uNum(src.unit) : '' };
    const what = `<b>${esc(rec.question)}</b><br>${esc(q.kind === 'custom' ? 'Custom question' : (q.sample ? 'Sample cluster' : (q.session || '') + ' ' + (q.year || '')) + (rec.q !== '' ? ' · question ' + rec.q : ''))}` +
                 `${rec.type ? '<br>Type ' + esc(rec.type) + (tn ? ': ' + esc(tn) : '') : ''}${rec.unit !== '' ? ' · unit ' + esc(rec.unit) : ''}`;
    return { rec, what };
  }
  function openReport() {
    const qs = worksheetQuestions(); let cur = describe(null);
    $('uiRpSel').innerHTML = qs.map((q, i) => `<option value="${i}">${esc(q.label)}</option>`).join('');
    $('uiRpQ').disabled = !qs.length; $('uiRpNone').hidden = !!qs.length;
    $('uiRpQ').checked = !!qs.length; $('uiRpG').checked = !qs.length;
    const sync = () => {
      const isQ = $('uiRpQ').checked && qs.length > 0, pick = isQ ? qs[Number($('uiRpSel').value) || 0] : null;
      $('uiRpSelRow').hidden = !isQ; $('uiRpReasons').hidden = !isQ;
      cur = pick ? describe(pick.id, pick.qn) : describe(null); $('uiRpWhat').innerHTML = cur.what;
      $('uiRpNote').placeholder = isQ ? 'What is wrong, and what should it be?' : 'What happened, and what did you expect?';
    };
    ['uiRpG', 'uiRpQ', 'uiRpSel'].forEach(id => { $(id).onchange = sync; });
    $('uiRpNote').value = ''; REASONS.forEach((r, i) => { $('uiRp' + i).checked = false; });
    sync(); $('uiReport').hidden = false; $('uiRpNote').focus();
    $('uiRpSend').onclick = async () => {
      const rec = Object.assign({}, cur.rec, { reasons: $('uiRpReasons').hidden ? [] : REASONS.filter((r, i) => $('uiRp' + i).checked), note: $('uiRpNote').value.trim(), build: window.BUILD || '' });
      if (!rec.reasons.length && !rec.note) { alert($('uiRpReasons').hidden ? 'Type a note first.' : 'Tick a reason or type a note first.'); return; }
      $('uiReport').hidden = true;
      if (A.SHARED) { try { await A.call('saveReport', rec); A.progress('Report sent. Thank you.'); setTimeout(() => A.progress(null), 2200); } catch (e) { alert('The report could not be sent: ' + e.message); } }
      else { saveText(reportText(Object.assign({}, rec, { reasons: rec.reasons.join('; '), saved: new Date().toISOString(), by: '' })), 'problem report.txt'); alert('This copy is not signed in, so the report was saved as a text file. Send that file to Quinn.'); }
    };
  }
  const report = openReport;                       // kept for the app's hook name
  async function downloadReports() {
    try {
      const rows = await A.call('listReports');
      if (!rows.length) { alert('No open problem reports.'); return; }
      saveText(`Science Test Builder: ${rows.length} open problem report${rows.length === 1 ? '' : 's'}, ${new Date().toISOString().slice(0, 10)}\nType "fixed" in the status column of the reports tab to retire one.\n\n` + rows.map(reportText).join('\n'), `problem-reports-${new Date().toISOString().slice(0, 10)}.txt`);
    } catch (e) { alert('Could not read the reports: ' + e.message); }
  }

  // ------------------------------------------------------------------------------------------------ guided tours
  // A tour: { name, sample: n (start with n sample questions on the worksheet), before(), steps() -> [step] }.
  // A step: { sel: css selector or function returning the element (omit for a centered box), title, text,
  //           do: what to click (shown in bold), done: () => true once the user has done it (the tour then moves on),
  //           enter(): runs when the step opens, leave(): runs when it is left }.
  const TOUR_ORDER = ['basics', 'clusters', 'arrange', 'settings', 'save'];
  const openMore = () => { if ($('uiMore') && $('uiMore').hidden) $('uiMoreBtn').click(); };
  const tabBtn = name => [...document.querySelectorAll('.stabs nav button')].find(b => b.textContent === name);
  const tabOn = name => { const b = tabBtn(name); return !!b && b.classList.contains('on'); };
  const TOURS = {
    basics: {
      name: 'Basics',
      steps: () => [
        { title: 'The basics', text: 'This short tour builds a small worksheet with you. Your own worksheet is put away and comes back the moment the tour ends.' },
        { sel: '#bankswitch', title: 'Two question banks', text: 'Old Regents questions are on the left. New-format clusters, each a reading with its questions, are on the right. This tour stays with the old Regents questions.' },
        { sel: () => $('fUnit').parentElement, title: 'Start with a unit', text: 'Questions are sorted into your course units.', do: 'Choose a unit from this list.', done: () => !!$('fUnit').value },
        { sel: () => $('fType').parentElement, title: 'Narrow to a question type', text: 'Every question has a type, such as one kind of calculation or one kind of graph reading. Pick one to see only those, or leave it on all types.' },
        { sel: '#uiMoreRow', title: 'More filters', text: 'Exam, figure, kind and reference-table filters are tucked in here. Filters you turn on show as small tags you can click to remove.' },
        { sel: () => $('list').querySelector('.card[data-id]:not(.cluster)') || $('list').querySelector('.card'), title: 'Add a question', text: 'Each card shows the question as it will print.', do: 'Click this card to put it on the worksheet.', done: () => A.picked.length > 0 },
        { sel: '#sheetwrap', title: 'Your worksheet', text: 'The question is typeset on the page straight away. Click its card again to take it off, or point at it on the page for the move and remove buttons.' },
        { sel: '#count', title: 'Keep the list short', text: 'This shows how many questions match. The dropdown hides ones already on the worksheet, and the two buttons switch between cards and a one-line list.' },
        { sel: '#uiCounts', title: 'Running totals', text: 'Questions, credits and pages update as you build.' },
        { sel: '#uiExport', title: 'Get the files', text: 'Export makes the PDF or Word files, with the answer key. Quick Print sends the page on screen straight to the printer.' },
        { title: 'That is the basics', text: 'The other tours cover clusters, arranging, settings and export, and saving and sharing. Any tour can be run again from File, Guided tours.' },
      ],
    },
    clusters: {
      name: 'Clusters',
      before() { openMore(); },
      steps: () => [
        { title: 'Clusters', text: 'A cluster is a reading, table or figure together with the questions that go with it. It goes on the worksheet as one piece.' },
        { sel: () => $('fKind').parentElement, title: 'Show only clusters', text: 'The Kind filter, under More filters, narrows the list to one kind of item.', do: 'Choose "Clusters with work space".', done: () => $('fKind').value === 'cr', enter: openMore },
        { sel: () => $('list').querySelector('.card.cluster'), title: 'Open a cluster', text: 'A cluster card shows its passage and each of its questions.', do: 'Click this cluster.', done: () => !$('preview').hidden },
        { sel: () => $('preview').querySelector('.dialog'), title: 'Choose what to keep', text: 'The preview shows the passage and every question. Untick a question to leave it out. The passage and the rest stay together.', do: 'Click Insert.', done: () => A.picked.length > 0 },
        { sel: '#sheetwrap', title: 'On the worksheet', text: 'The passage and its questions print together and are numbered in order. Point at one question on the page and use its ✕ to leave only that one out.' },
        { sel: '#swNew', title: 'New Regents clusters', text: 'New-format clusters have their own list.', do: 'Click New clusters.', done: () => A.bankMode === 'new' },
        { sel: () => $('nMode').parentElement, title: 'The unit rule', text: 'With a unit chosen, "This unit and earlier only" shows the clusters your students can do by that point in the course. One question from a later unit is allowed.' },
        { sel: () => $('list').querySelector('.card.ncl'), title: 'Yellow means one later question', text: 'A yellow card has exactly one question from a later unit, and its preview highlights that question. New clusters always go on the worksheet whole.' },
        { title: 'That is clusters', text: 'Next is arranging: moving questions, breaks and inserts.' },
      ],
    },
    arrange: {
      name: 'Arranging',
      sample: 5,
      steps: () => [
        { title: 'Arranging the worksheet', text: 'Five sample questions are on the worksheet for this tour. Your own worksheet comes back at the end.' },
        { sel: () => $('sheet').querySelector('.item'), title: 'Buttons on each question', text: 'Point at a question on the page. The arrows move it up or down one place, and ✕ takes it off.' },
        { sel: '#uiOutlineBtn', title: 'Reorder as a list', text: 'For bigger moves, the worksheet opens as a list.', do: 'Click Reorder….', done: () => !$('uiOutline').hidden },
        { sel: () => $('uiOutline').querySelector('.dialog'), title: 'Drag to reorder', text: 'Drag a line to a new place. The numbers on the page follow the new order.', do: 'Try a drag, then click Done.', done: () => $('uiOutline').hidden },
        { sel: '#uiUndo', title: 'Undo', text: 'Undo steps back through your changes one at a time. Ctrl+Z does the same, and Redo is in the File menu.' },
        { sel: () => $('insCol').parentElement, title: 'Insert', text: 'Insert adds a column break or a page break. Other holds a text block for directions or a heading, a page from your own PDF, and a reference table. Each lands at the end, and you move it like a question.', do: 'Click Page break.', done: () => A.picked.some(id => A.state.extras[id]) },
        { sel: '#sheetwrap', title: 'Breaks', text: 'A break shows as a dashed marker on screen and does not print. Everything after a page break starts a new page.' },
        { sel: '#uiCounts', title: 'Watch the totals', text: 'Questions, credits and pages update with every change.' },
        { title: 'That is arranging', text: 'Next is settings and export: how the worksheet prints and which files you get.' },
      ],
    },
    settings: {
      name: 'Settings and export',
      sample: 5,
      steps: () => [
        { title: 'Settings and export', text: 'Five sample questions are on the worksheet for this tour. Your own worksheet comes back at the end.' },
        { sel: '#btnSettings', title: 'Worksheet settings', text: 'Everything about how the worksheet prints is in one place.', do: 'Click Worksheet settings….', done: () => !$('settings').hidden },
        { sel: () => document.querySelector('.stabs nav'), title: 'Groups of settings', text: A.SUBJECT.noRef ? 'Layout, header, answer key and versions. The worksheet behind this box updates as you change things.' : 'Layout, header, reference tables, answer key and versions. The worksheet behind this box updates as you change things.', enter: () => { if ($('settings').hidden) $('btnSettings').click(); } },
        { sel: () => $('oSize').closest('.row'), title: 'Text size', text: '14 pt keeps the same layout. Large print is different: it switches to landscape pages laid out like the Regents large-type edition.', enter: () => { const b = tabBtn('Layout'); if (b) b.click(); } },
        { sel: () => tabBtn('Answer key'), title: 'Answer key', text: 'The key, the scoring pages for written questions and a student answer sheet are chosen here.', do: 'Click Answer key.', done: () => tabOn('Answer key') },
        { sel: () => tabBtn('Versions'), title: 'Versions', text: 'A test can print as Form A and Form B, with the answer choices in a different order on B.', do: 'Click Versions.', done: () => tabOn('Versions') },
        { sel: '#uiDefault', title: 'Your defaults', text: 'This saves the settings as your default for this type of sheet. Worksheets, quizzes and tests each keep their own.' },
        { sel: '#sClose', title: 'Close the settings', text: 'Changes apply as you make them, so there is nothing to confirm.', do: 'Click Done.', done: () => $('settings').hidden },
        { sel: '#uiType', title: 'The type label', text: 'This says what you are making. Click it to change the type. You are asked before your defaults for the new type are applied.', enter: () => { $('settings').hidden = true; } },
        { sel: '#uiExport', title: 'Export', text: 'Export makes the files.', do: 'Click Export.', done: () => !!openMenu },
        { sel: () => openMenu || $('uiExport'), title: 'PDF or Word', text: 'Either choice gives you the worksheet and the key, plus any answer sheet or reference sheet you turned on. Word files can be edited afterwards.', leave: closeMenu },
        { sel: '#btnPrint', title: 'Quick Print', text: 'Quick Print sends the page on screen straight to the printer, without the key.' },
        { title: 'That is settings and export', text: 'Next is saving and sharing.' },
      ],
    },
    save: {
      name: 'Saving and sharing',
      sample: 5,
      steps: () => [
        { title: 'Saving and sharing', text: A.SHARED ? 'Saved worksheets are kept in your library so you can reopen, change and reuse them. Five sample questions are on the worksheet for this tour.' : 'This copy is not signed in, so saving works with files. The signed-in version keeps a library and can share with the department.' },
        { sel: '#uiSaved', title: 'Saved or not', text: 'This shows whether the worksheet has changes that are not saved yet.' },
        { sel: '#uiFile', title: 'The File menu', text: 'New, Open and Save are here. Ctrl+S saves too.', do: 'Click File.', done: () => !!openMenu },
        { sel: () => openMenu || $('uiFile'), title: 'New, Open, Save', text: 'New asks what you are making, then starts a clean sheet with your defaults for that type. If the current sheet has unsaved changes, you are asked about them first.', leave: closeMenu },
      ].concat(A.SHARED ? [
        { sel: () => $('savedlg').querySelector('.dialog'), title: 'Saving', text: 'Give it a title and check the type and unit. The unit is filled in from the questions. A saved sheet is private unless you tick "Share with the department".', do: 'Click Cancel to move on.', enter: () => { if ($('savedlg').hidden) $('btnSave').click(); }, done: () => $('savedlg').hidden, leave: () => { $('savedlg').hidden = true; } },
        { sel: () => $('lib').querySelector('.dialog'), title: 'Opening', text: 'Mine lists your sheets. Department lists what colleagues shared. Opening one of theirs starts your own copy and never changes the original.', do: 'Click Close to move on.', enter: () => { if ($('lib').hidden) $('btnLoad').click(); }, done: () => $('lib').hidden, leave: () => { $('lib').hidden = true; } },
        { sel: '#count', title: 'Used marks', text: 'Once sheets are saved, cards carry small marks: a filled dot for a question you used this school year, a hollow dot for an earlier year, and a blue square for one on a colleague\'s shared sheet. The dropdown here can hide any of them.' },
      ] : [
        { sel: '#uiFile', title: 'Files on this copy', text: 'Save downloads the worksheet as a small file. Open reads that file back in, on this or any other computer.' },
      ]).concat([
        { sel: () => document.querySelector('header .badge'), title: 'Leaving', text: 'The OP button goes back to the subjects. Like New and Clear, it asks about unsaved changes first.' },
        { title: 'That is saving and sharing', text: 'That is every tour for now. Any of them can be run again from File, Guided tours.' },
      ]),
    },
  };
  const FILTER_IDS = ['fSearch', 'fUnit', 'fSub', 'fType', 'fKind', 'fExam', 'fFig', 'fRef', 'nSearch', 'nUnit', 'nSub', 'nExam', 'nType', 'nPE', 'uiHide'];
  const setFilter = (id, v) => { const e = $(id); if (!e || v == null || e.value === v) return; e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
  const sampleIds = n => A.Q.filter(q => q.kind !== 'custom' && !q.stimulus).slice().sort((a, b) => a.exam < b.exam ? 1 : a.exam > b.exam ? -1 : a.q - b.q).slice(0, n).map(q => q.id);
  let tour = null;
  function startTour(name) {
    if (name === 'build') name = 'basics';
    const T = TOURS[name]; if (!T || tour) return;
    closeMenu(); document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
    const stash = { state: A.state, title: $('oTitle').value, ws: A.currentWs, dirty, savedAt, bank: A.bankMode, more: $('uiMore') ? !$('uiMore').hidden : false, filters: FILTER_IDS.map(id => $(id) ? $(id).value : null) };
    try { sessionStorage.setItem('stb.tourStash', JSON.stringify({ state: { picked: stash.state.picked, extras: {}, dropped: stash.state.dropped }, title: stash.title, ws: stash.ws })); } catch (e) { }
    if (A.bankMode !== 'old') A.setBank('old');
    FILTER_IDS.forEach(id => setFilter(id, ''));
    A.setCurrent(null); A.setState({ picked: T.sample ? sampleIds(T.sample) : [], extras: {}, dropped: {} });
    if (T.before) T.before();
    const steps = T.steps(), dims = [0, 1, 2, 3].map(() => el('div', { class: 'tourdim' })), ring = el('div', { class: 'tourring' }), box = el('div', { class: 'tourbox' });
    document.body.append(...dims, ring, box);
    const target = st => { if (!st.sel) return null; const t = typeof st.sel === 'function' ? st.sel() : document.querySelector(st.sel); if (!t) return null; const r = t.getBoundingClientRect(); return r.width || r.height ? t : null; };
    const end = then => {
      const st = steps[tour.i]; if (st && st.leave) st.leave();
      clearInterval(tour.timer); [...dims, ring, box].forEach(e => e.remove()); closeMenu(); document.querySelectorAll('.modal').forEach(m => { m.hidden = true; });
      if (A.bankMode !== 'old') A.setBank('old');
      FILTER_IDS.forEach((id, k) => setFilter(id, stash.filters[k]));
      if (stash.bank !== 'old') A.setBank(stash.bank);
      if ($('uiMore') && $('uiMore').hidden === stash.more) $('uiMoreBtn').click();
      A.setState(stash.state); $('oTitle').value = stash.title; A.setCurrent(stash.ws); A.persist();
      undoStack = []; redoStack = []; cur = A.state; lastS = ssig(); dirty = stash.dirty; savedAt = stash.savedAt; LS.set(A.SK + 'dirty', dirty); lastSig = sig(); updateSaved();
      try { sessionStorage.removeItem('stb.tourStash'); } catch (e) { }
      PREFS.toured = PREFS.toured || {}; PREFS.toured[name] = true; savePrefs(); tour = null;
      if (then) setTimeout(() => startTour(then), 250);
    };
    const place = () => {
      const st = steps[tour.i], t = target(st), W = window.innerWidth, H = window.innerHeight;
      if (!t) { dims[0].style.cssText = 'left:0;top:0;width:100%;height:100%'; dims.slice(1).forEach(d => { d.style.cssText = 'display:none'; }); ring.style.display = 'none';
        box.style.left = Math.max(8, (W - box.offsetWidth) / 2) + 'px'; box.style.top = Math.max(8, (H - box.offsetHeight) / 2) + 'px'; return; }
      const r0 = t.getBoundingClientRect(), p = 6, r = { l: Math.max(0, r0.left - p), t: Math.max(0, r0.top - p), r: Math.min(W, r0.right + p), b: Math.min(H, r0.bottom + p) };
      dims[0].style.cssText = `left:0;top:0;width:100%;height:${r.t}px`; dims[1].style.cssText = `left:0;top:${r.b}px;width:100%;height:${Math.max(0, H - r.b)}px`;
      dims[2].style.cssText = `left:0;top:${r.t}px;width:${r.l}px;height:${r.b - r.t}px`; dims[3].style.cssText = `left:${r.r}px;top:${r.t}px;width:${Math.max(0, W - r.r)}px;height:${r.b - r.t}px`;
      ring.style.cssText = `left:${r.l}px;top:${r.t}px;width:${r.r - r.l}px;height:${r.b - r.t}px`;
      const bw = box.offsetWidth, bh = box.offsetHeight; let x, y;
      if (W - r.r >= bw + 16) { x = r.r + 12; y = Math.min(Math.max(8, r.t), H - bh - 8); }               // to the right
      else if (r.l >= bw + 16) { x = r.l - bw - 12; y = Math.min(Math.max(8, r.t), H - bh - 8); }          // to the left
      else if (H - r.b >= bh + 16) { x = Math.min(Math.max(8, r.l), W - bw - 8); y = r.b + 12; }           // below
      else if (r.t >= bh + 16) { x = Math.min(Math.max(8, r.l), W - bw - 8); y = r.t - bh - 12; }          // above
      else { x = W - bw - 16; y = H - bh - 16; }                                                           // a target that fills the screen: bottom right corner
      box.style.left = x + 'px'; box.style.top = y + 'px';
    };
    const go = d => { const st = steps[tour.i]; if (st && st.leave) st.leave(); tour.i = Math.max(0, Math.min(steps.length - 1, tour.i + d)); show(); };
    const show = () => {
      const st = steps[tour.i], n = steps.length, lastStep = tour.i === n - 1, nextName = TOUR_ORDER[TOUR_ORDER.indexOf(name) + 1];
      if (st.enter) st.enter();
      box.innerHTML = `<h4>${esc(st.title)}</h4><div>${esc(st.text)}</div>${st.do ? `<div class="do" style="margin-top:6px">${esc(st.do)}</div>` : ''}` +
        `<div class="nav"><span class="n">${esc(T.name)} · ${tour.i + 1} of ${n}</span>${lastStep ? '' : '<button class="small" data-a="skip">End tour</button>'}${tour.i ? '<button class="small" data-a="back">Back</button>' : ''}` +
        (lastStep ? `<button class="small${nextName ? '' : ' primary'}" data-a="finish">Finish</button>${nextName ? `<button class="small primary" data-a="more">Next tour: ${esc(TOURS[nextName].name)}</button>` : ''}` : '<button class="small primary" data-a="next">Next</button>') + `</div>`;
      box.querySelectorAll('button').forEach(b => { b.onclick = () => { const a = b.dataset.a; if (a === 'skip' || a === 'finish') end(); else if (a === 'more') end(nextName); else go(a === 'back' ? -1 : 1); }; });
      const t = target(st);
      if (t && t.scrollIntoView) { const r = t.getBoundingClientRect(); if (r.top < 0 || r.bottom > window.innerHeight) t.scrollIntoView({ block: 'center' }); }
      tour.wasDone = st.done ? st.done() : false; place();
    };
    tour = { T, i: 0, end, timer: null };
    tour.timer = setInterval(() => { if (!tour) return; const st = steps[tour.i]; place(); if (st.done && !tour.wasDone && st.done()) { tour.wasDone = true; setTimeout(() => { if (tour && steps[tour.i] === st) go(1); }, 400); } }, 250);
    show();
  }
  function restoreTourStash() {                     // the page was closed or reloaded in the middle of a tour
    try { const s = JSON.parse(sessionStorage.getItem('stb.tourStash') || 'null'); if (!s) return; sessionStorage.removeItem('stb.tourStash');
      A.setState(s.state); if (s.title) $('oTitle').value = s.title; A.setCurrent(s.ws || null); A.persist(); } catch (e) { }
  }

  // ------------------------------------------------------------------------------------------------ start
  const lastNameOf = email => { const m = String(email || '').split('@')[0].replace(/[^a-z'-]/gi, ''); return m.length > 2 ? m.charAt(1).toUpperCase() + m.slice(2).toLowerCase() : ''; };
  function fillTeacher() { const tn = $('oTeacherName'); if (!tn || tn.value) return; const n = PREFS.teacher || lastNameOf(A.me && A.me.email); if (n) { tn.value = n; if ($('oTeacher').checked) A.renderSheet(); } }
  function init(app) {
    A = app; applyDark();
    restoreTourStash();
    buildHeader(); buildSidebar(); buildToolbar(); buildSettings(); buildLibrary(); buildDialogs();
    A.picked.forEach(id => { addSeq[id] = 0; });
    cur = A.state; lastS = ssig(); lastSig = sig(); dirty = !!LS.get(A.SK + 'dirty', false) && A.picked.length > 0; savedAt = LS.get(A.SK + 'savedAt', 0) || 0;
    updateSaved(); onList(); setInterval(updateSaved, 60000); writeLast(null, false); if (!A.SHARED) fillTeacher();
    if (window.WRITER) {                              // teacher-written questions and clusters join the bank here
      try { WRITER.init(A); } catch (e) { console.error(e); }
      const gone = A.picked.filter(id => /^cc_/.test(id) && !A.byId[id]);
      if (gone.length) { const st = A.state; st.picked = st.picked.filter(id => !gone.includes(id)); A.setState(st); cur = A.state; lastS = ssig(); lastSig = sig(); }
    }
    document.addEventListener('keydown', e => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable, k = e.key.toLowerCase();
      if (e.key === 'Escape') { closeMenu(); if (tour) tour.end(); }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (k === 's') { e.preventDefault(); if (A.picked.length) $('btnSave').click(); }
      else if (!typing && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (!typing && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    });
    if (A.SHARED) {
      A.call('getPrefs').then(p => { if (p && Object.keys(p).length) { PREFS = Object.assign({}, PREFS, p); LS.set('stb.prefs', PREFS); applyDark(); syncKind(); if ($('uiDark')) $('uiDark').innerHTML = darkIcon(); } fillTeacher(); }).catch(() => { fillTeacher(); });
      loadUsage();
    }
    const qs = location.search || '';
    const tq = LS.get('stb.tour', null) || (qs.match(/[?&]tour=([a-z]+)/) || [])[1];                    // set by the home page, or ?tour=basics in the address
    if (tq) { LS.set('stb.tour', null); setTimeout(() => startTour(tq), 700); }
  }

  document.addEventListener('DOMContentLoaded', applyDark);
  window.APPUI = { init, onList, onChange, onSheet, onSaved, onLoaded, hide, libFilter, report, startTour, editText, versions, worksheetQuestions, get prefs() { return PREFS; } };
})();

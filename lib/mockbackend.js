/* mockbackend.js — a stand-in for the Apps Script backend, for testing the signed-in features on a local copy.
 * Loaded only when the page address has ?mock=1. It keeps everything in this browser's localStorage and seeds a few
 * worksheets (one shared by a colleague, one of yours from last year, one from this year, one private to a colleague
 * that must never show up) so the Mine / Department tabs and the used marks have something to show.
 */
(function () {
  const ME = 'you@opschools.org', DAY = 864e5;
  const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  function api(subject) {
    const K = n => 'mock.' + subject + '.' + n;
    const seed = () => {
      const ids = (window.BANK ? window.BANK.questions : []).map(q => q.id), now = Date.now(), base = { extras: {}, dropped: {}, options: {} };
      const rows = [
        Object.assign({ id: 'ws_seed1', title: 'Shared unit 1 quiz', owner: 'jrusso@opschools.org', saved: new Date(now - 5 * DAY).toISOString(), questions: ids.slice(0, 4), kind: 'quiz', unit: '1', shared: true }, base),
        Object.assign({ id: 'ws_seed2', title: 'Last year review', owner: ME, saved: new Date(now - 400 * DAY).toISOString(), questions: ids.slice(4, 8), kind: 'worksheet', unit: '1', shared: false }, base),
        Object.assign({ id: 'ws_seed3', title: 'This year practice', owner: ME, saved: new Date(now - DAY).toISOString(), questions: ids.slice(8, 11), kind: 'practice', unit: '', shared: false }, base),
        Object.assign({ id: 'ws_seed4', title: 'Private sheet of a colleague', owner: 'mlee@opschools.org', saved: new Date(now - 2 * DAY).toISOString(), questions: ids.slice(11, 14), kind: 'test', unit: '2', shared: false }, base),
      ];
      set(K('ws'), rows); return rows;
    };
    const all = () => get(K('ws'), null) || seed();
    const visible = () => all().filter(r => r.owner === ME || r.shared).map(r => Object.assign({}, r, { mine: r.owner === ME }));
    return {
      whoAmI: () => ({ email: ME, when: new Date().toISOString(), subject: subject }),
      boot: () => ({ me: { email: ME, when: new Date().toISOString(), subject: subject }, prefs: get('mock.prefs', {}), unitMap: get(K('um'), null) }),
      setSubject: s => s, clearSubject: () => '',
      getUnitMap: () => get(K('um'), null),
      saveUnitMap: m => { set(K('um'), m); const h = get(K('umh'), []); h.push({ saved: new Date().toISOString(), by: ME, json: m }); set(K('umh'), h); return true; },
      unitMapInfo: () => { const h = get(K('umh'), []), r = h[h.length - 1]; return { saved: r ? r.saved : '', by: r ? r.by : '', me: ME }; },
      listUnitMaps: () => get(K('umh'), []).map(r => ({ saved: r.saved, by: r.by })).reverse(),
      getUnitMapAt: saved => { const r = get(K('umh'), []).find(x => x.saved === saved); if (!r) throw new Error('That saved order is no longer there.'); return r.json; },
      listVersions: id => get(K('wsh'), []).filter(r => r.id === id && r.owner === ME).map(r => ({ saved: r.saved, title: r.title, nq: r.questions.length })).sort((a, b) => a.saved < b.saved ? 1 : -1),
      listCustom: () => get(K('custom'), []).filter(q => q.owner === ME || q.shared).map(q => Object.assign({}, q, { mine: q.owner === ME })),
      saveCustom: q => { const rows = get(K('custom'), []), id = q.id || 'custom_' + Date.now().toString(36), cur = rows.find(x => x.id === id);
        if (cur && cur.owner !== ME) throw new Error('Only ' + cur.owner + ' can change that question.');
        const row = Object.assign({}, q, { id, owner: ME, shared: !!q.shared, updated: Date.now() }); const i = rows.findIndex(x => x.id === id); if (i >= 0) rows[i] = row; else rows.push(row);
        set(K('custom'), rows); return { id, owner: ME, shared: row.shared }; },
      deleteCustom: id => { set(K('custom'), get(K('custom'), []).filter(x => x.id !== id || x.owner !== ME)); return true; },
      listWorksheets: () => visible().map(r => ({ id: r.id, title: r.title, owner: r.owner, mine: r.mine, shared: !!r.shared, saved: r.saved, nq: r.questions.length, kind: r.kind, unit: r.unit })).sort((a, b) => a.saved < b.saved ? 1 : -1),
      loadWorksheet: (id, saved) => { const r = saved ? get(K('wsh'), []).map(x => Object.assign({}, x, { mine: true })).find(x => x.id === id && x.saved === saved && x.owner === ME) : visible().find(x => x.id === id);
        if (!r) throw new Error('That worksheet is no longer in the library.'); return r; },
      saveWorksheet: rec => {
        const rows = all(), cur = rows.find(x => x.id === rec.id); let id = rec.id;
        if (!id || (cur && cur.owner !== ME)) id = 'ws_' + Date.now().toString(36);
        const row = { id, title: rec.title || 'worksheet', owner: ME, saved: new Date().toISOString(), questions: rec.questions || [], extras: rec.extras || {}, dropped: rec.dropped || {}, options: rec.options || {}, kind: rec.kind || 'worksheet', unit: rec.unit == null ? '' : String(rec.unit), shared: !!rec.shared };
        const i = rows.findIndex(x => x.id === id); if (i >= 0) rows[i] = row; else rows.push(row);
        set(K('ws'), rows); const hist = get(K('wsh'), []); hist.push(row); set(K('wsh'), hist);      // every save is kept, like the rows of the real sheet
        return { id, owner: ME, saved: row.saved, shared: row.shared };
      },
      deleteWorksheet: id => { const rows = all(), cur = rows.find(x => x.id === id); if (cur && cur.owner !== ME) throw new Error('Only ' + cur.owner + ' can remove that worksheet.'); set(K('ws'), rows.filter(x => x.id !== id)); return true; },
      listUsage: () => visible().map(r => ({ id: r.id, title: r.title, owner: r.owner, mine: r.mine, saved: r.saved, kind: r.kind, questions: r.questions.filter(x => !/^(brk|pdf|reftab|text)_/.test(String(x))) })),
      saveReport: rec => { const r = get('mock.reports', []), id = 'rep_' + Date.now().toString(36);
        r.push({ id, saved: new Date().toISOString(), by: ME, subject, question: rec.question || '', exam: rec.exam || '', q: String(rec.q == null ? '' : rec.q), type: String(rec.type || ''), unit: String(rec.unit == null ? '' : rec.unit), reasons: (rec.reasons || []).join('; '), note: rec.note || '', status: '', build: rec.build || '' });
        set('mock.reports', r); return { id }; },
      listReports: () => get('mock.reports', []).filter(r => String(r.status).toLowerCase() !== 'fixed'),
      getPrefs: () => get('mock.prefs', {}), setPrefs: p => { set('mock.prefs', p || {}); return true; },
    };
  }
  const runner = (ok, fail) => ({
    withSuccessHandler(f) { return runner(f, fail); }, withFailureHandler(f) { return runner(ok, f); },
    rpc(name, args, subject) {
      setTimeout(() => { try { const fn = api(subject || 'chemistry')[name]; if (!fn) throw new Error('Unknown call: ' + name);
        const r = fn.apply(null, args || []); if (ok) ok(JSON.parse(JSON.stringify(r === undefined ? null : r))); } catch (e) { if (fail) fail(e); else console.error(e); } }, 60);
    },
  });
  window.google = { script: { run: runner(null, null) } };
  console.log('mock backend active: signed in as ' + ME);
})();

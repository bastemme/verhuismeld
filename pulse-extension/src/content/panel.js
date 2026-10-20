/*
 * Bedieningspaneel op de Pulse-pagina: "Zoek fouten", "Volgende fout", "Stop".
 * Het paneel staat in een gesloten shadow root, zodat het de opmaak van Pulse niet
 * beïnvloedt en zelf niet als tabel wordt herkend.
 */
(function (root) {
  if (root.PulseFinderContent) return;

  const { GridModel, describeEl, visibleText, allElements } = root.PulseGrid;
  const { collectEvidence } = root.PulseClassify;
  const { Finder, clearHighlight } = root.PulseFinder;
  const settings = () => root.PulseScanDefaults.DEFAULT_SETTINGS;

  let ui = null;
  const finder = new Finder((st) => ui && ui.render(st));

  function probe() {
    const grid = new GridModel(settings());
    if (!grid.detect()) return { found: false, reason: grid.failReason, score: 0 };
    const sum = grid.summary();
    return { found: true, score: sum.series.length * 10 + Math.min(sum.rowCountInDom, 500) / 100 + (sum.timeColumn ? 5 : 0), grid: sum };
  }

  // ---------- paneel ----------

  const CSS = `
    :host { all: initial; }
    .box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 320px;
      background: #161c26; color: #e6ebf2; border: 1px solid #2a3445; border-radius: 8px;
      box-shadow: 0 6px 24px rgba(0,0,0,.45); font: 13px/1.4 "Segoe UI", system-ui, sans-serif; }
    .head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #2a3445; cursor: move; user-select: none; }
    .head b { flex: 1; font-size: 13px; }
    .x { background: none; border: none; color: #8d99ab; font-size: 16px; cursor: pointer; padding: 0 4px; }
    .body { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
    .btns { display: flex; gap: 6px; }
    button.b { flex: 1; font: inherit; color: #e6ebf2; background: #1c2431; border: 1px solid #2a3445; border-radius: 6px; padding: 6px 8px; cursor: pointer; }
    button.b:hover:not(:disabled) { border-color: #4da3ff; }
    button.b:disabled { opacity: .4; cursor: not-allowed; }
    button.primary { background: #4da3ff; border-color: #4da3ff; color: #06121f; font-weight: 600; }
    button.stop { border-color: #e5262b; color: #ffb3b4; }
    .msg { font-weight: 600; }
    .msg.found { color: #ff6b6e; }
    .msg.complete { color: #3ecf8e; }
    .msg.incomplete, .msg.error { color: #f5a524; }
    .detail { color: #b7c1cf; word-break: break-word; }
    .meta { color: #8d99ab; font-size: 12px; }
    .link { background: none; border: none; color: #4da3ff; padding: 0; font: inherit; font-size: 12px; cursor: pointer; text-align: left; }
  `;

  function createPanel() {
    const host = document.createElement('div');
    host.setAttribute('data-pulse-error-finder', '');
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>${CSS}</style>
      <div class="box">
        <div class="head"><b>Pulse Error Finder</b><button class="x" title="Sluiten">×</button></div>
        <div class="body">
          <div class="btns">
            <button class="b primary" data-a="search">Zoek fouten</button>
            <button class="b" data-a="next" disabled>Volgende fout</button>
            <button class="b stop" data-a="stop" disabled>Stop</button>
          </div>
          <div class="msg"></div>
          <div class="detail"></div>
          <div class="meta"></div>
          <button class="link" data-a="diag">Diagnose opslaan (tabelstructuur)</button>
        </div>
      </div>`;
    document.documentElement.appendChild(host);
    const q = (s) => shadow.querySelector(s);
    const btn = (a) => q(`[data-a="${a}"]`);

    btn('search').onclick = () => finder.search({ fromStart: true });
    btn('next').onclick = () => finder.search({ fromStart: false });
    btn('stop').onclick = () => finder.stop();
    btn('diag').onclick = () => saveDiagnose();
    q('.x').onclick = () => { finder.stop(); clearHighlight(); host.remove(); ui = null; };

    // verslepen aan de kop
    const box = q('.box');
    q('.head').addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = box.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => {
        box.style.left = Math.max(0, ev.clientX - dx) + 'px';
        box.style.top = Math.max(0, ev.clientY - dy) + 'px';
        box.style.right = 'auto'; box.style.bottom = 'auto';
      };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });

    function render(st) {
      const running = !!st.running;
      btn('search').disabled = running;
      btn('stop').disabled = !running;
      btn('next').disabled = running || !(st.state === 'found' || st.state === 'stopped');
      const m = q('.msg');
      m.textContent = st.text || '';
      m.className = 'msg ' + (st.state || '');
      q('.detail').textContent = st.detail || '';
      const parts = [];
      if (st.checked != null) parts.push(`${st.checked} rij(en) gecontroleerd`);
      if (st.foundCount) parts.push(`${st.foundCount} fout(en) gevonden`);
      q('.meta').textContent = parts.join(' · ');
    }

    function setInfo(text, state) { render({ state, text, running: false }); }

    return { host, render, setInfo };
  }

  function showPanel(reason) {
    if (!ui || !ui.host.isConnected) ui = createPanel();
    if (reason) {
      ui.setInfo('Geen meetdatatabel herkend in deze pagina. ' + reason + ' Sla de diagnose op en stuur die door.', 'error');
      return;
    }
    if (!finder.running) {
      const p = probe();
      if (p.found) {
        const names = p.grid.series.map((s) => s.name || '(zonder naam)').join(', ');
        ui.setInfo(`Tabel herkend: ${names}`, '');
      } else {
        ui.setInfo('Geen meetdatatabel herkend. ' + p.reason, 'error');
      }
    }
  }

  // ---------- diagnose (voor het afstemmen op de echte Pulse-DOM) ----------

  function mask(text, on) {
    return on ? String(text).replace(/\d/g, '9') : String(text);
  }

  function skeleton(el, maskDigits, depth = 0, budget = { n: 0 }) {
    if (!el || budget.n > 400) return '';
    budget.n++;
    const pad = '  '.repeat(depth);
    if (el.nodeType === 3) {
      const t = el.textContent.replace(/\s+/g, ' ').trim();
      return t ? pad + JSON.stringify(mask(t.slice(0, 80), maskDigits)) + '\n' : '';
    }
    if (el.nodeType !== 1) return '';
    const attrs = [];
    for (const a of el.attributes) {
      if (/^on/i.test(a.name)) continue;
      if (['class', 'role', 'style', 'title', 'id', 'tabindex', 'colspan', 'rowspan'].includes(a.name) || a.name.startsWith('aria-') ||
        a.name.startsWith('data-') || /^(row-|col-|comp-id|ng-reflect)/.test(a.name)) {
        attrs.push(`${a.name}="${mask(a.value.slice(0, 120), maskDigits && a.name !== 'class')}"`);
      }
    }
    let out = `${pad}<${el.tagName.toLowerCase()}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
    const kids = Array.from(el.childNodes);
    if (!kids.length) return out + '\n';
    out += '\n';
    for (const k of kids.slice(0, 40)) out += skeleton(k, maskDigits, depth + 1, budget);
    if (kids.length > 40) out += `${pad}  … (${kids.length - 40} meer)\n`;
    return out;
  }

  // Meetwaarden en tijdstippen worden gemaskeerd (cijfers → 9); statusteksten blijven leesbaar.
  function diagnose(maskDigits = true) {
    const grid = new GridModel(settings());
    const ok = grid.detect();
    const report = {
      generatedAt: new Date().toISOString(),
      page: { origin: location.origin, path: location.pathname, inFrame: window.top !== window },
      detected: ok,
      failReason: ok ? null : grid.failReason,
      tables: Array.from(document.querySelectorAll('table,[role="grid"],[role="table"],[role="treegrid"]')).slice(0, 10).map((t) => ({
        el: describeEl(t),
        rowsInDom: t.querySelectorAll('tr,[role="row"]').length,
        ariaRowCount: t.getAttribute('aria-rowcount'),
        firstRowText: mask(visibleText(t.querySelector('tr,[role="row"]')).slice(0, 200), maskDigits)
      })),
      scrollables: allElements(document.documentElement).filter((e) => {
        const cs = getComputedStyle(e);
        return /(auto|scroll|overlay)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1;
      }).slice(0, 10).map((e) => ({ el: describeEl(e), scrollHeight: e.scrollHeight, clientHeight: e.clientHeight, scrollTop: e.scrollTop }))
    };
    if (ok) {
      report.grid = grid.summary();
      report.headerSkeleton = skeleton(grid.headerScope, maskDigits).slice(0, 15000);
      const cols = grid.columnRects();
      report.sampleRows = grid.groupRows(grid.queryRows()).slice(0, 6).map((rg) => {
        const mapped = [];
        for (const [c, el] of grid.cellsOf(rg, cols)) {
          const item = { column: (c.series ? c.series.id + ' / ' : '') + c.role, el: describeEl(el), text: mask(visibleText(el).slice(0, 80), maskDigits && c.role !== 'status') };
          if (c.role === 'status') {
            const ev = collectEvidence(el, settings());
            item.evidence = { text: ev.text, attrs: ev.attrs, classes: ev.classes, colors: ev.colors };
          }
          mapped.push(item);
        }
        return { identity: rg.id, fragments: rg.frags.length, mapped, skeleton: rg.frags.map((f) => skeleton(f, maskDigits)).join('\n').slice(0, 12000) };
      });
    }
    return report;
  }

  function saveDiagnose() {
    const text = JSON.stringify(diagnose(true), null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pulse-diagnose.json';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  root.PulseFinderContent = { probe, showPanel, diagnose, finder };
})(typeof globalThis !== 'undefined' ? globalThis : this);

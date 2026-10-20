/*
 * Tabelherkenning voor Pulse.
 *
 * Er wordt bewust niet uitgegaan van vaste CSS-selectors of kolomnummers. De tabel
 * wordt gevonden aan de hand van de zichtbare kolomkoppen (Tijdstip / Waarde /
 * Kwaliteit / Status, configureerbaar). Cellen worden aan kolommen gekoppeld via
 * aria-colindex (als aanwezig) of anders via de horizontale positie ten opzichte
 * van de kolomkop. Meetreeksen (bijv. "Energie 8") worden afgeleid uit de
 * groepskop die boven de waarde/kwaliteit/status-koppen staat.
 *
 * Dit werkt voor <table>-tabellen, ARIA-grids (role=grid/row/gridcell, zoals
 * AG Grid, Kendo, DevExtreme) en generieke div-tabellen.
 */
(function (root) {
  const ROW_ID_ATTRS = ['aria-rowindex', 'row-index', 'data-row-index', 'data-rowindex', 'row-id',
    'data-row-id', 'data-rowid', 'data-id', 'data-key', 'data-row-key', 'data-index', 'data-item-index'];
  const SERIES_ROLES = ['value', 'quality', 'status'];
  const MAX_DESCENDANTS_PER_ROW = 400;

  // ---------- tekst ----------

  function norm(text) {
    return String(text || '')
      .replace(/[ \s]+/g, ' ')
      .replace(/\b[a-z]+_[a-z_]+\b/g, ' ') // ligatuur-icoonnamen zoals arrow_upward
      .replace(/[▲▼△▽↑↓⇅⇵⬆⬇▴▾]/g, ' ')
      .replace(/[:*]+\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function visibleText(el) {
    if (!el) return '';
    const t = el.innerText != null ? el.innerText : el.textContent;
    return String(t || '').replace(/[ \s]+/g, ' ').trim();
  }

  function isRendered(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (el.checkVisibility) return el.checkVisibility({ visibilityProperty: true, opacityProperty: false });
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  // Alle elementen, inclusief open shadow roots.
  function allElements(start) {
    const out = [];
    const stack = [start];
    while (stack.length) {
      const node = stack.pop();
      const kids = node.children || [];
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      if (node.shadowRoot) stack.push(node.shadowRoot);
      if (node.nodeType === 1) out.push(node);
    }
    return out;
  }

  function parentOf(el) {
    return el.parentElement || (el.parentNode && el.parentNode.host) || null;
  }

  function contains(a, b) {
    for (let n = b; n; n = parentOf(n)) if (n === a) return true;
    return false;
  }

  function lca(els) {
    if (!els.length) return null;
    let anc = els[0];
    for (const el of els.slice(1)) {
      while (anc && !contains(anc, el)) anc = parentOf(anc);
    }
    return anc;
  }

  // ---------- kolomkoppen ----------

  function buildLabelIndex(settings) {
    const idx = [];
    for (const [role, labels] of Object.entries(settings.headers)) {
      for (const l of labels) idx.push({ role, label: norm(l) });
    }
    // langste label eerst zodat "datum tijd" voor "tijd" komt
    idx.sort((a, b) => b.label.length - a.label.length);
    return idx;
  }

  // Herkent "Status" en ook "Energie 8 Status" (dan seriesHint = "Energie 8").
  function matchLabel(text, labelIndex) {
    const n = norm(text);
    if (!n || n.length > 80) return null;
    for (const { role, label } of labelIndex) {
      if (n === label) return { role, seriesHint: '' };
    }
    for (const { role, label } of labelIndex) {
      if (role === 'time' || role === 'meetpunt') continue;
      if (n.endsWith(' ' + label)) {
        const raw = String(text).replace(/[ \s]+/g, ' ').trim();
        const hint = raw.slice(0, raw.length - label.length).replace(/[\s\-–:|/]+$/, '').trim();
        // de rest mag zelf geen kolomkop zijn (anders is dit een hele koprij)
        const nh = norm(hint);
        if (hint && !labelIndex.some((li) => (' ' + nh + ' ').includes(' ' + li.label + ' '))) return { role, seriesHint: hint };
      }
    }
    return null;
  }

  // Klim van het diepste tekstelement naar de volledige kopcel (zelfde tekst).
  function climbToCell(el) {
    let cur = el;
    const t = norm(visibleText(el));
    for (let i = 0; i < 8; i++) {
      const role = cur.getAttribute && cur.getAttribute('role');
      if (cur.tagName === 'TH' || role === 'columnheader') return cur;
      const p = parentOf(cur);
      if (!p || p === document.body || p === document.documentElement) return cur;
      if (norm(visibleText(p)) !== t) return cur;
      cur = p;
    }
    return cur;
  }

  function findHeaderCandidates(settings, scope) {
    const labelIndex = buildLabelIndex(settings);
    const found = [];
    const seen = new Set();
    for (const el of allElements(scope || document.documentElement)) {
      const tc = el.textContent;
      if (!tc || tc.length > 120) continue;
      if (el.closest && el.closest('script,style,noscript,select,option')) continue;
      // diepste element met deze tekst
      let deeper = false;
      for (const c of el.children) {
        if (norm(c.textContent) && norm(visibleText(c)) === norm(visibleText(el))) { deeper = true; break; }
      }
      if (deeper) continue;
      const m = matchLabel(visibleText(el), labelIndex);
      if (!m) continue;
      if (!isRendered(el)) continue;
      const cell = climbToCell(el);
      if (seen.has(cell)) continue;
      seen.add(cell);
      found.push({ el: cell, role: m.role, seriesHint: m.seriesHint, label: visibleText(cell) });
    }
    return found;
  }

  function vOverlap(a, b) {
    return Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  }

  function hOverlap(a, b) {
    return Math.min(a.right, b.right) - Math.max(a.left, b.left);
  }

  // Groepeer kopcellen per tabel: kolomkoppen die op dezelfde hoogte staan en een
  // gemeenschappelijke voorouder delen.
  function clusterHeaders(cands) {
    const statusCands = cands.filter((c) => c.role === 'status');
    const clusters = [];
    const used = new Set();
    for (const s of statusCands) {
      if (used.has(s)) continue;
      const sr = s.el.getBoundingClientRect();
      const members = cands.filter((c) => {
        if (used.has(c)) return false;
        const r = c.el.getBoundingClientRect();
        return vOverlap(r, sr) > Math.min(r.height, sr.height) * 0.5;
      });
      // alleen leden met een gemeenschappelijke voorouder die niet <body> is
      const anc = lca(members.map((m) => m.el));
      if (!anc) continue;
      members.forEach((m) => used.add(m));
      clusters.push({ members, anc });
    }
    clusters.sort((a, b) => {
      const sa = a.members.filter((m) => m.role === 'status').length;
      const sb = b.members.filter((m) => m.role === 'status').length;
      if (sb !== sa) return sb - sa;
      return (b.members.some((m) => m.role === 'time') ? 1 : 0) - (a.members.some((m) => m.role === 'time') ? 1 : 0);
    });
    return clusters;
  }

  // ---------- meetreeksen ----------

  function findGroupHeaders(headerScope, leaves, labelIndex) {
    // alleen waarde/kwaliteit/status: een Tijdstip-kop kan over meerdere koprijen lopen
    const leafRects = leaves.filter((l) => SERIES_ROLES.includes(l.role)).map((l) => l.el.getBoundingClientRect());
    const minLeafTop = Math.min(...leafRects.map((r) => r.top));
    const leafSet = new Set(leaves.map((l) => l.el));
    const groups = [];
    const seen = new Set();
    for (const el of allElements(headerScope)) {
      if (leafSet.has(el)) continue;
      const tc = el.textContent;
      if (!tc || tc.length > 200) continue;
      const text = visibleText(el);
      if (!text || matchLabel(text, labelIndex)) continue;
      // tekst mag geen kolomkop-labels bevatten (dan is het een wrapper)
      const n = norm(text);
      if (labelIndex.some(({ label }) => (' ' + n + ' ').includes(' ' + label + ' '))) continue;
      let deeper = false;
      for (const c of el.children) if (norm(visibleText(c)) === n) { deeper = true; break; }
      if (deeper) continue;
      if (!isRendered(el)) continue;
      const cell = climbToCell(el);
      if (seen.has(cell)) continue;
      const r = cell.getBoundingClientRect();
      if (r.bottom > minLeafTop + 4) continue;
      seen.add(cell);
      groups.push({ el: cell, text: visibleText(cell) });
    }
    return groups;
  }

  function attrIdentity(el) {
    if (!el) return '';
    const parts = [];
    for (const a of ['title', 'aria-label', 'data-tooltip', 'data-original-title']) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && norm(v) !== norm(visibleText(el))) parts.push(v.trim());
    }
    return parts.join(' ');
  }

  function buildSeries(leaves, groups) {
    const statusCenters = leaves.filter((l) => l.role === 'status').map((l) => {
      const r = l.el.getBoundingClientRect();
      return (r.left + r.right) / 2;
    });
    const leafHeight = Math.max(...leaves.map((l) => l.el.getBoundingClientRect().height), 10);
    const covers = (r, x) => r.left - 2 <= x && r.right + 2 >= x;
    // Groepskoppen boven een kolomkop, van dichtbij naar ver weg, binnen het kopgebied.
    const groupsAbove = (leaf) => {
      const lr = leaf.el.getBoundingClientRect();
      const cx = (lr.left + lr.right) / 2;
      return groups
        .map((g) => ({ g, r: g.el.getBoundingClientRect() }))
        .filter(({ r }) => covers(r, cx) && r.bottom <= lr.top + 4 && r.bottom >= lr.top - leafHeight * 4)
        .sort((a, b) => b.r.bottom - a.r.bottom);
    };
    const statusCount = (r) => statusCenters.filter((x) => covers(r, x)).length;

    const ordered = leaves.slice().sort((a, b) => a.el.getBoundingClientRect().left - b.el.getBoundingClientRect().left);
    const series = [];
    const byKey = new Map();
    let pending = []; // voor tabellen zonder groepskop: kolommen tot de volgende status
    for (const leaf of ordered) {
      if (!SERIES_ROLES.includes(leaf.role)) continue;
      const above = groupsAbove(leaf);
      // de meetreeks is de dichtstbijzijnde groepskop die precies één statuskolom omvat;
      // koppen daarboven (die meerdere reeksen omvatten) gelden als meetpuntidentificatie
      const own = above.find(({ r }) => statusCount(r) === 1);
      let key = null;
      let name = '';
      let meetpunt = '';
      let groupEl = null;
      if (own) {
        groupEl = own.g.el;
        key = groupEl;
        name = own.g.text;
        const higher = above.filter(({ r }) => r.bottom <= own.r.top + 2 && statusCount(r) > 1).reverse().map(({ g }) => g.text);
        meetpunt = [...higher, attrIdentity(groupEl)].filter(Boolean).join(' / ');
      } else if (leaf.seriesHint) {
        key = 'hint:' + leaf.seriesHint;
        name = leaf.seriesHint;
        meetpunt = above.filter(({ r }) => statusCount(r) > 1).reverse().map(({ g }) => g.text).join(' / ');
      }
      if (key !== null) {
        let s = byKey.get(key);
        if (!s) {
          s = { name, meetpunt, groupEl, cols: {} };
          byKey.set(key, s);
          series.push(s);
        }
        if (!s.cols[leaf.role]) s.cols[leaf.role] = leaf;
        continue;
      }
      pending.push(leaf);
      if (leaf.role === 'status') {
        const s = { name: '', meetpunt: '', groupEl: null, cols: {} };
        for (const p of pending) if (!s.cols[p.role]) s.cols[p.role] = p;
        series.push(s);
        pending = [];
      }
    }
    const unnamed = series.filter((s) => !s.name);
    unnamed.forEach((s, i) => { s.name = unnamed.length > 1 ? 'Kolomgroep ' + (i + 1) : ''; s.unnamed = true; });
    // unieke id; gelijke namen worden genummerd zodat ze nooit samenvallen
    const counts = {};
    for (const s of series) counts[s.name] = (counts[s.name] || 0) + 1;
    const nth = {};
    for (const s of series) {
      nth[s.name] = (nth[s.name] || 0) + 1;
      s.id = counts[s.name] > 1 ? `${s.name}#${nth[s.name]}` : s.name;
      if (counts[s.name] > 1) s.duplicateName = true;
    }
    return series.filter((s) => s.cols.status);
  }

  // ---------- scrollcontainer ----------

  function isScrollable(el) {
    if (!el || el.nodeType !== 1) return false;
    const cs = getComputedStyle(el);
    return /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
  }

  function findScrollContainer(fromEl) {
    for (let n = fromEl; n; n = parentOf(n)) {
      if (n === document.body || n === document.documentElement) break;
      if (isScrollable(n)) return n;
    }
    return document.scrollingElement || document.documentElement;
  }

  // ---------- rijen ----------

  function rowIdentity(el) {
    for (const a of ROW_ID_ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v != null && v !== '') return a + '=' + v;
    }
    return '';
  }

  const DATE_RE = /(\d{1,2}[-./]\d{1,2}[-./]\d{2,4})|(\d{4}-\d{2}-\d{2})|(\b\d{1,2}:\d{2}\b)/;

  class GridModel {
    constructor(settings) {
      this.settings = settings;
      this.labelIndex = buildLabelIndex(settings);
      this.notes = [];
    }

    // Zoekt de tabel. Geeft false terug als er geen bruikbare tabel is.
    detect(scope) {
      const cands = findHeaderCandidates(this.settings, scope);
      const clusters = clusterHeaders(cands);
      if (!clusters.length) {
        this.failReason = cands.length
          ? 'Kolomkoppen gevonden, maar geen kolom "Status" in dezelfde koprij.'
          : 'Geen kolomkoppen gevonden (zoek naar: ' + this.settings.headers.status.join('/') + ').';
        return false;
      }
      const cl = clusters[0];
      this.leaves = cl.members;
      this.timeCol = cl.members.find((m) => m.role === 'time') || null;
      this.meetpuntCol = cl.members.find((m) => m.role === 'meetpunt') || null;
      // headerScope: voorouder van de kopcellen, één niveau ruimer voor groepskoppen
      this.headerScope = parentOf(cl.anc) || cl.anc;
      const groups = findGroupHeaders(this.headerScope, this.leaves, this.labelIndex);
      this.series = buildSeries(this.leaves, groups);
      if (!this.series.length) {
        this.failReason = 'Geen meetreeks met een statuskolom gevonden.';
        return false;
      }
      if (!this.timeCol) this.notes.push('Geen kolom "Tijdstip" gevonden; rijen worden op rijnummer geïdentificeerd.');
      this.useColIndex = this.leaves.every((l) => l.el.getAttribute('aria-colindex'));
      this.locateBody();
      return true;
    }

    // Bepaalt waar de rijen staan en welke container scrollt.
    locateBody() {
      this.rowMode = 'none';
      const headerEls = this.leaves.map((l) => l.el);
      const anc = lca(headerEls);
      this.root = anc;
      const tryMode = (mode, scope) => {
        this.rowMode = mode;
        this.root = scope;
        if (this.queryRows().length) return true;
        this.rowMode = 'none';
        this.root = anc;
        return false;
      };
      const table = headerEls[0].closest('table');
      let ok = !!(table && headerEls.every((h) => contains(table, h)) && tryMode('table', table));
      // ARIA-grid: klim tot er datarijen (role=row zonder columnheader) in zitten
      for (let n = anc; !ok && n && n !== document.documentElement; n = parentOf(n)) ok = tryMode('aria', n);
      // Generiek: tijdstipcellen onder de tijdstipkop (ook voor aparte kop- en bodytabellen)
      if (this.timeCol) {
        for (let n = anc; !ok && n && n !== document.documentElement; n = parentOf(n)) ok = tryMode('generic', n);
      }
      const rows = this.queryRows();
      this.scroller = findScrollContainer(rows[0] || this.root);
      // Als de rijen zelf niet in een scrollbare container staan maar de pagina scrollt
      this.scrollerIsDocument = this.scroller === document.scrollingElement || this.scroller === document.documentElement;
    }

    isHeaderRow(row) {
      if (row.querySelector('th,[role="columnheader"]')) return true;
      if (row.closest('thead,[role="rowgroup"][class*="header" i]')) return true;
      return this.leaves.some((l) => contains(row, l.el));
    }

    queryAriaRows(scope) {
      return Array.from(scope.querySelectorAll('[role="row"]')).filter((r) => !this.isHeaderRow(r));
    }

    queryGenericRows(scope) {
      const tr = this.timeCol.el.getBoundingClientRect();
      const headerBottom = Math.max(...this.leaves.map((l) => l.el.getBoundingClientRect().bottom));
      const timeCells = [];
      for (const el of scope.querySelectorAll('*')) {
        if (el.children.length > 2) continue;
        const t = el.textContent;
        if (!t || t.length > 40 || !DATE_RE.test(t)) continue;
        if (this.leaves.some((l) => contains(l.el, el))) continue;
        const r = el.getBoundingClientRect();
        if (r.height <= 0 || r.top < headerBottom - 1) continue;
        const cx = (r.left + r.right) / 2;
        if (cx < tr.left - 2 || cx > tr.right + 2) continue;
        // diepste
        if (Array.from(el.children).some((c) => DATE_RE.test(c.textContent || ''))) continue;
        timeCells.push(el);
      }
      const rows = [];
      const set = new Set();
      for (const tc of timeCells) {
        let rowEl = tc;
        for (let p = parentOf(tc); p && p !== scope; p = parentOf(p)) {
          const others = timeCells.some((o) => o !== tc && contains(p, o));
          if (others) break;
          rowEl = p;
        }
        if (!set.has(rowEl)) { set.add(rowEl); rows.push(rowEl); }
      }
      return rows;
    }

    queryRows() {
      if (this.rowMode === 'table') {
        return Array.from(this.root.querySelectorAll('tr')).filter((r) => r.closest('table') === this.root && !this.isHeaderRow(r));
      }
      if (this.rowMode === 'aria') return this.queryAriaRows(this.root);
      if (this.rowMode === 'generic') return this.queryGenericRows(this.root);
      return [];
    }

    // Controleert of de gevonden kopcellen nog in de DOM staan.
    isAlive() {
      return this.leaves.every((l) => l.el.isConnected) && (!this.root || this.root.isConnected);
    }

    // Leest de huidige geometrie van de kolomkoppen (kan verschuiven bij horizontaal scrollen).
    columnRects() {
      const cols = [];
      const add = (col, role, series) => {
        if (!col) return;
        const r = col.el.getBoundingClientRect();
        cols.push({ col, role, series, left: r.left, right: r.right, colIndex: col.el.getAttribute('aria-colindex') });
      };
      add(this.timeCol, 'time', null);
      add(this.meetpuntCol, 'meetpunt', null);
      for (const s of this.series) for (const role of SERIES_ROLES) add(s.cols[role], role, s);
      return cols;
    }

    // Groepeert rij-fragmenten (bijv. vastgezette kolommen in een aparte container) tot logische rijen.
    groupRows(rowEls) {
      const groups = new Map();
      const loose = [];
      for (const el of rowEls) {
        const r = el.getBoundingClientRect();
        if (r.height <= 0) continue;
        const id = rowIdentity(el);
        if (id) {
          if (!groups.has(id)) groups.set(id, { id, frags: [], top: r.top, height: r.height });
          groups.get(id).frags.push(el);
        } else {
          loose.push({ el, top: r.top, height: r.height });
        }
      }
      loose.sort((a, b) => a.top - b.top);
      const out = Array.from(groups.values());
      let cur = null;
      for (const l of loose) {
        if (cur && Math.abs(l.top - cur.top) < 3) cur.frags.push(l.el);
        else { cur = { id: '', frags: [l.el], top: l.top, height: l.height }; out.push(cur); }
      }
      out.sort((a, b) => a.top - b.top);
      return out;
    }

    // Koppelt cellen van een logische rij aan kolommen.
    cellsOf(rowGroup, cols) {
      const byCol = new Map();
      const byIndex = new Map();
      if (this.useColIndex) for (const c of cols) if (c.colIndex) byIndex.set(c.colIndex, c);
      for (const frag of rowGroup.frags) {
        const els = frag.querySelectorAll('*');
        const n = Math.min(els.length, MAX_DESCENDANTS_PER_ROW);
        for (let i = 0; i < n; i++) {
          const el = els[i];
          let target = null;
          const ci = byIndex.size && el.getAttribute('aria-colindex');
          if (ci && byIndex.has(ci)) {
            target = byIndex.get(ci);
          } else if (!byIndex.size || !ci) {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) continue;
            let best = null;
            let bestOv = 0;
            for (const c of cols) {
              const cw = c.right - c.left;
              if (r.width > cw * 1.3 + 6) continue;
              const ov = hOverlap(r, c);
              if (ov > bestOv) { bestOv = ov; best = c; }
            }
            if (best && bestOv >= Math.min(r.width, best.right - best.left) * 0.5) target = best;
          }
          if (target && !byCol.has(target)) byCol.set(target, el); // pre-order: buitenste element eerst
        }
      }
      return byCol;
    }

    summary() {
      return {
        rowMode: this.rowMode,
        series: this.series.map((s) => ({
          id: s.id, name: s.name, meetpunt: s.meetpunt, unnamed: !!s.unnamed,
          columns: SERIES_ROLES.filter((r) => s.cols[r]).map((r) => s.cols[r].label)
        })),
        timeColumn: this.timeCol ? this.timeCol.label : null,
        meetpuntColumn: this.meetpuntCol ? this.meetpuntCol.label : null,
        scroller: describeEl(this.scroller),
        scrollerIsDocument: this.scrollerIsDocument,
        rowCountInDom: this.queryRows().length,
        ariaRowCount: this.ariaRowCount(),
        notes: this.notes.slice()
      };
    }

    ariaRowCount() {
      const g = this.root && (this.root.closest('[aria-rowcount]') || this.root.querySelector('[aria-rowcount]'));
      if (!g) return null;
      const n = parseInt(g.getAttribute('aria-rowcount'), 10);
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
  }

  function describeEl(el) {
    if (!el) return '';
    if (el === document.scrollingElement || el === document.documentElement) return 'pagina (document)';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3) : [];
    if (cls.length && cls[0]) s += '.' + cls.join('.');
    const role = el.getAttribute('role');
    if (role) s += `[role=${role}]`;
    return s;
  }

  root.PulseGrid = { GridModel, norm, visibleText, isRendered, rowIdentity, describeEl, allElements, parentOf, contains, DATE_RE };
})(typeof globalThis !== 'undefined' ? globalThis : this);

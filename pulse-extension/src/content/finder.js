/*
 * Zoek-engine: scrollt de tabelcontainer, wacht op dynamisch geladen rijen,
 * controleert iedere meetreeks per rij en stopt bij de eerstvolgende fout.
 *
 * De engine wijzigt niets in Pulse: hij leest alleen de DOM en verandert de
 * scrollpositie. Er wordt nergens op geklikt en er worden geen formulieren verstuurd.
 * De enige zichtbare aanpassing is een tijdelijke markering (outline/achtergrond)
 * van de gevonden rij, die weer wordt verwijderd.
 */
(function (root) {
  const { GridModel, norm, visibleText, rowIdentity, isRendered } = root.PulseGrid;
  const { classify, collectEvidence } = root.PulseClassify;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => Date.now();

  // ---------- laadstatus ----------

  function isLoading(grid, settings) {
    for (const sel of settings.loading.selectors) {
      let els;
      try { els = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of els) if (isRendered(el) && !(grid.loadingBaseline && grid.loadingBaseline.has(el))) return true;
    }
    const scopes = [grid.root, grid.scroller].filter((s) => s && s.nodeType === 1 && s !== document.documentElement);
    const texts = settings.loading.texts.map((p) => { try { return new RegExp(p, 'i'); } catch (e) { return null; } }).filter(Boolean);
    for (const scope of scopes) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      let n = 0;
      for (let node = walker.nextNode(); node && n < 4000; node = walker.nextNode(), n++) {
        const t = node.textContent.trim();
        const pe = node.parentElement;
        if (t && t.length < 40 && texts.some((r) => r.test(t)) && pe && isRendered(pe) && !(grid.loadingBaseline && grid.loadingBaseline.has(pe))) return true;
      }
    }
    return false;
  }

  // Laadindicatoren die al zichtbaar zijn voordat er gescrolld wordt (bijv. een
  // permanent element met class "loading") worden genegeerd.
  function captureLoadingBaseline(grid, settings) {
    grid.loadingBaseline = null;
    const base = new Set();
    for (const sel of settings.loading.selectors) {
      let els;
      try { els = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of els) if (isRendered(el)) base.add(el);
    }
    grid.loadingBaseline = base;
    return base.size;
  }

  function findLoadMoreButton(grid, settings) {
    const scope = (grid.root && grid.root.parentElement) || document.body;
    const pats = settings.loadMoreTexts.map((t) => norm(t));
    for (const el of scope.querySelectorAll('button,a,[role="button"]')) {
      const t = norm(visibleText(el));
      if (t && pats.some((p) => t.includes(p)) && isRendered(el)) return visibleText(el);
    }
    return '';
  }

  // Wacht tot de DOM na een scroll weer tot rust is gekomen (MutationObserver +
  // laadindicatoren + scrollhoogte), zonder vaste lange wachttijd.
  // Resultaat: { changed, loadingSeen, timedOut, stillLoading }
  function waitForSettle(grid, settings, { maxWaitMs, quietMs, minWaitForChangeMs = 0, aborted = () => false }) {
    return new Promise((resolve) => {
      const targets = new Set([grid.root, grid.scroller].filter((t) => t && t.nodeType === 1));
      if (grid.scrollerIsDocument) targets.add(document.body);
      let lastMutation = 0;
      let loadingSeen = false;
      const startH = grid.scroller.scrollHeight;
      const obs = new MutationObserver(() => { lastMutation = now(); });
      for (const t of targets) obs.observe(t, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'aria-rowindex', 'aria-busy', 'aria-rowcount'] });
      const start = now();
      const tick = () => {
        const t = now();
        if (aborted()) return done(false, false);
        const loading = isLoading(grid, settings);
        if (loading) loadingSeen = true;
        const heightChanged = grid.scroller.scrollHeight !== startH;
        if (!loading) {
          if (lastMutation && t - lastMutation >= quietMs) return done(true, false);
          if (!lastMutation && !heightChanged && t - start >= Math.max(quietMs, minWaitForChangeMs)) return done(false, false);
          if (heightChanged && !lastMutation && t - start >= quietMs) return done(true, false);
        }
        if (t - start >= maxWaitMs) return done(!!lastMutation || heightChanged, true);
        setTimeout(tick, 60);
      };
      const done = (changed, timedOut) => {
        obs.disconnect();
        resolve({ changed, loadingSeen, timedOut, stillLoading: timedOut && isLoading(grid, settings) });
      };
      setTimeout(tick, 60);
    });
  }

  // ---------- scrollen ----------

  function scrollState(sc) {
    return { top: sc.scrollTop, height: sc.scrollHeight, client: sc.clientHeight };
  }

  function atBottom(sc) {
    return sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
  }

  function scrollTo(sc, top) {
    sc.scrollTop = top;
    // sommige grids luisteren alleen naar scroll-events op window bij documentscroll
    if (sc === document.scrollingElement || sc === document.documentElement) window.scrollTo(window.scrollX, top);
  }

  // Extra duwtje onderaan: kleine scroll omhoog en terug plus een wheel-event,
  // voor infinite-loaders die alleen op wheel of op een nieuwe scrollbeweging reageren.
  function nudge(sc) {
    const max = sc.scrollHeight - sc.clientHeight;
    scrollTo(sc, Math.max(0, max - Math.min(60, sc.clientHeight / 4)));
    scrollTo(sc, max);
    const target = sc === document.scrollingElement || sc === document.documentElement ? document : sc;
    try {
      target.dispatchEvent(new WheelEvent('wheel', { deltaY: sc.clientHeight / 2, bubbles: true, cancelable: true }));
    } catch (e) { /* oudere browsers */ }
    sc.dispatchEvent(new Event('scroll', { bubbles: false }));
  }

  // ---------- markering ----------

  let activeMarks = [];
  let bgTimer = null;

  function clearHighlight() {
    clearTimeout(bgTimer);
    for (const [el, prev] of activeMarks) Object.assign(el.style, prev);
    activeMarks = [];
  }

  function mark(el, style) {
    const prev = {};
    for (const k of Object.keys(style)) prev[k] = el.style[k];
    activeMarks.push([el, prev]);
    Object.assign(el.style, style);
  }

  // Rode rand om de rij (blijft tot de volgende zoekactie) en een tijdelijke achtergrond.
  function highlight(frags, statusEl) {
    clearHighlight();
    const tinted = [];
    for (const f of frags) {
      mark(f, { outline: '3px solid #e5262b', outlineOffset: '-3px' });
      for (const el of [f, ...f.children]) { mark(el, { backgroundColor: 'rgba(229, 38, 43, 0.22)' }); tinted.push(el); }
    }
    if (statusEl) mark(statusEl, { boxShadow: 'inset 0 0 0 3px #e5262b' });
    bgTimer = setTimeout(() => {
      // achtergrond na enkele seconden terugzetten, rand blijft staan
      activeMarks = activeMarks.filter(([el, prev]) => {
        if ('backgroundColor' in prev && tinted.includes(el)) { el.style.backgroundColor = prev.backgroundColor; return false; }
        return true;
      });
    }, 4000);
  }

  // ---------- zoeker ----------

  class Finder {
    constructor(onUpdate) {
      this.onUpdate = onUpdate || (() => {});
      this.running = false;
      this.stopRequested = false;
      this.reset();
    }

    reset() {
      this.found = [];               // gevonden fouten (los van de DOM bewaard)
      this.foundKeys = new Set();    // voorkomt dat dezelfde fout opnieuw wordt gemeld
      this.checkedRows = new Set();  // gecontroleerde rijen (voor de melding)
      this.cursorTop = null;         // absolute positie van de laatst gevonden fout
      this.startedAtTop = false;
    }

    update(state, text, extra) {
      this.state = state;
      this.last = Object.assign({ state, text, checked: this.checkedRows.size, foundCount: this.found.length, running: this.running, canContinue: this.cursorTop != null || this.state === 'stopped' }, extra || {});
      this.onUpdate(this.last);
    }

    stop() {
      if (this.running) this.stopRequested = true;
    }

    ensureGrid() {
      this.settings = root.PulseScanDefaults.DEFAULT_SETTINGS;
      if (this.grid && this.grid.isAlive()) return true;
      const g = new GridModel(this.settings);
      if (!g.detect()) { this.failReason = g.failReason; return false; }
      this.grid = g;
      return true;
    }

    absTop(rect) {
      const sc = this.grid.scroller;
      const scTop = this.grid.scrollerIsDocument ? 0 : sc.getBoundingClientRect().top;
      return rect.top - scTop + sc.scrollTop;
    }

    // Controleert de rijen die nu in de DOM staan, van boven naar beneden, en geeft de
    // eerste nog niet gemelde fout op of onder de cursor terug.
    scanVisible() {
      const grid = this.grid;
      const cols = grid.columnRects();
      const loadingPats = this.settings.loading.texts.map((p) => new RegExp(p, 'i'));
      for (const rg of grid.groupRows(grid.queryRows())) {
        const top = this.absTop({ top: rg.top });
        if (this.cursorTop != null && top < this.cursorTop - 1) continue;
        const rowText = rg.frags.map((f) => visibleText(f)).join(' ').trim();
        if (!rowText || loadingPats.some((r) => r.test(rowText))) continue;
        const cells = grid.cellsOf(rg, cols);
        const cellFor = (role, s) => { for (const [c, el] of cells) if (c.role === role && c.series === s) return el; return null; };
        const timeEl = cellFor('time', null);
        const time = timeEl ? visibleText(timeEl) : '';
        if (grid.timeCol && !time) continue; // rij nog niet gevuld
        const identity = rg.id || rowIdentity(rg.frags[0]) || '';
        const rowKey = time + '|' + identity;
        let anySeries = false;
        for (const s of grid.series) {
          const statusEl = cellFor('status', s);
          if (!statusEl) continue;
          anySeries = true;
          const valueEl = cellFor('value', s);
          const qualityEl = cellFor('quality', s);
          const evidence = collectEvidence(statusEl, this.settings);
          const res = classify({ evidence, value: valueEl ? visibleText(valueEl) : '', quality: qualityEl ? visibleText(qualityEl) : '' }, this.settings);
          if (res.category !== 'critical') continue;
          const key = [s.id, time, identity].join('|');
          if (this.foundKeys.has(key)) continue;
          if (anySeries) this.checkedRows.add(rowKey);
          return {
            key, top, time, identity,
            series: s.name, seriesId: s.id, meetpunt: s.meetpunt,
            value: valueEl ? visibleText(valueEl) : '',
            quality: qualityEl ? visibleText(qualityEl) : '',
            status: evidence.text,
            details: res.details.join('; '),
            frags: rg.frags, statusEl
          };
        }
        if (anySeries) this.checkedRows.add(rowKey);
      }
      return null;
    }

    // Scrolt de container zodat de rij in het midden staat en markeert hem.
    async reveal(hit) {
      const sc = this.grid.scroller;
      const rowH = hit.frags[0].getBoundingClientRect().height || 0;
      scrollTo(sc, Math.max(0, hit.top - sc.clientHeight / 2 + rowH / 2));
      await waitForSettle(this.grid, this.settings, { maxWaitMs: 3000, quietMs: this.settings.timing.settleMs });
      if (!this.grid.scrollerIsDocument) {
        const r = sc.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) sc.scrollIntoView({ block: 'nearest' });
      }
      // bij virtual scrolling kan het element opnieuw gerenderd zijn: opnieuw opzoeken
      const cols = this.grid.columnRects();
      let frags = hit.frags.every((f) => f.isConnected) ? hit.frags : null;
      let statusEl = hit.statusEl && hit.statusEl.isConnected ? hit.statusEl : null;
      if (!frags) {
        for (const rg of this.grid.groupRows(this.grid.queryRows())) {
          if (hit.identity && rg.id && rg.id !== hit.identity) continue;
          const cells = this.grid.cellsOf(rg, cols);
          let t = '', st = null;
          for (const [c, el] of cells) {
            if (c.role === 'time') t = visibleText(el);
            if (c.role === 'status' && c.series && c.series.id === hit.seriesId) st = el;
          }
          if ((hit.time && t === hit.time) || (!hit.time && hit.identity && rg.id === hit.identity)) { frags = rg.frags; statusEl = st; break; }
        }
      }
      if (frags) highlight(frags, statusEl);
      return !!frags;
    }

    // fromStart: true = "Zoek fouten" (vanaf het begin), false = "Volgende fout".
    async search({ fromStart }) {
      if (this.running) return;
      clearHighlight();
      if (!this.ensureGrid()) {
        this.update('error', 'Geen meetdatatabel herkend. ' + (this.failReason || ''));
        return;
      }
      const grid = this.grid;
      const s = this.settings;
      const t = s.timing;
      const sc = () => grid.scroller;
      this.running = true;
      this.stopRequested = false;
      const aborted = () => this.stopRequested;
      const settle = (opts) => waitForSettle(grid, s, Object.assign({ maxWaitMs: t.maxWaitMs, quietMs: t.settleMs, aborted }, opts));
      captureLoadingBaseline(grid, s);
      this.update('searching', 'Zoeken…');

      try {
        if (fromStart) {
          this.reset();
          this.startedAtTop = true;
          scrollTo(sc(), 0);
          await settle();
        } else if (this.cursorTop != null) {
          // terug naar de laatst gevonden fout, ook als de gebruiker intussen heeft gescrolld
          scrollTo(sc(), Math.max(0, this.cursorTop - sc().clientHeight / 3));
          await settle();
        }

        let endAttempts = 0;
        let stuck = 0;
        for (;;) {
          if (this.stopRequested) return this.finish('stopped', 'Gestopt.');
          if (!grid.isAlive()) {
            this.grid = null;
            if (!this.ensureGrid()) return this.finish('incomplete', 'Scan onvolledig: de tabel is uit de pagina verdwenen.');
            return this.finish('incomplete', 'Scan onvolledig: de tabel is opnieuw opgebouwd. Klik op "Zoek fouten" om opnieuw te beginnen.');
          }

          const hit = this.scanVisible();
          if (hit) {
            this.found.push(hit);
            this.foundKeys.add(hit.key);
            this.cursorTop = hit.top;
            const shown = await this.reveal(hit);
            const where = [hit.time || (hit.identity ? 'rij ' + hit.identity.split('=').pop() : ''), hit.series].filter(Boolean).join(', ');
            const detail = [hit.status ? `Status: "${hit.status}"` : '', hit.details].filter(Boolean).join(' — ');
            this.running = false;
            this.update('found', 'Fout gevonden: ' + where, { detail: detail + (shown ? '' : ' (rij kon niet worden gemarkeerd)') });
            return;
          }

          const el = sc();
          if (!atBottom(el)) {
            endAttempts = 0;
            const before = el.scrollTop;
            scrollTo(el, before + Math.max(40, Math.floor(el.clientHeight * t.scrollStepRatio)));
            this.update('searching', 'Zoeken…');
            const w = await settle();
            if (w.timedOut && w.stillLoading) this.update('searching', 'Zoeken… (Pulse is nog aan het laden)');
            if (el.scrollTop <= before + 1 && !atBottom(el)) {
              if (++stuck >= 3) return this.finish('incomplete', 'Scan onvolledig: de tabel kan niet verder gescrolld worden.');
            } else stuck = 0;
            continue;
          }

          // Onderaan de geladen rijen: controleren of Pulse nog meer data laadt.
          this.update('searching', `Zoeken… wachten op meer data (${endAttempts + 1}/${t.endConfirmAttempts})`);
          const h = el.scrollHeight;
          const rowsBefore = grid.queryRows().length;
          nudge(el);
          const w = await settle({ minWaitForChangeMs: t.endWaitMs });
          if (this.stopRequested) continue;
          if (el.scrollHeight > h + 1 || grid.queryRows().length !== rowsBefore || !atBottom(el)) { endAttempts = 0; continue; }
          if (w.stillLoading) {
            if (++stuck >= 3) return this.finish('incomplete', 'Scan onvolledig: einde van de data niet bevestigd (Pulse bleef laden).');
            continue;
          }
          if (++endAttempts < t.endConfirmAttempts) continue;

          // Laatste controle van de rijen die nu in beeld zijn.
          const last = this.scanVisible();
          if (last) { endAttempts = 0; continue; }
          const loadMore = findLoadMoreButton(grid, s);
          if (loadMore) return this.finish('incomplete', `Scan onvolledig: einde van de data niet bevestigd (er staat een knop "${loadMore}"; daar wordt niet op geklikt).`);
          if (!this.checkedRows.size) return this.finish('incomplete', 'Geen meetregels gevonden: de tabel is leeg of de rijen worden niet herkend.');
          if (!this.startedAtTop) return this.finish('incomplete', 'Einde van de tabel bereikt, maar de zoektocht begon niet bovenaan. Klik op "Zoek fouten" voor een volledige controle.');
          if (!this.found.length) return this.finish('complete', 'Geen fouten gevonden in de volledig gecontroleerde data.');
          return this.finish('complete', `Geen verdere fouten. Einde van de tabel bereikt (${this.found.length} fout(en) gevonden).`);
        }
      } catch (e) {
        return this.finish('incomplete', 'Scan onvolledig: ' + (e && e.message ? e.message : e));
      }
    }

    finish(state, text) {
      this.running = false;
      // na Stop gaat "Volgende fout" verder vanaf de bovenkant van het huidige beeld
      if (state === 'stopped' && this.grid && this.grid.scroller) {
        const top = this.grid.scroller.scrollTop;
        this.cursorTop = this.cursorTop == null ? top : Math.min(Math.max(this.cursorTop, 0), top);
      }
      this.update(state, text);
    }
  }

  root.PulseFinder = { Finder, clearHighlight, waitForSettle, isLoading };
})(typeof globalThis !== 'undefined' ? globalThis : this);

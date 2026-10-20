/*
 * Uitlezen en classificeren van statuscellen.
 *
 * Bewijs wordt uitsluitend binnen de statuscel van de betreffende meetreeks verzameld,
 * zodat een rode indicator elders in de rij nooit aan deze status wordt gekoppeld.
 * Volgorde van zwaarte: tekst > expliciete attributen/tooltip > CSS-class > kleur.
 * Kleur alleen bepaalt de categorie uitsluitend als er geen statustekst is, of (bij
 * een rode indicator) als de tekst onbekend is. Anders wordt een afwijkende kleur
 * alleen in de details genoemd.
 */
(function (root) {
  const { norm, visibleText } = root.PulseGrid;
  const SEVERITY = { critical: 4, warning: 3, unknown: 2, info: 1, normal: 0 };
  const MAX_EVIDENCE_ELS = 25;

  const regexCache = new Map();
  function rx(src) {
    if (!regexCache.has(src)) {
      try { regexCache.set(src, new RegExp(src, 'i')); } catch (e) { regexCache.set(src, null); }
    }
    return regexCache.get(src);
  }

  function matchRules(text, rules, order) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    for (const cat of order || ['critical', 'warning', 'info', 'normal']) {
      for (const p of (rules && rules[cat]) || []) {
        const r = rx(p);
        if (r && r.test(t)) return cat;
      }
    }
    return null;
  }

  // ---------- kleur ----------

  function parseColor(str) {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(str || '');
    if (!m) return null;
    let a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }

  function hueName(c) {
    if (!c || c.a < 0.3) return '';
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (s < 0.3 || l < 0.15 || l > 0.9) return 'grey';
    let h;
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    if (h < 14 || h >= 340) return 'red';
    if (h < 40) return 'orange';
    if (h < 66) return 'yellow';
    if (h < 170) return 'green';
    if (h < 260) return 'blue';
    return '';
  }

  // Kleine elementen (bolletjes/iconen), svg-vormen en pseudo-elementen binnen de cel.
  function indicatorColors(cell) {
    const out = [];
    const els = [cell, ...Array.from(cell.querySelectorAll('*')).slice(0, MAX_EVIDENCE_ELS)];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const cs = getComputedStyle(el);
      const small = r.width <= 28 && r.height <= 28;
      const isSvg = el instanceof SVGElement;
      const push = (source, value) => {
        const h = hueName(parseColor(value));
        if (h && h !== 'grey') out.push({ hue: h, source, value });
      };
      if (el === cell) {
        push('celachtergrond', cs.backgroundColor);
      } else if (isSvg) {
        if (cs.fill && cs.fill !== 'none') push('svg-vulling', cs.fill);
        if (cs.stroke && cs.stroke !== 'none' && el.tagName.toLowerCase() !== 'svg') push('svg-lijn', cs.stroke);
      } else if (small) {
        push('indicator', cs.backgroundColor);
        if (parseFloat(cs.borderTopWidth) > 0) push('indicatorrand', cs.borderTopColor);
        if (visibleText(el).length <= 2) push('icoon', cs.color); // icoonfont-glyph
      }
      for (const pseudo of ['::before', '::after']) {
        const ps = getComputedStyle(el, pseudo);
        if (!ps || ps.content === 'none' || ps.content === 'normal') continue;
        const pw = parseFloat(ps.width), ph = parseFloat(ps.height);
        if (pw > 0 && pw <= 28 && ph > 0 && ph <= 28) push('indicator' + pseudo, ps.backgroundColor);
        if (ps.content && ps.content.length <= 4) push('icoon' + pseudo, ps.color);
      }
      // tekstkleur van de statustekst zelf (bijv. rode "Fout")
      if (!isSvg && el.childNodes.length && Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) {
        push('tekstkleur', cs.color);
      }
    }
    return out;
  }

  // ---------- bewijs uit de statuscel ----------

  function collectEvidence(cell, settings) {
    const ev = { text: '', attrs: [], classes: [], colors: [] };
    if (!cell) return ev;
    ev.text = visibleText(cell);
    const seenAttr = new Set([norm(ev.text)]);
    const els = [cell, ...Array.from(cell.querySelectorAll('*')).slice(0, MAX_EVIDENCE_ELS)];
    const classSet = new Set();
    for (const el of els) {
      for (const a of settings.tooltipAttributes) {
        const v = el.getAttribute && el.getAttribute(a);
        if (v && v.trim() && !seenAttr.has(norm(v))) { seenAttr.add(norm(v)); ev.attrs.push(v.trim()); }
      }
      const ids = el.getAttribute && el.getAttribute('aria-describedby');
      if (ids) {
        for (const id of ids.split(/\s+/)) {
          const ref = id && document.getElementById(id);
          const v = ref && (ref.textContent || '').trim();
          if (v && !seenAttr.has(norm(v))) { seenAttr.add(norm(v)); ev.attrs.push(v); }
        }
      }
      const cls = el.getAttribute && el.getAttribute('class');
      if (cls) cls.split(/\s+/).forEach((c) => c && classSet.add(c));
    }
    ev.classes = Array.from(classSet).slice(0, 40);
    ev.colors = indicatorColors(cell);
    return ev;
  }

  function worst(a, b) {
    if (!a) return b;
    if (!b) return a;
    return SEVERITY[a] >= SEVERITY[b] ? a : b;
  }

  // Classificeert één meetreeks in één rij.
  function classify({ evidence, value, quality }, settings) {
    const details = [];
    const statusText = evidence.text;
    const textCat = matchRules(statusText, settings.statusRules);

    let attrCat = null;
    let attrHit = '';
    for (const a of evidence.attrs) {
      const c = matchRules(a, settings.statusRules);
      if (c && (!attrCat || SEVERITY[c] > SEVERITY[attrCat])) { attrCat = c; attrHit = a; }
    }
    let classCat = null;
    let classHit = '';
    for (const c of evidence.classes) {
      const k = matchRules(c, settings.classRules, ['critical', 'warning', 'normal']);
      if (k && (!classCat || SEVERITY[k] > SEVERITY[classCat])) { classCat = k; classHit = c; }
    }
    let colorCat = null;
    let colorHit = null;
    for (const col of evidence.colors) {
      const k = settings.colorRules[col.hue];
      if (k && (!colorCat || SEVERITY[k] > SEVERITY[colorCat])) { colorCat = k; colorHit = col; }
    }
    const qualityCat = matchRules(quality, settings.qualityRules, ['critical', 'warning']);
    const valueEmpty = !String(value || '').trim();
    const hasIndicator = evidence.colors.length > 0 || evidence.attrs.length > 0;

    let category;
    let kind = 'status';
    if (textCat) {
      category = textCat;
      // expliciete tekst in tooltip/aria of een foutclass is 'aanvullende informatie'
      const explicit = worst(attrCat, classCat);
      if (explicit && SEVERITY[explicit] > SEVERITY[category] && (explicit === 'critical' || explicit === 'warning')) {
        category = explicit;
        details.push(attrCat === explicit ? `Tooltip/label: "${attrHit}"` : `Foutclass: ${classHit}`);
      }
      if (colorCat && SEVERITY[colorCat] > SEVERITY[category] && SEVERITY[colorCat] >= SEVERITY.warning) {
        details.push(`Let op: indicatorkleur ${colorHit.hue} (${colorHit.source}) wijkt af van status "${statusText}"`);
      }
    } else if (statusText) {
      // tekst aanwezig maar niet herkend
      const explicit = worst(attrCat, classCat);
      if (explicit && explicit !== 'normal') {
        category = explicit;
        details.push(attrCat === explicit ? `Tooltip/label: "${attrHit}"` : `Foutclass: ${classHit}`);
      } else if (colorCat === 'critical') {
        category = 'critical';
        details.push(`Onbekende statustekst met rode indicator (${colorHit.source})`);
      } else {
        category = 'unknown';
        if (colorHit) details.push(`Indicatorkleur: ${colorHit.hue} (${colorHit.source})`);
      }
    } else {
      // geen statustekst: alleen icoon/tooltip
      if (attrCat) { category = attrCat; details.push(`Tooltip/label: "${attrHit}"`); }
      else if (classCat) { category = classCat; details.push(`Class: ${classHit}`); }
      else if (colorCat && settings.colorDecidesWhenTextUnknown) {
        category = colorCat;
        details.push(`Alleen statusindicator: ${colorHit.hue} (${colorHit.source})`);
      } else if (valueEmpty && !hasIndicator) {
        category = settings.missingValueCategory || 'warning';
        kind = 'missing';
        details.push('Ontbrekende meting: geen waarde en geen status');
      } else {
        category = 'unknown';
        details.push(evidence.attrs.length ? 'Status onbekend: ' + evidence.attrs.join(' | ') : 'Geen statustekst');
      }
    }

    if (qualityCat && SEVERITY[qualityCat] > SEVERITY[category]) {
      category = qualityCat;
      details.push(`Kwaliteit: "${quality}"`);
    }
    if (kind !== 'missing' && valueEmpty) {
      if (SEVERITY[category] < SEVERITY.warning) {
        category = settings.missingValueCategory || 'warning';
        kind = 'missing';
      }
      details.push('Waarde ontbreekt');
    }
    if (category === 'critical' && kind === 'status') kind = 'error';
    if (evidence.attrs.length && !details.some((d) => d.startsWith('Tooltip') || d.startsWith('Status onbekend'))) {
      details.push('Tooltip/label: ' + evidence.attrs.join(' | '));
    }
    return { category, kind, details };
  }

  root.PulseClassify = { classify, collectEvidence, matchRules, hueName, parseColor, SEVERITY };
})(typeof globalThis !== 'undefined' ? globalThis : this);

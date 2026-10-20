// Integratietest in headless Chromium met de uitgepakte extensie.
// Draait tegen lokale testpagina's (test/fixtures) die het laadgedrag simuleren;
// dit vervangt NIET de controle op de echte Pulse-pagina.
//
// Gebruik: node test/run-tests.mjs   (vereist het npm-pakket "playwright")
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const here = path.dirname(fileURLToPath(import.meta.url));
const extSrc = path.resolve(here, '..');

// Kopie van de extensie met host-toegang tot localhost: in een test kan niet op het
// werkbalkicoon geklikt worden (activeTab), dus injecteert de test zelf.
const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pef-ext-'));
fs.cpSync(extSrc, extDir, { recursive: true, filter: (p) => !p.includes(`${path.sep}test`) });
const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest));
fs.appendFileSync(path.join(extDir, 'src/background.js'), '\nglobalThis.showFinder = showFinder;\n');
// testhaken in de content-scriptwereld (eval is daar niet toegestaan)
fs.appendFileSync(path.join(extDir, 'src/content/panel.js'), `
globalThis.__pefTest = {
  probe: () => PulseFinderContent.probe(),
  search: (fromStart) => { PulseFinderContent.finder.search({ fromStart }); return true; },
  stop: () => { PulseFinderContent.finder.stop(); return true; },
  state: () => ({ running: PulseFinderContent.finder.running, last: PulseFinderContent.finder.last }),
  timing: (t) => { Object.assign(PulseScanDefaults.DEFAULT_SETTINGS.timing, t); return true; }
};`);

const server = http.createServer((req, res) => {
  const file = path.join(here, 'fixtures', decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true, viewport: { width: 1200, height: 800 },
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`]
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');

let failures = 0;
const check = (cond, label, extra) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${!cond && extra ? '  → ' + JSON.stringify(extra) : ''}`);
  if (!cond) failures++;
};

async function open(file) {
  const page = await ctx.newPage();
  await page.goto(base + file);
  await page.waitForTimeout(200);
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, page.url());
  // zelfde pad als een klik op het icoon
  await sw.evaluate((id) => globalThis.showFinder({ id }), tabId);
  return { page, tabId };
}

const inPage = (tabId, name, arg) => sw.evaluate(async ([id, n, a]) => {
  const [r] = await chrome.scripting.executeScript({ target: { tabId: id }, func: (n2, a2) => globalThis.__pefTest[n2](a2), args: [n, a ?? null] });
  return r.result;
}, [tabId, name, arg]);

async function run(tabId, fromStart, { timeout = 60000 } = {}) {
  await inPage(tabId, 'search', fromStart);
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 150));
    const st = await inPage(tabId, 'state');
    if (!st.running && st.last && st.last.state !== 'searching') return st.last;
    if (process.env.DEBUG && Math.random() < 0.1) console.log('    …', JSON.stringify(st.last));
    if (Date.now() - t0 > timeout) return { state: 'timeout', text: 'timeout', last: st.last };
  }
}

const markedRowText = (page) => page.evaluate(() => {
  const el = Array.from(document.querySelectorAll('tr,[role=row]')).filter((e) => e.style.outline.includes('3px'));
  return el.map((e) => e.innerText.replace(/\s+/g, ' ').trim()).join(' || ');
});

// ---------- 1. tabel met groepskoppen en bijladen ----------
console.log('Tabel (colspan-koppen, bijladen met laadindicator, 300 rijen in 5 delen)');
{
  const { page, tabId } = await open('table-infinite.html');
  const probe = await inPage(tabId, 'probe');
  check(probe.found && probe.grid.series.map((s) => s.name).join(',') === 'Energie 8,Energie 9', 'meetreeksen Energie 8 en Energie 9 herkend', probe);
  check(probe.grid && probe.grid.scroller.startsWith('div#wrap'), 'scrollcontainer is de tabelcontainer, niet de pagina', probe.grid && probe.grid.scroller);

  const expected = [
    ['20-09-2026 10:00', 'Energie 8'], // rij 40: "Fout"
    ['21-09-2026 08:30', 'Energie 9'], // rij 130: alleen rood bolletje
    ['22-09-2026 14:30', 'Energie 8'], // rij 250: "Rejected"
    ['22-09-2026 14:30', 'Energie 9']  // rij 250: "Mislukt"
  ];
  for (let k = 0; k < expected.length; k++) {
    const r = await run(tabId, k === 0);
    const want = `Fout gevonden: ${expected[k][0]}, ${expected[k][1]}`;
    check(r.state === 'found' && r.text === want, `${k === 0 ? 'Zoek fouten' : 'Volgende fout'} → "${want}"`, r);
    const marked = await markedRowText(page);
    check(marked.startsWith(expected[k][0]), '  rij gemarkeerd in de tabel', marked);
    const inView = await page.evaluate((t) => {
      const tr = Array.from(document.querySelectorAll('tr')).find((e) => e.cells[0] && e.cells[0].innerText === t);
      const w = document.getElementById('wrap').getBoundingClientRect(), b = tr.getBoundingClientRect();
      return b.top >= w.top && b.bottom <= w.bottom;
    }, expected[k][0]);
    check(inView, '  rij staat zichtbaar in de scrollcontainer');
  }
  const end = await run(tabId, false);
  check(end.state === 'complete' && /Geen verdere fouten/.test(end.text) && end.foundCount === 4, 'daarna: einde bevestigd, 4 fouten totaal', end);
  check(end.checked === 300, 'alle 300 rijen gecontroleerd (ook bijgeladen rijen)', end.checked);
  const again = await run(tabId, true);
  check(again.text === `Fout gevonden: ${expected[0][0]}, ${expected[0][1]}`, '"Zoek fouten" begint opnieuw bovenaan', again);
  await page.close();
}

// ---------- 2. geen fouten ----------
console.log('Tabel zonder fouten (OK, Handm. goedgekeurd, onbekende status, ontbrekende meting)');
{
  const { page, tabId } = await open('table-infinite.html?clean=1');
  const r = await run(tabId, true);
  check(r.state === 'complete' && r.text === 'Geen fouten gevonden in de volledig gecontroleerde data.', 'melding: geen fouten in volledig gecontroleerde data', r);
  check(r.checked === 300, 'alle 300 rijen gecontroleerd', r.checked);
  await page.close();
}

// ---------- 3. stoppen en verder ----------
console.log('Stop en Volgende fout');
{
  const { page, tabId } = await open('table-infinite.html');
  await inPage(tabId, 'search', true);
  await new Promise((r) => setTimeout(r, 300));
  await inPage(tabId, 'stop');
  let st;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100));
    st = (await inPage(tabId, 'state')).last;
    if (st.state !== 'searching') break;
  }
  check(st.state === 'stopped' && st.text === 'Gestopt.', 'Stop beëindigt het zoeken', st);
  const r = await run(tabId, false);
  check(r.state === 'found' && r.text === 'Fout gevonden: 20-09-2026 10:00, Energie 8', 'Volgende fout na Stop vindt de eerste fout', r);
  await page.close();
}

// ---------- 4. laadindicator blijft staan ----------
console.log('Einde niet te bevestigen (laadindicator blijft zichtbaar)');
{
  const { page, tabId } = await open('table-infinite.html?clean=1&stuck=1');
  await inPage(tabId, 'timing', { maxWaitMs: 1500 });
  const r = await run(tabId, true);
  check(r.state === 'incomplete' && /^Scan onvolledig: einde van de data niet bevestigd/.test(r.text), 'melding: scan onvolledig', r);
  await page.close();
}

// ---------- 5. lege tabel ----------
console.log('Lege tabel');
{
  const { page, tabId } = await open('table-infinite.html?empty=1');
  const r = await run(tabId, true);
  check(r.state === 'incomplete' && /Geen meetregels gevonden/.test(r.text), 'lege tabel wordt niet als "geen fouten" gemeld', r);
  await page.close();
}

// ---------- 6. virtual scrolling ----------
console.log('ARIA-grid met virtual scrolling, vastgezette tijdkolom, stil bijladen (500 rijen)');
{
  const { page, tabId } = await open('aria-virtual.html');
  const probe = await inPage(tabId, 'probe');
  check(probe.found && probe.grid.series.length === 2 && probe.grid.rowMode === 'aria', 'ARIA-grid en 2 meetreeksen herkend', probe);
  const expected = [
    ['20-09-2026 10:00', 'Energie 9', 'Error'],
    ['03-10-2026 21:00', 'Energie 8', ''],
    ['10-10-2026 00:00', 'Energie 8', 'Ongeldig']
  ];
  for (let k = 0; k < expected.length; k++) {
    const r = await run(tabId, k === 0);
    const want = `Fout gevonden: ${expected[k][0]}, ${expected[k][1]}`;
    check(r.state === 'found' && r.text === want, `→ "${want}"`, r);
    if (k === 1) check(/Meetfout/.test(r.detail || ''), '  tooltiptekst "Meetfout" in de details', r.detail);
    const marked = await markedRowText(page);
    check(marked.includes(expected[k][0]), '  rij-fragmenten gemarkeerd', marked);
  }
  const end = await run(tabId, false);
  check(end.state === 'complete' && end.foundCount === 3 && end.checked === 500, 'einde bevestigd na stil bijladen; 500 rijen, 3 fouten', end);
  await page.close();
}

// ---------- 7. pagina zonder tabel ----------
console.log('Pagina zonder meetdatatabel');
{
  const page = await ctx.newPage();
  await page.setContent('<p>Geen tabel</p>');
  await page.goto(base + 'table-infinite.html?empty=1');
  await page.evaluate(() => { document.querySelector('table').remove(); });
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, page.url());
  await sw.evaluate((id) => globalThis.showFinder({ id }), tabId);
  const st = await inPage(tabId, 'probe');
  check(!st.found, 'geen tabel → geen zoekactie, wel uitleg', st);
  await page.close();
}

await ctx.close();
server.close();
fs.rmSync(extDir, { recursive: true, force: true });
console.log(failures ? `\n${failures} controle(s) mislukt` : '\nAlle controles geslaagd');
process.exit(failures ? 1 : 0);

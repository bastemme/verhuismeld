/*
 * Klik op het extensie-icoon: injecteer de zoeker in het actieve tabblad (activeTab)
 * en toon het bedieningspaneel in het frame waarin de meetdatatabel staat.
 * De service worker bewaart geen status; alles draait in de pagina zelf.
 */
const FILES = [
  'src/shared/defaults.js',
  'src/content/grid.js',
  'src/content/classify.js',
  'src/content/finder.js',
  'src/content/panel.js'
];

async function showFinder(tab) {
  const tabId = tab.id;
  let target = { tabId, allFrames: true };
  try {
    await chrome.scripting.executeScript({ target, files: FILES });
  } catch (e) {
    target = { tabId };
    try {
      await chrome.scripting.executeScript({ target, files: FILES });
    } catch (e2) {
      console.warn('Pulse Error Finder: deze pagina kan niet worden gelezen.', e2);
      return;
    }
  }
  const results = await chrome.scripting.executeScript({
    target,
    func: () => (globalThis.PulseFinderContent ? globalThis.PulseFinderContent.probe() : null)
  });
  let best = null;
  let reason = 'Geen tabel met de kolom "Status" gevonden.';
  for (const r of results) {
    if (r.result && r.result.found && (!best || r.result.score > best.score)) best = { frameId: r.frameId, score: r.result.score };
    if (r.frameId === 0 && r.result && !r.result.found) reason = r.result.reason;
  }
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [best ? best.frameId : 0] },
    func: (why) => globalThis.PulseFinderContent && globalThis.PulseFinderContent.showPanel(why),
    args: [best ? null : reason]
  });
}

chrome.action.onClicked.addListener(showFinder);

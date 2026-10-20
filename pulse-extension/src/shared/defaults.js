/*
 * Standaardinstellingen en detectieregels.
 *
 * Pas deze regels hier aan om statussen toe te voegen (daarna de extensie herladen
 * via chrome://extensions). Patronen zijn reguliere expressies (hoofdletterongevoelig).
 * Deze regels zijn bewust generiek: ze beschrijven tekst die in Pulse zichtbaar is
 * (zoals "OK" en "Handm. goedgekeurd"), niet een vermoede HTML-structuur.
 */
(function (root) {
  const DEFAULT_SETTINGS = {
    version: 1,

    // Kolomkoppen. Iedere meetreeks bestaat uit een set waarde/kwaliteit/status-kolommen.
    headers: {
      time: ['Tijdstip', 'Datum/tijd', 'Datum tijd', 'Tijd', 'Timestamp'],
      value: ['Waarde', 'Value'],
      quality: ['Kwaliteit', 'Quality'],
      status: ['Status'],
      // Kolommen die een meetpunt identificeren (indien per rij aanwezig).
      meetpunt: ['Meetpunt', 'EAN', 'EAN-code', 'Aansluiting', 'Kanaal', 'Register']
    },

    // Optioneel: CSS-selector voor een element buiten de tabel dat het meetpunt
    // identificeert (bijv. de geselecteerde aansluiting). Leeg = niet gebruiken.
    meetpuntSelector: '',

    // Classificatie van de statustekst. Volgorde van controle: critical, warning, info, normal.
    // De eerste categorie waarvan een patroon matcht wint.
    statusRules: {
      critical: [
        '^fout', '\\bfout(ief|ieve)?\\b', '\\berror\\b', '\\bmislukt\\b', '\\bfailed\\b',
        '\\brejected\\b', '\\bongeldig\\b', '\\binvalid\\b', '\\bafgekeurd\\b'
      ],
      warning: [
        '\\bwaarschuwing\\b', '\\bwarning\\b', '\\bontbre(ekt|kend|kende)\\b', '\\bmissing\\b',
        '\\bonvolledig\\b', '\\bincomplete\\b'
      ],
      info: ['^handm\\.?\\s*goedgekeurd', '^handmatig\\s+goedgekeurd', '\\bmanually approved\\b'],
      normal: ['^ok$']
    },

    // Kwaliteitsveld: alleen expliciete teksten. Lege kwaliteit wordt niet als fout gezien.
    qualityRules: {
      critical: ['\\bongeldig\\b', '\\binvalid\\b', '\\bfout\\b', '\\berror\\b'],
      warning: ['\\bontbre(ekt|kend|kende)\\b', '\\bmissing\\b', '\\bonvolledig\\b', '\\bincomplete\\b']
    },

    // Kleur van een statusindicator (bolletje/icoon) binnen de statuscel.
    // Waarde: categorie, of '' om de kleur te negeren.
    colorRules: { red: 'critical', orange: 'warning', yellow: 'warning', green: 'normal', blue: '', grey: '' },

    // Als de statustekst leeg/onbekend is, mag een kleur alleen dan de categorie bepalen.
    // Een kleur die afwijkt van een herkende tekst wordt als 'tegenstrijdig' in de details gemeld.
    colorDecidesWhenTextUnknown: true,

    // Lege waarde + lege status = ontbrekende meting (waarschuwing), niet een foutieve meting.
    missingValueCategory: 'warning',

    // CSS-classes van iconen/cellen. Matcht op classnamen van de statuscel en haar kinderen.
    classRules: {
      critical: ['(^|[-_])(error|danger|fail|failed|invalid|rejected|fout)([-_]|$)'],
      warning: ['(^|[-_])(warning|warn|missing)([-_]|$)'],
      normal: []
    },

    // Signalen dat de tabel aan het laden is (generiek, niet Pulse-specifiek).
    loading: {
      selectors: ['[aria-busy="true"]', '[role="progressbar"]', '.spinner', '.loading', '.loader',
        '.ag-loading', '.ag-overlay-loading-wrapper', '.k-loading-mask', '.dx-loadpanel-content',
        '.mat-progress-spinner', '.mat-mdc-progress-spinner', '.v-progress-circular'],
      texts: ['^laden', '^bezig met laden', '^loading', '^gegevens ophalen']
    },

    // Teksten van knoppen die op handmatig 'meer laden' wijzen. De scanner klikt hier NIET op,
    // maar meldt de scan als mogelijk onvolledig.
    loadMoreTexts: ['meer laden', 'load more', 'toon meer', 'meer tonen'],

    timing: {
      settleMs: 350,        // stilte (geen DOM-wijzigingen) voordat data als geladen geldt
      maxWaitMs: 12000,     // maximale wachttijd op laden na een scroll
      endWaitMs: 2500,      // wachttijd per eindbevestiging onderaan de tabel
      endConfirmAttempts: 3,// aantal pogingen onderaan zonder nieuwe data voordat einde vaststaat
      scrollStepRatio: 0.8  // scrollstap als deel van de zichtbare hoogte (overlap voorkomt gaten)
    },

    // Vluchtige status/hint-attributen die tooltips bevatten.
    tooltipAttributes: ['title', 'aria-label', 'data-tooltip', 'data-title', 'data-original-title',
      'data-bs-original-title', 'data-tip', 'mattooltip', 'ng-reflect-message', 'ptooltip', 'tooltip']
  };

  root.PulseScanDefaults = { DEFAULT_SETTINGS };
})(typeof globalThis !== 'undefined' ? globalThis : this);

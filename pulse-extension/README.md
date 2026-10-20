# Pulse Error Finder (Chrome-extensie)

Zoekt fouten in de meetdatatabel van Pulse. De extensie scrolt zelf door de tabel, laat
Pulse nieuwe rijen laden, stopt bij de eerste fout en markeert die rij met een rode rand.

> **Status:** getest op lokale testpagina's die het laadgedrag nabootsen (zie *Testen*).
> **Nog niet getest op de echte Pulse-pagina.** Zie *Eerste keer op Pulse* hieronder.

## Installeren

1. Open `chrome://extensions`.
2. Zet rechtsboven **Ontwikkelaarsmodus** aan.
3. Klik op **Uitgepakte extensie laden** (*Load unpacked*) en kies de map `pulse-extension`.
4. Zet de extensie eventueel vast via het puzzelstukje in de werkbalk.

## Gebruik

1. Open in Pulse de meetdatatabel.
2. Klik op het extensie-icoon. Rechtsonder verschijnt een klein paneel (versleepbaar).
   Het paneel meldt welke meetreeksen zijn herkend, bijvoorbeeld `Tabel herkend: Energie 8, Energie 9`.
3. Gebruik de knoppen:
   - **Zoek fouten**: begint bovenaan de tabel en zoekt tot de eerste fout.
   - **Volgende fout**: zoekt verder vanaf de laatst gevonden fout (of vanaf waar je op Stop drukte).
   - **Stop**: stopt het zoeken direct.

Mogelijke meldingen:

| Melding | Betekenis |
|---|---|
| `Zoeken…` | De extensie scrolt en wacht op nieuwe rijen. |
| `Fout gevonden: <tijdstip>, <meetreeks>` | Tijdstip en meetreeks zoals ze in Pulse staan. Daaronder de originele status en details. |
| `Geen fouten gevonden in de volledig gecontroleerde data.` | Bovenaan begonnen en het einde van de data is bevestigd. |
| `Geen verdere fouten. Einde van de tabel bereikt (N fout(en) gevonden).` | Alle fouten zijn langsgelopen. |
| `Scan onvolledig: …` | Het einde kon niet betrouwbaar worden vastgesteld. De reden staat erbij. |
| `Geen meetregels gevonden…` | Lege tabel of rijen niet herkend. Dit wordt nooit als "geen fouten" gemeld. |

## Wat telt als fout

Alleen de statuscel van de betreffende meetreeks telt mee. Een rood icoon elders in de rij
(bijvoorbeeld een verwijderknop) wordt dus nooit aan een meetreeks gekoppeld.

- **Fout**: statustekst zoals `Fout`, `Error`, `Mislukt`, `Failed`, `Rejected`, `Ongeldig`, `Afgekeurd`.
  Dit geldt ook voor dezelfde tekst in een tooltip of `aria-label`, of voor een foutclass (`error`, `danger`, `failed` …).
- **Rood statusbolletje**: telt als fout als de status geen tekst heeft, of als de tekst onbekend is.
  De originele tekst staat dan in de melding, zodat je het zelf kunt beoordelen.
- **Geen fout**: `OK` (normaal), `Handm. goedgekeurd` (informatief), onbekende statussen zonder
  rode indicator, en ontbrekende metingen (lege waarde en lege status).

De regels staan in `src/shared/defaults.js` en zijn reguliere expressies. Pas ze daar aan en
klik daarna in `chrome://extensions` op het vernieuwicoon van de extensie.

## Hoe het werkt

- **Tabel herkennen** gebeurt zonder vaste CSS-selectors. De extensie zoekt de kolomkoppen
  `Tijdstip`, `Waarde`, `Kwaliteit` en `Status`. Iedere set kolommen wordt gekoppeld aan de
  groepskop erboven (bijv. `Energie 8`). Cellen worden aan kolommen gekoppeld via
  `aria-colindex` of anders via hun horizontale positie onder de kop. Dat werkt voor
  `<table>`, ARIA-grids (AG Grid e.d.) en div-tabellen, ook met vastgezette kolommen.
- **Scrollcontainer**: de dichtstbijzijnde scrollbare voorouder van de rijen. De pagina zelf
  wordt alleen gebruikt als de tabel niet in een eigen container staat.
- **Wachten op data**: een `MutationObserver` met een korte stilteperiode, laadindicatoren
  (`aria-busy`, `role=progressbar`, spinners, de tekst "Laden…") en de scrollhoogte.
  Er zit geen vaste lange wachttijd na iedere scroll.
- **Einde van de data**: onderaan scrolt de extensie een paar keer opnieuw (met een
  wheel-event erbij) en wacht dan steeds op nieuwe rijen. Pas als dat drie keer niets
  oplevert, geldt het einde als bevestigd. Blijft er een laadindicator staan, of staat er een
  knop "Meer laden", dan volgt `Scan onvolledig`. Op zo'n knop wordt niet geklikt.
- **Virtual scrolling**: iedere rij wordt gecontroleerd terwijl hij in de DOM staat. Een
  gevonden fout wordt eerst bewaard (tijdstip, meetreeks, rij-ID en positie) en de rij wordt
  daarna opnieuw opgezocht om te markeren. Al gemelde fouten worden overgeslagen.

## Rechten en veiligheid

- Rechten: alleen `activeTab` en `scripting`. Er zijn geen vaste hostrechten. De extensie
  krijgt alleen toegang tot het tabblad waarin je op het icoon klikt.
- Alleen-lezen: de extensie leest de DOM en verandert de scrollpositie. Er wordt nergens op
  geklikt, er worden geen formulieren verstuurd en er wordt niets opgeslagen of verzonden.
  De enige zichtbare wijziging is de tijdelijke rode rand en achtergrond van de gevonden rij.

## Eerste keer op Pulse: wat ik van je nodig heb

Ik had geen toegang tot Pulse. Doe daarom de eerste keer het volgende:

1. Open een meetdatatabel en klik op het icoon. Wordt de tabel herkend, met de juiste meetreeksen?
2. Klik op **Zoek fouten** in een tabel waarvan je weet dat er een fout in staat.
   Klopt de gemelde fout (tijdstip, meetreeks)?
3. Werkt iets niet, klik dan in het paneel op **Diagnose opslaan (tabelstructuur)** en stuur
   mij het bestand `pulse-diagnose.json`. Het bevat de opbouw van de kolomkoppen, een paar
   voorbeeldrijen en de gegevens van de statusbolletjes (kleur, classes, tooltips) en de
   scrollcontainer. Cijfers in waarden en tijdstippen zijn vervangen door `9`;
   statusteksten blijven leesbaar. Kijk het bestand na voordat je het deelt.

Handig als aanvulling: een screenshot van de tabel met een rood bolletje, en de naam van het
Pulse-domein. Met dat domein kan ik de extensie zo instellen dat het paneel automatisch
verschijnt.

## Testen (ontwikkelaars)

```
node test/run-tests.mjs
```

Hiervoor is het npm-pakket `playwright` met Chromium nodig. De test laadt de extensie in
headless Chromium en draait tegen testpagina's in `test/fixtures/`:

- `table-infinite.html`: `<table>` met groepskoppen (colspan) en rijen die in delen worden
  bijgeladen, met laadindicator. Varianten: zonder fouten, een laadindicator die blijft
  staan, en een lege tabel.
- `aria-virtual.html`: ARIA-grid met virtual scrolling, een vastgezette tijdkolom en stil
  bijladen zonder laadindicator.

Dit zijn simulaties, geen Pulse. Ze tonen aan dat het mechanisme werkt, niet dat de
herkenning op de echte Pulse-DOM klopt.

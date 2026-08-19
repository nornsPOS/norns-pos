/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EIN ERZEUGER, DEN NIEMAND RUFT, IST EINE GRÜNE PRÜFUNG OHNE WIRKUNG
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die zwanzig Dateien, der Bauplan, die geschlossenen Listen — alles gebaut
 * und alles geprüft. Solange die Exportroute weiter `buildDsfinvkBundle`
 * ruft, ändert davon NICHTS etwas an der Datei, die Roman bekommt.
 *
 * Diese Prüfung bewacht genau die Naht.
 */

import { describe, expect, it } from 'vitest';

// ⚠️ 18.08.2026: der Tages-Erzeuger ist WORTGLEICH aus der Route nach
// `lib/dsfinvk-tag.ts` gewandert (zweiter Rufer: das Prueferpaket der
// Kassennachschau). Dieser Waechter liest seither BEIDE Dateien: den Rumpf
// dort, die Verdrahtung hier.
const lies = async () => {
  const { readFileSync } = await import('node:fs');
  return (
    readFileSync(new URL('../../src/lib/dsfinvk-tag.ts', import.meta.url), 'utf8') +
    '\n' +
    readFileSync(new URL('../../src/routes/closing-export.ts', import.meta.url), 'utf8')
  );
};

const ohneKommentare = (q: string) =>
  q
    .split('\n')
    .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
    .join('\n');

describe('⛔ die Route erzeugt nach der NORM', () => {
  it('sie ruft den neuen Erzeuger', async () => {
    const q = ohneKommentare(await lies());
    expect(q).toContain('baueAlleDateien(');
    expect(q).toContain('leseTaxonomie(amtlicheTaxonomie())');
  });

  it('⛔ und der ALTE Erzeuger wird nicht mehr gerufen', async () => {
    // Er darf noch existieren (andere Prüfungen lesen ihn), aber nicht mehr
    // den Weg bestimmen, auf dem Romans Datei entsteht.
    const q = ohneKommentare(await lies());
    expect(
      /buildDsfinvkBundle\s*\(/.test(q),
      'die Route baut das Paket wieder mit dem alten Erzeuger',
    ).toBe(false);
  });

  it('⛔ die amtlichen Beschreibungsdateien liegen IM Paket', async () => {
    // Ohne index.xml und DTD kann ein Prüfer den Datenträger nicht einlesen.
    // ⚠️ Auf die WIRKUNG prüfen, nicht auf die Aufrufform. Der erste Entwurf
    // verlangte wörtlich `amtlicheBeschreibung()` — und wurde rot, sobald die
    // Funktion einen Parameter bekam (den Absender des Datenträgers). Der
    // Code war dabei richtiger als vorher.
    const q = ohneKommentare(await lies());
    expect(q, 'die Beschreibungsdateien fehlen im Paket').toContain('amtlicheBeschreibung(');
    expect(
      /zipDsfinvkBundle\(\[\s*\.\.\.dateien,[\s\S]{0,300}?\.\.\.amtlicheBeschreibung\(/.test(q),
      'die Beschreibungsdateien landen nicht im ZIP',
    ).toBe(true);
    // Und der Absender wird mitgegeben — ein Datenträger ohne ihn zeigt
    // Zahlen, aber nicht, wessen Zahlen.
    expect(q).toContain('name: stammdaten.daten.legalName');
  });
});

describe('⛔ der Weg SPERRT, wo er vorher erfand', () => {
  it('ohne die Angaben zum Steuerpflichtigen entsteht nichts', async () => {
    // ⚠️ Auf den WURF prüfen, nicht auf den Namen. Die erste Fassung suchte
    // nur `StammdatenUnvollstaendigError` im Text — und blieb GRÜN, als ich
    // den ganzen Riegel löschte: der Name stand ja noch im import. Ein
    // Wächter, der die Einbindung liest statt den Aufruf, bewacht nichts.
    const q = ohneKommentare(await lies());
    expect(
      /throw new StammdatenUnvollstaendigError\(/.test(q),
      'der Riegel wirft nicht — die Angaben zum Steuerpflichtigen sind nicht erzwungen',
    ).toBe(true);
    expect(q).toContain('!stammdaten.vollstaendig');
  });

  it('⛔ und zwar VOR dem Bauen, nicht danach', async () => {
    // Ein Riegel hinter dem Erzeuger hätte die Datei schon gebaut.
    const q = ohneKommentare(await lies());
    // ⚠️ Ein blosser Reihenfolgevergleich genügt NICHT: verschwindet der
    // Riegel ganz, verschwinden BEIDE Seiten des Vergleichs, und die Zusage
    // bleibt formal wahr. Deshalb zuerst die Existenz, dann die Reihenfolge —
    // und der Riegel muss im SELBEN Block stehen wie das Lesen.
    const wurf = q.indexOf('throw new StammdatenUnvollstaendigError(');
    const bau = q.indexOf('baueAlleDateien(');
    const lesen = q.indexOf('leseStammdaten(einst)');
    expect(wurf, 'der Riegel fehlt ganz').toBeGreaterThan(0);
    expect(bau, 'der Erzeuger wird nicht gerufen').toBeGreaterThan(0);
    expect(lesen, 'die Stammdaten werden nicht gelesen').toBeGreaterThan(0);
    expect(wurf, 'der Riegel steht HINTER dem Erzeuger').toBeLessThan(bau);
    // Und unmittelbar nach dem Lesen, nicht irgendwo weit dahinter.
    expect(
      wurf - lesen,
      'zwischen Lesen und Riegel steht zu viel — läuft dazwischen schon etwas?',
    ).toBeLessThan(200);
  });

  it('die Steuerschlüssel des Beraters werden gelesen', async () => {
    const q = ohneKommentare(await lies());
    // ⚠️ Im Quelltext steht der Punkt maskiert (`dsfinvk\\.ust_schluessel\\.`),
    // weil er in einem regulären Ausdruck sitzt. Eine wörtliche Suche nach
    // `dsfinvk.ust_schluessel.` findet ihn deshalb NICHT — der erste Entwurf
    // dieser Prüfung wurde daran rot, obwohl der Code stimmte.
    expect(/dsfinvk\\?\.ust_schluessel/.test(q), 'die Schlüssel werden nicht gelesen').toBe(true);
    expect(q).toContain('eigeneUstSchluessel');
  });

  it('⛔ Prozentsatz und Beschreibung werden EBENFALLS gelesen', async () => {
    // ⚠️ Ohne sie stünde in `vat.csv` ein leerer Satz — und der erste
    // Entwurf schrieb dort ein festes `0.00`, das dem `lines_vat.csv`
    // daneben widersprach.
    const q = ohneKommentare(await lies());
    // ⚠️ Im Quelltext steht `dsfinvk\\.ust_satz` — der Punkt ist für den
    // regulären Ausdruck maskiert. Eine Suche, die das nicht berücksichtigt,
    // findet die Zeile nicht (oder findet sie IMMER). Deshalb die
    // Zuweisung mitprüfen, nicht nur den Namen.
    expect(q, 'der Prozentsatz des Beraters wird nicht gelesen').toContain('ust_satz');
    // ⚠️ Der Index enthält selbst eine Klammer (`s1[1].toUpperCase()`), also
    // taugt ein „alles ausser ]" nicht. Auf die ZUWEISUNG selbst prüfen.
    expect(
      /eigeneUstSaetze\[.+\s*=\s*v;/.test(q),
      'der gelesene Satz wird nicht übernommen',
    ).toBe(true);
    expect(q).toContain('eigeneUstSaetze[');
    expect(q).toContain('eigeneUstBeschreibungen[');
  });

  it('⚠️ und sie werden auch WEITERGEREICHT', async () => {
    // Sie zu lesen und dann nicht zu übergeben wäre der stille Fehler: der
    // Export bräche mit „kein Schlüssel hinterlegt" ab, obwohl einer dasteht.
    const q = ohneKommentare(await lies());
    const i = q.indexOf('formeDaten(bundleInput');
    expect(i, 'formeDaten wird nicht gerufen').toBeGreaterThan(0);
    expect(q.slice(i, i + 500)).toContain('eigeneUstSchluessel,');
    expect(q.slice(i, i + 500)).toContain('eigeneUstSaetze,');
    expect(q.slice(i, i + 500)).toContain('stammdaten,');
  });
});

describe('die amtlichen Dateien liegen im Erzeugnis', () => {
  it('index.xml und die DTD sind lesbar', async () => {
    const { amtlicheBeschreibung, amtlicheTaxonomie } = await import(
      '../../src/lib/dsfinvk-amtlich.js'
    );
    expect(amtlicheTaxonomie()).toContain('<URL>transactions.csv</URL>');
    const b = amtlicheBeschreibung();
    expect(b.map((x) => x.name).sort()).toEqual(['gdpdu-01-09-2004.dtd', 'index.xml']);
  });
});

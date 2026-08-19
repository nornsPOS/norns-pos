/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EIN DATENTRÄGER OHNE ABSENDER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die amtliche `index.xml` trägt `<DataSupplier><Name /><Location /></…>`,
 * leer, weil sie eine VORLAGE ist. Der Steuerpflichtige trägt sich dort ein.
 *
 * Wir lieferten sie unverändert aus. Ein Prüfer sah damit Zahlen, aber nicht,
 * WESSEN Zahlen.
 *
 * ⚠️ Und die andere Seite ist genauso wichtig: der Eingriff darf die Vorlage
 * sonst NICHT anfassen. Sobald wir eine eigene index.xml schreiben, misst der
 * Normwächter nicht mehr die amtliche, sondern unsere, und dann ist die
 * ganze Umstellung wieder eine Prüfung gegen sich selbst.
 */

import { describe, expect, it } from 'vitest';

import { amtlicheBeschreibung, amtlicheTaxonomie } from '../../src/lib/dsfinvk-amtlich.js';
import { leseTaxonomie } from '../../src/lib/dsfinvk-taxonomie.js';

const index = (h?: { name?: string; ort?: string }): string =>
  amtlicheBeschreibung(h).find((d) => d.name === 'index.xml')!.content;

describe('⛔ der Datenträger nennt seinen Absender', () => {
  it('ohne Angabe bleibt die Vorlage unangetastet', () => {
    expect(index()).toContain('<Name />');
  });

  it('mit Angabe steht der Händler drin', () => {
    const x = index({ name: 'Norns Muster-Edelmetallhandel e. K.', ort: 'Schorndorf' });
    expect(x).toContain('<Name>Norns Muster-Edelmetallhandel e. K.</Name>');
    expect(x).toContain('<Location>Schorndorf</Location>');
  });

  it('⚠️ ein kaufmännisches Und im Firmennamen zerstört das XML nicht', () => {
    // „Müller & Sohn" ist ein gewöhnlicher Firmenname und ein unentschärftes
    // `&` macht die Datei unlesbar.
    const x = index({ name: 'Müller & Sohn' });
    expect(x).toContain('Müller &amp; Sohn');
    expect(x).not.toContain('<Name>Müller & Sohn</Name>');
  });

  it('Leerzeichen zählen nicht als Angabe', () => {
    expect(index({ name: '   ' })).toContain('<Name />');
  });
});

describe('⛔ die Vorlage bleibt sonst UNVERÄNDERT', () => {
  it('nur der Absender wandert, sonst nichts', () => {
    // Der Unterschied zwischen Vorlage und Ausgabe darf ausschliesslich die
    // beiden Absenderknoten betreffen.
    const vorlage = amtlicheTaxonomie();
    const gefuellt = index({ name: 'X', ort: 'Y' });
    const zurueck = gefuellt
      .replace('<Name>X</Name>', '<Name />')
      .replace('<Location>Y</Location>', '<Location />');
    expect(zurueck, 'der Eingriff hat mehr geändert als den Absender').toBe(vorlage);
  });

  it('⛔ und die Tabellendefinitionen bleiben lesbar', () => {
    // Der Normwächter liest aus derselben Datei. Wäre sie beschädigt, misst
    // er nichts mehr.
    const t = leseTaxonomie(index({ name: 'Müller & Sohn', ort: 'Schorndorf' }));
    expect(t).toHaveLength(20);
    expect(t.reduce((s, x) => s + x.spalten.length, 0)).toBe(219);
  });

  it('die DTD wird NIE angefasst', () => {
    const a = amtlicheBeschreibung().find((d) => d.name === 'gdpdu-01-09-2004.dtd')!.content;
    const b = amtlicheBeschreibung({ name: 'X' }).find(
      (d) => d.name === 'gdpdu-01-09-2004.dtd',
    )!.content;
    expect(a).toBe(b);
  });
});

/**
 * ⚠️ Die flache Ablage ist richtig, nachgemessen, nicht angenommen.
 */
describe('die Ablage im Paket', () => {
  it('die Norm nennt keine Unterverzeichnisse', () => {
    // Ein Prüfer meldete eine fehlende Ordnerstruktur. Nachgemessen: KEINE
    // der zwanzig URLs in der amtlichen index.xml enthält einen Pfad, und
    // die Wörter „Verzeichnis" und „Ordner" kommen im Normtext nicht vor.
    // Die flache Ablage ist also die richtige.
    for (const t of leseTaxonomie(amtlicheTaxonomie())) {
      expect(t.datei, `${t.datei} trägt einen Pfad`).not.toContain('/');
    }
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE ERZEUGTE index.xml IST SO GÜLTIG WIE DIE AMTLICHE VORLAGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ein Prüfwerkzeug liest die `index.xml` gegen die mitgelieferte DTD. Wenn
 * unser Eingriff sie ungültig macht, ist der ganze Datenträger unlesbar,
 * unabhängig davon, wie richtig die CSV-Dateien sind.
 *
 * ⚠️ Gemessen wird nicht „ist gültig", sondern „ist GENAUSO gültig wie die
 * Vorlage". Der Grund: `xmllint --valid` meldet an der amtlichen Datei selbst
 * eine Warnung („Content model of Media is not determinist"). Sie stammt aus
 * der DTD von 2004 und ist keine Eigenschaft unserer Ausgabe.
 *
 * Ein Test, der einfach „keine Meldung" verlangt, wäre also auf der amtlichen
 * Vorlage rot. Ein Test, der Meldungen ignoriert, fände unsere eigenen nicht.
 * Deshalb der VERGLEICH.
 */
describe('⛔ die Ausgabe bleibt XML-gültig', () => {
  it('sie erzeugt keine Meldung, die die Vorlage nicht auch erzeugt', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync, copyFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const pruefe = (inhalt: string): string[] => {
      const d = mkdtempSync(join(tmpdir(), 'dsfinvk-'));
      writeFileSync(join(d, 'index.xml'), inhalt);
      copyFileSync(
        new URL('../../src/fiskal/dsfinvk-2.4/gdpdu-01-09-2004.dtd', import.meta.url),
        join(d, 'gdpdu-01-09-2004.dtd'),
      );
      try {
        execFileSync('xmllint', ['--noout', '--valid', 'index.xml'], {
          cwd: d,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return [];
      } catch (e) {
        // ⚠️ FEHLT DAS WERKZEUG SELBST, IST DAS KEIN „KEINE MELDUNGEN".
        //
        // Befund vom 13.08.2026: hier stand nur `e.stderr?.toString() ?? ''`.
        // Ohne `xmllint` wirft `execFileSync` mit `code: 'ENOENT'` und OHNE
        // `stderr`. Aus dem Fangarm kam dann eine leere Liste, fuer die
        // Vorlage UND fuer unsere Ausgabe, die Differenz war leer, und der
        // Test bestand, ohne EIN Zeichen geprueft zu haben.
        //
        // Das ist die amtliche DTD der GDPdU. Eine Pruefung dagegen, die
        // still nichts tut und gruen meldet, ist schlimmer als keine: sie
        // beendet die Suche.
        if ((e as { code?: string }).code === 'ENOENT') {
          throw new Error(
            'xmllint ist auf dieser Maschine nicht vorhanden. Dieser Satz prueft ' +
              'die Ausgabe gegen die AMTLICHE DTD der GDPdU und kann ohne das ' +
              'Werkzeug nichts beweisen. Bis zum 13.08.2026 bestand er in diesem ' +
              'Fall STILL. Installieren: `apt-get install libxml2-utils` (Linux) ' +
              'oder `brew install libxml2` (macOS); auf macOS liegt es meist schon ' +
              'unter /usr/bin/xmllint.',
          );
        }
        const err = (e as { stderr?: Buffer }).stderr?.toString() ?? '';
        // Der Dateiname steht in jeder Meldung; er unterscheidet sich
        // zwischen den beiden Läufen und gehört nicht zum Befund.
        return err
          .split('\n')
          .filter((z) => z.trim() !== '')
          .map((z) => z.replace(/^[^:]*index\.xml:/, 'index.xml:'));
      }
    };

    const vorlage = pruefe(amtlicheTaxonomie());
    const unsere = pruefe(index({ name: 'Müller & Sohn', ort: 'Schorndorf' }));

    const neu = unsere.filter((m) => !vorlage.includes(m));
    expect(neu, `unsere Ausgabe erzeugt eigene Meldungen: ${neu.join(' | ')}`).toEqual([]);
  });
});

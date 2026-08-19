/**
 * ════════════════════════════════════════════════════════════════════════
 *  Die Verfahrensdokumentation beschreibt DIESE Kasse
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 * `SteuerComplianceSection.tsx:27` holte `docs/Verfahrensdokumentation.md`
 * über `?raw` ins Bündel und bot sie dem Prüfer zum Herunterladen an.
 *
 *     „warehouse14"   11 Treffer      ← ein FREMDES Erzeugnis
 *     „Norns"          0 Treffer
 *     Stand            08.06.2026     fest eingetippt
 *     Fassung          v0.4.0         tauri.conf.json sagt 0.1.0
 *     Migrationsstand  0057 und 0106  widersprechen sich, beide falsch
 *     Abschnitt 3.1    Docker, Oracle Cloud, Redis, Cloudflare R2
 *
 * Rz. 154 GoBD verlangt, dass die Verfahrensdokumentation dem tatsächlich
 * eingesetzten Verfahren VOLL entspricht. Ein Prüfer, der dieses Blatt
 * aufschlug, las den Namen einer fremden Firma und die Beschreibung einer
 * Anlage, die es in dieser Kasse nicht gibt.
 *
 * ── WAS HIER GEMESSEN WIRD ─────────────────────────────────────────────
 *
 * Erstens: dass der eingebackene Text weg ist und nicht zurückkommt.
 * Zweitens: dass der Erzeuger nichts erfindet.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  baueVerfahrensdoku,
  type VerfahrensdokuEingabe,
} from '../../src/lib/verfahrensdokumentation.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '../../../..');

const schema = {
  tabellen: 87,
  ausloeser: 73,
  pruefbedingungen: 303,
  funktionen: 47,
  wanderungsstand: '0134',
};

const eingabe = (
  einstellungen: Record<string, string> = {},
  tse = { tssId: '', clientId: '', eingerichtetAm: '', seriennummer: '' },
): VerfahrensdokuEingabe => ({
  einstellungen,
  fassung: '0.1.0',
  jetzt: new Date('2026-08-08T12:00:00.000Z'),
  schema,
  tse,
});

describe('⛔ Der eingebackene Text ist weg und kommt nicht zurück', () => {
  it('⛔ die alte Datei liegt nicht mehr im Baum', () => {
    /**
     * Solange sie dort liegt, kann jemand sie erneut über `?raw`
     * importieren — und dann steht der Name einer fremden Firma wieder in
     * einem Dokument, das dem Finanzamt ausgehändigt wird.
     */
    expect(
      existsSync(join(REPO, 'docs/Verfahrensdokumentation.md')),
      'die abgeloeste Textdatei ist zurueck',
    ).toBe(false);
  });

  it('⛔ und die Fläche importiert keinen Rohtext mehr', () => {
    const q = readFileSync(
      join(REPO, 'apps/tauri-pos/src/screens/secondary/SteuerComplianceSection.tsx'),
      'utf8',
    );
    /**
     * ⚠️ Gemessen wird der GEBRAUCH, nicht die Erwähnung: die Zeilen ohne
     * `import` fallen vorher weg, damit ein erklärender Kommentar den
     * Wächter nicht rot färbt. Diese Falle hat im Haus schon zweimal
     * zugeschlagen.
     */
    const nurEinfuhren = q
      .split('\n')
      .filter((z) => /^\s*import\b/.test(z))
      .join('\n');
    expect(nurEinfuhren, 'der ?raw-Import ist zurueck').not.toMatch(/Verfahrensdokumentation\.md/);

    // Und positiv: der lebende Weg wird wirklich benutzt.
    expect(q, 'der erzeugte Weg fehlt').toMatch(/useVerfahrensdokuPdf/);
  });
});

describe('⛔ Der Erzeuger erfindet nichts', () => {
  it('⛔ ohne Stammdaten bleibt jedes Feld leer und wird als offen gemeldet', () => {
    const b = baueVerfahrensdoku(eingabe());
    expect(b.vollstaendig).toBe(false);

    const alle = b.abschnitte.flatMap((a) => a.angaben ?? []);
    const firma = alle.find((a) => a.etikett === 'Firma');
    expect(firma?.wert, 'die Firma wurde erfunden').toBe('');
    expect(firma?.fehlt).toBe(true);

    // Und die offene Stelle nennt, WO sie einzutragen ist.
    const offen = b.offeneAngaben.find((o) => o.etikett === 'Firma');
    expect(offen?.wo).toContain('Betrieb');
  });

  it('⛔ das Land wird NICHT als DEU angenommen', () => {
    /**
     * Wanderung 0126 begründet ausführlich, warum kein Feld aus einem
     * anderen abgeleitet wird. Eine angenommene Länderkennung wäre in der
     * DSFinV-K eine Angabe, die niemand geprüft hat.
     */
    const b = baueVerfahrensdoku(
      eingabe({ 'shop.legal_name': 'Muster e. K.', 'shop.city': 'Schorndorf' }),
    );
    const alle = b.abschnitte.flatMap((a) => a.angaben ?? []);
    expect(alle.find((a) => a.etikett === 'Länderkennzeichen')?.wert).toBe('');
  });

  it('⛔ keine TSE heisst: das Dokument sagt es, statt es zu verschweigen', () => {
    const b = baueVerfahrensdoku(eingabe());
    const tse = b.abschnitte.find((a) => a.titel.includes('Sicherheitseinrichtung'));
    expect(tse, 'der TSE-Abschnitt fehlt').toBeDefined();
    expect(tse!.absaetze.join(' ')).toMatch(/KEINE technische Sicherheitseinrichtung/);
    expect(tse!.absaetze.join(' '), 'das Dokument verschweigt die Folge').toMatch(/§ 146a/);
  });

  it('⛔ die gemessene Seriennummer steht wirklich im Abschnitt', () => {
    /*
     * ── WARUM DIESE PRUEFUNG (13.08.2026) ────────────────────────────────
     *
     * Die Startliste sagt dem Haendler: „Die Angaben, die das Formular
     * verlangt, stehen fertig in Ihrer Verfahrensdokumentation." Fuer die
     * Meldung nach § 146a Abs. 4 AO gehoert die Seriennummer der
     * Sicherungseinrichtung dazu — und sie stand hier bis heute nirgends,
     * weil es in der Kasse ueberhaupt keinen Ort dafuer gab.
     *
     * Ohne diese Pruefung waere das neue Feld eines, das man befuellt und
     * das nie irgendwo erscheint: gebaut und nie angeschlossen.
     */
    const b = baueVerfahrensdoku(
      eingabe(
        {},
        {
          tssId: 'tss-1',
          clientId: 'cl-1',
          eingerichtetAm: '2026-08-01',
          seriennummer: 'SWB-0000042',
        },
      ),
    );
    const tse = b.abschnitte.find((a) => a.titel.includes('Sicherheitseinrichtung'))!;
    const zeile = (tse.angaben ?? []).find((a) => a.etikett.includes('Seriennummer'));
    expect(zeile, 'Der TSE-Abschnitt fuehrt die Seriennummer gar nicht.').toBeDefined();
    expect(zeile?.wert).toBe('SWB-0000042');
  });

  it('⛔ eine fehlende Seriennummer wird NICHT erfunden', () => {
    // Belege von vor Wanderung 0141 haben keine. Eine abgeleitete oder aus
    // der Kennung zusammengebaute Nummer waere eine unrichtige Angabe nach
    // § 146a AO — schlimmer als die sichtbar offene Stelle.
    const b = baueVerfahrensdoku(
      eingabe(
        {},
        { tssId: 'tss-1', clientId: 'cl-1', eingerichtetAm: '2026-08-01', seriennummer: '' },
      ),
    );
    const tse = b.abschnitte.find((a) => a.titel.includes('Sicherheitseinrichtung'))!;
    const zeile = (tse.angaben ?? []).find((a) => a.etikett.includes('Seriennummer'));
    expect(zeile?.wert ?? '').toBe('');
    // Und sie darf auch nicht heimlich die Kennung tragen.
    expect(zeile?.wert ?? '').not.toBe('tss-1');
  });

  it('⚠️ mit eingerichteter TSE kippt der Abschnitt auf die andere Aussage', () => {
    const b = baueVerfahrensdoku(
      eingabe({}, { tssId: 'tss-1', clientId: 'cl-1', eingerichtetAm: '2026-08-01', seriennummer: 'SWB-0000042' }),
    );
    const tse = b.abschnitte.find((a) => a.titel.includes('Sicherheitseinrichtung'))!;
    expect(tse.absaetze.join(' ')).not.toMatch(/KEINE technische/);
    const angaben = tse.angaben ?? [];
    expect(angaben.find((a) => a.etikett.includes('Eingerichtet'))?.wert).toBe('01.08.2026');
  });

  it('⛔ die gemessenen Zahlen stehen im Dokument, nicht eine Beschreibung davon', () => {
    const b = baueVerfahrensdoku(eingabe());
    const tech = b.abschnitte.find((a) => a.nummer === '2.1')!;
    const zeilen = (tech.tabelle?.zeilen ?? []).map((z) => z.join(' '));
    expect(zeilen).toContain('Tabellen 87');
    expect(zeilen).toContain('Stand des Wanderungsbuchs 0134');
  });

  it('⛔ und kein Abschnitt behauptet eine Anlage, die es hier nicht gibt', () => {
    /**
     * Der Kern des alten Befunds: Abschnitt 3.1 beschrieb Docker, Oracle
     * Cloud, Redis und Cloudflare R2. Diese Kasse ist voll offline.
     */
    const b = baueVerfahrensdoku(eingabe());
    const text = b.abschnitte.flatMap((a) => a.absaetze).join(' ');
    for (const verboten of ['Docker', 'Oracle', 'Redis', 'Cloudflare', 'R2', 'warehouse']) {
      expect(text, `das Dokument behauptet ${verboten}`).not.toContain(verboten);
    }
  });

  it('⚠️ vollständig gepflegt heisst wirklich vollständig', () => {
    const b = baueVerfahrensdoku(
      eingabe({
        'shop.legal_name': 'Muster Edelmetallhandel e. K.',
        'shop.street': 'Musterstraße 1',
        'shop.postal_code': '73614',
        'shop.city': 'Musterstadt',
        'shop.country_code': 'DEU',
        'shop.tax_number': '12345/67890',
        'shop.vat_id': 'DE343451090',
        'betrieb.verantwortlich_aufzeichnungen': 'M. Muster',
        'betrieb.geldwaeschebeauftragter': 'M. Muster',
        'betrieb.inbetriebnahme_am': '2026-01-02',
        'betrieb.sicherungsort': 'Bankschliessfach',
        'kasse.seriennummer': 'KS-0001',
        'datev.sachkontenrahmen': 'SKR03',
        'datev.sachkontenlaenge': '4',
        'datev.wirtschaftsjahr_beginn': '01-01',
        'datev.beraternummer': '1234567',
        'datev.mandantennummer': '54321',
        'gwg.verkauf_identity_threshold_eur': '2000',
        'gwg.verkauf_identity_threshold_unbar_eur': '10000',
        'gwg.ankauf_identity_required_always': 'true',
      }, { tssId: 'tss-1', clientId: 'cl-1', eingerichtetAm: '2026-01-02', seriennummer: 'SWB-0000042' }),
    );
    expect(b.offeneAngaben.map((o) => o.etikett)).toEqual([]);
    expect(b.vollstaendig).toBe(true);
  });
});

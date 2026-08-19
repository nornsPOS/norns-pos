/**
 * JEDER Weg in die fiskalische Tabelle muss sich erklären.
 *
 * ── DER FUND VOM 02.08.2026 ─────────────────────────────────────────────────
 *
 * Sechs Dateien schreiben eine Zeile in `transactions`. GENAU EINE prüfte, ob
 * überhaupt je eine technische Sicherungseinrichtung eingerichtet wurde:
 * `transactions-finalize.ts`. Die anderen fünf gingen ungeprüft durch.
 *
 * Am Tresen: der Händler liest an der Verkaufsmaske, seine Kasse erfülle
 * § 146a AO nicht, und kauft eine Minute später für 5.000 Euro Gold an, ohne
 * dass irgendetwas rot wird.
 *
 * ── WARUM DIESER WÄCHTER ANDERS GEBAUT IST ─────────────────────────────────
 *
 * Ein Wächter mit fester Namensliste wird blind: ein SIEBTER Weg entsteht,
 * steht in keiner Liste, wird nie geprüft und fällt nie auf. Dieselbe Klasse
 * hat dieses Haus schon getroffen.
 *
 * Deshalb SUCHT dieser Satz die Schreiber selbst im Baum und verlangt für
 * jeden gefundenen eine von zwei Antworten:
 *
 *   • er ruft `istSicherungseinrichtungEingerichtet`, ODER
 *   • er steht namentlich in `AUSGENOMMEN`, MIT Begründung.
 *
 * Ein neuer Weg ist damit nie stillschweigend erlaubt: er ist rot, bis jemand
 * ihn bewusst einordnet.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const QUELLE = resolve(HIER, '../../src');

/**
 * Wege, die AUSDRÜCKLICH nicht sperren dürfen, mit dem Grund.
 *
 * ⚠️ Jeder Eintrag ist eine Entscheidung, kein Versehen. Ein Riegel am
 * falschen Ort schadet mehr als er nützt.
 */
const AUSGENOMMEN: Readonly<Record<string, string>> = {
  'routes/transactions-storno.ts':
    'Eine Rückbuchung anzuhalten hielte das Geld des Kunden fest. Der Vorgang wird ' +
    'aufgezeichnet und bei stehender TSE nachsigniert (§ 6 KassenSichV).',
  // 19.08.2026: dieselbe Klasse, derselbe Grund. Eine Warenruecknahme, die
  // WIRKLICH geschehen ist (der Kunde hat sein Geld), MUSS aufzeichenbar
  // sein — BFH 29.07.2025, X R 23-24/21: nicht ausgewiesene Rueckgaengig-
  // machungen begruenden die Schaetzung. Ein Riegel hier erzwaenge genau
  // das, was das Urteil bestraft. Signiert wird bei stehender TSE nach.
  'routes/transactions-rueckgabe.ts':
    'Eine Warenruecknahme anzuhalten hielte das Geld des Kunden fest. Der Vorgang wird ' +
    'aufgezeichnet und bei stehender TSE nachsigniert (§ 6 KassenSichV).',
  // 15.08.2026: routes/transactions-return.ts stand hier. Die Route ist
  // geloescht: sie verlangte einen WEB-Verkauf, und den schreibt seit dem
  // 0.4.0-Kahlschlag niemand mehr — sie konnte nur noch ablehnen.
  // 14.08.2026: routes/storefront-webhook.ts stand hier (sales_channel WEB).
  // Mit der Trennung von warehouse14 geloescht; ALTE WEB-Zeilen in
  // transactions bleiben Daten und laufen weiter durch die DSFinV-K.
};

function alleQuelldateien(wurzel: string): string[] {
  const gefunden: string[] = [];
  for (const name of readdirSync(wurzel)) {
    const pfad = join(wurzel, name);
    if (statSync(pfad).isDirectory()) gefunden.push(...alleQuelldateien(pfad));
    else if (name.endsWith('.ts')) gefunden.push(pfad);
  }
  return gefunden;
}

function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Jede Datei, die eine Zeile in `transactions` schreibt. Gesucht, nicht gelistet. */
function schreiberDerFiskaltabelle(): string[] {
  const treffer: string[] = [];
  for (const pfad of alleQuelldateien(QUELLE)) {
    const rumpf = ohneKommentare(readFileSync(pfad, 'utf8'));
    const schreibt =
      /\.insert\(\s*transactions\s*\)/.test(rumpf) || /INSERT\s+INTO\s+transactions\b/i.test(rumpf);
    if (schreibt) treffer.push(pfad.slice(QUELLE.length + 1));
  }
  return treffer.sort();
}

describe('Jeder Weg in die fiskalische Tabelle', () => {
  const schreiber = schreiberDerFiskaltabelle();

  it('die Suche findet überhaupt Schreiber', () => {
    // Ohne diesen Satz wäre alles Folgende auf einer leeren Liste grün: die
    // gefährlichste Fassung eines Wächters.
    // 15.08.2026: vier statt fuenf. `routes/transactions-return.ts` ist
    // geloescht — sie wies alles ab, was kein WEB-Verkauf war, und seit dem
    // 0.4.0-Kahlschlag schreibt niemand mehr diesen Kanal.
    expect(schreiber.length, 'kein einziger Schreiber gefunden').toBeGreaterThanOrEqual(4);
    expect(schreiber).toContain('routes/transactions-finalize.ts');
  });

  it('⛔ jeder ruft den Riegel ODER ist namentlich begründet ausgenommen', () => {
    const stumm: string[] = [];
    for (const datei of schreiber) {
      const rumpf = ohneKommentare(readFileSync(join(QUELLE, datei), 'utf8'));
      const ruft = rumpf.includes('istSicherungseinrichtungEingerichtet');
      if (!ruft && !(datei in AUSGENOMMEN)) stumm.push(datei);
    }
    expect(
      stumm,
      'Diese Wege schreiben in `transactions`, prüfen § 146a AO aber nicht und ' +
        'stehen in keiner begründeten Ausnahme. Entweder den Riegel rufen oder ' +
        'in AUSGENOMMEN eintragen, MIT Grund.',
    ).toEqual([]);
  });

  it('die Ausnahmeliste enthält keine Geister', () => {
    // Ein Eintrag ohne Datei ist ein Wächter, der ins Leere schaut, und lässt
    // eine echte Lücke wie erledigte Arbeit aussehen.
    const geister = Object.keys(AUSGENOMMEN).filter((d) => !schreiber.includes(d));
    expect(geister, 'ausgenommen, schreibt aber gar nicht (mehr)').toEqual([]);
  });

  it('jede Ausnahme trägt einen ganzen Satz als Begründung', () => {
    for (const [datei, grund] of Object.entries(AUSGENOMMEN)) {
      expect(grund.length, `${datei}: die Begründung ist zu dünn`).toBeGreaterThan(60);
      expect(grund, `${datei}: die Begründung endet nicht als Satz`).toMatch(/\.$/);
    }
  });

  it('die beiden Ankaufwege sperren WIRKLICH', () => {
    // Die zwei, die heute nachgezogen wurden. Namentlich, weil genau sie den
    // Schaden trugen: der Verkauf hielt an, der Ankauf nicht.
    for (const datei of ['routes/transactions-ankauf.ts', 'routes/appraisals.ts']) {
      const rumpf = ohneKommentare(readFileSync(join(QUELLE, datei), 'utf8'));
      expect(rumpf, `${datei} ruft den Riegel nicht`).toMatch(
        /istSicherungseinrichtungEingerichtet\(/,
      );
      expect(rumpf, `${datei} wirft bei fehlender TSE nicht`).toMatch(
        /throw new KeineTseEingerichtetError\(/,
      );
    }
  });

  it('der Konvolut-Ankauf hängt an einer Schicht', () => {
    // Ohne Schicht verschwindet die Barauszahlung aus dem Kassensturz, und die
    // Kassiererin trägt eine Differenz, die sie nicht verursacht hat.
    const rumpf = ohneKommentare(readFileSync(join(QUELLE, 'routes/appraisals.ts'), 'utf8'));
    expect(rumpf).toMatch(/FROM shifts[\s\S]{0,200}status = 'OPEN'/);
    expect(rumpf, 'die Schicht wird ermittelt, aber nicht gesetzt').toMatch(/shiftId:/);
  });
});

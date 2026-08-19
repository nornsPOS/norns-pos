/**
 * Der Wächter gegen Auskünfte, die der Finger nie sieht.
 *
 * ── WAS AM 27.07.2026 GEMESSEN WURDE ────────────────────────────────────────
 * Die Kasse steht auf einer Theke und wird mit dem Finger bedient. Ein
 * HTML-`title=` erscheint aber NUR unter dem Mauszeiger, auf dem Finger
 * verschwindet die Kurzhilfe ersatzlos. Die Messung fand zehn Stellen, deren
 * title= Information trug, die sonst NIRGENDS stand: das gesperrte
 * Kartenterminal, der veraltete Goldkurs, die PEP-Marke am Kunden, die
 * Herkunft einer Bestellung, dynamische Sperrgründe, der Verbindungspunkt.
 *
 * ── WAS DIESER WÄCHTER TUT ──────────────────────────────────────────────────
 * Er liest den Quelltext jeder betroffenen Datei und entfernt daraus ALLES,
 * was nur die Maus (title=) oder nur der Screenreader (aria-label=) sieht,
 * dazu die Kommentare. Was übrig bleibt, ist das, was auf dem Bildschirm
 * gerendert wird oder beim Drücken erscheint (Meldungsblase, Rückfrage).
 * In diesem Rest MUSS die tragende Auskunft jeder Stelle noch vorkommen.
 *
 * title= darf zusätzlich bestehen bleiben (die Maus schadet nicht), aber es
 * darf nie der EINZIGE Träger sein. Fällt eine Stelle zurück auf title-only,
 * wird dieser Wächter ROT und nennt Datei und fehlende Auskunft.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(HIER, '..');

/**
 * Entfernt aus einem Quelltext alles, was der Finger nie sieht:
 * Blockkommentare, Zeilenkommentare, title=-Attribute und aria-label=.
 * Übrig bleibt der sichtbare beziehungsweise drückbare Anteil.
 */
function nurFuerDenFinger(quelle: string): string {
  return (
    quelle
      // Blockkommentare (auch JSDoc)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Zeilenkommentare, aber keine URLs (https://…): nur nach Zeilenanfang
      // oder Leerraum
      .replace(/(^|\s)\/\/[^\n]*/g, '$1')
      // title="…" und title={…} — die reine Maus-Auskunft
      .replace(/title=\{[^}]*\}/g, '')
      .replace(/title="[^"]*"/g, '')
      // aria-label — wichtig für den Screenreader, aber unsichtbar für den Finger
      .replace(/aria-label=\{[^}]*\}/g, '')
      .replace(/aria-label="[^"]*"/g, '')
  );
}

function fingerSicht(relativerPfad: string): string {
  return nurFuerDenFinger(readFileSync(join(SRC, relativerPfad), 'utf8'));
}

describe('Tast-Auskünfte: kein title= ist der einzige Träger einer Information', () => {
  it('Bezahlen: der gesperrte Kartenchip nennt seinen Grund beim Drücken (Meldungsblase)', () => {
    // Der Sperrgrund („Terminal nicht konfiguriert …") muss in die
    // Meldungsblase fliessen, nicht nur in das title=-Attribut.
    const sicht = fingerSicht('screens/verkauf/BezahlenDialog.tsx');
    expect(sicht).toMatch(/body:\s*disabledReason/);
  });

  it('Goldticker: das Alter des Kurses steht sichtbar in der Leiste, nicht nur im title', () => {
    // ⚠️ Dieser Satz prüfte wörtlich „Kurs veraltet". In `7059036` wurde die
    // Leiste GENAUER: statt eines Etiketts nennt sie jetzt das Alter und die
    // Folge („Kurs 6 Tage alt · kein Ankaufvorschlag"). Der Wächter blieb auf
    // dem alten Wortlaut stehen und war seither rot — er hat die Verbesserung
    // als Verschlechterung gemeldet.
    //
    // Er prüft ab jetzt die ABSICHT statt eines Wortlauts: dass das Alter und
    // die Folge im sichtbaren Text stehen, nicht nur im title=.
    const sicht = fingerSicht('app/chrome/MetalTicker.tsx');
    expect(sicht).toMatch(/Kurs \$\{|Kurs /);
    expect(sicht).toContain('kein Ankaufvorschlag');
    expect(sicht).toContain('letzter bekannter Kurs');
  });

  it('Kundenakte: die PEP-Marke trägt ihre Pflicht (§15 GwG) sichtbar', () => {
    const sicht = fingerSicht('screens/kunden/CustomerDetailPanel.tsx');
    expect(sicht).toContain('Verstärkte Sorgfalt');
    expect(sicht).toContain('§15 GwG');
  });

  it('Kundensuche: die PEP-Marke ist als Wort lesbar, nicht als Kürzel mit Maus-Erklärung', () => {
    const sicht = fingerSicht('screens/kunden/KundenSucher.tsx');
    expect(sicht).toContain('Politisch exponiert');
  });

  it('Kundenliste: „zuletzt …" sagt sichtbar, WAS zuletzt war (letzter Vorgang)', () => {
    const sicht = fingerSicht('screens/kunden/CustomerListPanel.tsx');
    expect(sicht).toContain('letzter Vorgang');
  });

  // 14.08.2026: der Bestellungen-Fall stand hier; die Flaeche fiel mit dem
  // Kundenshop bei der Trennung von warehouse14.

  // 14.08.2026: der Bestellungen-Fall stand hier; die Flaeche fiel mit dem
  // Kundenshop bei der Trennung von warehouse14.

  // 01.08.2026: Der Satz „Web-SEO: der gesperrte KI-Knopf nennt seinen Grund"
  // stand hier. `screens/lager/WebSeoPanel.tsx` ist ausgezogen — die Fläche
  // schaltete ein Stück im Webshop frei und pflegte Suchmaschinentext dazu,
  // beides gibt es in Norns POS nicht. Ersatzlos gestrichen statt auf eine
  // andere Datei umgebogen: ein Wächter, der etwas anderes prüft als sein
  // Name sagt, ist schlimmer als keiner.

  // 19.08.2026 (Abend): der Fotos-Fall stand hier. Die Flaeche war seit dem
  // Morgen ohne Weg (Webshop-Erbe, Dekret 14.08.), die Datei lag als toter
  // Ballast — Basels Pruefliste nannte sie, und sie ist GELOESCHT. Das Foto
  // eines Stuecks entsteht im Lager (Stufe „Foto · Etikett · Freigabe") und
  // im Ankauf. Ersatzlos gestrichen, wie beim Web-SEO-Fall darueber.

  it('Kopfleiste: der Gesundheitspunkt trägt im Störfall ein sichtbares Wort neben der Farbe', () => {
    const sicht = fingerSicht('app/chrome/HealthDot.tsx');
    // „getrennt" ist das Wort des schwersten Zustands (Server nicht
    // erreichbar); es existiert nur in der sichtbaren Wort-Zuordnung.
    expect(sicht).toContain('getrennt');
    // Und der Druck-Weg (Meldungsblase mit den Details) bleibt bestehen.
    expect(sicht).toContain('addToast');
  });

  it('Werkstatt: der Verbindungspunkt behält sein sichtbares Zustandswort', () => {
    // Bestand schon: das Label steht als Kind neben dem Punkt. Festgeschrieben.
    const sicht = fingerSicht('screens/werkstatt/WerkstattHeader.tsx');
    expect(sicht).toContain('{DOT_LABEL[sseStatus]}');
  });
});

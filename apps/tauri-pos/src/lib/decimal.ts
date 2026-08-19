/**
 * decimal — die EINE Zerlegung für Geld und Gewicht am Tresen.
 *
 * ── DIE DREI FUNDE VOM 02.08.2026 ──────────────────────────────────────────
 *
 * Basel hat gemeldet, er könne beim Verkaufen und Ankaufen kein Komma in den
 * Preis tippen und ein Stück lasse sich nicht ins Lager aufnehmen. Gemessen an
 * der damaligen Zerlegung, mit echten Tastenfolgen:
 *
 *   eingetippt      wurde daraus     galt als gültig
 *   ──────────      ────────────     ───────────────
 *   1.999,99        1.99             JA      ⚠️ 1.999,99 € wurde zu 1,99 €
 *   199٫99          19999            JA      ⚠️ arabisches Komma verschluckt
 *   ١٩٩٫٩٩          (leer)           nein    ⚠️ Feld blieb leer
 *
 * Der dritte Fall IST Basels Erlebnis: das Feld bleibt leer, der Speichern-
 * Knopf bleibt grau, und das Stück wird nicht angelegt. Beide gemeldeten
 * Fehler hatten dieselbe Wurzel.
 *
 * Der ERSTE Fall ist der teuerste und war jahrelang still: `1.999,99` wurde
 * als `1.99` gespeichert UND als gültig gemeldet. Eine Goldmünze für
 * 1.999,99 € stand danach mit 1,99 € im Bestand. Der alte Kopfkommentar wusste
 * es sogar („liest den ERSTEN Punkt als Dezimalpunkt und macht aus 1.500 also
 * 1.5") und verwies auf eine zweite Funktion, die es richtig machte. Benutzt
 * hat die zweite Funktion genau EINE Fläche von acht.
 *
 * Zwei Wahrheiten für dieselbe Sache sind keine Wahl, sondern eine Falle.
 * Deshalb gibt es hier ab jetzt EINE Zerlegung.
 *
 * ── DIE REGEL ──────────────────────────────────────────────────────────────
 *
 * 1. Ziffern werden vereinheitlicht. Arabisch-indische (٠١٢٣٤٥٦٧٨٩) und
 *    persische (۰۱۲۳۴۵۶۷۸۹) Ziffern sind Ziffern. Ein Händler, dessen Tastatur
 *    arabisch steht, tippt eine echte Zahl und darf kein leeres Feld sehen.
 * 2. Trennzeichen werden vereinheitlicht. Das arabische Dezimalzeichen ٫
 *    (U+066B) ist ein Komma, das arabische Tausenderzeichen ٬ (U+066C) ist ein
 *    Punkt. Schmale und geschützte Leerzeichen fallen weg, ebenso der Schweizer
 *    Hochkomma-Tausender.
 * 3. Welches Zeichen das Dezimaltrennzeichen ist:
 *      • Kommen BEIDE vor, ist das LETZTE das Dezimaltrennzeichen und das
 *        andere der Tausender. `1.999,99` → 1999.99, `1,999.99` → 1999.99.
 *      • Kommt nur ein Komma vor, ist es das Dezimaltrennzeichen (deutsch).
 *      • Kommen nur Punkte vor, entscheidet die LÄNGE der letzten Gruppe:
 *        höchstens `maxFrac` Stellen heisst Dezimaltrennzeichen, mehr heisst
 *        Tausender. Bei Geld (`maxFrac` = 2) ist `1.999` also 1999, bei
 *        Gewicht (`maxFrac` = 3) ist `7.965` 7,965 g.
 *
 * ⚠️ EINE ZWEIDEUTIGKEIT BLEIBT, und sie steht hier ausdrücklich: beim GEWICHT
 * ist `1.500` 1,5 g und nicht 1500 g. Das ist die alte, gewollte Auslegung: an
 * der Goldwaage wiegt ein Stück selten anderthalb Kilo, und `7.965` ist die
 * übliche Schreibweise. Wer Kilogramm meint, tippt `1500`.
 */

/** Arabisch-indische und persische Ziffern auf 0 bis 9 bringen. */
function vereinheitlicheZiffern(text: string): string {
  let out = '';
  for (const zeichen of text) {
    const c = zeichen.codePointAt(0) ?? 0;
    // ٠ U+0660 .. ٩ U+0669
    if (c >= 0x0660 && c <= 0x0669) out += String(c - 0x0660);
    // ۰ U+06F0 .. ۹ U+06F9
    else if (c >= 0x06f0 && c <= 0x06f9) out += String(c - 0x06f0);
    else out += zeichen;
  }
  return out;
}

/**
 * Alles auf Ziffern, Punkt und Komma bringen.
 *
 * Was hier wegfällt, fällt bewusst weg: Währungszeichen, Leerzeichen jeder
 * Art, der Schweizer Hochkomma-Tausender.
 */
function vereinheitlicheTrenner(text: string): string {
  return vereinheitlicheZiffern(text)
    .replace(/٫/g, ',') // arabisches Dezimalzeichen
    .replace(/٬/g, '.') // arabisches Tausenderzeichen
    .replace(/[   \s]/g, '') // schmale, geschützte, gewöhnliche Leerzeichen
    .replace(/['’ʼ]/g, '') // Schweizer Tausender
    .replace(/[^\d.,]/g, '');
}

/**
 * ⛔ TRÄGT DIE EINGABE EIN MINUS? (19.08.2026, boeswillige Pruefung)
 *
 * ── DER FUND ───────────────────────────────────────────────────────────────
 *
 * `vereinheitlicheTrenner` wirft mit `[^\d.,]` JEDES fremde Zeichen weg — und
 * das Minus ist eines davon. Aus getipptem „-50" wurde still „50", und
 * `isMoneyInput('-50')` antwortete WAHR, obwohl seine eigene Doku „nicht
 * negativ" verspricht.
 *
 * Gemessen an der Rabattzeile (CartPanel): das Feld ist ein freies Textfeld,
 * `isMoneyInput` gab gruen, der Uebernehmen-Knopf ging auf, und im Warenkorb
 * landete ein Rabatt von FUENFZIG EURO. Der Riegel im Speicher
 * (`Number(eur) <= 0`) sah nur noch die positiv gemachte Zahl.
 *
 * Ein weggeworfenes Vorzeichen ist keine Sauberkeit, sondern eine stille
 * Betragsaenderung. Die Eingabe wird deshalb ABGEWIESEN, nicht begradigt.
 */
function traegtMinus(text: string): boolean {
  // Alle Schreibweisen, die eine Tastatur, ein Beleg oder eine Zwischenablage
  // liefert: Bindestrich, echtes Minus, Gedankenstriche, Halb- und Vollbreite.
  return /[-\u2212\u2013\u2014\uFE63\uFF0D]/.test(text ?? '');
}

/**
 * Rohe Eingabe eines Menschen zur kanonischen Zeichenkette mit Punkt.
 *
 * Gibt `''` zurück, wenn nichts Verwertbares übrig bleibt. Schneidet auf
 * `maxFrac` Nachkommastellen ab (kein Runden: die Kasse erfindet keine Cents).
 */
export function normalizeDecimal(raw: string, maxFrac = 2): string {
  const s = vereinheitlicheTrenner(raw ?? '');
  if (s === '') return '';

  const letztesKomma = s.lastIndexOf(',');
  const letzterPunkt = s.lastIndexOf('.');

  /** Position des Dezimaltrennzeichens, oder -1 wenn es keines gibt. */
  let trenner = -1;
  if (letztesKomma >= 0 && letzterPunkt >= 0) {
    // Beide da: das LETZTE trennt die Nachkommastellen ab.
    trenner = Math.max(letztesKomma, letzterPunkt);
  } else if (letztesKomma >= 0) {
    // Nur Kommas: deutsches Dezimalkomma. Mehrere Kommas sind ein Vertipper;
    // das letzte gilt, die davor zählen als Tausender.
    trenner = letztesKomma;
  } else if (letzterPunkt >= 0) {
    // Nur Punkte. Die LÄNGE der letzten Gruppe entscheidet.
    const nachDemPunkt = s.length - letzterPunkt - 1;
    trenner = nachDemPunkt > 0 && nachDemPunkt <= maxFrac ? letzterPunkt : -1;
  }

  const ganz = (trenner === -1 ? s : s.slice(0, trenner)).replace(/[.,]/g, '');
  const bruch = trenner === -1 ? '' : s.slice(trenner + 1).replace(/[.,]/g, '');

  if (ganz === '' && bruch === '') return '';
  // Kein führendes Nichts: „,50" ist „0,50".
  const kopf = ganz === '' ? '0' : ganz;
  if (trenner === -1) return kopf;
  return `${kopf}.${bruch.slice(0, maxFrac)}`;
}

/**
 * Wahr, wenn `raw` ein nicht negativer Geldbetrag ist: mindestens eine ganze
 * Stelle, höchstens `maxFrac` Nachkommastellen.
 *
 * ⚠️ `„199,"` ist absichtlich NICHT gültig: während des Tippens soll der
 * Speichern-Knopf nicht schon freigegeben sein.
 */
export function isMoneyInput(raw: string, maxFrac = 2): boolean {
  // 19.08.2026: ein getipptes Minus ist eine ABWEISUNG, keine Saeuberung
  // (Fund der boeswilligen Pruefung; Begruendung bei `traegtMinus`).
  if (traegtMinus(raw)) return false;
  const n = normalizeDecimal(raw, maxFrac);
  return new RegExp(`^\\d+(?:\\.\\d{1,${maxFrac}})?$`).test(n);
}

/**
 * Wahr, wenn `raw` ein nicht negatives GEWICHT in Gramm ist — bis zu drei
 * Nachkommastellen, denn die Goldwaage wiegt auf Milligramm.
 */
export function isWeightInput(raw: string): boolean {
  return isMoneyInput(raw, 3);
}

/**
 * Kanonisches Gewicht für die Anzeige: deutsches Komma, KEINE unnötigen
 * Nullen, höchstens drei Nachkommastellen. Die aufrufende Stelle hängt die
 * Einheit an. Nur zur Anzeige, nie zurück in die Rechnung.
 */
export function formatGrams(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (s === '') return '';
  // ⚠️ NICHT `normalizeDecimal`. Die ist für TASTENANSCHLÄGE eines Menschen
  // gebaut und liest einen Punkt vor drei Ziffern als Tausendertrennung. Was
  // hier ankommt, ist aber ein KANONISCHER Wert aus der Datenbank: Postgres
  // liefert `NUMERIC(10,4)` als „300.0000". Durch die Tipp-Zerlegung geschickt
  // würde daraus 3.000.000 g. Gemessen am 02.08.2026, gefangen von der
  // bestehenden Prüfung dieser Datei.
  //
  // ⚠️ 04.08.2026: hier stand die Erkenntnis, aber als HANDGRIFF, nicht als
  // Begriff. Deshalb ueberlebte dieselbe Falle im Kursstreifen und machte Gold
  // 1,1 Millionen Euro je Gramm teuer. Jetzt gibt es EINEN Namen dafuer.
  const n = zahlVomServer(s.replace(',', '.'));
  if (n === null) return '';
  return GRAMM_FORMAT.format(n);
}

// Ein Formatierer je Datei, nicht je Aufruf — siehe MoneyAmount.tsx (19.08.2026).
const GRAMM_FORMAT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 });
const EUR_FORMAT = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Kanonischer Geldbetrag für die Anzeige: deutsches Komma, Tausenderpunkt,
 * immer zwei Nachkommastellen. Die aufrufende Stelle hängt „ €" an. Nur zur
 * Anzeige — die RECHNUNG bleibt auf der kanonischen Zeichenkette.
 */
export function formatEur(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (s === '') return '';
  // ⚠️ Wie bei `formatGrams`: hier kommt ein KANONISCHER Wert an, kein
  // Tastenanschlag. Die Tipp-Zerlegung gehört an die Eingabe, nicht an die
  // Anzeige. Der Begriff dafuer heisst `zahlVomServer`.
  const n = zahlVomServer(s.replace(',', '.'));
  if (n === null) return '';
  return EUR_FORMAT.format(n);
}

/**
 * Früher die zweite, richtigere Zerlegung für Geld.
 *
 * ⚠️ Sie ist jetzt nur noch ein Name für `normalizeDecimal`. Genau die
 * Doppelung, dass es ZWEI Zerlegungen gab und sieben von acht Flächen die
 * falsche riefen, war der Fehler. Bleibt stehen, damit bestehende Aufrufe
 * weiterlaufen; neue Stellen nehmen `normalizeDecimal`.
 */
export function germanMoneyToDot(raw: string): string {
  return normalizeDecimal(raw, 2);
}

/**
 * Eine Zahl, die vom EIGENEN Motor kommt. Wird gelesen, nicht geraten.
 *
 * ── WARUM ES DAS BRAUCHT (04.08.2026) ──────────────────────────────────────
 *
 * ⚠️ Auf dem Werkstattbild der laufenden Kasse stand:
 *
 *       GOLD 1138664,00 €/g
 *
 * Der Motor hatte 113,8664 EUR/g gezogen und genau das gespeichert. Verloren
 * ging es beim Lesen: der Kursstreifen reichte den Wert durch
 * `normalizeDecimal`, und der ist ein Parser fuer MENSCHENTIPP. Er kennt das
 * deutsche Komma, Tausenderpunkte und Vertipper, und bei einem einzelnen
 * Punkt raet er nach der Zahl der Stellen dahinter:
 *
 *       normalizeDecimal('113.8664')  →  '1138664'
 *
 * Vier Stellen sind „mehr als zwei", also gilt der Punkt als Tausenderpunkt.
 * Fuer jemanden, der „1.234" tippt, ist das richtig. Fuer eine Zahl aus
 * Postgres ist es falsch: die kommt IMMER mit Punkt als Dezimaltrenner und
 * NIE mit Tausenderpunkten.
 *
 * Metallkurse tragen vier Nachkommastellen, weil ein Gramm Silber sonst auf
 * null Cent faellt. Der Fehler traf also JEDEN Kurs, jeden Tag.
 *
 * ── DIE REGEL ──────────────────────────────────────────────────────────────
 *
 * Menschentipp  → `normalizeDecimal`  (raet, und darf raten)
 * Motorzahl     → `zahlVomServer`     (raet NIE)
 *
 * Was hier nicht sauber ankommt, wird `null` und nicht etwa eine plausibel
 * aussehende falsche Zahl. Ein Strich auf dem Schirm ist ehrlich; ein
 * Millionenbetrag ist es nicht.
 */
export function zahlVomServer(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = raw.trim();
  // Genau die Gestalt, die Postgres fuer `numeric` und `double` liefert.
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

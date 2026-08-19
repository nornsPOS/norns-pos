/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE FARBE EINES ZEICHENS — nach Taetigkeit, nie zur Zierde
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── BASELS BEFUND VOM 19.08.2026 ───────────────────────────────────────────
 *
 * „Beide Themen sind ohne Seele, keine Lebendigkeit, kein Wuerzen — etwa
 * eine Zeichenfarbe, die stimmig ist und das Thema VOLLENDET, statt einer
 * Volltoenung ueber alles."
 *
 * Gemessen: 53 von 59 Zeichenaufrufen der Kasse tragen gar keine Farbe. Alle
 * erben `currentColor`, also den Grauton der Schrift. Die Flaeche ist damit
 * nicht ruhig, sie ist stumm.
 *
 * ── ⛔ DIE HAUSREGEL, DIE HIER GILT ────────────────────────────────────────
 *
 * „Funktionsfarben tragen nur Bedeutung." Ein Zeichen bunt zu machen, WEIL
 * Buntheit huebsch ist, waere genau die Volltoenung, gegen die Basel spricht,
 * nur andersherum. Deshalb faellt die Farbe hier nicht je Zeichen, sondern je
 * TAETIGKEIT — und die Taetigkeiten gibt es schon: die fuenf Gruppen der
 * Uebersicht (`screens/secondary/Uebersicht.tsx`), nach denen der Haendler
 * seine Flaechen ohnehin sucht.
 *
 *   Aufsicht und Schutz   Patina — die ruhige Wache. Grün liest sich als
 *                         „in Ordnung", und genau das sagt eine Aufsicht.
 *   Geld und Steuer       Gilt — der einzige Ort, an dem dieses Haus einen
 *                         Goldton fuehrt, und er gehoert dem Geld.
 *   Ware und Kanaele      Terra — Erde und Handwerk, die Ware selbst.
 *   Kundschaft            Weinrot — die Hausfarbe fuer den Menschen davor.
 *   Haus und Personal     Tinte — das Haus selbst traegt keine Sonderfarbe.
 *
 * ── WARUM DAS DAS THEMA VOLLENDET STATT ES ZU UEBERTOENEN ─────────────────
 *
 * Es sind MARKEN, keine Literale: jede kippt mit dem Thema (die Nachtwerte
 * stehen in `tokens.css` unter dem Dunkel-Block und sind dort gegen den
 * Schiefer gemessen). Und sie faerben nur das ZEICHEN, nie die Flaeche —
 * ein Tupfer je Kachel, kein Anstrich.
 */

/** Die fuenf Taetigkeiten, wie die Uebersicht sie fuehrt. */
export type Taetigkeit = 'aufsicht' | 'geld' | 'ware' | 'kundschaft' | 'haus';

/** Marke je Taetigkeit. Kippt mit dem Thema, weil es Marken sind. */
const FARBE_JE_TAETIGKEIT: Readonly<Record<Taetigkeit, string>> = {
  aufsicht: 'var(--w14-verdigris)',
  geld: 'var(--w14-gilt)',
  ware: 'var(--w14-terra)',
  kundschaft: 'var(--w14-weinrot)',
  haus: 'var(--w14-ink-faded)',
};

/**
 * Welcher Taetigkeit ein Pfad angehoert.
 *
 * ⚠️ Die Zuordnung steht hier NOCH EINMAL, statt aus `GRUPPEN` gelesen zu
 * werden — und das ist Absicht: `Uebersicht.tsx` ist eine Flaeche mit
 * Bauteilen, dieses Modul ist rein und wird von der Kopfleiste gebraucht,
 * die frueher laedt. Ein Waechter haelt beide Listen zusammen
 * (`symbolfarbe.test.ts`), damit aus zwei Kopien nie zwei Wahrheiten werden.
 */
const TAETIGKEIT_JE_PFAD: Readonly<Record<string, Taetigkeit>> = {
  // ── 19.08.2026: die KOPFLEISTE selbst fehlte ────────────────────────────
  //
  // Die Zuordnung kannte nur die Flaechen der Uebersicht — also die zweite
  // Reihe. Die sieben Reiter, die die Kassiererin den ganzen Tag ansieht
  // (/verkauf, /ankauf, /kasse, /lager, /kunden, /werkstatt, /schreiben),
  // fielen alle auf 'haus' und damit auf das stumme Grau. Am laufenden
  // Schirm gemessen: jede Reiterfarbe war rgb(139 152 166). Basels Befund
  // („keine Lebendigkeit") galt ausgerechnet dort, wo er ihn zuerst sieht.
  //
  // Die Zuordnung folgt denselben fuenf Taetigkeiten, keine neue Farbe:
  // Verkauf und Tageskasse bewegen GELD; Ankauf und Lager bewegen WARE;
  // Kunden und Schreiben gehoeren der KUNDSCHAFT (ein Schreiben hat immer
  // einen Empfaenger); die Werkstatt ist der Blick AUFS Ganze — Aufsicht.
  '/verkauf': 'geld',
  '/kasse': 'geld',
  '/ankauf': 'ware',
  '/lager': 'ware',
  '/kunden': 'kundschaft',
  '/schreiben': 'kundschaft',
  '/werkstatt': 'aufsicht',
  // Die Uebersicht ist die Landkarte des Hauses — sie gehoert dem Haus.
  '/uebersicht': 'haus',
  '/leitstand': 'aufsicht',
  '/risiko': 'aufsicht',
  '/zielkarte': 'aufsicht',
  '/tagebuch': 'aufsicht',
  '/finanzen': 'geld',
  '/steuer-export': 'geld',
  '/dokumente': 'geld',
  '/belegtexte': 'geld',
  '/inventur': 'ware',
  '/bewertung': 'ware',
  // 19.08.2026: /fotos ausgebaut (Webshop-Erbe) — siehe surface-registry.
  '/kurse': 'ware',
  '/compliance-inbox': 'kundschaft',
  '/termine': 'kundschaft',
  '/aufgaben': 'kundschaft',
  '/einstellungen': 'haus',
  '/team': 'haus',
};

/**
 * Die Farbe des Zeichens fuer einen Pfad.
 *
 * Ein unbekannter Pfad bekommt die Tinte — kein Raten, keine Zufallsfarbe.
 */
export function symbolfarbeFuer(pfad: string): string {
  const t = TAETIGKEIT_JE_PFAD[pfad];
  return FARBE_JE_TAETIGKEIT[t ?? 'haus'];
}

/** Nur fuer den Waechter: welche Pfade hier eine Taetigkeit tragen. */
export const PFADE_MIT_TAETIGKEIT = Object.keys(TAETIGKEIT_JE_PFAD);

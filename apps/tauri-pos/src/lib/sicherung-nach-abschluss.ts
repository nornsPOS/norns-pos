/**
 * ════════════════════════════════════════════════════════════════════════
 *  DIE SICHERUNG NACH DEM ABSCHLUSS — Basels Auftrag vom 12.08.2026
 * ════════════════════════════════════════════════════════════════════════
 *
 * „عمل نسخة احتياطية صامتة (pg_dump) عند كل إغلاق يومي (Z-Bon)."
 *
 * ── DER BEFUND, DER DAS NÖTIG MACHT (gemessen am 13.08.2026) ────────────
 *
 * Tagesabschluss und Sicherung waren zwei Flächen, die einander NIE riefen.
 * Es gab genau EINEN Auslöser für eine Sicherung im ganzen Baum: den Knopf
 * „Sicherung jetzt" in den Einstellungen. Kein Zeitgeber, kein Nachtlauf,
 * keine Erinnerung. Wer ihn nie drückte, hatte nie eine Sicherung — und
 * merkte es an dem Tag, an dem die Platte stirbt.
 *
 * § 147 AO verlangt zehn Jahre Vorlagefähigkeit. Eine Sicherung, die vom
 * Gedächtnis eines beschäftigten Händlers abhängt, ist keine.
 *
 * ── DIE REGEL, UND WARUM SIE SO VORSICHTIG IST ──────────────────────────
 *
 * ⚠️ Die Sicherung darf den Kassenschluss NIEMALS aufhalten oder ihn
 * scheitern lassen. Der Abschluss ist der fiskalische Akt; die Sicherung
 * ist Hygiene. Ein Kassierer, der abends vor einer Fehlermeldung steht,
 * weil ein USB-Stick fehlt, drückt beim nächsten Mal gar nicht mehr ab.
 *
 * Deshalb entscheidet dieses Stück NUR, OB gesichert wird. Es kennt weder
 * Tauri noch das Dateisystem, und es wirft nie.
 */

/** Was die Fläche wissen muss, um zu entscheiden. */
export interface Lage {
  /** Der Zielordner aus den Einstellungen. Leer heisst: nicht eingerichtet. */
  zielordner: string;
  /** Wann zuletzt gesichert wurde, als ISO-Tag. Leer heisst: nie. */
  zuletztAm: string;
  /** Heute, als ISO-Tag. */
  heute: string;
}

export type Entscheidung =
  | { sichern: true; zielordner: string }
  | { sichern: false; grund: 'nicht-eingerichtet' | 'heute-schon' };

/**
 * Sichern oder nicht.
 *
 * ⚠️ HÖCHSTENS EINMAL am Tag. Eine Kasse mit zwei Schichten schliesst
 * zweimal ab; zweimal die ganze Datenbank auf einen USB-Stick zu schreiben,
 * kostet den Kassierer beim zweiten Mal nur Wartezeit für dieselben Daten.
 * Der Tagesabschluss der zweiten Schicht enthält die erste ohnehin mit.
 */
export function entscheide(lage: Lage): Entscheidung {
  const ziel = lage.zielordner.trim();
  if (ziel === '') return { sichern: false, grund: 'nicht-eingerichtet' };
  if (lage.zuletztAm.trim() === lage.heute.trim()) {
    return { sichern: false, grund: 'heute-schon' };
  }
  return { sichern: true, zielordner: ziel };
}

/**
 * Der Satz nach einer gelungenen Sicherung.
 *
 * Er nennt den ORT, weil der Händler ihn braucht: eine Sicherung, von der
 * niemand weiss, wo sie liegt, hilft beim Plattentausch nicht.
 */
export function gelungenSatz(datei: string, zeilen: number): string {
  return `Sicherung abgelegt: ${datei} (${zeilen.toLocaleString('de-DE')} Zeilen).`;
}

/**
 * Der Satz nach einer gescheiterten Sicherung.
 *
 * ⚠️ Er sagt ZUERST, dass der Abschluss steht. Sonst liest ein Kassierer
 * am Abend „Fehler" und glaubt, sein Tagesabschluss sei nicht durch — und
 * macht ihn ein zweites Mal, oder ruft nachts an.
 */
export function gescheitertSatz(grund: string): string {
  return (
    'Der Tagesabschluss ist gebucht. Nur die automatische Sicherung danach ' +
    `hat nicht geklappt: ${grund} Sie lässt sich unter Einstellungen ` +
    'jederzeit von Hand nachholen.'
  );
}

/** Heute als ISO-Tag, aus der Uhr des Rechners. */
export function heute(jetzt: Date = new Date()): string {
  const z = (n: number): string => String(n).padStart(2, '0');
  return `${jetzt.getFullYear()}-${z(jetzt.getMonth() + 1)}-${z(jetzt.getDate())}`;
}

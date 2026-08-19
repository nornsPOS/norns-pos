/**
 * logo-werk — die reine Logik des Haendler-Logos auf dem Bon.
 *
 * BASELS DEKRET (26.07.2026, letztes Schreibtisch-Update): der Haendler laedt
 * in den Beleg-Einstellungen SEIN Logo hoch (SVG als „die praeziseste Form",
 * dazu PNG/JPEG), waehlt eine von drei festen Stufen — und jeder Bon danach
 * traegt es. Keine Pixelfummelei.
 *
 * Dieses Modul kennt weder DOM noch Tauri noch Server: es prueft Dateien und
 * SPIEGELT die Groessenrechnung der Rust-Seite (thermal.rs,
 * `logo_zielbreite`/`druckbreite_punkte`), damit die React-Seitenansicht
 * dieselben Verhaeltnisse zeigt wie das Papier. Die Byte-Vorschau braucht
 * diese Rechnung nicht (sie bekommt die ECHTE Rasterbreite aus dem Strom) —
 * der Spiegel dient dem Rueckfall und wird von den Tests festgeschrieben,
 * damit ein Drift zwischen den Seiten ROT wird.
 */

export type LogoStufe = 'klein' | 'mittel' | 'gross';

/**
 * Die drei Stufen als Prozent der Druckbreite — EXAKT die Zahlen aus
 * thermal.rs (`logo_zielbreite`): klein 40, mittel 60, gross 80. Mittel ist
 * dort auch der Rueckfall fuer Unbekanntes.
 */
export const LOGO_STUFEN: readonly { stufe: LogoStufe; label: string; prozent: number }[] = [
  { stufe: 'klein', label: 'Klein', prozent: 40 },
  { stufe: 'mittel', label: 'Mittel', prozent: 60 },
  { stufe: 'gross', label: 'Gross', prozent: 80 },
];

/** Ist der Wert eine der drei Stufen? (Grenzpruefung fuer fremde Quellen.) */
export function istLogoStufe(wert: unknown): wert is LogoStufe {
  return wert === 'klein' || wert === 'mittel' || wert === 'gross';
}

/**
 * Druckbare Punkte der Rolle — Spiegel von `druckbreite_punkte` in
 * thermal.rs: 48 Spalten (80 mm) sind 576 Punkte, alles andere faellt auf
 * 384 Punkte (58 mm) zurueck. Im Zweifel schmal: ein Logo, das auf die
 * schmale Rolle passt, passt immer auch auf die breite; andersherum
 * schneidet der Drucker rechts ab, ohne Fehler, ohne Warnung.
 */
export function druckbreitePunkte(cols: number): 384 | 576 {
  return cols >= 48 ? 576 : 384;
}

/**
 * Die Zielbreite einer Stufe in Punkten — Spiegel von `logo_zielbreite`
 * (ganzzahlige Teilung wie in Rust). Der `GS v 0`-Packer rundet die Breite
 * selbst auf ganze Bytes; hier zaehlt nur, dass BEIDE Seiten dieselbe Zahl
 * rechnen.
 */
export function logoZielbreitePunkte(stufe: LogoStufe, cols: number): number {
  const eintrag = LOGO_STUFEN.find((s) => s.stufe === stufe);
  const prozent = eintrag ? eintrag.prozent : 60;
  return Math.floor((druckbreitePunkte(cols) * prozent) / 100);
}

// ── Dateiannahme ───────────────────────────────────────────────────────────

export type LogoFormat = 'svg' | 'png' | 'jpeg';

/**
 * 256 KB — die SERVER-Grenze (apps/api-cloud/src/routes/beleg-logo.ts,
 * `BELEG_LOGO_MAX_BYTES`). Die Flaeche prueft VOR dem Hochladen gegen
 * dieselbe Zahl: eine Grenze, die erst der Server nennt, ist eine
 * Fehlermeldung nach dem Warten statt vor dem Waehlen.
 */
export const LOGO_MAX_BYTES = 256 * 1024;

export type LogoDateiPruefung =
  | { ok: true; format: LogoFormat }
  | { ok: false; grund: string };

const FORMAT_GRUND = 'Bitte SVG, PNG oder JPEG waehlen.';

/**
 * Nimmt die Kasse diese Datei als Logo an?
 *
 * Das Format wird am MIME-Typ UND an der Endung erkannt: Windows liefert je
 * nach Registry fuer .svg einen LEEREN Typ, und eine Pruefung nur am Typ
 * haette genau Basels Wunschformat abgelehnt.
 */
export function pruefeLogoDatei(
  dateiname: string,
  mime: string,
  groesseBytes: number,
): LogoDateiPruefung {
  const format = erkenneFormat(dateiname, mime);
  if (format === null) return { ok: false, grund: FORMAT_GRUND };
  if (groesseBytes <= 0) {
    return { ok: false, grund: 'Die Datei ist leer.' };
  }
  if (groesseBytes > LOGO_MAX_BYTES) {
    return { ok: false, grund: 'Die Datei ist groesser als 256 KB.' };
  }
  return { ok: true, format };
}

/** Der Anzeigetyp je Format — fuer die data-URL der React-Seitenansicht. */
export function logoMime(format: LogoFormat): string {
  if (format === 'svg') return 'image/svg+xml';
  if (format === 'png') return 'image/png';
  return 'image/jpeg';
}

function erkenneFormat(dateiname: string, mime: string): LogoFormat | null {
  const typ = mime.trim().toLowerCase();
  if (typ === 'image/svg+xml') return 'svg';
  if (typ === 'image/png') return 'png';
  if (typ === 'image/jpeg') return 'jpeg';
  const name = dateiname.trim().toLowerCase();
  if (typ === '') {
    if (name.endsWith('.svg')) return 'svg';
    if (name.endsWith('.png')) return 'png';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'jpeg';
  }
  return null;
}

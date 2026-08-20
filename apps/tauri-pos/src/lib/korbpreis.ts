/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  korbpreis — WELCHER Preis für dieses Stück gilt, an EINER Stelle
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 ──────────────────────────────────────────────
 *
 * Die Kasse kannte den Tagespreis und buchte den gespeicherten. Der Satz auf
 * der Verkaufsfläche sagte es dem Händler wörtlich: „Den Tagespreis übernehmen
 * Sie im Lager: Zeile anklicken, unter Details den Verkaufspreis eintragen."
 * Also: jeden Morgen, für jedes Stück, von Hand — für eine Zahl, die die Kasse
 * selbst ausrechnet.
 *
 * ── WARUM DIESE ENTSCHEIDUNG EINE EIGENE DATEI IST ─────────────────────────
 *
 * Sie wird an mehreren Stellen gebraucht: in der Korbzeile, in der Summe, im
 * Bezahlen-Dialog, auf dem Beleg. Stünde sie dort viermal, gäbe es irgendwann
 * vier Antworten auf dieselbe Frage — und ein abweichender Verkaufspreis ist
 * kein Schönheitsfehler, sondern ein falscher Beleg.
 *
 * Sie ist REIN: keine Uhr, kein Netz, keine Datenbank. Genau deshalb prüfbar.
 *
 * ── DIE REGEL, IN EINEM SATZ ───────────────────────────────────────────────
 *
 * Es gilt der Tagespreis, WENN es einen gibt. Sonst der gespeicherte Preis.
 * Ein Stück mit festem Preis hat nie einen Tagespreis (der Motor gibt dann
 * keinen heraus), also fällt es von selbst auf den gespeicherten.
 */

/** Was der Motor je Stück über den Preis sagt (`/api/products/kurspreise`). */
export interface Preisauskunft {
  readonly productId: string;
  readonly listPriceEur: string;
  readonly kurspreisEur: string | null;
  readonly kurspreisGrund: string | null;
  readonly festerPreis: boolean;
}

/** Der Preis, der gilt — und woher er kommt. */
export interface GeltenderPreis {
  readonly preisEur: string;
  readonly herkunft: 'tagespreis' | 'gespeichert';
  /**
   * Warum KEIN Tagespreis gilt. Nur gesetzt, wenn der Preis der gespeicherte
   * ist UND der Motor einen Grund genannt hat — die Fläche zeigt ihn, statt
   * den Händler raten zu lassen.
   */
  readonly grund: string | null;
}

/**
 * Der geltende Preis für ein Stück.
 *
 * @param gespeichert Der Preis aus dem Bestand (immer vorhanden).
 * @param auskunft    Die Auskunft des Motors, oder `undefined`, solange sie
 *                    noch nicht da ist. Ohne sie gilt der gespeicherte Preis —
 *                    die Kasse rät NICHT und wartet auch nicht.
 */
export function geltenderPreis(
  gespeichert: string,
  auskunft: Preisauskunft | undefined,
): GeltenderPreis {
  if (auskunft?.kurspreisEur) {
    return { preisEur: auskunft.kurspreisEur, herkunft: 'tagespreis', grund: null };
  }
  return {
    preisEur: auskunft?.listPriceEur ?? gespeichert,
    herkunft: 'gespeichert',
    grund: auskunft?.kurspreisGrund ?? null,
  };
}

/**
 * Der Takt, in dem der Motor die Kurse holt (`norns-sidecar.mjs`).
 *
 * ⚠️ Die Zahl steht hier ein zweites Mal, und das ist eine bewusste
 * Entscheidung: die Fläche kann den Motor nicht fragen, wie oft er tickt, und
 * ein Countdown ohne Takt ist keiner. Ein Prüfsatz hält beide Zahlen
 * zusammen, damit aus zwei Kopien nie zwei Wahrheiten werden.
 */
export const KURSTAKT_SEKUNDEN = 5 * 60;

/**
 * Wie viele Sekunden bis zum nächsten Kurs.
 *
 * Am Tresen steht damit eine ehrliche Zahl statt eines Gefühls: „der Preis,
 * den Sie sehen, gilt noch so lange."
 *
 * ⚠️ Nie negativ und nie grösser als der Takt: ist der Abruf überfällig (Netz
 * weg), zeigt die Fläche 0 — ein Countdown, der ins Minus läuft, verwirrt nur,
 * und dass das Netz fehlt, sagt die Kasse an ihrer eigenen Stelle.
 */
export function sekundenBisZumNaechstenKurs(
  geholtAm: string | null | undefined,
  jetzt: Date = new Date(),
): number | null {
  if (!geholtAm) return null;
  const t = Date.parse(geholtAm);
  if (!Number.isFinite(t)) return null;
  const vergangen = Math.floor((jetzt.getTime() - t) / 1000);
  const rest = KURSTAKT_SEKUNDEN - vergangen;
  return Math.max(0, Math.min(KURSTAKT_SEKUNDEN, rest));
}

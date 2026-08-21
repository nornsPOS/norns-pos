/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Der Rettungsstick — der Notfallschlüssel als Ding statt als Zettel
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── BASELS AUFTRAG (21.08.2026) ────────────────────────────────────────────
 *
 * Wörtlich: ein gewöhnlicher USB-Stick wird bei der Einrichtung beschrieben
 * und öffnet später den Weg zu einem neuen Kassencode. Genau das ist hier
 * gebaut — mit zwei bewussten Abweichungen, beide begründet:
 *
 * 1. ⚠️ DER STICK WIRD NICHT FORMATIERT. Basel schlug vor, ihn zu leeren.
 *    Ein Händler greift aber zum nächstbesten Stick — und auf dem liegen
 *    Familienfotos. Ein Formatieren aus einem Kassenprogramm heraus, mit
 *    einem falsch gewählten Laufwerk, wäre die Katastrophe, die kein
 *    Notausgang wert ist. Der Stick bekommt stattdessen EINEN Ordner
 *    (`NORNS-RETTUNG/`); alles andere darauf bleibt unberührt. Erkannt wird
 *    er am Ordner, nicht am Dateisystem.
 *
 * 2. ⚠️ AUF DEM STICK LIEGT DAS GEHEIMNIS, IN DER KASSE NUR SEIN ABDRUCK
 *    (argon2id, derselbe Weg wie Kassencode und Notfallschlüssel). Wer die
 *    Datenbank stiehlt, kann daraus keinen Stick bauen. Wer den Stick
 *    stiehlt, kann damit nichts buchen — er kann nur einen neuen Code
 *    setzen, und das steht laut im Tagebuch und auf der Aufsicht.
 *
 * ── EINMALIG, ABER SELBSTNACHLADEND ────────────────────────────────────────
 *
 * Nach jedem Einlösen schreibt die Kasse SOFORT ein frisches Geheimnis auf
 * denselben Stick und speichert dessen Abdruck. Der Stick bleibt damit
 * dauerhaft gültig, aber jedes eingelöste Geheimnis ist verbraucht — ein
 * kopierter Stick verrät sich, weil die Kopie nach dem nächsten Gebrauch des
 * Originals tot ist.
 */

import { hashPin, verifyPin } from './index.js';

/** Der Ordner auf dem Stick. Gross geschrieben, damit man ihn im Explorer sieht. */
export const STICK_ORDNER = 'NORNS-RETTUNG';

/** Die Datei mit dem Geheimnis. */
export const STICK_DATEI = 'rettungsschluessel.norns';

/** Bytes des Geheimnisses. 32 → 256 Bit; Raten ist kein Weg. */
export const GEHEIMNIS_BYTES = 32;

export interface StickInhalt {
  /** Fassung des Formats, für spätere Wanderungen. */
  fassung: 1;
  /** Wofür der Stick ist — steht auch als Klartext für den Finder. */
  zweck: string;
  /** Das Geheimnis, base64url. */
  geheimnis: string;
  /** Wann geschrieben (ISO). Nur Auskunft, nie Prüfgrundlage. */
  geschrieben: string;
}

/** Ein frisches Geheimnis (base64url), aus kryptographischem Zufall des Rufers. */
export function alsGeheimnis(bytes: Uint8Array): string {
  if (bytes.length !== GEHEIMNIS_BYTES) {
    throw new Error(`Rettungsgeheimnis braucht ${GEHEIMNIS_BYTES} Bytes, bekam ${bytes.length}`);
  }
  return Buffer.from(bytes).toString('base64url');
}

/** Der Dateiinhalt, wie er auf den Stick geschrieben wird. */
export function stickDateiInhalt(geheimnis: string, geschrieben: string): string {
  const inhalt: StickInhalt = {
    fassung: 1,
    zweck:
      'Rettungsschluessel dieser Norns-Kasse. Mit diesem Stick laesst sich ein ' +
      'vergessener Kassencode neu setzen. Sicher verwahren.',
    geheimnis,
    geschrieben,
  };
  return `${JSON.stringify(inhalt, null, 2)}\n`;
}

/**
 * Eine Stickdatei zurücklesen. `null` bei allem, was nicht exakt passt —
 * eine kaputte Datei ist KEIN Fehlerdialog wert, sie ist einfach kein Stick.
 */
export function leseStickDatei(roh: string): StickInhalt | null {
  let j: unknown;
  try {
    j = JSON.parse(roh);
  } catch {
    return null;
  }
  if (typeof j !== 'object' || j === null) return null;
  const o = j as Record<string, unknown>;
  if (o.fassung !== 1) return null;
  if (typeof o.geheimnis !== 'string' || !/^[A-Za-z0-9_-]{40,50}$/.test(o.geheimnis)) return null;
  if (typeof o.geschrieben !== 'string') return null;
  return {
    fassung: 1,
    zweck: typeof o.zweck === 'string' ? o.zweck : '',
    geheimnis: o.geheimnis,
    geschrieben: o.geschrieben,
  };
}

/** Abdruck fürs Speichern — der Klartext bleibt auf dem Stick, nie in der Kasse. */
export function stickAbdruck(geheimnis: string): Promise<string> {
  return hashPin(geheimnis);
}

/** Passt das Geheimnis vom Stick zum gespeicherten Abdruck? */
export function stickStimmt(geheimnis: string, abdruck: string): Promise<boolean> {
  return verifyPin(geheimnis, abdruck);
}

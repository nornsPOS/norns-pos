/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER DAUERHAFTE FADEN — was bleibt, wenn die Kasse neu startet
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 09.08.2026 ────────────────────────────────────────────
 *
 * KEIN Fehlschlag hinterliess eine dauerhafte Spur.
 *
 *   • Der Motor schreibt sein Protokoll nach stdout (`app.ts:190`, keine
 *     `destination`, keine Datei).
 *   • Rust liest die Ausgabe und VERWIRFT sie ab Bereitschaft:
 *     `motor.rs:407`  `while empfaenger.recv().is_ok() {}`
 *   • Von der Fehlerausgabe bleiben zwölf Zeilen im Arbeitsspeicher
 *     (`motor.rs:75`, `LETZTE_ZEILEN`).
 *
 * Die `requestId`, die der Server in seine Zeile schreibt, war nach einem
 * Neustart also für immer weg. Der Händler ruft am Dienstag an und sagt
 * „gestern ging etwas schief" — und es gibt nichts mehr nachzusehen.
 *
 * ── ⚠️ WARUM NICHT EINFACH DAS PROTOKOLL AUF PLATTE ──────────────────────
 *
 * Weil in einer Fehlermeldung ein Kundenname stehen kann. Der naheliegende
 * Weg — Rust fängt stdout und schreibt es in eine Datei — legte damit
 * personenbezogene Daten unverschlüsselt neben die Datenbank, in eine Datei,
 * die niemand aufräumt und die in jeder Sicherung mitreist.
 *
 * Diese Datei schreibt deshalb NICHT den Text. Sie schreibt eine feste,
 * enge Zeile aus Feldern, die von sich aus keine Person benennen können:
 *
 *     Zeitpunkt · Vorgangskennung · Stelle · Code · Status · Verb · Muster
 *
 * ⚠️ `muster` ist die Routenschablone (`/api/customers/:id`), NIE die echte
 * Adresse: die trüge die Kennung des Kunden.
 *
 * Damit ist die Datei sicher genug, um sie einem Techniker zu schicken, und
 * genau reich genug, um vom Codewort des Händlers zur Stelle zu führen.
 *
 * ── AUFBEWAHRUNG ─────────────────────────────────────────────────────────
 *
 * Eine Datei je Tag, und beim Start fallen die älteren weg. Ein Protokoll,
 * das unbegrenzt wächst, ist der nächste Befund.
 *
 * ⚠️ Das ist KEINE Aufzeichnung nach § 147 AO. Es ist ein technisches
 * Betriebsprotokoll; die steuerlich erheblichen Daten stehen in der
 * Datenbank und im Tagebuch. Deshalb darf es kurz sein.
 */

import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/** Wie viele Tage zurück das Protokoll reicht. */
export const VORFALL_TAGE = 30;

/** Der Ordner unterhalb des Datenorts. */
export const VORFALL_ORDNER = 'protokoll';

export interface Vorfall {
  /** Wann, ISO 8601 mit Zeitzone. */
  zeit: string;
  /** Die Vorgangskennung, dieselbe wie `x-request-id`. */
  vorgang: string;
  /** WO, z. B. `NORNS-BARGELD-OHNE-SCHICHT`. Leer bei fremden Fehlern. */
  stelle: string;
  /** Die Art, z. B. `CONFLICT`. */
  code: string;
  status: number;
  verb: string;
  /** Die Routenschablone, NIE die echte Adresse. */
  muster: string;
}

/** Der Dateiname eines Tages. */
export function dateiname(zeit: Date): string {
  return `vorfaelle-${zeit.toISOString().slice(0, 10)}.jsonl`;
}

/**
 * Die Zeile bauen. Rein, damit prüfbar ist, was WIRKLICH auf der Platte
 * landet.
 *
 * ⚠️ Kein Meldungstext, keine Adresse mit Werten, kein Rumpf. Was hier nicht
 * steht, kann auch nicht hinausgetragen werden.
 */
export function zeile(v: Vorfall): string {
  return `${JSON.stringify({
    zeit: v.zeit,
    vorgang: v.vorgang,
    stelle: v.stelle,
    code: v.code,
    status: v.status,
    verb: v.verb,
    muster: v.muster,
  })}\n`;
}

/**
 * Welche Dateien zu alt sind. Rein, damit die Entscheidung prüfbar ist,
 * BEVOR sie etwas löscht.
 */
export function zuAlt(namen: readonly string[], jetzt: Date, tage = VORFALL_TAGE): string[] {
  const grenze = new Date(jetzt.getTime() - tage * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return namen
    .filter((n) => /^vorfaelle-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
    .filter((n) => {
      const tag = n.slice('vorfaelle-'.length, -'.jsonl'.length);
      /**
       * ⚠️ Die Form allein genügt NICHT. `vorfaelle-2020-13-99.jsonl` passt
       * auf das Muster, ist aber kein Tag — und weil „2020-13-99" lexikalisch
       * kleiner ist als die Grenze, hätte das Aufräumen es gelöscht.
       *
       * Das ist keine Kleinigkeit: der Datenort trägt auch die Datenbank und
       * die Sicherungen. Was wir nicht selbst geschrieben haben, fassen wir
       * nicht an. Deshalb muss der Tag ECHT sein und sich unverändert
       * zurückschreiben lassen.
       */
      const d = new Date(`${tag}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime())) return false;
      if (d.toISOString().slice(0, 10) !== tag) return false;
      return tag < grenze;
    });
}

/**
 * Einen Vorfall anhängen.
 *
 * ⚠️ Wirft NIE. Ein Protokoll, das den laufenden Verkauf umbringt, weil die
 * Platte voll ist, wäre schlimmer als gar keins — und genau in dem Augenblick
 * steht ein Kunde am Tresen.
 */
export async function haltFest(datenort: string, v: Vorfall): Promise<void> {
  try {
    const ordner = join(datenort, VORFALL_ORDNER);
    await mkdir(ordner, { recursive: true });
    await appendFile(join(ordner, dateiname(new Date(v.zeit))), zeile(v), 'utf8');
  } catch {
    // Bewusst still. Der Verkauf hat Vorrang.
  }
}

/** Alte Dateien wegräumen. Wirft nie, aus demselben Grund. */
export async function raeumeAuf(datenort: string, jetzt = new Date()): Promise<number> {
  try {
    const ordner = join(datenort, VORFALL_ORDNER);
    const alle = await readdir(ordner);
    const weg = zuAlt(alle, jetzt);
    for (const n of weg) await unlink(join(ordner, n));
    return weg.length;
  } catch {
    return 0;
  }
}

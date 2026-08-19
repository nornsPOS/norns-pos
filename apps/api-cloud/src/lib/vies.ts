/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EINE USt-IdNr. DARF NICHT OHNE PRÜFSATZ EXISTIEREN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Am Abend des 26.07.2026 gemessen, nachdem der § 13b-Riegel ausgerollt war:
 * der Riegel stand, aber der einzige legitime Weg zu ihm war tot.
 *
 *   • Die Kasse fragte die EU OHNE `customerId` ab, also hielt die Route
 *     nichts fest.
 *   • Der B2B-Kunde wurde erst DANACH angelegt, und `POST /api/customers`
 *     schrieb nur `vat_id` — kein Prüfsatz, nirgends.
 *   • Wanderung 0116 belegt den Bestand bewusst nicht vor.
 *
 * Ergebnis: `darfReverseCharge` antwortete immer „die USt-IdNr. wurde nie
 * geprüft", finalize warf 403, und diesen Fehlercode kannte kein einziger
 * Client. Beim Kartenweg lag die Autorisierung bereits VOR dem finalize: die
 * Karte war belastet, jeder Wiederholversuch scheiterte gleich, und die
 * Kassiererin hatte keinen Ausweg.
 *
 * ── Warum die Reparatur HIER sitzt und nicht in der Kasse ────────────────
 *
 * Der naheliegende Weg wäre gewesen, die Kasse `customerId` mitschicken zu
 * lassen. Das repariert genau einen Bildschirm. Es gibt aber ZWEI Stellen, die
 * `vat_id` schreiben (`routes/customers.ts` beim Anlegen und
 * `routes/customer-update.ts` beim Ändern), und jede weitere Oberfläche —
 * Inhaber-App, Web-Shop, ein Import — hätte dieselbe Lücke von neuem.
 *
 * Deshalb die Regel eine Ebene tiefer: **wer `vat_id` setzt, löst die Prüfung
 * aus.** Es gibt dann keinen Weg mehr, eine USt-IdNr. ohne Prüfsatz in die
 * Datenbank zu bekommen.
 *
 * ── Und was bei einer ÄNDERUNG passiert ──────────────────────────────────
 *
 * Der alte Prüfsatz wird nicht etwa mitgeschleift, sondern ersetzt. Zusätzlich
 * vergleicht `darfReverseCharge` ohnehin `vat_id_checked_value` gegen `vat_id`
 * — zwei Riegel gegen denselben Handgriff, weil er so verlockend ist: eine
 * echte Nummer eintragen, prüfen lassen, danach austauschen.
 *
 * ── Wenn die EU nicht antwortet ──────────────────────────────────────────
 *
 * Dann wird `NICHT_ERREICHBAR` festgehalten, und das Anlegen des Kunden
 * gelingt trotzdem. Ein Ausfall bei der EU darf keinen Kunden verhindern. § 13b
 * bleibt bis zur Wiederholung gesperrt — das ist die sichere Richtung, und der
 * Satz an der Kasse sagt ausdrücklich, dass es KEINE Aussage über die Nummer
 * ist.
 */

import { sql as drizzleSql } from 'drizzle-orm';

import { normalisiereVatId, type VatPruefergebnis } from './reverse-charge.js';

export interface ViesAntwort {
  ergebnis: VatPruefergebnis;
  name?: string;
  address?: string;
  /** `INVALID_FORMAT`, `VIES_TIMEOUT`, `VIES_UNAVAILABLE` — für die Anzeige. */
  error?: string;
}

/** Die reine Abfrage. Kein Datenbankzugriff, damit sie ohne Aufbau prüfbar ist. */
export async function frageVies(rohVatId: string): Promise<ViesAntwort> {
  const clean = normalisiereVatId(rohVatId);

  if (clean.length < 4 || clean.length > 15) {
    return { ergebnis: 'FORMFEHLER', error: 'INVALID_FORMAT' };
  }
  const countryCode = clean.slice(0, 2);
  const vatNumber = clean.slice(2);
  if (!/^[A-Z]{2}$/.test(countryCode) || !/^[A-Z0-9]+$/.test(vatNumber)) {
    return { ergebnis: 'FORMFEHLER', error: 'INVALID_FORMAT' };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${vatNumber}`,
      {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'Warehouse14/1.0.0' },
      },
    );
    clearTimeout(timeoutId);

    if (!response.ok) {
      // Die EU antwortet, aber nicht mit einem Ergebnis. Das ist KEINE Aussage
      // über die Nummer.
      return { ergebnis: 'NICHT_ERREICHBAR', error: 'VIES_UNAVAILABLE' };
    }

    const data = (await response.json()) as { isValid: boolean; name?: string; address?: string };
    if (!data.isValid) return { ergebnis: 'UNGUELTIG' };

    // DE und ES melden gültig, verbergen aber die Angaben. Leeres Feld heisst
    // hier „nicht mitgeteilt", nicht „unbekannte Firma".
    const name = data.name && data.name.trim() !== '' ? data.name.trim() : '---';
    const address = data.address && data.address.trim() !== '' ? data.address.trim() : '---';
    return { ergebnis: 'GUELTIG', name, address };
  } catch (err) {
    const zeitablauf = (err as { name?: string }).name === 'AbortError';
    return {
      ergebnis: 'NICHT_ERREICHBAR',
      error: zeitablauf ? 'VIES_TIMEOUT' : 'VIES_UNAVAILABLE',
    };
  }
}

/**
 * Nur so viel Datenbank, wie hier gebraucht wird — die Route reicht sie durch.
 *
 * Bewusst weit gefasst: der echte `AppDb` traegt eine engere Signatur, und ein
 * zu enges Abbild hier wuerde bloss einen Zwang zum Umtypisieren erzeugen, der
 * dann auch echte Fehler verschlucken kann.
 */
export interface DbAusfuehrer {
  execute: (query: never) => Promise<unknown>;
}

async function zeilen<T>(db: DbAusfuehrer, query: unknown): Promise<T[]> {
  const r = (await db.execute(query as never)) as T[] | { rows?: T[] } | undefined;
  if (Array.isArray(r)) return r;
  return r?.rows ?? [];
}

/**
 * Hält das Ergebnis beim Kunden fest.
 *
 * Gibt zurück, ob wirklich eine Zeile beschrieben wurde. ⚠️ Ein Fehlschlag darf
 * NICHT als Erfolg durchgehen: genau diese fünf Spalten sind die, die die
 * Spaltenrechte-Falle in diesem Haus schon zweimal live gesperrt hat.
 */
export async function haltePruefungFest(
  db: DbAusfuehrer,
  customerId: string,
  vatId: string,
  antwort: ViesAntwort,
): Promise<boolean> {
  const rows = await zeilen<{ id: string }>(db, drizzleSql`
    UPDATE customers
       SET vat_id_checked_at    = now(),
           vat_id_check_result  = ${antwort.ergebnis}::vat_check_result,
           vat_id_check_name    = ${antwort.name ?? null},
           vat_id_check_address = ${antwort.address ?? null},
           vat_id_checked_value = ${normalisiereVatId(vatId)}
     WHERE id = ${customerId}::uuid
     RETURNING id`);
  return rows.length > 0;
}

/**
 * Der eine Handgriff für jede Stelle, die eine USt-IdNr. schreibt.
 *
 * Wirft NICHT. Ein Ausfall bei der EU darf kein Anlegen und kein Ändern eines
 * Kunden verhindern — er darf nur nicht als Prüfung durchgehen.
 */
export async function pruefeUndHalteFest(
  db: DbAusfuehrer,
  customerId: string,
  vatId: string | null | undefined,
  log?: { warn: (o: unknown, m: string) => void },
): Promise<ViesAntwort | null> {
  if (!vatId || vatId.trim() === '') return null;
  try {
    const antwort = await frageVies(vatId);
    const gespeichert = await haltePruefungFest(db, customerId, vatId, antwort);
    if (!gespeichert) {
      log?.warn({ customerId }, 'USt-IdNr.-Pruefung konnte nicht festgehalten werden');
    }
    return antwort;
  } catch (e) {
    log?.warn({ customerId, err: e }, 'USt-IdNr.-Pruefung fehlgeschlagen');
    return null;
  }
}

/**
 * Ein Kunde, dessen USt-IdNr. entfernt wurde, behält keinen Prüfsatz.
 *
 * Sonst stünde beim nächsten Setzen derselben Nummer ein alter Satz da, der nie
 * zu ihr gehörte — und `darfReverseCharge` würde ihn akzeptieren, weil die
 * Werte zufällig wieder zusammenpassen.
 */
export async function loeschePruefung(db: DbAusfuehrer, customerId: string): Promise<void> {
  await zeilen(db, drizzleSql`
    UPDATE customers
       SET vat_id_checked_at = NULL, vat_id_check_result = NULL,
           vat_id_check_name = NULL, vat_id_check_address = NULL,
           vat_id_checked_value = NULL
     WHERE id = ${customerId}::uuid`);
}

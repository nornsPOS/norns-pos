/**
 * Reverse-Charge (§ 13b): darf dieser Vorgang ohne Umsatzsteuer laufen?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER ZUSTAND, DEN DIESE PRÜFUNGEN BEENDEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `POST /api/transactions/finalize` nahm `taxTreatmentCode` aus dem Rumpf und
 * schrieb ihn durch, bis in den Hauptbuch-Eintrag. Keine Zeile prüfte bei
 * `REVERSE_CHARGE_13B`, ob der Kunde überhaupt eine USt-IdNr. trägt.
 * Kassiererrecht genügte. Es ging um 19 Prozent jedes Verkaufs.
 *
 * Der Integrationstest, der das absegnete, benutzte `DE123456789` — die
 * erfundene Nummer aus der Vorlage. Er war grün.
 */

import { describe, expect, it } from 'vitest';

import {
  darfReverseCharge,
  normalisiereVatId,
  VAT_PRUEFUNG_HOECHSTALTER_TAGE,
  type KundeSteuerstand,
} from '../../src/lib/reverse-charge.js';

const JETZT = new Date('2026-07-26T12:00:00Z');
const vorTagen = (t: number) => new Date(JETZT.getTime() - t * 86_400_000);

const gueltig = (ueber: Partial<KundeSteuerstand> = {}): KundeSteuerstand => ({
  vatId: 'DE811907980',
  geprueftesVatId: 'DE811907980',
  geprueftAm: vorTagen(3),
  ergebnis: 'GUELTIG',
  ...ueber,
});

describe('der Normalfall', () => {
  it('geprueft, gueltig und frisch: erlaubt', () => {
    const u = darfReverseCharge({ kunde: gueltig(), jetzt: JETZT });
    expect(u.erlaubt).toBe(true);
    expect(u.grund).toBeUndefined();
  });

  it('und der Beleg traegt den Nachweis, nicht nur die Datenbank', () => {
    // Bei einer Pruefung Jahre spaeter liegt der Beleg auf dem Tisch, nicht
    // die Datenbank.
    const u = darfReverseCharge({ kunde: gueltig(), jetzt: JETZT });
    expect(u.belegvermerk).toContain('DE811907980');
    expect(u.belegvermerk).toContain('23.07.2026');
    expect(u.belegvermerk).toContain('gültig');
  });
});

describe('was NICHT reicht', () => {
  it('gar kein Kunde', () => {
    expect(darfReverseCharge({ kunde: null, jetzt: JETZT }).erlaubt).toBe(false);
  });

  it('Kunde ohne USt-IdNr.', () => {
    expect(darfReverseCharge({ kunde: gueltig({ vatId: null }), jetzt: JETZT }).erlaubt).toBe(false);
  });

  it('eine USt-IdNr., die NIE geprueft wurde — der Zustand jedes Bestandskunden', () => {
    // Wanderung 0116 legt die Spalten leer an, ausdruecklich ohne Vorbelegung.
    // Ein vorbelegtes GUELTIG waere genau die Erfindung, gegen die sie gebaut ist.
    const u = darfReverseCharge({
      kunde: gueltig({ ergebnis: null, geprueftAm: null }),
      jetzt: JETZT,
    });
    expect(u.erlaubt).toBe(false);
    expect(u.grund).toContain('nie geprüft');
  });

  it('die EU kennt die Nummer nicht', () => {
    expect(darfReverseCharge({ kunde: gueltig({ ergebnis: 'UNGUELTIG' }), jetzt: JETZT }).erlaubt).toBe(
      false,
    );
  });

  it('⚠️ „konnte nicht fragen" berechtigt GENAUSO WENIG wie „ungueltig"', () => {
    // Aber der Satz fuer den Menschen ist ein anderer: die Route gab bei
    // Zeitueberschreitung dasselbe `valid: false` zurueck wie bei einer
    // wirklich ungueltigen Nummer. Das ist eine falsche Anschuldigung
    // gegenueber einem Geschaeftskunden.
    const u = darfReverseCharge({ kunde: gueltig({ ergebnis: 'NICHT_ERREICHBAR' }), jetzt: JETZT });
    expect(u.erlaubt).toBe(false);
    expect(u.grund).toContain('KEINE Aussage über die Nummer');
  });

  it('eine Nummer, die gar keine Form hat', () => {
    expect(darfReverseCharge({ kunde: gueltig({ ergebnis: 'FORMFEHLER' }), jetzt: JETZT }).erlaubt).toBe(
      false,
    );
  });
});

describe('das Alter der Pruefung', () => {
  it('eine USt-IdNr. kann erloeschen, also verfaellt die Pruefung', () => {
    const u = darfReverseCharge({ kunde: gueltig({ geprueftAm: vorTagen(91) }), jetzt: JETZT });
    expect(u.erlaubt).toBe(false);
    expect(u.grund).toContain('91 Tage alt');
  });

  it('genau auf der Grenze gilt noch', () => {
    expect(
      darfReverseCharge({
        kunde: gueltig({ geprueftAm: vorTagen(VAT_PRUEFUNG_HOECHSTALTER_TAGE) }),
        jetzt: JETZT,
      }).erlaubt,
    ).toBe(true);
  });

  it('eine eigene Grenze aus den Einstellungen gilt', () => {
    expect(
      darfReverseCharge({
        kunde: gueltig({ geprueftAm: vorTagen(40) }),
        jetzt: JETZT,
        hoechstalterTage: 30,
      }).erlaubt,
    ).toBe(false);
  });

  it('eine Pruefung aus der ZUKUNFT legt den Laden nicht lahm', () => {
    // Das waere ein Uhrfehler, kein frischer Beleg. Dieselbe Regel wie beim
    // Metallkurs: sonst koennte eine schiefe Serveruhr jeden B2B-Verkauf
    // blockieren.
    expect(
      darfReverseCharge({ kunde: gueltig({ geprueftAm: vorTagen(-5) }), jetzt: JETZT }).erlaubt,
    ).toBe(true);
  });
});

describe('⚠️ der Austausch NACH der Pruefung', () => {
  it('eine gepruefte Nummer faerbt NICHT auf eine neue ab', () => {
    // Der Angriff ohne diese Prüfung: eine echte, pruefbare USt-IdNr.
    // eintragen, pruefen lassen, danach die Nummer austauschen. Die Pruefung
    // stuende weiter da und ginge still auf die neue Nummer ueber.
    const u = darfReverseCharge({
      kunde: gueltig({ vatId: 'DE999999999' }), // geprueft wurde DE811907980
      jetzt: JETZT,
    });
    expect(u.erlaubt).toBe(false);
    expect(u.grund).toContain('nicht die eingetragene');
  });

  it('Schreibweise und Leerzeichen sind KEIN Austausch', () => {
    // Sonst haette der Riegel Fehlalarme, und ein Riegel mit Fehlalarmen wird
    // umgangen.
    expect(
      darfReverseCharge({ kunde: gueltig({ vatId: 'de 811 907 980' }), jetzt: JETZT }).erlaubt,
    ).toBe(true);
  });

  it('normalisiereVatId macht daraus genau das, was abgefragt wird', () => {
    expect(normalisiereVatId('de 811-907.980')).toBe('DE811907980');
  });
});

/**
 * ⚠️ Der Wächter gegen die Rückkehr des alten Zustands.
 *
 * Die Prüfungen oben belegen die Entscheidungsfunktion. Sie sagen NICHTS
 * darüber, ob die Route sie auch aufruft — und genau das war der Fehler: die
 * Regel existierte im Kopf, nur nicht im Code.
 */
describe('die Route ruft den Riegel wirklich an', () => {
  const lies = async () =>
    (await import('node:fs')).readFileSync(
      new URL('../../src/routes/transactions-finalize.ts', import.meta.url),
      'utf8',
    );

  it('finalize prueft § 13b, bevor es schreibt', async () => {
    const q = await lies();
    expect(q).toContain('darfReverseCharge');
    expect(q).toContain('VatCheckRequiredError');
  });

  it('und zwar AUCH, wenn nur eine einzelne Zeile es traegt', async () => {
    // Sonst bliebe die Luecke eine Feldebene tiefer offen: der Kopf sagt 19 %,
    // eine Zeile sagt § 13b, und die Summe stimmt trotzdem.
    const q = await lies();
    const block = q.slice(q.indexOf('const will13b'), q.indexOf('const will13b') + 300);
    expect(block).toContain('body.items.some');
  });

  it('die EU-Abfrage haelt ihr Ergebnis fest', async () => {
    const q = (await import('node:fs')).readFileSync(
      new URL('../../src/routes/customers-verify-vat.ts', import.meta.url),
      'utf8',
    );
    expect(q).toContain('vat_id_check_result');
    expect(q).toContain('vat_id_checked_value');
    // Und `ergebnis` MUSS im Antwortschema stehen, sonst entfernt Fastify es
    // still — dann waere die Unterscheidung zwischen „ungueltig" und „konnte
    // nicht fragen" wieder weg. Dieselbe Falle wie beim Kursalter.
    const schema = q.slice(q.indexOf('const ResponseSchema'), q.indexOf('const ErrorResponse'));
    expect(schema).toContain('ergebnis');
    expect(schema).toContain('gespeichert');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER TROCKENLAUF: PRUEFEN, BEVOR DAS GELD FLIESST
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Am 26.07.2026 gemessen: die Kartenautorisierung lag VOR dem finalize
 * (`BezahlenDialog.tsx`, `pendingAuthRef`). Wurde der Vorgang danach abgelehnt
 * — § 13b, § 10 GwG, § 259 StGB oder ein Rechenfehler — war die Karte
 * belastet, jeder Wiederholversuch scheiterte identisch, und die Kassiererin
 * hatte keinen Ausweg.
 */
describe('der Trockenlauf', () => {
  const lies = async (p: string) =>
    (await import('node:fs')).readFileSync(new URL(p, import.meta.url), 'utf8');

  it('steht NACH allen Riegeln, aber VOR dem ersten Schreiben', async () => {
    // Steht er zu frueh, prueft er nichts. Steht er zu spaet, hat er schon
    // geschrieben. Beides waere schlimmer als kein Trockenlauf, weil man sich
    // dann auf ihn verlaesst.
    const q = await lies('../../src/routes/transactions-finalize.ts');
    const riegel = q.indexOf('darfReverseCharge');
    /*
     * 14.08.2026: der Anker hiess hier `app.db.transaction`. Diese WOERTLICHE
     * Folge stand aber nur im eBay-Sofort-Delist NACH dem Commit; der echte
     * fiskale Schreibbeginn ist `await app.db` mit `.transaction(` auf der
     * NAECHSTEN Zeile. Der Waechter mass also gegen die falsche Stelle und
     * haette eine Pruefung INNERHALB des fiskalen Blocks nicht bemerkt. Mit
     * der Trennung von warehouse14 fiel der eBay-Block, der Anker lief ins
     * Leere (indexOf -1), und der Fehler wurde sichtbar. Jetzt haengt er am
     * echten Beginn des fiskalen Blocks.
     */
    const trocken = q.indexOf('body.dryRun === true');
    const schreiben = q.indexOf('.transaction(async (tx) => {');

    expect(riegel, 'der § 13b-Riegel fehlt').toBeGreaterThan(0);
    expect(trocken, 'es gibt keinen Trockenlauf').toBeGreaterThan(riegel);
    expect(trocken, 'der Trockenlauf steht NACH dem ersten Schreiben').toBeLessThan(schreiben);
  });

  it('⚠️ seine Antwort steht im Antwortschema — sonst entfernt Fastify sie still', async () => {
    // `FinalizeResponse` verlangt id, receiptLocator und ledgerEventId, die es
    // hier gar nicht gibt. Ohne die Vereinigung waere der Trockenlauf am
    // EIGENEN Schema gescheitert, mit einem 500er, der nach einem Serverfehler
    // aussieht.
    const q = await lies('../../src/schemas/transaction.ts');
    expect(q).toContain('DryRunResponse');
    expect(q).toContain('FinalizeOrDryRunResponse');
    expect(await lies('../../src/routes/transactions-finalize.ts')).toContain(
      '200: FinalizeOrDryRunResponse',
    );
  });

  it('die Kasse fragt ihn VOR der Kartenautorisierung', async () => {
    const q = (await import('node:fs')).readFileSync(
      new URL('../../../tauri-pos/src/screens/verkauf/BezahlenDialog.tsx', import.meta.url),
      'utf8',
    );
    const trocken = q.indexOf('await trockenlauf(');
    const autorisieren = q.indexOf('zvtClient.authorize(');
    expect(trocken, 'die Kasse fragt gar nicht').toBeGreaterThan(0);
    expect(trocken, 'die Karte wird VOR dem Trockenlauf belastet').toBeLessThan(autorisieren);
  });

  it('und benutzt dafuer einen EIGENEN Idempotenzschluessel', async () => {
    // Mit dem echten Schluessel koennte der Trockenlauf den spaeteren Vorgang
    // als Wiederholung erscheinen lassen — und dann bekaeme die Kassiererin
    // eine leere Antwort statt eines Belegs.
    const q = (await import('node:fs')).readFileSync(
      new URL('../../../tauri-pos/src/screens/verkauf/BezahlenDialog.tsx', import.meta.url),
      'utf8',
    );
    const block = q.slice(q.indexOf('const trockenlauf'), q.indexOf('const finalizeWithTse'));
    expect(block).toContain('idempotencyKey: newIntentionId()');
    expect(block, 'der Trockenlauf benutzt den echten Schluessel').not.toContain(
      'idempotencyKeyRef.current',
    );
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER RIEGEL MACHTE § 13b UNBENUTZBAR — 500 STATT VERKAUF
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Am 28.07.2026 im Monatslauf gemessen, nicht im Quelltext vermutet:
 *
 *     POST /api/transactions/finalize → 500
 *     TypeError: kunde.geprueftAm.getTime is not a function
 *       at darfReverseCharge (lib/reverse-charge.ts:153)
 *
 * Der Aufrufer liest `vat_id_checked_at` mit ROHEM SQL (`db.execute`). Dort
 * kommt `timestamptz` als ZEICHENKETTE zurück. Die Typangabe an der
 * Aufrufstelle sagte `Date | null` — eine Behauptung, die der Compiler bei
 * rohem SQL nicht prüfen kann und deshalb glaubte.
 *
 * Wirkung: JEDER § 13b-Verkauf endete in einem 500er. Der Riegel, der die
 * Steuerschuldnerschaft absichern sollte, machte den ganzen Weg unbenutzbar —
 * und zwar erst, seit die Prüfung überhaupt Daten hatte.
 *
 * ⚠️ Die Lehre: ein Typ über rohem SQL ist eine Behauptung, kein Beweis.
 */
describe('⛔ die Zeichenkette aus rohem SQL', () => {
  const kunde = (geprueftAm: unknown) => ({
    vatId: 'DE811907980',
    geprueftesVatId: 'DE811907980',
    geprueftAm: geprueftAm as Date,
    ergebnis: 'GUELTIG' as const,
  });

  it('eine ISO-Zeichenkette wird angenommen, statt abzustürzen', () => {
    const u = darfReverseCharge({
      kunde: kunde('2026-07-23T09:00:00.000Z'),
      jetzt: new Date('2026-07-27T09:00:00Z'),
    });
    expect(u.erlaubt).toBe(true);
    expect(u.belegvermerk).toContain('23.07.2026');
  });

  it('die Postgres-Schreibweise ebenfalls', () => {
    const u = darfReverseCharge({
      kunde: kunde('2026-07-23 09:00:00+00'),
      jetzt: new Date('2026-07-27T09:00:00Z'),
    });
    expect(u.erlaubt).toBe(true);
  });

  it('ein echtes Date bleibt selbstverständlich gültig', () => {
    const u = darfReverseCharge({
      kunde: kunde(new Date('2026-07-23T09:00:00Z')),
      jetzt: new Date('2026-07-27T09:00:00Z'),
    });
    expect(u.erlaubt).toBe(true);
  });

  it('⛔ und das Alter wird WIRKLICH gerechnet, nicht übersprungen', () => {
    // Sonst hätte man den Absturz beseitigt und den Riegel gleich mit.
    const u = darfReverseCharge({
      kunde: kunde('2024-01-01T00:00:00.000Z'),
      jetzt: new Date('2026-07-27T09:00:00Z'),
    });
    expect(u.erlaubt).toBe(false);
    expect(u.grund).toContain('Tage alt');
  });

  it('⛔ eine unlesbare Zeit gilt als UNGEPRÜFT, nicht als frisch', () => {
    // Die sichere Richtung. `new Date('Unsinn')` ergibt NaN, und NaN in einer
    // Altersrechnung ergäbe `false` in JEDEM Vergleich — der Verkauf liefe
    // still durch.
    const u = darfReverseCharge({
      kunde: kunde('kein Datum'),
      jetzt: new Date('2026-07-27T09:00:00Z'),
    });
    expect(u.erlaubt).toBe(false);
    expect(u.grund).toContain('nicht lesbar');
  });
});

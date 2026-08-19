/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DAS PRUEFERPAKET — EIN KNOPF, EINE DATEI, § 146b AO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── BASELS ANWEISUNG VOM 18.08.2026 ────────────────────────────────────────
 *
 * „Der Fahnder oder Steuerpruefer: du drueckst einen Knopf, die Datei kommt
 * heraus, die er braucht, stimmt ueberein und prueft bis auf den Milli."
 *
 * ── WAS VORHER GALT, UND WARUM ES NICHT REICHTE ────────────────────────────
 *
 * Jeder Baustein existierte schon: DSFinV-K je TAG, Kassenbericht je TAG,
 * Verfahrensdokumentation als eigener Knopf, Kettenpruefung im Takt. Bei
 * einer Kassennachschau steht der Pruefer aber UNANGEKUENDIGT im Laden
 * (§ 146b Abs. 1 AO), und der Haendler haette je Tag zwei Klicks gebraucht,
 * dreissig Tage lang, waehrend der Pruefer zusieht. Ein Zeitraum, ein Knopf.
 *
 * ── WAS IM PAKET LIEGT, UND WAS EHRLICH FEHLT ──────────────────────────────
 *
 *   DSFinV-K/…            ein Tages-ZIP je FINALISIERTEM Abschluss, aus
 *                          exakt demselben Erzeuger wie der Einzelabruf
 *                          (`lib/dsfinvk-tag.ts`, ein Erzeuger, zwei Rufer)
 *   PRUEFBERICHT.txt       die Selbstpruefung: Pruefsummenkette JETZT
 *                          gelaufen (nicht der letzte Takt), je Tag die
 *                          Summen in Cent, quergerechnet
 *   LIESMICH.txt           was drin ist, was fehlt und WARUM es fehlt
 *   Verfahrensdokumentation.pdf   wenn die Kasse sie mitschickt (sie wird
 *                          im Rumpf gesetzt, typst; der Motor kann das nicht)
 *
 * Ehrlich fehlt: der TSE-Export (TAR) der Sicherungseinrichtung. Er entsteht
 * bei fiskaly in der Wolke; die Kasse hier traegt die Signaturen je Beleg in
 * `tse.csv` (im Tages-ZIP), aber das TAR-Archiv gibt es nur dort. Das steht
 * so in LIESMICH.txt, statt ein leeres TAR zu erfinden.
 *
 * ── WER DARF ────────────────────────────────────────────────────────────────
 *
 * Wie der Einzelabruf: ADMIN oder READONLY, mit frischem Step-up. Die
 * Kassennachschau duldet keinen Rollenumweg, aber auch keinen stilleren Weg
 * als die Einzelexporte.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import {
  baueDsfinvkTagZip,
  centsToEur,
  eurToCents,
} from '../lib/dsfinvk-tag.js';
import { type DsfinvkFile, zipDsfinvkBundle } from '../lib/dsfinvk-export.js';
import { pruefeKetteFrisch } from '../lib/kettenpruefung.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class ZeitraumLeerError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/** Der Zeitraum sprengt den Deckel. Begruendung an der Pruefstelle. */
class ZeitraumZuGrossError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/** Was hereingereicht wurde, ist kein PDF. Begruendung an der Pruefstelle. */
class KeinPdfError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

const PaketBody = Type.Object({
  /** Erster Tag des Zeitraums, einschliesslich. */
  von: Type.String({ format: 'date' }),
  /** Letzter Tag des Zeitraums, einschliesslich. */
  bis: Type.String({ format: 'date' }),
  /**
   * Die Verfahrensdokumentation als PDF, base64. Sie entsteht im RUMPF der
   * Kasse (typst), nicht im Motor; die Kasse setzt sie und reicht sie hier
   * herein, damit der Pruefer EINE Datei bekommt. Ohne sie entsteht das
   * Paket trotzdem, und LIESMICH.txt benennt die Luecke.
   */
  verfahrensdokuPdfBase64: Type.Optional(Type.String()),
});

const PaketResponse = Type.Object({
  ok: Type.Literal(true),
  dateiname: Type.String(),
  zipBase64: Type.String(),
  /** Was der Kassierer sofort sehen soll, ohne das ZIP zu oeffnen. */
  tage: Type.Integer(),
  ketteUnversehrt: Type.Boolean(),
});

type TagZeile = {
  id: string;
  business_day: string;
  z_nr: string | null;
  gross_verkauf_eur: string;
  gross_ankauf_eur: string;
  storno_verkauf_eur: string;
  storno_ankauf_eur: string;
  belege: string;
};

const prueferPaketRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { von: string; bis: string; verfahrensdokuPdfBase64?: string } }>(
    '/api/pruefer/paket',
    {
      schema: {
        tags: ['closings'],
        summary: 'Kassennachschau: alle Exporte eines Zeitraums als EIN ZIP (§ 146b AO)',
        body: PaketBody,
        response: { 200: PaketResponse },
      },
    },
    async (req) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'READONLY');
      requireStepUp(req);

      const { von, bis, verfahrensdokuPdfBase64 } = req.body;

      /*
       * ⛔ EIN DECKEL AUF DEN ZEITRAUM (19.08.2026, Fund der boeswilligen
       * Pruefung).
       *
       * Ohne ihn baut ein einziger Ruf („von 2000 bis 2099") JEDES Tagespaket
       * der Geschichte in den Arbeitsspeicher, haengt sie in EIN ZIP und
       * schickt das Ganze noch base64-verbreitert durch eine JSON-Antwort.
       * Diese Kasse ist EIN Prozess auf einem Tresenrechner: das ist kein
       * langsamer Abruf, das ist ihr Tod mitten im Verkauf.
       *
       * 400 Tage sind grosszuegig ueber jeder echten Nachschau (die fragt nach
       * Tagen bis Monaten) und weit unter dem, was den Speicher sprengt. Wer
       * mehr braucht — eine Betriebspruefung ueber drei Jahre — zieht die
       * Jahre nacheinander; der Satz unten sagt ihm das.
       */
      const HOECHST_TAGE = 400;
      const spanneTage =
        Math.round(
          (new Date(`${bis}T00:00:00Z`).getTime() - new Date(`${von}T00:00:00Z`).getTime()) /
            86_400_000,
        ) + 1;
      if (!Number.isFinite(spanneTage) || spanneTage <= 0) {
        throw new ZeitraumLeerError(
          `Der Zeitraum ${von} bis ${bis} ergibt keine Spanne. Bitte Anfang vor Ende setzen.`,
        );
      }
      if (spanneTage > HOECHST_TAGE) {
        throw new ZeitraumZuGrossError(
          `Der Zeitraum umfasst ${spanneTage} Tage; ein Paket traegt hoechstens ${HOECHST_TAGE}. ` +
            'Bitte in Abschnitte teilen (etwa Jahr fuer Jahr) und die Pakete einzeln ziehen. ' +
            'Das schuetzt die Kasse davor, mitten im Verkauf am Speicher zu ersticken.',
        );
      }

      // Nur FINALISIERTE Tage: ein offener Tag hat keine Z-Nummer und kein
      // vollstaendiges Tages-ZIP; ihn stumm einzupacken hiesse, dem Pruefer
      // einen halben Tag als ganzen zu reichen.
      const tage = await app.db.execute<TagZeile>(sql`
        SELECT dc.id::text AS id,
               dc.business_day::text AS business_day,
               dc.z_nr::text AS z_nr,
               dc.gross_verkauf_eur::text AS gross_verkauf_eur,
               dc.gross_ankauf_eur::text  AS gross_ankauf_eur,
               dc.storno_verkauf_eur::text AS storno_verkauf_eur,
               dc.storno_ankauf_eur::text  AS storno_ankauf_eur,
               (SELECT count(*) FROM transactions t
                 WHERE berlin_business_day(t.finalized_at) = dc.business_day)::text AS belege
          FROM daily_closings dc
         WHERE dc.business_day BETWEEN ${von}::date AND ${bis}::date
           AND dc.state = 'FINALIZED'
         ORDER BY dc.business_day ASC`);

      if (tage.length === 0) {
        throw new ZeitraumLeerError(
          `Im Zeitraum ${von} bis ${bis} liegt kein festgeschriebener Tagesabschluss. ` +
            'Das Prueferpaket packt nur abgeschlossene Tage; ein offener Tag wird erst ' +
            'mit dem Tagesabschluss exportierbar.',
        );
      }

      // ── 1. Die Kette JETZT pruefen, nicht den letzten Takt zitieren ──────
      //
      // Der Pruefer fragt: stimmen die Aufzeichnungen? Die Antwort muss von
      // HEUTE sein. `pruefeKette` laeuft ueber das gesamte Tagebuch und
      // zeichnet den Lauf auf wie der Takt es tut.
      const kette = await pruefeKetteFrisch(app.db, Date.now());

      // ── 2. Je Tag das volle DSFinV-K-ZIP, derselbe Erzeuger wie einzeln ──
      const dateien: DsfinvkFile[] = [];
      for (const t of tage) {
        const { businessDay, zip } = await baueDsfinvkTagZip(app.db, t.id);
        dateien.push({ name: `DSFinV-K/DSFinV-K_${businessDay}.zip`, content: zip });
      }

      // ── 3. Der Pruefbericht: Cent-genau, aus denselben Zeilen ───────────
      //
      // „prueft bis auf den Milli": gerechnet wird in ganzen Cent als
      // bigint (eurToCents wirft bei jedem missgeformten Betrag), und die
      // Summenzeile unten ist die Summe GENAU dieser Tabellenzeilen, kein
      // zweiter Rechenweg.
      let sumVerkauf = 0n;
      let sumAnkauf = 0n;
      let sumBelege = 0;
      const zeilen = tage.map((t) => {
        const verkauf = eurToCents(t.gross_verkauf_eur) - eurToCents(t.storno_verkauf_eur);
        const ankauf = eurToCents(t.gross_ankauf_eur) - eurToCents(t.storno_ankauf_eur);
        sumVerkauf += verkauf;
        sumAnkauf += ankauf;
        sumBelege += Number(t.belege);
        return (
          `${t.business_day}  Z ${String(t.z_nr ?? '?').padStart(6)}  ` +
          `Verkauf ${centsToEur(verkauf).padStart(12)} EUR  ` +
          `Ankauf ${centsToEur(ankauf).padStart(12)} EUR  ` +
          `Belege ${String(t.belege).padStart(5)}`
        );
      });

      const erstellt = new Date().toISOString();
      const pruefbericht = [
        'NORNS POS, PRUEFBERICHT ZUR KASSENNACHSCHAU',
        `Zeitraum: ${von} bis ${bis} (einschliesslich)`,
        `Erstellt: ${erstellt}`,
        '',
        'PRUEFSUMMENKETTE',
        kette.brueche.length === 0
          ? `Ergebnis: UNVERSEHRT. Jede Zeile des Tagebuchs wurde soeben gegen ihre Vorgaengerin geprueft (Dauer ${kette.dauerMs} ms).`
          : `Ergebnis: GEBROCHEN. Erster Bruch bei Eintrag ${kette.brueche[0]?.break_at_id ?? '?'}: ${kette.brueche[0]?.reason ?? ''}. Brueche gesamt: ${kette.brueche.length}.`,
        kette.zitiert
          ? 'Die Pruefung stammt aus einem Lauf der letzten fuenf Minuten. Ein Durchlauf ueber das ganze Tagebuch bei JEDEM Abruf wuerde die Kasse im laufenden Betrieb ausbremsen; innerhalb dieses Fensters aendert sich das Ergebnis nicht.'
          : 'Die Pruefung lief JETZT, fuer dieses Paket.',
        '',
        `TAGE IM PAKET (${tage.length})`,
        ...zeilen,
        ''.padEnd(100, '-'),
        `SUMME             Verkauf ${centsToEur(sumVerkauf).padStart(12)} EUR  ` +
          `Ankauf ${centsToEur(sumAnkauf).padStart(12)} EUR  Belege ${String(sumBelege).padStart(5)}`,
        '',
        'Alle Betraege sind nach Storno gerechnet, in ganzen Cent, ohne Fliesskomma.',
        'Die Tagessummen stammen aus denselben Abschlusszeilen, die auch die',
        'cashpointclosing.csv der Tages-ZIPs fuellen; die Querrechnung Einzelbeleg',
        'gegen Tagessumme steht damit in jedem Tages-ZIP selbst.',
      ].join('\n');

      const liesmich = [
        'NORNS POS, PRUEFERPAKET ZUR KASSENNACHSCHAU (§ 146b AO)',
        `Zeitraum: ${von} bis ${bis} · erstellt ${erstellt}`,
        '',
        'INHALT',
        `  DSFinV-K/                      ${tage.length} Tages-ZIP(s), je festgeschriebenem Tagesabschluss eines,`,
        '                                 mit den amtlichen Taxonomie-Dateien. Die Signaturen je Beleg',
        '                                 stehen in transactions_tse.csv; tse.csv sind die Stammdaten',
        '                                 des Geraets (Seriennummer und Schluessel ab Wanderung 0141,',
        '                                 aeltere Zeilen ehrlich leer).',
        '  PRUEFBERICHT.txt               Kettenpruefung von JETZT und die Tagessummen, Cent-genau.',
        '',
        'ZU DEN BON-NUMMERN (BON_NR)',
        '  Die Nummern stammen aus einer Datenbank-Sequenz. Eine Sequenz vergibt',
        '  eine Nummer auch dann, wenn der Vorgang danach scheitert und nie',
        '  gebucht wird — solche Nummern fehlen dann in der Reihe. Eine Luecke',
        '  in BON_NR ist also KEIN geloeschter Beleg: geloescht werden kann hier',
        '  nichts (Hash-Kette, siehe PRUEFBERICHT.txt), und jeder gebuchte Beleg',
        '  ist lueckenlos in der Kette. Die Abschluss-Nummern (Z_NR) sind dagegen',
        '  echt lueckenlos vergeben.',
        verfahrensdokuPdfBase64
          ? '  Verfahrensdokumentation.pdf    Die Verfahrensdokumentation nach GoBD, Stand der Erstellung.'
          : '  Verfahrensdokumentation.pdf    FEHLT in diesem Paket: die Kasse hat sie nicht mitgeschickt.',
        '',
        'WAS DIESES PAKET NICHT ENTHAELT, UND WARUM',
        '  1. Der TSE-Export (TAR) der technischen Sicherungseinrichtung entsteht beim',
        '     TSE-Anbieter (fiskaly) und nicht in dieser Kasse. Die Signaturen jedes',
        '     einzelnen Belegs liegen in der tse.csv der Tages-ZIPs. Das TAR-Archiv',
        '     stellt der Anbieter auf Verlangen bereit; nichts davon wird hier erfunden.',
        '  2. Die DSFinV-K-Dateien sind ein getreuer Kern-Export aus den echten',
        '     Aufzeichnungen dieser Kasse. Vor einer foermlichen Verprobung empfiehlt',
        '     sich der Lauf durch das amtliche DSFinV-K-Prueftool.',
        '',
        'Ein Tag erscheint erst nach seinem Tagesabschluss in diesem Paket.',
      ].join('\n');

      dateien.push({ name: 'PRUEFBERICHT.txt', content: pruefbericht });
      dateien.push({ name: 'LIESMICH.txt', content: liesmich });
      if (verfahrensdokuPdfBase64) {
        /*
         * ⛔ WAS ALS PDF INS PRUEFERPAKET GEHT, MUSS EIN PDF SEIN
         * (19.08.2026, Fund der boeswilligen Pruefung).
         *
         * `Buffer.from(x, 'base64')` verwirft ungueltige Zeichen STILL und
         * dekodiert den Rest. Ein Tippfehler, ein abgeschnittener Upload oder
         * schlicht eine andere Datei landete damit als
         * „Verfahrensdokumentation.pdf" beim Pruefer — eine unlesbare Datei
         * mit dem Namen einer Pflichtunterlage ist schlimmer als eine
         * fehlende, denn sie sieht aus, als sei die Pflicht erfuellt.
         *
         * Geprueft wird die Signatur des Formats selbst (%PDF-) und eine
         * Mindestgroesse; beides kostet nichts und faengt jeden dieser Faelle.
         */
        const roh = Buffer.from(verfahrensdokuPdfBase64, 'base64');
        if (roh.length < 1024 || roh.subarray(0, 5).toString('latin1') !== '%PDF-') {
          throw new KeinPdfError(
            'Die mitgeschickte Verfahrensdokumentation ist keine lesbare PDF-Datei. ' +
              'Das Paket wurde NICHT gebaut, damit beim Pruefer keine unlesbare Datei ' +
              'unter dem Namen einer Pflichtunterlage landet.',
          );
        }
        dateien.push({ name: 'Verfahrensdokumentation.pdf', content: roh });
      }

      const zip = zipDsfinvkBundle(dateien);
      const dateiname = `Kassennachschau_${von}_${bis}.zip`;

      return {
        ok: true as const,
        dateiname,
        zipBase64: zip.toString('base64'),
        tage: tage.length,
        ketteUnversehrt: kette.brueche.length === 0,
      };
    },
  );
};

export default prueferPaketRoute;

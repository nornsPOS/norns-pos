/**
 * Die Kasse trägt ihre technische Sicherheitseinrichtung ein.
 *
 * ── WARUM ES DIESE ROUTE GEBEN MUSS ────────────────────────────────────────
 *
 * `transactions-finalize.ts` weigert sich, einen Verkauf abzuschliessen, wenn
 * keine TSE eingerichtet ist. Das ist richtig: ohne Sicherungseinrichtung
 * erfüllt die Kasse § 146a AO nicht, und ein Beleg ohne Signatur ist kein
 * Beleg.
 *
 * Der erste Anlauf dieses Riegels (01.08.2026) zählte die Zeilen in
 * `tse_clients`. Das war doppelt falsch:
 *
 *   • Diese Tabelle hat im ganzen Baum genau EINEN Schreiber, den
 *     Arbeiter-Auftrag `tse-cert-checker`. Der Arbeiter reist mit Norns POS
 *     nicht mit. Auf einer ausgelieferten Kasse blieb sie also für immer leer.
 *   • Ihre Spalten heissen `cert_valid_to`, `alert_sent_at`,
 *     `last_alert_tier`. Sie ist ein Wachbuch über ablaufende Zertifikate,
 *     kein Verzeichnis eingerichteter Kassen.
 *
 * Wirkung am Tresen: der Händler richtet die TSE ein, die Gerätefläche meldet
 * „erreichbar", er drückt Bezahlen und liest „keine Sicherungseinrichtung
 * eingerichtet". Er geht zurück, alles steht richtig, er drückt wieder
 * Bezahlen, derselbe Satz. Ein Kreis ohne Ausgang, mit dem ersten Kunden
 * daneben.
 *
 * Der Grund dahinter ist grundsätzlich: die TSE-Fläche legt den Schlüssel in
 * den Systemtresor des Rechners und die Kennungen in den örtlichen Speicher
 * des Fensters. Der SERVER erfuhr davon nie. Ein Riegel im Server kann aber
 * nur prüfen, was der Server weiss.
 *
 * ── WAS HIER EINGETRAGEN WIRD, UND WAS AUSDRÜCKLICH NICHT ──────────────────
 *
 * Eingetragen wird die KENNUNG der Sicherungseinrichtung (`tss_id`) und die
 * Kennung dieses Kassenklienten (`client_id`). Beide sind keine Geheimnisse;
 * sie stehen ohnehin in jeder Signatur und im DSFinV-K-Paket.
 *
 * NICHT eingetragen wird der Schlüssel. Er bleibt im Systemtresor des
 * Rechners, wo ihn `tresor.rs` verwahrt. Ein API-Schlüssel in der Datenbank
 * wäre ein Rückschritt hinter das, was das Haus schon erreicht hat.
 *
 * ── WARUM DER INHABER UND WARUM MIT ZWEITER BESTÄTIGUNG ────────────────────
 *
 * Wer hier schreibt, hebt einen fiskalischen Riegel auf. Das ist keine
 * Kassiererhandlung. Und es darf nicht spurlos geschehen: bei einer
 * Kassennachschau ist die Frage, WANN eine Kasse fiskalisch scharf wurde, eine
 * der ersten. Deshalb Inhaberrecht, zweite Bestätigung, und eine Zeile im
 * Tagebuch.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog } from '@norns/db/schema';

import { requireAuth, requireOwner, requireStepUp } from '../lib/auth-policy.js';
import type { Env } from '../config/env.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  type TsePruefung,
  type TseZugang,
  pruefeTse,
  tseSatz,
} from '../lib/fiskaly-tse-pruefung.js';

/**
 * Der Einstellungsschlüssel, an dem der Riegel in `transactions-finalize.ts`
 * hängt. Beide Seiten müssen denselben Namen benutzen, sonst ist der Riegel
 * wieder unaufhebbar — genau der Fehler, den diese Datei behebt.
 */
/**
 * Die TSE hat sich nicht bestaetigen lassen — die Kennung wurde NICHT gespeichert.
 *
 * Eigener Fehler statt eines allgemeinen Validierungsfehlers, damit die Kasse
 * den Fall erkennen und den Satz aus `tseSatz` gross anzeigen kann. Wer hier
 * nur „ungueltig" liest, tippt dieselbe Kennung ein zweites Mal.
 */
export class TseNichtBestaetigtError extends DomainError {
  public readonly httpStatus = 422;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

export const SCHLUESSEL_TSS_ID = 'tse.tss_id';
export const SCHLUESSEL_CLIENT_ID = 'tse.client_id';
export const SCHLUESSEL_EINGERICHTET_AM = 'tse.eingerichtet_am';

const EinrichtenBody = Type.Object({
  // ⚠️ `minLength` ist kein Schönheitsfehler-Schutz, sondern der Riegel selbst:
  // ohne ihn hübe ein Klick auf „Speichern" mit leeren Feldern die ganze
  // fiskalische Sperre auf, ohne dass je eine TSE eingerichtet wurde.
  tssId: Type.String({ minLength: 8, maxLength: 128 }),
  clientId: Type.String({ minLength: 1, maxLength: 128 }),
  /** Freier Text für den Prüfer: „fiskaly Cloud-TSE", „Epson TSE-Modul". */
  bezeichnung: Type.Optional(Type.String({ maxLength: 200 })),
});

/**
 * ⚠️ Der Prüfer ist einspritzbar, damit die Integrationstests das ECHTE
 * Protokoll durchlaufen können, ohne ins Netz zu greifen. Ohne diese Naht
 * würde entweder gar nicht geprüft (und der Riegel wäre ein Schmuckstück)
 * oder jeder Testlauf hinge an fiskalys Verfügbarkeit.
 */
export interface TseEinrichtungOpts {
  env: Env;
  pruefer?: (
    tssId: string,
    clientId: string,
    zugang: TseZugang,
  ) => Promise<TsePruefung>;
}

const tseEinrichtungRoutes: FastifyPluginAsync<TseEinrichtungOpts> = async (app, opts) => {
  const pruefe = opts.pruefer ?? ((t, c, z) => pruefeTse(t, c, z));

  app.post(
    '/api/tse/einrichten',
    {
      schema: {
        tags: ['tse'],
        summary: 'Die technische Sicherheitseinrichtung dieser Kasse eintragen',
        description:
          'Trägt die Kennungen der TSE ein und macht damit den Verkauf möglich. Der Schlüssel ' +
          'bleibt im Systemtresor des Rechners und wird hier NICHT entgegengenommen. ' +
          'Liegen fiskaly-Zugangsdaten vor, wird die Kennung VORHER bei fiskaly geprüft: ' +
          'nur eine TSE im Zustand INITIALIZED mit registriertem Kassenklienten wird ' +
          'übernommen. Ist fiskaly nicht erreichbar, wird NICHTS gespeichert.',
        body: EinrichtenBody,
        response: {
          200: Type.Object({
            tssId: Type.String(),
            clientId: Type.String(),
            eingerichtetAm: Type.String(),
            /** Wahr, wenn hier zum ersten Mal eine TSE eingetragen wurde. */
            erstmalig: Type.Boolean(),
            /**
             * Wahr, wenn fiskaly bestätigt hat, dass diese TSE signieren kann.
             * Falsch heisst: eingetragen, aber von niemandem bestätigt (etwa
             * eine Hardware-TSE ohne hinterlegte Zugangsdaten).
             */
            geprueft: Type.Boolean(),
            /** Was die Prüfung ergeben hat, in einem deutschen Satz. */
            hinweis: Type.String(),
            seriennummer: Type.Union([Type.String(), Type.Null()]),
          }),
        },
      },
    },
    async (req) => {
      requireAuth(req);
      requireOwner(req);
      requireStepUp(req);

      const body = req.body as {
        tssId: string;
        clientId: string;
        bezeichnung?: string;
      };
      const tssId = body.tssId.trim();
      const clientId = body.clientId.trim();
      const bezeichnung = body.bezeichnung?.trim() || 'Technische Sicherheitseinrichtung';

      // ══════════════════════════════════════════════════════════════════
      //  ERST FRAGEN, DANN SPEICHERN
      // ══════════════════════════════════════════════════════════════════
      //
      // ⚠️ BEFUND VOM 05.08.2026: hier stand NICHTS. Die Route nahm eine
      // getippte Kennung entgegen, schrieb sie in die Einstellungen und
      // meldete „fiskalisch scharf".
      //
      // Am selben Tag lag bei fiskaly eine TSE im Zustand CREATED, deren
      // Inbetriebnahme reproduzierbar an `E_SMAERS: storage error (66)`
      // scheiterte. Hätte Basel diese Kennung eingetippt, hätte die Kasse
      // sich scharf genannt und JEDER Beleg wäre ohne Signatur gelaufen —
      // aufgefallen wäre es erst bei der Kassennachschau.
      //
      // Die Prüfung fragt jetzt zweierlei: ist die TSE INITIALIZED, und ist
      // DIESER Kassenklient dort registriert. Alles andere wird abgewiesen,
      // auch eine Störung. Eine Kasse, die sich bei Netzausfall scharf nennt,
      // ist genau der Zustand, den es zu verhindern gilt.
      const pruefung = await pruefe(tssId, clientId, {
        apiKey: opts.env.FISKALY_API_KEY ?? '',
        apiSecret: opts.env.FISKALY_API_SECRET ?? '',
      });

      if (pruefung.art !== 'bereit' && pruefung.art !== 'kein_zugang') {
        // 422: der Wunsch ist verstanden, aber die Welt sagt nein. Der Satz
        // ist der aus `tseSatz` — er nennt die HANDLUNG, nicht nur den Fehler.
        throw new TseNichtBestaetigtError(tseSatz(pruefung));
      }

      const geprueft = pruefung.art === 'bereit';
      const seriennummer = pruefung.art === 'bereit' ? pruefung.seriennummer : null;
      const hinweis = tseSatz(pruefung);

      return app.db.transaction(async (tx) => {
        const vorher = await tx.execute<{ wert: string | null }>(drizzleSql`
          SELECT value #>> '{}' AS wert FROM system_settings WHERE key = ${SCHLUESSEL_TSS_ID}`);
        const alt = vorher[0]?.wert ?? null;
        const erstmalig = alt === null || alt.trim() === '';

        // ⚠️ Der Zeitpunkt wird beim ERSTEN Eintragen gesetzt und danach NICHT
        // mehr überschrieben. Bei einer Kassennachschau ist „seit wann ist
        // diese Kasse fiskalisch scharf" die Frage, und ein Wechsel der TSE
        // darf dieses Datum nicht nach hinten schieben.
        const jetzt = new Date().toISOString();
        for (const [schluessel, wert, beschreibung] of [
          [SCHLUESSEL_TSS_ID, tssId, `Kennung der TSE (${bezeichnung}).`],
          [SCHLUESSEL_CLIENT_ID, clientId, 'Kennung dieses Kassenklienten bei der TSE.'],
        ] as const) {
          await tx.execute(drizzleSql`
            INSERT INTO system_settings (key, value, description)
            VALUES (${schluessel}, to_jsonb(${wert}::text), ${beschreibung})
            ON CONFLICT (key) DO UPDATE
              SET value = EXCLUDED.value,
                  description = EXCLUDED.description,
                  updated_at = now()`);
        }
        await tx.execute(drizzleSql`
          INSERT INTO system_settings (key, value, description)
          VALUES (${SCHLUESSEL_EINGERICHTET_AM}, to_jsonb(${jetzt}::text),
                  'Zeitpunkt, zu dem diese Kasse erstmals fiskalisch scharf wurde.')
          ON CONFLICT (key) DO NOTHING`);

        const zeit = await tx.execute<{ wert: string | null }>(drizzleSql`
          SELECT value #>> '{}' AS wert FROM system_settings
          WHERE key = ${SCHLUESSEL_EINGERICHTET_AM}`);

        await tx.insert(auditLog).values({
          eventType: erstmalig ? 'tse.eingerichtet' : 'tse.gewechselt',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
          // Der ALTE Wert geht mit. Ein Wechsel der Sicherungseinrichtung ohne
          // Spur des Vorgängers wäre für einen Prüfer wertlos.
          payload: { tssId, clientId, bezeichnung, vorherigeTssId: alt, geprueft, hinweis, seriennummer },
        });

        return {
          tssId,
          clientId,
          eingerichtetAm: zeit[0]?.wert ?? jetzt,
          erstmalig,
          geprueft,
          hinweis,
          seriennummer,
        };
      });
    },
  );

  app.get(
    '/api/tse/einrichtung',
    {
      schema: {
        tags: ['tse'],
        summary: 'Ist an dieser Kasse eine TSE eingetragen?',
        response: {
          200: Type.Object({
            eingerichtet: Type.Boolean(),
            tssId: Type.Union([Type.String(), Type.Null()]),
            clientId: Type.Union([Type.String(), Type.Null()]),
            eingerichtetAm: Type.Union([Type.String(), Type.Null()]),
          }),
        },
      },
    },
    async (req) => {
      requireAuth(req);
      const zeilen = await app.db.execute<{ key: string; wert: string | null }>(drizzleSql`
        SELECT key, value #>> '{}' AS wert FROM system_settings
        WHERE key IN (${SCHLUESSEL_TSS_ID}, ${SCHLUESSEL_CLIENT_ID}, ${SCHLUESSEL_EINGERICHTET_AM})`);
      const karte = new Map(zeilen.map((z) => [z.key, z.wert]));
      const tssId = karte.get(SCHLUESSEL_TSS_ID) ?? null;
      return {
        // Dieselbe Bedingung wie der Riegel: nicht leer heisst eingerichtet.
        eingerichtet: tssId !== null && tssId.trim() !== '',
        tssId,
        clientId: karte.get(SCHLUESSEL_CLIENT_ID) ?? null,
        eingerichtetAm: karte.get(SCHLUESSEL_EINGERICHTET_AM) ?? null,
      };
    },
  );
};

export default tseEinrichtungRoutes;

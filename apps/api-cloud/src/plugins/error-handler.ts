/**
 * Centralized error handling.
 *
 * Two responsibilities:
 *   1. Map *typed domain errors* from workspace packages (`inventory-lock`,
 *      `audit`, future `domain` lib) to HTTP responses. Routes don't try/catch
 *      these — they let them bubble.
 *   2. Map *raw Postgres errors* (foreign-key violation, check violation
 *      surfaced by the new migration-0013 triggers) to HTTP responses with a
 *      stable error code so the front-end can react.
 *
 * Anything else is treated as a 500 + Pino error log. Future Sentry hook lives
 * here.
 */

import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

/** Stable error codes — front-end maps these, not status codes. */
export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'STEP_UP_REQUIRED'
  | 'PIN_LOCKED'
  | 'CONFLICT'
  /**
   * Der DATEV-Export ist nicht eingerichtet: die Angaben des Steuerberaters
   * fehlen. Ein EIGENER Code, weil die Oberflaeche darauf ein
   * Einrichtungsformular zeigt statt einer Fehlermeldung — der Haendler soll
   * die Zahlen an Ort und Stelle eintragen koennen. Siehe lib/datev-mandant.ts.
   */
  | 'DATEV_MANDANT_FEHLT'
  | 'SANCTIONS_BLOCK'
  | 'KYC_REQUIRED'
  /** § 13b ohne belegte USt-IdNr.-Pruefung. Siehe lib/reverse-charge.ts. */
  | 'VAT_CHECK_REQUIRED'
  | 'CLOSING_DAY_FINALIZED'
  | 'PIN_NOT_SET'
  | 'STORNO_OF_STORNO'
  | 'PRODUCT_NOT_RESERVABLE'
  | 'DEVICE_NOT_AUTHORIZED'
  /**
   * Die Kasse ist nicht freigeschaltet. Ein EIGENER Code, weil die Flaeche
   * darauf den Weg zum Freischaltschluessel zeigt statt einer Fehlermeldung —
   * und weil der Kassierer NICHT nach seinen Rechten suchen soll: er hat
   * nichts falsch gemacht. Siehe lib/lizenz-riegel.ts; dort steht auch,
   * warum Abschluss, Storno und Ausfuhr NIE davon beruehrt werden.
   */
  | 'LIZENZ_FEHLT'
  // ⚰️ 18.08.2026: hier stand 'IMPLAUSIBLE_PRICE' (Plausibilitaetsband um
  // den von Hand gesetzten Kurs, lib/kursband.ts). Die Handeingabe ist
  // abgeschafft, der einzige Werfer geloescht; die Quellen-Uebernahme
  // schuetzen absolute Vernunftgrenzen im Beipack-Dienst.
  | 'RATE_LIMITED'
  | 'EXTERNAL_SERVICE_FAILED'
  /** An optional capability is deliberately not configured in this environment
   *  (Stripe/R2/AI keys unset). Honest 503 — the shop degrades, it did NOT crash;
   *  keeps these out of the 500 "unexpected error" bucket that pages on-call. */
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

import { stellenkennung } from '../lib/fehlerkennung.js';
import { haltFest } from '../lib/vorfall-protokoll.js';

interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Validation errors carry per-field detail; nothing else uses this. */
    details?: unknown;
    /** Correlation ID — same as `x-request-id` response header. */
    requestId: string;
    /**
     * WO es passiert ist, abgeleitet aus dem Namen der Fehlerklasse.
     *
     * ⚠️ 09.08.2026: `code` allein benennt nur die ART. Gemessen fallen 194
     * Fehlerklassen auf 20 Codes zusammen, 139 davon auf drei — 50 mal
     * CONFLICT, 46 mal NOT_FOUND, 43 mal VALIDATION_ERROR. Der Händler rief
     * an und sagte „es kam ein Konflikt"; davon gibt es fünfzig.
     *
     * Fehlt nur, wenn der Fehler gar keine Domänenklasse war.
     */
    stelle?: string;
  };
}

/** Base class for typed domain errors thrown from workspace packages. */
export abstract class DomainError extends Error {
  public abstract readonly httpStatus: number;
  public abstract readonly code: ApiErrorCode;
  public constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }

  /**
   * Die Stellenkennung, z. B. `NORNS-BARGELD-OHNE-SCHICHT`.
   *
   * Abgeleitet, nicht gepflegt: eine Tabelle wäre die Klasse „Wächter mit
   * Namensliste wird blind" — eine neue Fehlerklasse ohne Eintrag bekäme
   * still keine Kennung.
   */
  public get stelle(): string {
    return stellenkennung(this.name);
  }
}

/**
 * GwG identity requirement not met (route pre-check, friendly before the
 * un-bypassable DB trigger). ANKAUF: seller ID required for every buy (§259
 * StGB). VERKAUF: buyer ID required at/above the §10 threshold.
 */
export class KycRequiredError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'KYC_REQUIRED';
}

/**
 * Reverse-Charge (§ 13b) ohne belegte USt-IdNr.-Pruefung.
 *
 * Eigener Code statt VALIDATION_ERROR, damit die Kasse den Fall erkennen und
 * den Knopf „USt-IdNr. pruefen" anbieten kann. Ein Vorgang, der nur „ungueltig"
 * meldet, endet damit, dass jemand den Steuerschluessel von Hand umstellt.
 */
export class VatCheckRequiredError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'VAT_CHECK_REQUIRED';
}

/**
 * Single source of truth for the PG-message → `ApiErrorCode` contract.
 *
 * Each entry maps one stable substring `token` (raised verbatim by a DB
 * trigger / constraint) to the code we surface. `pgErrorToCode` iterates this
 * in order — first matching token wins — so precedence is the array order.
 * Adding or rewording a trigger? Add/adjust the token here, nowhere else.
 *
 * NOTE: the `STORNO_OF_STORNO` case needs *two* substrings to co-occur, which
 * a single-token entry can't express, so it stays an explicit check below.
 */
const PG_MESSAGE_CODES: ReadonlyArray<{ token: string; code: ApiErrorCode }> = [
  { token: 'Sanctions hard-block', code: 'SANCTIONS_BLOCK' },
  { token: 'KYC hard-block', code: 'KYC_REQUIRED' },
  { token: 'Closing-day guard', code: 'CLOSING_DAY_FINALIZED' },
  { token: 'transactions_ankauf_requires_customer', code: 'VALIDATION_ERROR' },
  { token: 'transactions_one_storno_per_original_uq', code: 'CONFLICT' },
  { token: 'appointments_one_transaction_link_uq', code: 'CONFLICT' },
];

/**
 * Translate a known PG error message into a stable `ApiErrorCode`.
 *
 * Postgres surfaces the trigger's RAISE message verbatim via the
 * `error.message` field, plus an SQLSTATE like `23514` (check_violation).
 * The triggers we added in migration 0013 prefix their messages with stable
 * tokens that we match here — no regex on free German prose.
 */
function pgErrorToCode(err: FastifyError & { code?: string }): ApiErrorCode | null {
  const msg = err.message ?? '';
  for (const { token, code } of PG_MESSAGE_CODES) {
    if (msg.includes(token)) return code;
  }
  if (msg.includes('Cannot storno') && msg.includes('it is itself a storno'))
    return 'STORNO_OF_STORNO';
  if (err.code === '23505') return 'CONFLICT'; // unique_violation
  if (err.code === '23P01') return 'CONFLICT'; // exclusion_violation (e.g. appointment slot overlap)
  if (err.code === '23503') return 'CONFLICT'; // foreign_key_violation
  if (err.code === '23514') return 'CONFLICT'; // check_violation (fallback)
  if (err.code === '23502') return 'VALIDATION_ERROR'; // not_null_violation
  return null;
}

const codeToHttp: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  STEP_UP_REQUIRED: 403,
  VAT_CHECK_REQUIRED: 403,
  PIN_LOCKED: 423,
  CONFLICT: 409,
  DATEV_MANDANT_FEHLT: 409,
  SANCTIONS_BLOCK: 403,
  KYC_REQUIRED: 403,
  CLOSING_DAY_FINALIZED: 409,
  PIN_NOT_SET: 409,
  STORNO_OF_STORNO: 422,
  PRODUCT_NOT_RESERVABLE: 409,
  DEVICE_NOT_AUTHORIZED: 403,
  // 402 heisst genau das: bezahlen und weitermachen. Bewusst KEIN 403 — der
  // Kassierer hat nichts falsch gemacht und soll nicht seine Rechte pruefen.
  LIZENZ_FEHLT: 402,
  RATE_LIMITED: 429,
  EXTERNAL_SERVICE_FAILED: 502,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/**
 * ⚠️ WARUM `send` EINEN EIGENEN STATUS ANNIMMT (05.08.2026)
 *
 * Gemessen an diesem Tag: 187 Fehlerklassen erklären ein Feld `httpStatus`,
 * und der Behandler las es NIE. Er nahm allein `codeToHttp[code]`.
 *
 * Bei 182 Klassen fiel das nicht auf, weil Erklärung und Wirklichkeit
 * zufällig übereinstimmten. Bei fünf log das Feld — darunter ein an diesem
 * Tag neu geschriebener Fehler, der 422 erklärte und 400 lieferte. Wer eine
 * Zahl in den Quelltext schreibt und ihr glaubt, hat dann einen Fehler, den
 * kein Test zeigt und keine Suche findet.
 *
 * Ein Feld muss regieren oder verschwinden. Es regiert jetzt: erklärt eine
 * Klasse einen Status, gilt er; sonst weiter die Landkarte. Die fünf
 * abweichenden Klassen liefern damit ab heute den Status, den sie immer
 * behauptet haben (503 statt 500 bei fehlender Einrichtung, 422 statt 400).
 */
function send(
  reply: FastifyReply,
  req: FastifyRequest,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
  statusUeberschreibung?: number,
  stelle?: string,
): FastifyReply {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      requestId: req.id,
      ...(stelle !== undefined ? { stelle } : {}),
    },
  };
  const status = statusUeberschreibung ?? codeToHttp[code];

  /**
   * ⚠️ DER DAUERHAFTE FADEN.
   *
   * Bis zum 09.08.2026 hinterliess KEIN Fehlschlag eine Spur, die einen
   * Neustart überlebte: der Motor schreibt nach stdout, und `motor.rs:407`
   * verwirft die Zeilen ab Bereitschaft. Die Vorgangskennung war danach für
   * immer weg.
   *
   * Geschrieben wird eine enge Zeile OHNE Meldungstext und OHNE die echte
   * Adresse — in einer Meldung kann ein Kundenname stehen, in der Adresse
   * seine Kennung. Was hier nicht steht, kann auch nicht hinausgetragen
   * werden.
   *
   * Kein `await`: der Verkauf wartet nicht auf die Platte, und `haltFest`
   * wirft nie.
   */
  const datenort = process.env['NORNS_DATENORT'];
  if (datenort !== undefined && datenort !== '') {
    void haltFest(datenort, {
      zeit: new Date().toISOString(),
      vorgang: req.id,
      stelle: stelle ?? '',
      code,
      status,
      verb: req.method,
      // Die Schablone, nicht die gefahrene Adresse.
      muster: (req as { routeOptions?: { url?: string } }).routeOptions?.url ?? '',
    });
  }

  /**
   * ⛔ 11.08.2026 — WARUM DER FEHLERKOERPER AM SCHEMA-SERIALISIERER VORBEIGEHT
   *
   * BEFUND, live an der echten Kasse gemessen: die Stellenkennung erreichte
   * den Draht auf 63 von 96 Routendateien NIE, darunter jede fiskale Route.
   * 74 Dateien erklaeren ein eigenes `ErrorResponse` mit vier Feldern (code,
   * message, details?, requestId), 465 Statuszeilen zeigen darauf. Fastify
   * serialisiert eine Antwort mit `fast-json-stringify` gegen genau dieses
   * Schema und streift JEDES nicht deklarierte Feld ab — ohne Warnung, ohne
   * Protokollzeile. `stelle` wurde also gebaut, gefuellt, gemessen und
   * unterwegs weggeworfen; auf neun weiteren Routen ebenso `details`.
   *
   * ⚠️ WARUM DER NAHELIEGENDE WEG FALSCH IST: die beiden Felder in die 74
   * Schemata nachzutragen ist die Bauanleitung fuer die Klasse „Waechter mit
   * Namensliste wird blind" — die 75. Datei bringt das Loch zurueck, und es
   * meldet sich nicht, weil ein abgestreiftes Feld keinen Fehler wirft. Der
   * Fehlerkoerper gehoert auch keiner einzelnen Route: er entsteht hier,
   * zentral, aus `ApiErrorBody`. Also liefert ihn diese Stelle auch aus.
   *
   * Ein STRING-Rumpf mit gesetztem Inhaltstyp geht in Fastify 4 nicht durch
   * den Serialisierer (`lib/reply.js:198-226`: `typeof payload !== 'string'`
   * ist die Bedingung fuer `preSerializationHook`). Damit gilt fuer den
   * Fehlerweg der Typ `ApiErrorBody` als Vertrag, nicht das Routenschema.
   * Das Routenschema bleibt fuer die Beschreibung stehen; es beschneidet
   * nur nichts mehr.
   *
   * Gemessen wird das an der HTTP-ANTWORT in
   * `tests/unit/antwortschema-behaelt-die-stellenkennung.test.ts` — eine
   * Quelltextsuche meldete hier seit dem 09.08. gruen, waehrend der Draht
   * leer blieb.
   */
  let rumpf: string;
  try {
    rumpf = JSON.stringify(body);
  } catch {
    /**
     * `details` kommt aus einer Fehlerklasse und koennte einen Ring oder ein
     * BigInt tragen. Dann faellt GENAU dieses Feld weg — der Rest der Auskunft
     * (Code, Meldung, Vorgang, Stelle) muss den Menschen trotzdem erreichen.
     * Nichts wird ersetzt und nichts erfunden: das Feld fehlt dann sichtbar.
     */
    const ohneDetails: ApiErrorBody = {
      error: { code, message, requestId: req.id, ...(stelle !== undefined ? { stelle } : {}) },
    };
    rumpf = JSON.stringify(ohneDetails);
  }

  return reply.status(status).type('application/json; charset=utf-8').send(rumpf);
}

const errorHandlerPlugin: FastifyPluginAsync = async (app) => {
  app.setNotFoundHandler((req, reply) => {
    send(reply, req, 'NOT_FOUND', `Route ${req.method} ${req.url} not found`);
  });

  app.setErrorHandler((err, req, reply) => {
    // 1. Fastify validation errors carry `validation` + `statusCode === 400`.
    if (err.validation) {
      send(reply, req, 'VALIDATION_ERROR', err.message, err.validation);
      return;
    }

    // 2. Typed domain errors from workspace packages.
    if (err instanceof DomainError) {
      // PinLockedError carries `lockedUntil` — pass it through as structured
      // details so the client can show a countdown without parsing the message.
      const maybeLockedUntil = (err as { lockedUntil?: unknown }).lockedUntil;
      /**
       * ⛔ 08.08.2026 — HIER STAND NUR DER EINE SONDERFALL `lockedUntil`.
       *
       * Jede andere Fehlerklasse konnte ein `details` tragen, so viel sie
       * wollte: der Behandler warf es weg, und auf dem Bildschirm blieb der
       * Fliesstext. Bei einem Zeitraumexport über hunderte Belege ist die
       * Belegnummer aber die einzige Angabe, mit der jemand die Stelle findet.
       *
       * Dieselbe Klasse wie „das Antwortschema entfernt das ehrliche Feld",
       * nur eine Ebene höher: das Feld ist gebaut, benannt, gefüllt — und
       * erreicht den Menschen nie.
       *
       * ⚠️ Nur ein OBJEKT wird durchgereicht. Eine Zeichenkette oder Zahl
       * hier wäre eine zweite, formlose Fassung der Meldung; die Oberfläche
       * könnte damit nichts anfangen ausser sie anzuzeigen.
       */
      const eigene = (err as { details?: unknown }).details;
      const details =
        maybeLockedUntil instanceof Date
          ? { lockedUntil: maybeLockedUntil.toISOString() }
          : eigene !== null && typeof eigene === 'object' && !Array.isArray(eigene)
            ? eigene
            : undefined;
      send(reply, req, err.code, err.message, details, err.httpStatus, err.stelle);
      return;
    }

    // 3. Known PG triggers (migration 0013 + earlier).
    const pgCode = pgErrorToCode(err as FastifyError & { code?: string });
    if (pgCode) {
      send(reply, req, pgCode, err.message);
      return;
    }

    // 4. Fastify auth/rate-limit conventional shapes.
    if (err.statusCode === 401) {
      send(reply, req, 'UNAUTHORIZED', err.message);
      return;
    }
    if (err.statusCode === 403) {
      send(reply, req, 'FORBIDDEN', err.message);
      return;
    }
    if (err.statusCode === 429) {
      send(reply, req, 'RATE_LIMITED', err.message);
      return;
    }

    // 4b. Any OTHER client-side (4xx) error Fastify raised before a handler ran:
    //     a malformed JSON body, an empty body, an unsupported media type. These
    //     are the caller's fault. Without this branch they fell through to the
    //     catch-all below and were answered 500 + logged as our error — which
    //     both lied to the caller and polluted the server-error rate (every bot
    //     posting garbage looked like an outage).
    if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
      const code: ApiErrorCode =
        err.statusCode === 404
          ? 'NOT_FOUND'
          : err.statusCode === 409
            ? 'CONFLICT'
            : 'VALIDATION_ERROR';
      send(reply, req, code, err.message);
      return;
    }

    // 5. Unknown → 500 + log. The body intentionally hides the underlying
    //    error message (avoid leaking stack hints to a hostile client).
    req.log.error({ err }, 'unhandled error');
    send(reply, req, 'INTERNAL_ERROR', 'Internal server error');
  });
};

export default fastifyPlugin(errorHandlerPlugin, {
  name: 'warehouse14-error-handler',
  fastify: '4.x',
});

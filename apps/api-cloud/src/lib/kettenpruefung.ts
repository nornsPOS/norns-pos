/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE PRÜFSUMMENKETTE PRÜFT SICH SELBST — UND NULL IST NICHT GRÜN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ──────────────────────────────────────────────
 *
 * `system-health.ts:227` las den Zustand der Prüfsummenkette so:
 *
 *     const chainStale = chainLastOk ? now - chainLastOk.getTime() > STALE : false;
 *
 * Steht `chainLastOk` auf NULL, ist `chainStale` **false**, und die Ampel
 * meldet grün „Läuft".
 *
 * NULL heisst hier aber nicht „alles gut", sondern **die Kette wurde noch nie
 * geprüft**. Und auf Norns POS ist das der Dauerzustand: die Zeile kommt aus
 * `worker_job_runs WHERE job_name = 'chain_verifier'`, geschrieben allein vom
 * Arbeiter-Auftrag `apps/worker/src/jobs/chain-verifier.ts` — und der Arbeiter
 * reist mit der Kasse überhaupt nicht mit. Gemessen: null Schreiber im ganzen
 * ausgelieferten Baum.
 *
 * Also: seit jeher nie geprüft, und die Anzeige sagte seit jeher „Läuft".
 * Dieselbe Klasse wie die Fiskal-Ampel eine Variable weiter, nur in die andere
 * Richtung — dort log das Rot, hier log das Grün.
 *
 * ── DIE ZWEI TEILE DER ABHILFE ────────────────────────────────────────────
 *
 * 1. NULL bekommt einen eigenen Zustand. Nie geprüft ist weder gut noch
 *    kaputt, und keine der beiden Lügen ist besser als die Wahrheit.
 *
 * 2. ⚠️ Die Kasse prüft SELBST. Eine Anzeige, die dauerhaft „nie geprüft"
 *    sagt, ist genauso wertlos wie eine dauerhaft grüne — sie wird nach der
 *    zweiten Woche nicht mehr gelesen. Die Prüffunktion liegt seit der
 *    Wanderung 0008 in der Datenbank und ist dem Rumpf ausdrücklich erlaubt:
 *
 *        GRANT EXECUTE ON FUNCTION verify_ledger_chain() TO warehouse14_app;
 *
 *    Norns POS ist für immer offline und hat keinen Arbeiter. Wenn die Kasse
 *    ihre eigene Kette nicht prüft, prüft sie NIEMAND.
 *
 * ── ⚠️ DER RECHTE-STOLPERSTEIN, DER DEN AUFBAU BESTIMMT ───────────────────
 *
 * Gemessen in `sidecar/erststart/schema.sql`:
 *
 *     GRANT SELECT,INSERT        ON worker_job_runs TO warehouse14_app;
 *     GRANT SELECT,INSERT,UPDATE ON worker_job_runs TO warehouse14_worker;
 *
 * Der Rumpf darf **nicht UPDATE**. Der Weg des Arbeiters — eine Zeile RUNNING
 * einfügen und danach auf den Endstand ändern — ist hier also unmöglich. Wer
 * ihn trotzdem nachbaut, bekommt beim zweiten Schritt einen Rechtefehler, und
 * zwar erst zur Laufzeit auf der Kasse des Händlers.
 *
 * Deshalb: EINE Zeile, erst nach dem Lauf, gleich im Endstand. Der Riegel
 * `worker_job_runs_finished_iff_terminal` erlaubt das ausdrücklich.
 */

import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import type { AppDb } from '@norns/db/client';

/** Der Name, unter dem der Lauf aufgezeichnet wird. */
export const KETTENPRUEFER_NAME = 'chain_verifier';

/** Wie oft die Kasse ihre eigene Kette prüft. */
export const KETTEN_TAKT_MS = 24 * 60 * 60 * 1000;

/** Der erste Lauf, kurz nach dem Start, aber nicht IM Start. */
export const KETTEN_ANLAUF_MS = 60_000;

/**
 * Ab wann ein bestandener Lauf als veraltet gilt.
 *
 * Zwei Stunden Luft über dem Takt, damit ein Rechner, der über Nacht aus war,
 * nicht sofort eine Warnung wirft.
 */
export const KETTE_VERALTET_MS = 26 * 60 * 60 * 1000;

/**
 * Der Zustand der Kette, als Wort.
 *
 * ⚠️ `nie` ist ein EIGENER Zustand und ausdrücklich weder `frisch` noch
 * `alt`. Genau dieser fehlende dritte Fall war der Befund.
 */
export type KettenStand = 'nie' | 'frisch' | 'alt';

/**
 * Wie steht die Kette? Rein: keine Uhr, keine Datenbank.
 *
 * @param letzterErfolg Zeitpunkt des letzten BESTANDENEN Laufs, oder null.
 */
export function beurteileKette(letzterErfolg: Date | null, jetztMs: number): KettenStand {
  if (letzterErfolg === null) return 'nie';
  return jetztMs - letzterErfolg.getTime() > KETTE_VERALTET_MS ? 'alt' : 'frisch';
}

/**
 * Der deutsche Satz zum Zustand. EIN Wortlaut, damit Kasse und Inhaber-App
 * nicht zwei Erklärungen für dieselbe Sache lesen.
 */
export function kettenSatz(stand: KettenStand): string {
  switch (stand) {
    case 'nie':
      return 'Die Prüfsummenkette des Tagebuchs wurde noch nie geprüft. Die erste Prüfung läuft kurz nach dem Start der Kasse.';
    case 'alt':
      return 'Die letzte bestandene Prüfung der Prüfsummenkette liegt mehr als einen Tag zurück.';
    case 'frisch':
      return 'Die Prüfsummenkette des Tagebuchs ist geprüft und unversehrt.';
  }
}

/** Ein gefundener Bruch, so wie die Datenbankfunktion ihn meldet. */
export interface KettenBruch extends Record<string, unknown> {
  break_at_id: string;
  reason: string;
}

export interface KettenErgebnis {
  /** Leer heisst: die Kette ist unversehrt. */
  brueche: KettenBruch[];
  /** Wie lange der Lauf gedauert hat, in Millisekunden. */
  dauerMs: number;
}

/**
 * Die Kette einmal ganz durchlaufen und das Ergebnis aufzeichnen.
 *
 * ⚠️ Die Aufzeichnung ist EINE Einfügung im Endstand, nie ein UPDATE, siehe
 * den Rechte-Stolperstein im Kopf dieser Datei.
 *
 * ⚠️ Ein Bruch wird als FAILED aufgezeichnet, nicht als SUCCESS mit Anhang.
 * Sonst zählt die Ampel den Lauf als bestanden und die Kette gilt als heil,
 * obwohl die Funktion gerade einen Bruch gemeldet hat.
 */
/**
 * ⛔ EIN FRISCHER LAUF, ABER NICHT BEI JEDEM RUF (19.08.2026, Fund der
 * boeswilligen Pruefung).
 *
 * ── DAS PROBLEM ────────────────────────────────────────────────────────────
 *
 * Das Prueferpaket rief `pruefeKette` bei JEDEM Abruf. Das ist ein
 * O(n)-Durchlauf ueber das gesamte Tagebuch PLUS eine Einfuegung — ein
 * LESEweg, der schreibt. Mehrere Abrufe hintereinander (ein Pruefer, der die
 * Jahre einzeln zieht; ein Doppelklick) vervielfachten die Last auf einem
 * Tresenrechner, der gleichzeitig kassieren soll.
 *
 * ── DIE ABHILFE, OHNE DIE AUSSAGE ZU VERWAESSERN ──────────────────────────
 *
 * Der Pruefbericht darf keinen ALTEN Lauf zitieren — die Aussage „soeben
 * geprueft" waere sonst unwahr. Aber ein Lauf, der VOR WENIGEN MINUTEN
 * gelaufen ist, ist frisch: an einem Tagebuch, das zwischen zwei Abrufen um
 * ein paar Belege waechst, aendert sich das Ergebnis nicht.
 *
 * Also: liegt ein Lauf innerhalb des Fensters, wird ER genommen; sonst wird
 * neu geprueft. Das Fenster ist bewusst kurz (fuenf Minuten) und steht hier,
 * nicht beim Rufer — es ist eine Aussage ueber die Kette, nicht ueber das
 * Paket.
 */
export async function pruefeKetteFrisch(
  db: AppDb,
  jetztMs: number,
  fensterMs = 5 * 60_000,
): Promise<KettenErgebnis & { zitiert: boolean }> {
  const letzte = (await db.execute<{ status: string; alter_ms: string; payload: unknown }>(drizzleSql`
    SELECT status::text AS status,
           (EXTRACT(EPOCH FROM (now() - finished_at)) * 1000)::bigint::text AS alter_ms,
           payload
      FROM worker_job_runs
     WHERE job_name = ${KETTENPRUEFER_NAME}
       AND finished_at IS NOT NULL
     ORDER BY finished_at DESC
     LIMIT 1`)) as unknown as { status: string; alter_ms: string; payload: unknown }[];

  const jung = letzte[0];
  if (jung && Number(jung.alter_ms) <= fensterMs) {
    const p = (jung.payload ?? {}) as { brueche?: number; dauerMs?: number };
    // Ein zitierter Lauf traegt die ZAHL der Brueche, nicht ihre Zeilen —
    // mehr braucht der Bericht nicht, und weniger behauptet er auch nicht.
    const brueche: KettenBruch[] =
      jung.status === 'SUCCESS'
        ? []
        : Array.from({ length: Math.max(1, Number(p.brueche ?? 1)) }, () => ({
            break_at_id: '?',
            reason: 'aus dem zuletzt aufgezeichneten Lauf',
          }));
    return { brueche, dauerMs: Number(p.dauerMs ?? 0), zitiert: true };
  }

  const frisch = await pruefeKette(db, jetztMs);
  return { ...frisch, zitiert: false };
}

export async function pruefeKette(db: AppDb, jetztMs: number): Promise<KettenErgebnis> {
  const brueche = (await db.execute<KettenBruch>(drizzleSql`
    SELECT break_at_id::text AS break_at_id, reason FROM verify_ledger_chain()`)) as unknown as
    KettenBruch[];
  const dauerMs = Date.now() - jetztMs;

  const heil = brueche.length === 0;
  // Der Riegel `worker_job_runs_error_only_when_failing` erlaubt eine
  // Fehlermeldung NUR bei FAILED oder TIMEOUT — deshalb steht sie hier im
  // Zweig und nicht als Feld mit `null`.
  await db.execute(drizzleSql`
    INSERT INTO worker_job_runs (job_name, started_at, finished_at, status, error_message, payload)
    VALUES (
      ${KETTENPRUEFER_NAME},
      now() - make_interval(secs => ${dauerMs / 1000}),
      now(),
      ${heil ? 'SUCCESS' : 'FAILED'}::worker_job_status,
      ${heil ? null : `Prüfsummenkette gebrochen bei Eintrag ${brueche[0]?.break_at_id ?? '?'}: ${brueche[0]?.reason ?? ''}`},
      ${JSON.stringify({ brueche: brueche.length, dauerMs })}::jsonb
    )`);

  return { brueche, dauerMs };
}

/**
 * Den Takt starten: einmal kurz nach dem Hochfahren, danach täglich.
 *
 * ⚠️ NICHT im Start selbst. Ein O(n)-Durchlauf über das Tagebuch darf das
 * Hochfahren der Kasse nicht verzögern; der Händler wartet vor dem Tresen.
 *
 * ⚠️ Ein Fehler hier darf die Kasse NIE anhalten. Schlägt die Prüfung fehl,
 * bleibt der letzte bestandene Lauf stehen, die Anzeige altert sichtbar, und
 * genau das ist die richtige Meldung — eine Kasse, die wegen ihrer eigenen
 * Selbstprüfung nicht mehr kassiert, wäre die schlechtere Störung.
 */
export function starteKettenpruefung(app: FastifyInstance): NodeJS.Timeout {
  const lauf = (): void => {
    const start = Date.now();
    pruefeKette(app.db, start)
      .then(({ brueche, dauerMs }) => {
        if (brueche.length === 0) {
          app.log.info({ dauerMs }, 'Prüfsummenkette: unversehrt');
          return;
        }
        // ⛔ Ein Bruch in der Kette ist ein Befund für den Menschen, nicht eine
        // Zeile im Protokoll. Er steht deshalb auch in `worker_job_runs` als
        // FAILED, wo die Ampel des Inhabers ihn findet.
        app.log.error(
          { brueche: brueche.length, ersterBruch: brueche[0] },
          'Prüfsummenkette GEBROCHEN',
        );
      })
      .catch((err: unknown) => {
        app.log.error({ err }, 'Prüfsummenkette: Lauf fehlgeschlagen');
      });
  };

  setTimeout(lauf, KETTEN_ANLAUF_MS);
  const handle = setInterval(lauf, KETTEN_TAKT_MS);
  handle.unref?.();
  app.log.info({ taktMs: KETTEN_TAKT_MS }, 'Prüfsummenkette: Selbstprüfung gestartet');
  return handle;
}

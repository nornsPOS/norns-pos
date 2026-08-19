/**
 * TagesabschlussDialog — der ECHTE Tagesabschluss an der Kasse.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER BEFUND VOM 13.08.2026
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `closingsApi.finalize` — der gesetzliche Tagesabschluss, der die Zeile in
 * `daily_closings` schreibt — hatte im ganzen Baum NULL Aufrufer in der Kasse.
 * Einziger Aufrufer war die Inhaber-App auf Android
 * (`apps/mobile/src/warehouse14/api.ts:782`).
 *
 * Was die Kasse „Tagesabschluss" nannte, war `shiftsApi.close` — der
 * SCHICHTSCHLUSS. Der Händler zählte abends die Lade, las eine Erfolgsmeldung
 * und hielt den Tag für erledigt. Es entstand KEINE Abschlusszeile. Ohne die
 * gibt es kein DSFinV-K, kein DATEV und keinen Kassenbericht für den Tag —
 * und § 146 Abs. 1 Satz 2 AO verlangt genau diesen Abschluss.
 *
 * Dieses Fenster schliesst die Lücke: es ruft `closingsApi.finalize` wirklich.
 *
 * ── WARUM DER TAG MITGESCHICKT WIRD, OBWOHL ER WEGGELASSEN WERDEN DÜRFTE ───
 *
 * Ohne `businessDay` entscheidet der Server, welchen Tag er versiegelt. Das
 * ist bequem und an EINER Stelle gefährlich: ohne Netz reiht der Ausgangskorb
 * den Aufruf ein, und beim Nachspielen am nächsten Morgen versiegelte er dann
 * den FALSCHEN Tag. Mit ausdrücklichem Tag versiegelt der Abschluss genau den
 * Tag, der in der Vorschau steht — was der Mensch sieht, ist, was passiert.
 *
 * ── ⚠️ GEMESSEN AM 13.08.2026: DER ABSCHLUSS GILT NICHT ALS FISKALER WEG ───
 *
 * Nachgemessen gegen `packages/api-client/src/middleware/offline-queue.ts`
 * (gefahren, nicht gelesen — `isGobdRelevantPath` und `istFluechtigerPfad`):
 *
 *     /api/closings/finalize     flüchtig: nein   fiskal: NEIN
 *     /api/shifts/<kennung>/close flüchtig: nein  fiskal: ja
 *     /api/transactions/finalize  flüchtig: nein  fiskal: ja
 *
 * Was das heisst und was NICHT:
 *
 *   • NACHREICHBAR IST ER. Der Weg steht nicht in `FLUECHTIGE_PFADE`, also
 *     reiht ihn der Ausgangskorb ohne Netz wirklich ein und spielt ihn später
 *     ab. Der unten gefangene `istSicherEingereiht`-Zweig sagt die Wahrheit.
 *
 *   • ABER SEINE ZEILE VERFÄLLT NACH 30 TAGEN. `isGobdRelevantPath` antwortet
 *     für ihn `false`, und daraus rechnet `lib/outbox-store.ts:54` die
 *     Aufbewahrung: zehn Jahre nur für fiskale Wege, sonst 30 Tage.
 *     `pruneExpired` (`lib/outbox-store.ts:190`) löscht danach — allerdings
 *     NUR Zeilen mit `status='succeeded'`. Eine noch nicht abgespielte
 *     Abschlusszeile geht also nicht verloren; verloren geht die Spur des
 *     GEBUCHTEN Abschlusses, die § 147 AO zehn Jahre lang sehen will.
 *     Es ist derselbe Defekt, der am 12.08.2026 für den Schichtschluss und
 *     die Bargeldbewegung behoben wurde (`offline-queue.ts:124`).
 *
 * ⚠️ Die Heilung gehört in `FISCAL_PATH_PREFIXES` und damit in ein fremdes
 * Paket; von dieser Fläche aus lässt sie sich nicht setzen, weil
 * `closingsApi.finalize` keine Begleitangaben entgegennimmt
 * (`packages/api-client/src/domains/closings.ts:135`). Hier steht deshalb der
 * gemessene Befund, damit ihn niemand zweimal suchen muss.
 *
 * Der Tag wird mit derselben Zeitzone gerechnet wie in der Datenbank
 * (`berlin_business_day`, `packages/db/migrations/0002_helpers.sql:42`) und
 * wie im Riegel des Servers (`apps/api-cloud/src/lib/abschlusstag.ts:52`).
 * Geht die Uhr dieser Kasse vor, weist der Server den Tag ab — dafür gibt es
 * unten einen eigenen deutschen Satz statt einer blassen Eingabemeldung.
 *
 * ── ⚠️ DIE NACHREICHUNG, DIE ES FÜR MANCHE BELEGE NIE GEBEN WIRD ───────────
 *
 * Hier stand bis zum 13.08.2026 an ZWEI Stellen dieselbe Zusage:
 *
 *   :264  im Kasten über dem roten Knopf, wörtlich getippt
 *   :548  durchgereicht aus `describeError` (`packages/i18n-de`, Merkmal
 *         „keine TSE-Signatur"): „die fehlenden Signaturen werden nachgeholt,
 *         sobald die Sicherungseinrichtung wieder erreichbar ist"
 *
 * Beide beschreiben genau EINEN der Zustände, in denen ein Beleg ohne Signatur
 * steckt. Der Server zählt aber schlicht die Belege des Tages OHNE Zeile in
 * `tse_signatures` (`closings-finalize.ts:637` folgende) — er kennt den Grund
 * gar nicht. Darunter sind Belege, deren Ausfall `vermerkeDauerhaftenAusfall`
 * endgültig festgehalten hat: für die kommt nie mehr eine Signatur
 * (`lib/tse-queue-store.ts`, begründet in `istNachreichbar`). Wer den Kasten
 * las, schloss den Tag im Glauben ab, das hole sich von allein ein.
 *
 * Beide Stellen holen den Satz jetzt aus der EINEN Quelle
 * (`lib/fiskalzustand-satz.ts`), jeden für den Zustand, für den er wahr ist.
 * Nur der Kasten daneben zu richten hätte die Lüge verschoben, nicht behoben:
 * die durchgereichte Zeile stand auf DERSELBEN Fläche.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, type ClosingListItem, closingsApi } from '@norns/api-client';
import { describeError } from '@norns/i18n-de';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  Zwischentitel,
  MoneyAmount,
} from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { eingereihtHinweis, istSicherEingereiht } from '../../lib/eingereiht.js';
import { type FiskalzustandSatz, fiskalzustandSatz } from '../../lib/fiskalzustand-satz.js';
import { useToastStore } from '../../state/toast-store.js';

/**
 * Das Ergebnis des Abschlusses. `ClosingFinalizeResult` ist im Klientenpaket
 * nicht nach aussen gereicht, und das Paket darf hier nicht angefasst werden —
 * also wird der Typ aus der Methode abgeleitet. Bleibt damit von selbst in
 * Deckung, falls der Rumpf der Antwort einmal wächst.
 */
type Abschluss = Awaited<ReturnType<typeof closingsApi.finalize>>;

export interface TagesabschlussDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Der Berliner Geschäftstag als `JJJJ-MM-TT` — dieselbe Rechnung wie im Server. */
export function berlinerGeschaeftstag(zeitpunkt: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(zeitpunkt);
}

/** `JJJJ-MM-TT` als deutscher Klartext, z. B. „Mittwoch, 13.08.2026". */
function tagInWorten(tag: string): string {
  const d = new Date(`${tag}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return tag;
  return d.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  BELEGE OHNE SIGNATUR — DER EINE RIEGEL, DER EINE NACHFRAGE IST
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Spricht diese Absage von Belegen ohne Signatur?
 *
 * EIN Merkmal für beides: für die Nachfrage (der rote Knopf erscheint) und für
 * den Satz darüber. Vorher stand dieselbe Prüfung an einer Stelle und der Satz
 * kam von woanders — genau so laufen zwei Wahrheiten auseinander.
 *
 * Das Merkmal ist der Wortlaut des Servers (`closings-finalize.ts:659`), nicht
 * ein Fehlercode: der Riegel wirft `ClosingConflictError`, und den wirft dieser
 * Weg für vier verschiedene Gründe.
 */
export function betrifftUnsignierteBelege(nachricht: string): boolean {
  return nachricht.includes('keine TSE-Signatur');
}

/**
 * Die Anzahl aus dem Wortlaut des Servers — gemessen, nicht geschätzt.
 *
 * Der Server stellt sie voran: „3 Belege dieses Tages tragen keine
 * TSE-Signatur." `describeError` lässt sie weg und sagt nur „noch Belege"; am
 * Abschluss ist aber genau das der Unterschied zwischen einem vergessenen Beleg
 * und einem Tag, an dem die Sicherungseinrichtung durchgehend stumm war.
 *
 * Findet sich keine Zahl, wird KEINE erfunden — dann bleibt der Satz ohne sie.
 */
export function anzahlOhneSignatur(nachricht: string): number | null {
  const treffer = /(\d{1,6})\s+Beleg/.exec(nachricht);
  if (!treffer) return null;
  const zahl = Number(treffer[1]);
  return Number.isFinite(zahl) && zahl > 0 ? zahl : null;
}

/**
 * Der Satz über dem roten Knopf.
 *
 * ⚠️ Er verspricht NICHTS. Was aus einem einzelnen Beleg wird, steht in
 * `LAGEN_OHNE_SIGNATUR` darunter — und zwar in den Worten der einen Quelle.
 */
export function unsignierteBelegeSatz(nachricht: string): string {
  const anzahl = anzahlOhneSignatur(nachricht);
  const wieViele =
    anzahl === null
      ? 'Für diesen Kassentag tragen Belege keine Signatur der Sicherungseinrichtung.'
      : anzahl === 1
        ? 'Ein Beleg dieses Kassentags trägt keine Signatur der Sicherungseinrichtung.'
        : `${anzahl} Belege dieses Kassentags tragen keine Signatur der Sicherungseinrichtung.`;
  return `${wieViele} Der Tag lässt sich abschliessen, aber nur ausdrücklich.`;
}

/**
 * WAS AUS EINEM BELEG OHNE SIGNATUR WIRD — JEDE LAGE MIT DEM SATZ DER QUELLE.
 *
 * Der Server zählt nur, er unterscheidet nicht: gezählt wird jeder Beleg des
 * Tages ohne Zeile in `tse_signatures`. Diese Fläche kann die Lage eines
 * einzelnen Belegs deshalb nicht bestimmen — und tut auch nicht so. Sie zeigt,
 * was vorkommt, und überlässt jeder Lage ihren eigenen Satz:
 *
 *   · `wartetAufAbschluss`  die Kasse holt es selbst nach — der EINZIGE Fall,
 *                           für den die alte Zusage überhaupt stimmte.
 *   · `dauerhaftVermerkt`   es kommt nie mehr eine Signatur, der Ausfall ist
 *                           festgehalten.
 *   · `nichtGesichert`      der Fall echten Verlusts: nicht einmal örtlich
 *                           vermerkt. Er gehört auf eine Fläche, hinter der ein
 *                           unwiderruflicher Knopf sitzt.
 */
export const LAGEN_OHNE_SIGNATUR: readonly FiskalzustandSatz[] = [
  fiskalzustandSatz('wartetAufAbschluss'),
  fiskalzustandSatz('dauerhaftVermerkt'),
  fiskalzustandSatz('nichtGesichert'),
];

export function TagesabschlussDialog({ open, onClose }: TagesabschlussDialogProps): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [tag, setTag] = useState<string>(() => berlinerGeschaeftstag(new Date()));
  const [laeuft, setLaeuft] = useState<boolean>(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [unsignierteFrage, setUnsignierteFrage] = useState<boolean>(false);
  const [fertig, setFertig] = useState<Abschluss | null>(null);

  /**
   * Sperre gegen den zweiten Druck auf DERSELBEN Runde. `laeuft` wirkt erst
   * nach dem nächsten Zeichnen; wer schnell zweimal tippt, hätte bis dahin
   * zweimal abgeschickt. Ein Abschluss ist unwiderruflich, also darf das
   * nicht vom Zeichentakt abhängen.
   */
  const laeuftRef = useRef<boolean>(false);

  useEffect(() => {
    if (!open) return;
    // Beim Öffnen die Uhr neu lesen: eine Kasse läuft über Mitternacht durch.
    setTag(berlinerGeschaeftstag(new Date()));
    setFehler(null);
    setUnsignierteFrage(false);
    setFertig(null);
  }, [open]);

  /**
   * Die Vorschau. Sie erfindet KEINE Zahlen: für einen laufenden Tag gibt es
   * noch gar keine Abschlusszeile, die Summen entstehen erst im Abschluss.
   * Beantwortet wird deshalb nur die eine Frage, die vorher beantwortbar ist:
   * steht für diesen Tag schon ein Abschluss?
   */
  const vorschau = useQuery({
    queryKey: ['closings', 'tagesabschluss-vorschau', tag],
    queryFn: () => closingsApi.list(api, { from: tag, to: tag, limit: 1 }),
    enabled: open && fertig === null,
    staleTime: 0,
    retry: 1,
  });

  const bestehend: ClosingListItem | null = vorschau.data?.items[0] ?? null;
  const schonAbgeschlossen = bestehend?.state === 'FINALIZED';

  const abschliessen = useCallback(
    async (unsignierteBestaetigt: boolean) => {
      if (laeuftRef.current) return;
      laeuftRef.current = true;
      setLaeuft(true);
      setFehler(null);
      if (!unsignierteBestaetigt) setUnsignierteFrage(false);
      try {
        // 403 STEP_UP_REQUIRED fängt die Zwischenschicht ab: die PIN-Abfrage
        // öffnet sich, und dieser Aufruf läuft danach weiter.
        const ergebnis = await closingsApi.finalize(api, tag, unsignierteBestaetigt);
        setFertig(ergebnis);
        addToast({
          tone: 'success',
          title: 'Tagesabschluss gebucht',
          body: `Kassentag ${tagInWorten(ergebnis.businessDay)} ist abgeschlossen.`,
        });
        await qc.invalidateQueries({ queryKey: ['closings'] });
      } catch (err) {
        // Sicher eingereiht ist ein ERFOLG, kein Fehler — `src/lib/eingereiht.ts`.
        // Ohne diesen Zweig läse der Händler „Verbindung gestört", drückte
        // erneut und hätte zwei Abschlussversuche im Ausgangskorb.
        if (istSicherEingereiht(err)) {
          addToast(eingereihtHinweis('Tagesabschluss'));
          onClose();
          return;
        }
        if (err instanceof ApiError) {
          setFehler(fehlersatz(err));
          // Der EINE Grund, für den es einen Ausweg gibt. Ein Ausweg, der bei
          // jedem Fehler erscheint, ist keine Bestätigung mehr, sondern nur
          // ein zweiter Versuch. Dasselbe Merkmal entscheidet über den Satz
          // darüber (`fehlersatz`) — ein Kasten ohne passenden Satz wäre die
          // nächste auseinanderlaufende Wahrheit.
          setUnsignierteFrage(betrifftUnsignierteBelege(err.message));
        } else {
          setFehler('Keine Verbindung zum Server. Bitte das Netz prüfen und erneut versuchen.');
        }
      } finally {
        laeuftRef.current = false;
        setLaeuft(false);
      }
    },
    [addToast, api, onClose, qc, tag],
  );

  return (
    <Dialog
      open={open}
      onClose={laeuft ? () => undefined : onClose}
      title="Tagesabschluss"
      size="md"
      closeOnBackdrop={!laeuft}
      closeOnEsc={!laeuft}
    >
      <DialogBody>
        {fertig === null ? (
          <Vorschau
            tag={tag}
            laedt={vorschau.isLoading}
            leseFehler={vorschau.isError}
            bestehend={bestehend}
          />
        ) : (
          <Ergebnis abschluss={fertig} />
        )}

        {fertig === null && fehler !== null && (
          <p
            role="alert"
            style={{
              color: 'var(--w14-wax-red)',
              margin: 'var(--space-4) 0 0',
              fontSize: 'var(--w14-schrift-betont)',
              lineHeight: 1.5,
            }}
          >
            {fehler}
          </p>
        )}

        {fertig === null && unsignierteFrage && (
          <div
            style={{
              marginTop: 'var(--space-3)',
              padding: 'var(--space-3)',
              border: '1px solid var(--w14-gold)',
              borderRadius: 'var(--w14-radius-card)',
              background: 'var(--w14-parchment-2)',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 'var(--w14-schrift-feld)',
                color: 'var(--w14-ink-aged)',
                lineHeight: 1.5,
              }}
            >
              Was aus einem einzelnen Beleg wird, hängt davon ab, woran es gescheitert ist. Dieser
              Abschluss kann das nicht auseinanderhalten:
            </p>
            <ul
              style={{
                margin: 'var(--space-2) 0 0',
                // Eine Stufe der Hausleiter, kein roher Wert: `1.2em` stand
                // hier und war an keine Leiter gebunden. Der Abstandswächter
                // misst genau das.
                paddingLeft: 'var(--w14-abstand-16)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
                fontSize: 'var(--w14-schrift-feld)',
                color: 'var(--w14-ink-aged)',
                lineHeight: 1.5,
              }}
            >
              {LAGEN_OHNE_SIGNATUR.map((lage) => (
                <li key={lage.titel}>
                  <strong style={{ color: 'var(--w14-ink)' }}>{lage.titel}.</strong> {lage.satz}
                </li>
              ))}
            </ul>
            <p
              style={{
                margin: 'var(--space-3) 0 0',
                fontSize: 'var(--w14-schrift-feld)',
                color: 'var(--w14-ink-aged)',
                lineHeight: 1.5,
              }}
            >
              Der Abschluss selbst reicht keine Signatur nach. Er hält fest, dass sie zum
              Abschlusszeitpunkt gefehlt haben, und wer das bestätigt hat.
            </p>
            <div style={{ marginTop: 'var(--space-3)' }}>
              <Button
                variant="destructive"
                size="md"
                onClick={() => void abschliessen(true)}
                disabled={laeuft}
                fullWidth
              >
                {laeuft ? 'Schließe ab…' : 'Trotzdem abschließen und Lücke vermerken'}
              </Button>
            </div>
          </div>
        )}
      </DialogBody>

      <DialogFooter>
        {fertig === null ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={laeuft}>
              Abbrechen
            </Button>
            <Button
              variant="destructive"
              onClick={() => void abschliessen(false)}
              disabled={laeuft || schonAbgeschlossen || vorschau.isLoading}
            >
              {laeuft ? 'Schließe ab…' : 'Kassentag jetzt abschließen'}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose}>
            Fertig
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}

/**
 * Was hier abgeschlossen wird — ohne eine einzige erfundene Zahl.
 *
 * Für einen laufenden Tag gibt es noch keine Abschlusszeile: die Summen
 * entstehen erst im Abschluss selbst. Genau das steht hier auch, statt einer
 * Schätzung, die neben dem späteren Beleg stünde.
 */
function Vorschau({
  tag,
  laedt,
  leseFehler,
  bestehend,
}: {
  tag: string;
  laedt: boolean;
  leseFehler: boolean;
  bestehend: ClosingListItem | null;
}): JSX.Element {
  const schonAbgeschlossen = bestehend?.state === 'FINALIZED';
  return (
    <>
      <p
        style={{
          margin: '0 0 var(--space-3)',
          color: 'var(--w14-ink-aged)',
          fontSize: 'var(--w14-schrift-text)',
          lineHeight: 1.55,
        }}
      >
        Der Tagesabschluss schliesst den Kassentag als Ganzes ab. Er ist nicht dasselbe wie der
        Schichtschluss: der zählt die Lade, dieser schreibt den Abschluss des Tages, aus dem
        Kassenbericht, DATEV und DSFinV-K entstehen.
      </p>

      <Zwischentitel label="Was abgeschlossen wird" />

      <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <Zeile begriff="Kassentag" wert={tagInWorten(tag)} />
        <Zeile
          begriff="Umfasst"
          wert="Alle Belege dieses Tages und die Zählung der geschlossenen Schichten"
        />
        <Zeile
          begriff="Stand"
          wert={
            laedt
              ? 'Wird geprüft…'
              : leseFehler
                ? 'Konnte nicht gelesen werden. Der Abschluss selbst prüft es noch einmal'
                : schonAbgeschlossen
                  ? 'Dieser Tag ist bereits abgeschlossen'
                  : bestehend
                    ? 'Angefangen, aber nicht abgeschlossen. Dieser Abschluss ersetzt den Zwischenstand'
                    : 'Noch nicht abgeschlossen'
          }
        />
      </dl>

      <p
        style={{
          margin: 'var(--space-3) 0 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: 'var(--w14-schrift-zeile)',
          lineHeight: 1.5,
        }}
      >
        Die Summen berechnet der Abschluss selbst aus den Belegen des Tages. Vorher steht hier
        bewusst keine Zahl, die neben dem fertigen Abschluss stehen könnte.
      </p>

      {schonAbgeschlossen ? (
        <p
          style={{
            margin: 'var(--space-4) 0 0',
            padding: 'var(--space-3)',
            border: '1px solid var(--w14-rule)',
            borderRadius: 'var(--w14-radius-card)',
            color: 'var(--w14-ink-aged)',
            fontSize: 'var(--w14-schrift-feld)',
            lineHeight: 1.5,
          }}
        >
          Für diesen Kassentag steht der Abschluss bereits. Ein zweiter ist nicht möglich, und das
          ist richtig so: ein gebuchter Abschluss ist unveränderlich.
        </p>
      ) : (
        <p
          style={{
            margin: 'var(--space-4) 0 0',
            padding: 'var(--space-3)',
            border: '1px solid var(--w14-wax-red)',
            borderRadius: 'var(--w14-radius-card)',
            color: 'var(--w14-ink)',
            fontSize: 'var(--w14-schrift-feld)',
            lineHeight: 1.5,
          }}
        >
          <strong>Das lässt sich nicht rückgängig machen.</strong> Nach dem Abschluss nimmt die
          Kasse für diesen Tag keinen Verkauf, keinen Ankauf und keine Bargeldbewegung mehr an.
        </p>
      )}
    </>
  );
}

/** Der fertige Abschluss — die Zahlen, die der Server wirklich gebucht hat. */
function Ergebnis({ abschluss }: { abschluss: Abschluss }): JSX.Element {
  return (
    <>
      <p
        style={{
          margin: '0 0 var(--space-3)',
          fontFamily: 'var(--w14-font-display)',
          fontSize: 'var(--w14-schrift-titel)',
          textAlign: 'center',
        }}
      >
        Kassentag {tagInWorten(abschluss.businessDay)} ist abgeschlossen.
      </p>

      <Zwischentitel label="Gebucht" />

      <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <Zeile begriff="Verkäufe" wert={String(abschluss.verkaufCount)} />
        <Zeile begriff="Ankäufe" wert={String(abschluss.ankaufCount)} />
        <Zeile begriff="Stornos" wert={String(abschluss.stornoCount)} />
        <ZeileGeld begriff="Umsatz brutto" betragEur={abschluss.grossVerkaufEur} />
        <ZeileGeld begriff="Bar erwartet" betragEur={abschluss.cashExpectedEur} />
        <ZeileGeld begriff="Bar gezählt" betragEur={abschluss.cashCountedEur} />
        <ZeileGeld begriff="Differenz" betragEur={abschluss.cashVarianceEur} vorzeichen />
      </dl>

      <p
        style={{
          margin: 'var(--space-4) 0 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: 'var(--w14-schrift-zeile)',
          textAlign: 'center',
        }}
      >
        Gebucht am {new Date(abschluss.finalizedAt).toLocaleString('de-DE')} · Kassenbericht, DATEV
        und DSFinV-K stehen jetzt unter Steuer-Export bereit.
      </p>
    </>
  );
}

function Zeile({ begriff, wert }: { begriff: string; wert: string }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 'var(--space-3)',
      }}
    >
      <dt
        className="w14-smallcaps"
        style={{
          color: 'var(--w14-ink-aged)',
          fontSize: 'var(--w14-schrift-feld)',
          letterSpacing: '0.08em',
          flex: '0 0 auto',
        }}
      >
        {begriff}
      </dt>
      <dd
        style={{
          margin: 0,
          color: 'var(--w14-ink)',
          fontSize: 'var(--w14-schrift-feld)',
          textAlign: 'right',
          lineHeight: 1.4,
        }}
      >
        {wert}
      </dd>
    </div>
  );
}

function ZeileGeld({
  begriff,
  betragEur,
  vorzeichen = false,
}: {
  begriff: string;
  betragEur: string;
  vorzeichen?: boolean;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 'var(--space-3)',
      }}
    >
      <dt
        className="w14-smallcaps"
        style={{
          color: 'var(--w14-ink-aged)',
          fontSize: 'var(--w14-schrift-feld)',
          letterSpacing: '0.08em',
        }}
      >
        {begriff}
      </dt>
      <dd className="w14-tabular" style={{ margin: 0, fontFamily: 'var(--w14-font-mono)' }}>
        <MoneyAmount valueEur={betragEur} signed={vorzeichen} />
      </dd>
    </div>
  );
}

/**
 * Deutsche Sätze für die Fehlerfälle dieses Weges.
 *
 * `describeError` kennt die vier 409-Sätze des Abschlusses und antwortet
 * genau (`packages/i18n-de/src/german-text.ts:596 ff.`). ZWEI Fälle fallen
 * dort durch:
 *
 *   · Der Riegel gegen einen Tag in der Zukunft antwortet mit
 *     VALIDATION_ERROR und einem OBJEKT in `details`, während `describeError`
 *     dort eine Liste erwartet — herauskäme die blasse Zeile „Eingabe
 *     ungültig". Der Händler stünde vor einer Eingabe, die er nie gemacht hat.
 *     Deshalb ein eigener Satz, der die WIRKLICHE Ursache nennt: die Uhr
 *     dieser Kasse.
 *
 *   · ⚠️ Belege ohne Signatur. `describeError` antwortet dafür wortgetreu wie
 *     der Server: „die fehlenden Signaturen werden nachgeholt, sobald die
 *     Sicherungseinrichtung wieder erreichbar ist". Für einen dauerhaft
 *     vermerkten Ausfall ist das falsch, und diese Zeile stünde auf DERSELBEN
 *     Fläche wie der Kasten darüber. Nur den Kasten zu richten hätte die Lüge
 *     verschoben. Der Satz hier zählt und verspricht nichts; die Lagen stehen
 *     darunter, jede mit dem Satz aus `lib/fiskalzustand-satz.ts`.
 */
export function fehlersatz(err: ApiError): string {
  const feld = (err.details as { field?: string } | null | undefined)?.field;
  if (err.code === 'VALIDATION_ERROR' && feld === 'businessDay') {
    return (
      'Der Kassentag liegt für den Server in der Zukunft. Vermutlich geht die Uhr dieser Kasse ' +
      'vor. Bitte die Uhrzeit des Geräts richtigstellen und erneut versuchen.'
    );
  }
  if (betrifftUnsignierteBelege(err.message)) return unsignierteBelegeSatz(err.message);
  return describeError(err);
}

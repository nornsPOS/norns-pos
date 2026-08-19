/**
 * Steuer-Export & Compliance — die PIN-gesicherte Einstellungs-Sektion, in der
 * der Inhaber (ADMIN) bzw. der Steuerberater (READONLY) alle steuerlich
 * relevanten Exporte auf Knopfdruck zieht: DSFinV-K (Z3-Zugriff, pro
 * Kassentag), Kassenbericht (Z-Bon, CSV), DATEV (Buchungsstapel, EXTF) plus die
 * GoBD-Verfahrensdokumentation.
 *
 * Schutz: Die Sektion ist gesperrt, bis der GERÄTECODE bestätigt ist — derselbe,
 * mit dem die Kasse entsperrt wird. Bis zum 26.07.2026 sprach dieser Kopf und
 * die Oberfläche von einer „Manager-PIN": die gibt es nicht mehr, und geprüft
 * wurde ohnehin nie eine.
 * Beim ersten Mount (und beim „Entsperren") rufen wir `GET /api/compliance/unlock`
 * — das verlangt ADMIN + frischen Step-up, also öffnet der api-client-Interceptor
 * automatisch die StepUpModal. Erst nach `{ok:true}` werden die Export-Gruppen
 * gerendert. Läuft das Step-up-Token später ab, löst auch jeder Export-Aufruf das
 * Step-up erneut aus — das ist gewollt.
 *
 * GoBD: read-only — nichts hier verändert eine fiskalische Zeile.
 */

import { useEffect, useState } from 'react';

import { ApiError, type ClosingListItem, closingsApi } from '@norns/api-client';
import { Button, Zwischentitel, Icon, Lock } from '@norns/ui-kit';

import { useVerfahrensdokuPdf, zeitpunktText } from '../../hooks/useVerfahrensdokuPdf.js';
import { useApiClient } from '../../lib/api-context.js';
import {
  downloadBase64File,
  downloadBytesFile,
  downloadTextFile,
} from '../../lib/download-file.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@norns/i18n-de';
import { DatevMandantEinrichtung } from './DatevMandantEinrichtung.js';
import { KontenrahmenWahl, rahmenParameter, useKontenrahmenWahl } from './KontenrahmenWahl.js';
import {
  type Laufbericht,
  laufeUeberTage,
} from './nachschau-lauf.js';
import { SteuerberaterSection } from './SteuerberaterSection.js';

// ────────────────────────────────────────────────────────────────────────
// Datum-Helfer (lokal, ohne Zeitzonen-Drift) — YYYY-MM-DD / YYYY-MM.
// ────────────────────────────────────────────────────────────────────────

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function firstOfMonthIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}-01`;
}

function currentMonthIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}`;
}

/*
 * ⚠️ `isInMonth` und der Aufruf von `imFenster` sind am 06.08.2026 entfallen.
 *
 * Beide filterten HIER, nachdem der Server die 90 neuesten Abschlüsse
 * geliefert hatte. Genau das war der Befund: ein Monat von vor einem halben
 * Jahr kam in diesen 90 gar nicht vor, und der Filter konnte nur wegwerfen,
 * was schon da war. Die Auswahl gehört an die EINE Stelle, die alle Zeilen
 * sieht — die Datenbank.
 *
 * `imFenster` selbst bleibt in `nachschau-lauf.ts` bestehen; es hat dort
 * eigene Prüfungen und wird vom Berichtssatz gebraucht.
 */

/** Feste Kennung der Entsperr-Fehlmeldung, damit der Erfolg sie zuruecknehmen kann. */
const UNLOCK_TOAST_ID = 'compliance-unlock-fehlgeschlagen';

const isStepUpCancel = (err: unknown): boolean =>
  err instanceof ApiError && err.code === 'STEP_UP_REQUIRED';

// ════════════════════════════════════════════════════════════════════════
// Hauptkomponente
// ════════════════════════════════════════════════════════════════════════

export function SteuerComplianceSection(): JSX.Element {
  const api = useApiClient();
  const addToast = useToastStore((s) => s.addToast);

  const dismissToast = useToastStore((s) => s.dismiss);

  const [unlocked, setUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  // Probe gegen das Gerätecode-Tor. Erfolg → Sektion öffnen.
  const tryUnlock = async (): Promise<void> => {
    setUnlocking(true);
    try {
      const res = await api.request<{ ok: boolean }>('GET', '/api/compliance/unlock');
      if (res?.ok === true) {
        setUnlocked(true);
        // ── DIE MELDUNG MUSS MIT DER LAGE VERSCHWINDEN (26.07.2026) ──────
        // An der laufenden Kasse gemessen: die Fläche war offen, alle
        // Exporte standen da — und daneben leuchtete weiter rot „Entsperren
        // fehlgeschlagen". Eine Alarmmeldung ist absichtlich klebrig; sie
        // wartet darauf, dass ein Mensch sie wegklickt. Nur wartet sie hier
        // auf etwas, das längst gelungen ist.
        //
        // Woher sie kam: die Probe feuert beim Betreten von selbst, der
        // Dialog geht auf, der erste Aufruf scheitert — und der zweite,
        // erfolgreiche räumte hinter sich nicht auf. Die Kasse behauptete
        // also einen Fehlschlag, während sie das Gelungene zeigte. Genau die
        // Sorte Widerspruch, die dieses Haus nirgends stehen lässt.
        dismissToast(UNLOCK_TOAST_ID);
      }
    } catch (err) {
      if (isStepUpCancel(err)) return; // Operator hat den PIN-Dialog abgebrochen → still.
      addToast({
        // Feste Kennung, damit der Erfolg GENAU diese Meldung zurücknehmen
        // kann und nicht blind alle.
        id: UNLOCK_TOAST_ID,
        tone: 'alert',
        title: 'Entsperren fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    } finally {
      setUnlocking(false);
    }
  };

  // Beim ersten Mount automatisch das Step-up anstoßen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: unlock probe must fire exactly once on mount.
  useEffect(() => {
    void tryUnlock();
  }, []);

  if (!unlocked) {
    return (
      <div
        style={{
          ...pad,
          // Die Sperr-Karte steht allein: eine Spalte, mittig — das
          // zweispaltige Karten-Raster aus `pad` gilt hier nicht.
          gridTemplateColumns: 'minmax(0, 1fr)',
          placeItems: 'center',
          minHeight: '60vh',
          maxWidth: '100%',
        }}
      >
        <div style={{ ...card, maxWidth: 460, textAlign: 'center', placeItems: 'center' }}>
          {/* Strich-Schloss statt 🔒 — das Emoji rendert auf Windows als
              buntes Segoe-Bild (Dekret „Symbole statt Emoji", 26.07.2026). */}
          <span aria-hidden="true" style={{ display: 'inline-flex', color: 'var(--w14-gold)' }}>
            <Icon icon={Lock} size={36} />
          </span>
          <h2 style={{ margin: 0, fontSize: 'var(--w14-schrift-titel)', fontWeight: 600, color: 'var(--w14-ink)' }}>
            Geschützter Bereich
          </h2>
          {/*
            ── DER TÜRSTEHER NANNTE DEN FALSCHEN AUSWEIS (26.07.2026) ────────
            Hier stand „nur mit Manager-PIN zugänglich". Zwei Dinge stimmten
            daran nicht, und beide fielen erst an der laufenden Kasse auf:

            • Geprüft wird der GERÄTECODE. Der Dialog dahinter heißt wörtlich
              „Gerätecode bestätigen · Derselbe Code wie beim Entsperren der
              Kasse" — nicht irgendein Manager-Kennwort.
            • Eine vierstellige Manager-PIN gibt es seit dem 26.07.2026 gar
              nicht mehr; die Anmeldung läuft über Google.

            Ein Kassierer, der das las, suchte nach einem Vorgesetzten oder
            nach einer Zahl, die es nicht gibt — vor der Tür zum Steuer-Export,
            an dem Tag, an dem der Prüfer im Laden steht.
          */}
          <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-text)' }}>
            Steuer-Export &amp; Compliance ist nur mit dem Gerätecode zugänglich, mit demselben,
            mit dem Sie die Kasse entsperren.
          </p>
          <Button variant="primary" size="md" disabled={unlocking} onClick={() => void tryUnlock()}>
            {unlocking ? 'Prüft…' : 'Entsperren'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={pad}>
      {/* gridColumn: die Überschrift überspannt das Karten-Raster voll. */}
      <div style={{ gridColumn: '1 / -1' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--w14-schrift-titel)', fontWeight: 600, color: 'var(--w14-ink)' }}>
          Steuer-Export &amp; Compliance
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-text)' }}>
          DATEV · DSFinV-K · TSE · GoBD. Alle Pflicht-Exporte auf Knopfdruck. Read-only, keine
          fiskalische Änderung.
        </p>
        <Zwischentitel style={{ margin: '14px 0 0' }} />
      </div>

      {/*
        ⚠️ GANZ OBEN, vor den Export-Knöpfen.

        Drei Angaben entscheiden, ob überhaupt ein Paket entsteht, und für
        keine gab es bis zum 02.08.2026 ein Eingabefeld. Der Prüferknopf war
        damit für einen Edelmetallhändler dauerhaft zu, und die Absage nannte
        einen Ort, den es nicht gab. Also steht die Frage VOR dem Knopf, nicht
        dahinter.
      */}
      <div style={{ gridColumn: '1 / -1' }}>
        <SteuerberaterSection />
      </div>

      <FinanzamtGroup api={api} addToast={addToast} />
      <KassenberichtGroup api={api} addToast={addToast} />
      <SteuerberaterGroup api={api} addToast={addToast} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// GRUPPE 1 — Für das Finanzamt · Kassen-Nachschau
// ════════════════════════════════════════════════════════════════════════

type ApiClientLike = ReturnType<typeof useApiClient>;
type AddToast = ReturnType<typeof useToastStore.getState>['addToast'];

function FinanzamtGroup({
  api,
  addToast,
}: {
  api: ApiClientLike;
  addToast: AddToast;
}): JSX.Element {
  const verfahrensdoku = useVerfahrensdokuPdf(api);
  const [von, setVon] = useState(firstOfMonthIso());
  const [bis, setBis] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [bericht, setBericht] = useState<Laufbericht | null>(null);
  const [fortschritt, setFortschritt] = useState('');

  /**
   * Ein Lauf über den Zeitraum, echt oder als Probe.
   *
   * ⚠️ Der Probelauf ruft DIESELBEN Wege und wirft nur die Bytes weg. Keine
   * Attrappe: was hier grün ist, ist am Prüfungstag grün, weil es derselbe
   * Weg war. Ein Probelauf gegen eine Nachbildung wäre ein Versprechen, das
   * niemand geprüft hat.
   */
  const lauf = async (speichern: boolean): Promise<void> => {
    setBusy(true);
    setBericht(null);
    setFortschritt('');
    try {
      /**
       * ⚠️ DER ZEITRAUM GEHT AN DEN SERVER, NICHT AN EINEN FILTER HIER
       *
       * Bis zum 06.08.2026 holte diese Fläche `closingsApi.list(api)` ohne
       * Zeitraum. Der Server lieferte die 90 NEUESTEN, und hier wurde daraus
       * gefiltert. Ein Laden mit täglichem Geschäft hatte damit nach
       * dreieinhalb Monaten jeden älteren Tag verloren — und die Kasse sagte
       * dem Prüfer, es gebe ihn nicht.
       *
       * `limit: 500` deckt anderthalb Jahre täglichen Geschäfts; `gesamt`
       * sagt, ob doch noch etwas dahinterliegt, und dann steht es auch da.
       */
      const antwort = await closingsApi.list(api, { from: von, to: bis, limit: 500 });
      const tage = antwort.items
        .filter((c) => c.state === 'FINALIZED')
        .sort((a, b) => a.businessDay.localeCompare(b.businessDay))
        .map((c) => ({ id: c.id, tag: c.businessDay }));

      if (tage.length === 0) {
        // Und die Meldung sagt nur noch das, was die Kasse WEISS.
        addToast({
          tone: 'alert',
          title:
            antwort.gesamt === 0
              ? 'Keine Kassentage in diesem Zeitraum'
              : 'Keine ABGESCHLOSSENEN Kassentage in diesem Zeitraum',
          body:
            antwort.gesamt === 0
              ? 'In diesem Zeitraum wurde an dieser Kasse nichts gebucht.'
              : `${antwort.gesamt} Tag${antwort.gesamt === 1 ? '' : 'e'} liegen vor, aber keiner ist abgeschlossen. Ein Tag zählt erst mit dem Tagesabschluss.`,
        });
        return;
      }

      if (antwort.weitere) {
        addToast({
          tone: 'alert',
          title: 'Der Zeitraum ist grösser als eine Seite',
          body: `${antwort.gesamt} Kassentage im Zeitraum, geholt wurden ${antwort.items.length}. Bitte den Zeitraum verkleinern, damit nichts fehlt.`,
        });
        return;
      }

      const ergebnis = await laufeUeberTage(
        tage,
        async (t) => {
          const base64 = await closingsApi.dsfinvkZipBase64(api, t.id);
          // ⚠️ Der Probelauf prüft die Antwort, statt sie nur entgegenzunehmen:
          // ein leeres Paket wäre sonst ein grüner Tag ohne Inhalt.
          if (base64.trim() === '') throw new Error('Das Paket kam leer zurück.');
          if (speichern) downloadBase64File(`DSFinV-K_${t.tag}.zip`, base64);
        },
        (fehler) => {
          if (isStepUpCancel(fehler)) return 'Die Freigabe wurde abgebrochen.';
          if (fehler instanceof ApiError) return describeError(fehler);
          return fehler instanceof Error ? fehler.message : 'Unbekannter Fehler.';
        },
        (fertig, gesamt, tag) => setFortschritt(`${tag} · ${fertig} von ${gesamt}`),
      );

      setBericht(ergebnis);
      addToast({
        tone: ergebnis.gescheitert === 0 ? 'success' : 'alert',
        title:
          ergebnis.gescheitert === 0
            ? speichern
              ? 'Export vollständig'
              : 'Probelauf bestanden'
            : 'Der Datenträger hat Lücken',
        body: ergebnis.satz,
      });
    } catch (err) {
      // Nur noch, was VOR dem Tageslauf schiefgehen kann: die Liste selbst.
      if (isStepUpCancel(err)) return;
      addToast({
        tone: 'alert',
        title: 'Die Liste der Kassentage kam nicht',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    } finally {
      setBusy(false);
      setFortschritt('');
    }
  };

  /**
   * ⚠️ Bis zum 08.08.2026 lud dieser Knopf eine ins Programm gebackene
   * Textdatei herunter, die ein FREMDES Erzeugnis beschrieb: elfmal
   * „warehouse14", nullmal Norns, Stand 08.06.2026, dazu Docker und
   * Cloudflare — eine Anlage, die es in dieser Kasse nicht gibt.
   *
   * Jetzt: Befund aus der laufenden Anlage holen, im Programm selbst als
   * PDF setzen. Fehlende Angaben sperren NICHT; sie stehen im Dokument
   * sichtbar als offen.
   */
  const downloadVerfahrensdoku = async (): Promise<void> => {
    try {
      const { bytes, befund } = await verfahrensdoku.erzeugen();
      downloadBytesFile('Verfahrensdokumentation.pdf', bytes, 'application/pdf');
      addToast({
        tone: befund.vollstaendig ? 'success' : 'warn',
        title: 'Verfahrensdokumentation',
        body: befund.vollstaendig
          ? `Verfahrensdokumentation.pdf erzeugt, Stand ${zeitpunktText(befund.erzeugtAm)}.`
          : befund.offeneAngaben.length === 1
            ? 'Verfahrensdokumentation.pdf erzeugt. Eine Angabe ist noch offen und steht im Dokument als offen.'
            : `Verfahrensdokumentation.pdf erzeugt. ${befund.offeneAngaben.length} Angaben sind noch offen und stehen im Dokument als offen.`,
      });
    } catch {
      addToast({
        tone: 'alert',
        title: 'Verfahrensdokumentation',
        body: verfahrensdoku.fehler ?? 'Das Dokument konnte nicht erzeugt werden.',
      });
    }
  };

  return (
    <GroupCard
      title="Für das Finanzamt · Kassen-Nachschau"
      subtitle="DSFinV-K (Z3-Zugriff nach §146b AO), TSE-Archiv und die GoBD-Verfahrensdokumentation."
    >
      {/* DSFinV-K (Z3) — Von/Bis, ein ZIP je Kassentag. */}
      <div style={rowCard}>
        <div style={rowHead}>
          <span style={rowTitle}>DSFinV-K Export (Z3-Zugriff)</span>
          <span style={rowHint}>
            DSFinV-K ist tagesgenau. Pro Kassentag wird ein ZIP geladen (Prüftool-konform).
          </span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--w14-abstand-12)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <DateField label="Von" value={von} onChange={setVon} />
          <DateField label="Bis" value={bis} onChange={setBis} />
          <Button variant="ghost" size="md" disabled={busy} onClick={() => void lauf(false)}>
            {busy ? 'Läuft' : 'Probelauf, ohne zu speichern'}
          </Button>
          <Button variant="primary" size="md" disabled={busy} onClick={() => void lauf(true)}>
            {busy ? 'Lädt' : 'DSFinV-K herunterladen'}
          </Button>
        </div>
        {fortschritt === '' ? null : (
          <span style={{ ...rowHint, marginTop: 'var(--w14-abstand-8)' }}>{fortschritt}</span>
        )}
        {bericht === null ? null : (
          <div
            style={{
              marginTop: 'var(--w14-abstand-12)',
              border: `1px solid ${bericht.gescheitert === 0 ? 'var(--w14-gold-deep)' : 'var(--w14-danger)'}`,
              borderRadius: 'var(--w14-radius-fein)',
              padding: 'var(--w14-abstand-12)',
              fontSize: 'var(--w14-schrift-zeile)',
              color: 'var(--w14-ink)',
            }}
          >
            {bericht.satz}
          </div>
        )}
      </div>

      {/* TSE-Archiv — ehrlicher Status, KEIN Fake-Download. */}
      <div style={rowCard}>
        <div style={rowHead}>
          <span style={rowTitle}>TSE-Archiv (TAR-Export)</span>
          <span style={rowHint}>
            Wird im nächtlichen TSE-Lauf archiviert · Abruf nach Aktivierung der TSE-Archivierung.
          </span>
        </div>
        <Button
          variant="ghost"
          size="md"
          disabled
          title="Die TSE-Archivablage ist in dieser Umgebung noch nicht eingerichtet."
        >
          Noch nicht verfügbar
        </Button>
      </div>

      {/* Verfahrensdokumentation (GoBD-Pflicht). */}
      <div style={rowCard}>
        <div style={rowHead}>
          <span style={rowTitle}>Verfahrensdokumentation herunterladen</span>
          <span style={rowHint}>
            Nach Rz. 151 GoBD. Wird beim Abruf aus der laufenden Anlage erzeugt und trägt
            deren Stand, nicht den eines gepflegten Textes.
          </span>
        </div>
        <Button
          variant="ghost"
          size="md"
          onClick={() => void downloadVerfahrensdoku()}
          disabled={verfahrensdoku.laeuft}
        >
          {verfahrensdoku.laeuft ? 'Wird erzeugt …' : 'Als PDF erzeugen'}
        </Button>
      </div>
    </GroupCard>
  );
}

// ════════════════════════════════════════════════════════════════════════
// GRUPPE 2 — Tagesabschlüsse · Kassenbericht
// ════════════════════════════════════════════════════════════════════════

function KassenberichtGroup({
  api,
  addToast,
}: {
  api: ApiClientLike;
  addToast: AddToast;
}): JSX.Element {
  const [tag, setTag] = useState(todayIso());
  const [busy, setBusy] = useState(false);

  const exportKassenbericht = async (): Promise<void> => {
    setBusy(true);
    try {
      // ⚠️ Hier stand `closingsApi.list(api)` OHNE Zeitraum. Der Server gibt
      // dann die 90 NEUESTEN Geschäftstage her (`closing-export.ts`, Vorgabe
      // von `limit`, `ORDER BY business_day DESC`). Für jeden Kassentag davor
      // fand `find` nichts — und die Kasse sagte über einen VORHANDENEN
      // Pflichtbeleg wörtlich, es gebe ihn nicht. § 147 Abs. 3 AO verlangt
      // zehn Jahre. Der gewählte Tag geht deshalb als Zeitraum an den Server.
      const { items } = await closingsApi.list(api, { from: tag, to: tag, limit: 1 });
      const closing: ClosingListItem | undefined = items.find(
        (c) => c.businessDay === tag && c.state === 'FINALIZED',
      );
      if (!closing) {
        addToast({
          tone: 'alert',
          title: 'Für diesen Tag liegt kein abgeschlossener Kassenbericht vor.',
        });
        return;
      }
      const csv = await closingsApi.kassenberichtCsv(api, closing.id);
      downloadTextFile(`Kassenbericht_${closing.businessDay}.csv`, csv);
      addToast({
        tone: 'success',
        title: 'Kassenbericht',
        body: `Kassenbericht_${closing.businessDay}.csv heruntergeladen.`,
      });
    } catch (err) {
      if (isStepUpCancel(err)) return;
      addToast({
        tone: 'alert',
        title: 'Export fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <GroupCard
      title="Tagesabschlüsse · Kassenbericht"
      subtitle="Der Z-Bon eines abgeschlossenen Kassentages als CSV."
    >
      <div style={rowCard}>
        <div style={rowHead}>
          <span style={rowTitle}>Kassenbericht (Z-Bon) herunterladen</span>
          <span style={rowHint}>Thermodruck über Tagesabschluss an der Kasse.</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--w14-abstand-12)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <DateField label="Tag" value={tag} onChange={setTag} />
          <Button
            variant="primary"
            size="md"
            disabled={busy}
            onClick={() => void exportKassenbericht()}
          >
            {busy ? 'Lädt…' : 'Kassenbericht herunterladen'}
          </Button>
        </div>
      </div>
    </GroupCard>
  );
}

// ════════════════════════════════════════════════════════════════════════
// GRUPPE 3 — Für den Steuerberater
// ════════════════════════════════════════════════════════════════════════

function SteuerberaterGroup({
  api,
  addToast,
}: {
  api: ApiClientLike;
  addToast: AddToast;
}): JSX.Element {
  const [month, setMonth] = useState(currentMonthIso());
  const [busy, setBusy] = useState(false);
  // ── DIE SACKGASSE, DIE HIER BIS ZUM 26.07.2026 STAND ────────────────────
  // Fehlten Berater- und Mandantennummer, bekam der Händler eine rote Meldung
  // und sonst nichts: der Knopf sagte ihm, was fehlt, aber nirgends auf dieser
  // Fläche konnte er es eintragen. Seit Wanderung 0117 ist das kein
  // Ausnahmefall mehr, sondern der ERSTE DATEV-Abruf JEDES neuen Ladens — die
  // zwei Zahlen gehören dem Händler, nicht dem Erzeugnis, und stehen deshalb
  // in keiner Wanderung mehr.
  //
  // Erkannt wird der Fall am FEHLERCODE `DATEV_MANDANT_FEHLT`, nie am Text der
  // Meldung: ein Textvergleich hätte still aufgehört zu greifen, sobald jemand
  // ein Wort am Satz ändert.
  const [einrichtungOffen, setEinrichtungOffen] = useState(false);
  // Ein Rahmen für den GANZEN Monat. Ein Stapel, dessen Tage teils in SKR03
  // und teils in SKR04 gezogen wurden, wäre für den Berater unbrauchbar.
  const rahmen = useKontenrahmenWahl();

  const exportDatev = async (): Promise<void> => {
    setBusy(true);
    try {
      const gewaehlt = rahmenParameter(rahmen.wahl);
      // ⚠️ Derselbe Befund wie oben: ohne Zeitraum kamen die 90 NEUESTEN, und
      // ein Monat von vor einem halben Jahr war damit unerreichbar. Der Monat
      // geht jetzt an den Server. `${month}-01` bis `${month}-31` deckt jeden
      // Monat; Postgres vergleicht Daten, nicht Zeichenketten, und ein 31. im
      // Februar schliesst schlicht nichts zusätzlich ein.
      const antwort = await closingsApi.list(api, {
        from: `${month}-01`,
        to: `${month}-31`,
        limit: 500,
      });
      const days = antwort.items
        .filter((c) => c.state === 'FINALIZED')
        .sort((a, b) => a.businessDay.localeCompare(b.businessDay));

      if (days.length === 0) {
        addToast({
          tone: 'alert',
          title:
            antwort.gesamt === 0
              ? 'Keine Kassentage in diesem Monat'
              : 'Keine ABGESCHLOSSENEN Kassentage in diesem Monat',
          body:
            antwort.gesamt === 0
              ? 'In diesem Monat wurde an dieser Kasse nichts gebucht.'
              : `${antwort.gesamt} Tag${antwort.gesamt === 1 ? '' : 'e'} liegen vor, aber keiner ist abgeschlossen.`,
        });
        return;
      }

      let done = 0;
      for (const c of days) {
        // Der Dateiname kommt vom SERVER. Er muss mit `EXTF_` beginnen und
        // Berater- und Mandantennummer tragen, sonst zeigt DATEV die Datei
        // gar nicht erst an. Hier stand bis zum 26.07.2026 ein selbst
        // gebauter Name, einer von fünf im Haus.
        // Der Rahmen geht als Parameter mit; ist `gewaehlt` leer, entscheidet
        // die gespeicherte Einstellung auf dem Server.
        const { inhalt, dateiname } = await closingsApi.datevDatei(api, c.id, gewaehlt);
        // Bytes, nicht Text: `inhalt` ist der rohe Windows-1252-Stapel.
        downloadBytesFile(dateiname ?? `EXTF_Buchungsstapel_${c.businessDay}.csv`, inhalt);
        done += 1;
        addToast({
          tone: 'success',
          title: `DATEV ${done}/${days.length}`,
          body: `${c.businessDay} heruntergeladen.`,
        });
      }
      // Der Weg ist gegangen — eine noch offene Einrichtung hat sich erledigt.
      setEinrichtungOffen(false);
    } catch (err) {
      if (isStepUpCancel(err)) return;
      // Kein Fehler, sondern eine offene Einrichtung: statt einer roten
      // Meldung erscheint an dieser Stelle das Formular. Der Server prüft die
      // Mandantenangaben, BEVOR er eine Zeile schreibt, also ist an dieser
      // Stelle noch keine Datei gefallen.
      if (err instanceof ApiError && err.code === 'DATEV_MANDANT_FEHLT') {
        setEinrichtungOffen(true);
        return;
      }
      addToast({
        tone: 'alert',
        title: 'Export fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <GroupCard
      title="Für den Steuerberater"
      subtitle="Der Buchungsstapel des Monats im DATEV-EXTF-Format."
    >
      <div style={rowCard}>
        <div style={rowHead}>
          <span style={rowTitle}>DATEV-Export (Buchungsstapel)</span>
          {/* Hier stand bis zum 26.07.2026 fest „SKR03-Buchungsstapel". Der
              Rahmen ist seither wählbar, also darf die Zeile ihn nicht mehr
              behaupten — sie nennt nur noch, was unabhängig davon gilt. */}
          <span style={rowHint}>Buchungsstapel im EXTF-Format. Eine CSV je Kassentag.</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--w14-abstand-12)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
            <span style={fieldLabel}>Monat</span>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              style={dateInput}
            />
          </label>
          <KontenrahmenWahl
            stand={rahmen}
            disabled={busy}
            hinweisZeigen={false}
            id="datev-kontenrahmen-monat"
          />
          <Button variant="primary" size="md" disabled={busy} onClick={() => void exportDatev()}>
            {busy ? 'Lädt…' : 'DATEV herunterladen'}
          </Button>
        </div>

        {/* Die Einrichtung sitzt UNTER dem Knopf, der sie ausgelöst hat — der
            Händler soll den Blick nicht wechseln müssen. Nach dem Speichern
            läuft der Export von selbst weiter; er wollte eine Datei, nicht
            ein Formular. */}
        <DatevMandantEinrichtung
          offen={einrichtungOffen}
          onAbbrechen={() => setEinrichtungOffen(false)}
          onGespeichert={() => {
            setEinrichtungOffen(false);
            void exportDatev();
          }}
        />

        <p style={{ ...rowHint, margin: 0, maxWidth: '62ch', lineHeight: 1.5 }}>
          {rahmen.wahl === ''
            ? (rahmen.ungelesenGrund ??
              `Der Export nutzt den gespeicherten Rahmen ${rahmen.gespeichert ?? ''}.`.trim())
            : `Dieser Monat wird in ${rahmen.wahl} gezogen. Die gespeicherte Einstellung bleibt unverändert.`}{' '}
          Die einzelnen Kontonummern liegen in den Einstellungen unter DATEV.
        </p>
      </div>
    </GroupCard>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Bausteine + Styles
// ════════════════════════════════════════════════════════════════════════

function GroupCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={card}>
      <div>
        <h3
          className="w14-smallcaps"
          style={{
            margin: 0,
            fontSize: 'var(--w14-schrift-zeile)',
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: 'var(--w14-gold)',
            fontWeight: 700,
          }}
        >
          {title}
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-faded)' }}>
          {subtitle}
        </p>
      </div>
      {children}
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <label style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
      <span style={fieldLabel}>{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={dateInput}
      />
    </label>
  );
}

// Breitbild (26.07.2026): gleiche Karten-Fließregel wie in Einstellungen.tsx —
// die drei Export-Gruppen fließen zweispaltig, sobald zwei Spalten à 520
// Punkte Platz haben, sonst wie bisher untereinander.
const pad: React.CSSProperties = {
  padding: 'var(--w14-abstand-24)',
  display: 'grid',
  gap: 'var(--w14-abstand-16)',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))',
  alignContent: 'start',
  maxWidth: 1400,
};
const card: React.CSSProperties = {
  background: 'var(--w14-parchment-2)',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-card)',
  padding: 'var(--w14-abstand-20)',
  display: 'grid',
  gap: 'var(--w14-abstand-16)',
  boxShadow: 'var(--w14-shadow-card)',
};
const rowCard: React.CSSProperties = {
  display: 'grid',
  gap: 'var(--w14-abstand-12)',
  padding: 'var(--w14-abstand-14)',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment)',
};
const rowHead: React.CSSProperties = { display: 'grid', gap: 'var(--w14-abstand-2)' };
const rowTitle: React.CSSProperties = {
  fontSize: 'var(--w14-schrift-betont)',
  fontWeight: 600,
  color: 'var(--w14-ink)',
};
const rowHint: React.CSSProperties = { fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' };
const fieldLabel: React.CSSProperties = {
  fontSize: 'var(--w14-schrift-zeile)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
};
const dateInput: React.CSSProperties = {
  padding: 'var(--w14-abstand-8) var(--w14-abstand-10)',
  border: '1px solid var(--w14-feldlinie)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink)',
  fontSize: 'var(--w14-schrift-betont)',
  fontFamily: 'var(--w14-font-mono)',
};

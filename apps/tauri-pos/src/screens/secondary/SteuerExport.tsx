/**
 * Steuer-Export — Tier-2 surface where the Inhaber (ADMIN) and the Steuerberater
 * (READONLY) list the daily closings and DOWNLOAD the required tax exports on
 * demand: DATEV (EXTF Buchungsstapel) + Kassenbericht (KassenSichV cash report).
 *
 * No facade: every figure + export is the REAL fiscal data from the server
 * (`GET /api/closings*`). Downloads are ADMIN/READONLY + step-up (server-
 * enforced; the api-client interceptor handles the 403 → PIN → retry). GoBD:
 * read-only — nothing here mutates a fiscal row.
 *
 * DATEV-DATEINAME (Befund vom 11.08.2026): diese Fläche ERFAND den Namen der
 * DATEV-Datei (Wort DATEV plus Datum) und warf den Namen weg, den der Server
 * im Kopf `content-disposition` mitschickt. Der naheliegende, sprechende Name
 * ist falsch: bei DATEV ist der Name Teil des Vertrags, er muss mit `EXTF_`
 * beginnen und Berater- und Mandantennummer tragen, sonst zeigt die
 * Stapelverarbeitung des Beraters die Datei GAR NICHT AN (REW04506). Nur der
 * Server kennt diese Nummern. Der Downloadweg nimmt darum den Namen aus dem
 * Antwortkopf (`closingsApi.datevDatei`); nur wenn der Kopf fehlt, greift ein
 * Rückfall, der das `EXTF`-Schema achtet. Der Wächter
 * `src/datev-dateiname-waechter.test.ts` misst genau diesen Gebrauch.
 *
 * DIE 90-TAGE-WAND (Befund vom 13.08.2026): diese Fläche holte die Abschlüsse
 * mit `closingsApi.list(api)` OHNE Zeitraum. Der Server liefert dann die 90
 * NEUESTEN Geschäftstage — und weil diese Liste die einzige Stelle ist, die
 * eine Abschluss-`id` hergibt, war ab dem 91. Tag jeder ältere Kassentag über
 * DATEV, Kassenbericht und DSFinV-K unerreichbar. Die Kasse behauptete damit
 * für einen VORHANDENEN Pflichtbeleg, es gebe ihn nicht. § 147 AO verlangt zehn
 * Jahre Aufbewahrung; eine Fläche, die nur ein Vierteljahr kennt, ist eine Wand
 * vor den Büchern. Der Zeitraum geht jetzt an den Server (Jahreswahl plus
 * Von/Bis), und die Fläche nennt immer die GESAMTZAHL der Kassentage im
 * Zeitraum — eine stille Obergrenze wäre dieselbe Wand mit besserer Tarnung.
 * Der Wächter `src/steuer-export-zeitraum-waechter.test.ts` misst das.
 *
 * DSFinV-K (der Finanzamt-Standard für Kassendaten) is available two ways: the
 * nightly worker still pushes the day's summary to Fiskaly, AND — new — a local
 * DSFinV-K bundle (the DFKA-Taxonomie core CSV files + index.xml, packed as a
 * ZIP) can be downloaded per day right here, for a §146b Kassen-Nachschau. It is
 * a faithful CORE export, not a certified one — validate it against the official
 * DSFinV-K Prüftool before a real inspection (see dsfinvk-export.ts). The full
 * GDPdU/GoBD .dtd Betriebsprüfungs-bundle remains a separate, larger format.
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { ApiError, type ClosingListItem, closingsApi, expensesApi } from '@norns/api-client';
import {
  Button,
  Zwischentitel,
  Download,
  Field,
  Icon,
  Input,
  MoneyAmount,
  ParchmentCard,
  Seal,
  Select,
  ShieldCheck,
  TriangleAlert,
} from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useVerfahrensdokuPdf } from '../../hooks/useVerfahrensdokuPdf.js';
import { baueUebergabeschreiben } from '../../lib/steuerberater-fragen.js';
import {
  downloadBase64File,
  downloadBytesFile,
  downloadTextFile,
} from '../../lib/download-file.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@norns/i18n-de';
import { DatevMandantEinrichtung } from './DatevMandantEinrichtung.js';
import { KontenrahmenWahl, rahmenParameter, useKontenrahmenWahl } from './KontenrahmenWahl.js';

type ExportKind = 'datev' | 'kassenbericht' | 'dsfinvk';

// ────────────────────────────────────────────────────────────────────────────
// ZEITRAUM — die Auswahl gehört an den Server, nicht an einen Filter hier
// ────────────────────────────────────────────────────────────────────────────

/**
 * Wie viele Zeilen der Server auf EINER Seite höchstens hergibt
 * (`apps/api-cloud/src/routes/closing-export.ts`, `limit` maximum 500).
 *
 * ⚠️ Diese Zahl ist keine stille Obergrenze: ein volles Jahr hat höchstens
 * 366 Kassentage und passt darum immer ganz auf eine Seite. Wählt jemand von
 * Hand einen längeren Zeitraum, sagt die Fläche ihm die GESAMTZAHL und dass
 * er den Zeitraum verkleinern muss — sie tut nicht so, als wäre die Seite
 * alles, was es gibt.
 */
export const SEITENGROESSE = 500;

/** Wie viele Jahre die Aufbewahrungspflicht umfasst (§ 147 Abs. 3 AO). */
export const AUFBEWAHRUNGSJAHRE = 10;

/**
 * Die Jahre der Aufbewahrungsfrist, neuestes zuerst.
 *
 * Die Liste behauptet NICHT, dass zu jedem Jahr Kassentage vorliegen — sie
 * sagt nur, wie weit die Pflicht reicht. Was wirklich da ist, sagt `gesamt`.
 */
export function aufbewahrungsJahre(heute: Date = new Date()): number[] {
  const jetzt = heute.getFullYear();
  return Array.from({ length: AUFBEWAHRUNGSJAHRE }, (_, i) => jetzt - i);
}

/** Erster Tag des Jahres als `JJJJ-MM-TT`. */
export function jahresAnfang(jahr: number): string {
  return `${jahr}-01-01`;
}

/** Letzter Tag des Jahres als `JJJJ-MM-TT`. */
export function jahresEnde(jahr: number): string {
  return `${jahr}-12-31`;
}

/**
 * Deckt der Zeitraum GENAU ein Kalenderjahr ab? Dann zeigt die Jahreswahl
 * dieses Jahr, sonst „Freier Zeitraum". Abgeleitet statt zweitgespeichert:
 * ein zweiter Zustand neben Von/Bis könnte von ihnen abdriften und dem
 * Händler ein Jahr anzeigen, das gar nicht abgefragt wird.
 */
export function jahrDesZeitraums(von: string, bis: string): string {
  const treffer = /^(\d{4})-01-01$/.exec(von);
  const jahr = treffer?.[1];
  if (jahr !== undefined && bis === jahresEnde(Number(jahr))) return jahr;
  return '';
}

/** Ein Zeitraum trägt nur, wenn beide Tage stehen und nicht verdreht sind. */
export function zeitraumTraegt(von: string, bis: string): boolean {
  return von !== '' && bis !== '' && von <= bis;
}

export function SteuerExport(): JSX.Element {
  const api = useApiClient();
  const role = useSessionStore((s) => s.actor?.role);
  const addToast = useToastStore((s) => s.addToast);
  const canAccess = role === 'ADMIN' || role === 'READONLY';

  // Busy key = `${closingId}:${kind}` while a download is in flight.
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // ── DIE EINRICHTUNG SITZT IN DER ZEILE, DIE SIE AUSGELÖST HAT (26.07.2026) ─
  // Fehlen Berater- und Mandantennummer, ist das seit Wanderung 0117 kein
  // Fehler mehr, sondern der ERSTE DATEV-Abruf eines Ladens: die zwei Zahlen
  // gehören dem Händler und stehen in keiner Wanderung. Statt einer roten
  // Meldung öffnet sich hier das Formular — und zwar in derselben Zeile, damit
  // der Blick nicht springt.
  //
  // Erkannt am FEHLERCODE, nie am Meldungstext.
  const [einrichtungFuer, setEinrichtungFuer] = useState<string | null>(null);

  // Die Wahl des Kontenrahmens gilt für ALLE Zeilen dieser Liste — ein Rahmen
  // je Sitzung, nicht je Tag. Ein Buchungsstapel, dessen Tage in verschiedenen
  // Rahmen gezogen wurden, wäre für den Steuerberater unbrauchbar.
  const rahmen = useKontenrahmenWahl();

  // ── DER ZEITRAUM GEHT AN DEN SERVER (13.08.2026) ─────────────────────────
  // Hier stand `closingsApi.list(api)` ohne Zeitraum. Der Server liefert dann
  // die 90 NEUESTEN Tage, und weil nur diese Liste eine Abschluss-`id`
  // hergibt, war ab dem 91. Tag jeder ältere Pflichtbeleg unerreichbar — die
  // Kasse sagte dem Prüfer, den Tag gebe es nicht. Vorgabe ist das laufende
  // Jahr; über die Jahreswahl steht jedes Jahr der Aufbewahrungsfrist offen.
  const jetzigesJahr = new Date().getFullYear();
  const [von, setVon] = useState(() => jahresAnfang(jetzigesJahr));
  const [bis, setBis] = useState(() => jahresEnde(jetzigesJahr));

  const jahre = useMemo(() => aufbewahrungsJahre(), []);
  const gewaehltesJahr = jahrDesZeitraums(von, bis);
  const zeitraumGueltig = zeitraumTraegt(von, bis);

  // ── DER EINE KNOPF DER KASSENNACHSCHAU (18.08.2026) ──────────────────────
  //
  // Basels Anweisung: „du drueckst einen Knopf, die Datei kommt heraus, die
  // der Pruefer braucht." Der Knopf setzt zuerst die Verfahrensdokumentation
  // im Rumpf (typst), reicht sie dem Motor, und der packt sie mit allen
  // Tages-ZIPs des Zeitraums, dem Pruefbericht (Kette + Cent-Summen) und
  // LIESMICH in EIN ZIP. Scheitert nur das PDF, entsteht das Paket trotzdem;
  // LIESMICH benennt die Luecke, und der Hinweis hier sagt es auch.
  const verfahrensdoku = useVerfahrensdokuPdf(api);
  const [paketLaeuft, setPaketLaeuft] = useState(false);

  const prueferPaketZiehen = async (): Promise<void> => {
    setPaketLaeuft(true);
    try {
      let pdfBase64: string | undefined;
      try {
        const { bytes } = await verfahrensdoku.erzeugen();
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        pdfBase64 = btoa(bin);
      } catch {
        pdfBase64 = undefined; // Paket ohne PDF, LIESMICH sagt es.
      }
      const paket = await closingsApi.prueferPaket(api, {
        von,
        bis,
        ...(pdfBase64 ? { verfahrensdokuPdfBase64: pdfBase64 } : {}),
      });
      downloadBase64File(paket.dateiname, paket.zipBase64);
      addToast({
        tone: paket.ketteUnversehrt ? 'success' : 'alert',
        title: 'Prüferpaket',
        body: paket.ketteUnversehrt
          ? `${paket.dateiname} mit ${paket.tage} Tag${paket.tage === 1 ? '' : 'en'} erstellt. Prüfsummenkette soeben geprüft, unversehrt.${pdfBase64 ? '' : ' Ohne Verfahrensdokumentation, siehe LIESMICH im Paket.'}`
          : `${paket.dateiname} erstellt, ABER die Prüfsummenkette meldet einen Bruch. Einzelheiten im PRUEFBERICHT im Paket.`,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') return;
      addToast({
        tone: 'alert',
        title: 'Prüferpaket',
        body: err instanceof ApiError ? describeError(err) : 'Das Paket konnte nicht erstellt werden.',
      });
    } finally {
      setPaketLaeuft(false);
    }
  };

  // ── Das Übergabeschreiben an die Kanzlei (18.08.2026) ────────────────────
  // Ein Griff neben den Exporten: der fertige deutsche Begleittext für die
  // Mail an den Steuerberater, mit Zeitraum, Anzahl der Tage und Rahmen.
  const schreibenKopieren = async (anzahlTage: number): Promise<void> => {
    const text = baueUebergabeschreiben({
      // Der Name des Hauses steht am Beleg; hier genügt die neutrale
      // Selbstbezeichnung, die Kanzlei kennt ihren Mandanten.
      firma: 'unser Kassenbetrieb',
      von,
      bis,
      tage: anzahlTage,
      kontenrahmen: rahmenParameter(rahmen.wahl) ?? null,
    });
    try {
      await navigator.clipboard.writeText(text);
      addToast({
        tone: 'success',
        title: 'Übergabeschreiben',
        body: 'Der Begleittext für die Kanzlei liegt in der Zwischenablage.',
      });
    } catch {
      addToast({
        tone: 'alert',
        title: 'Übergabeschreiben',
        body: 'Die Zwischenablage ist nicht erreichbar.',
      });
    }
  };

  // ── Fremdbelege: unbare Ausgaben als eigener DATEV-Stapel (18.08.2026) ──
  const [fremdbelegeLaufen, setFremdbelegeLaufen] = useState(false);
  const fremdbelegeZiehen = async (): Promise<void> => {
    setFremdbelegeLaufen(true);
    try {
      const { inhalt, dateiname } = await expensesApi.datevDatei(
        api,
        von,
        bis,
        rahmenParameter(rahmen.wahl),
      );
      const name = dateiname ?? `EXTF_Buchungsstapel_Fremdbelege_${von}_${bis}.csv`;
      downloadBytesFile(name, inhalt);
      addToast({ tone: 'success', title: 'Fremdbelege', body: `${name} heruntergeladen.` });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') return;
      addToast({
        tone: 'alert',
        title: 'Fremdbelege',
        body: err instanceof ApiError ? describeError(err) : 'Die Datei konnte nicht erzeugt werden.',
      });
    } finally {
      setFremdbelegeLaufen(false);
    }
  };

  const closingsQ = useQuery({
    // Der Zeitraum gehört in den Schlüssel, sonst zeigte die Fläche nach einem
    // Jahreswechsel weiter die Zeilen des vorigen Zeitraums.
    queryKey: ['closings', 'list', von, bis],
    queryFn: () => closingsApi.list(api, { from: von, to: bis, limit: SEITENGROESSE }),
    enabled: canAccess && zeitraumGueltig,
    staleTime: 30_000,
  });

  const download = async (closing: ClosingListItem, kind: ExportKind): Promise<void> => {
    const key = `${closing.id}:${kind}`;
    setBusyKey(key);
    try {
      if (kind === 'dsfinvk') {
        const base64 = await closingsApi.dsfinvkZipBase64(api, closing.id);
        const filename = `DSFinV-K_${closing.businessDay}.zip`;
        downloadBase64File(filename, base64);
        addToast({
          tone: 'success',
          title: 'Export bereit',
          body: `${filename} heruntergeladen.`,
        });
        return;
      }
      const gewaehlt = rahmenParameter(rahmen.wahl);
      if (kind === 'datev') {
        // Inhalt UND Name in einem Griff. Der Server sendet den Namen im
        // Kopf `content-disposition`, gebaut nach dem DATEV-Schema aus
        // Beraternummer, Mandantennummer und Zeitraum — nur er kennt diese
        // Nummern, keine Oberfläche darf sie erfinden. Fehlt der Kopf wider
        // Erwarten, achtet der Rückfall das `EXTF`-Schema und trägt den
        // gewählten Rahmen, damit ein SKR04-Stapel im Download-Ordner nie
        // still einen SKR03-Stapel gleichen Namens überschreibt.
        //
        // BYTES auf die Platte (Windows-1252 vom Server), niemals Text.
        const { inhalt, dateiname } = await closingsApi.datevDatei(api, closing.id, gewaehlt);
        const name =
          dateiname ??
          `EXTF_Buchungsstapel_${gewaehlt ? `${gewaehlt}_` : ''}${closing.businessDay}.csv`;
        downloadBytesFile(name, inhalt);
        addToast({
          tone: 'success',
          title: 'Export bereit',
          body: `${name} heruntergeladen.`,
        });
        return;
      }
      // Der Kassenbericht ist echter UTF-8-Text und hat kein Namensschema
      // vom Rang eines Vertrags — sein Name bleibt hier benannt.
      const csv = await closingsApi.kassenberichtCsv(api, closing.id);
      const name = `Kassenbericht_${closing.businessDay}.csv`;
      downloadTextFile(name, csv);
      addToast({
        tone: 'success',
        title: 'Export bereit',
        body: `${name} heruntergeladen.`,
      });
    } catch (err) {
      // Operator cancelled the PIN step-up → silent.
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') return;
      if (err instanceof ApiError && err.code === 'DATEV_MANDANT_FEHLT') {
        // Nur der Inhaber darf die Angaben schreiben (`PATCH
        // /api/settings/datev/:key` verlangt ADMIN). Dem Steuerberater ein
        // Formular hinzustellen, das ihm der Server danach mit 403 abweist,
        // wäre ein leeres Versprechen — er bekommt stattdessen den Satz, der
        // ihm wirklich weiterhilft.
        if (role === 'ADMIN') {
          setEinrichtungFuer(closing.id);
          return;
        }
        addToast({
          tone: 'alert',
          title: 'DATEV ist noch nicht eingerichtet',
          body:
            'Beraternummer und Mandantennummer fehlen. Eintragen kann sie nur der Inhaber, ' +
            'bitte kurz Bescheid geben; danach steht der Export bereit.',
        });
        return;
      }
      addToast({
        tone: 'alert',
        title: 'Export fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    } finally {
      setBusyKey(null);
    }
  };

  if (!canAccess) {
    return (
      <CenterWrap>
        <ParchmentCard padding="lg" style={{ width: 'min(460px, 100%)', textAlign: 'center' }}>
          <Seal size="md" tone="faded" label="§" />
          <h2 style={{ ...HEADING, margin: '14px 0 6px' }}>Steuer-Export</h2>
          <p style={{ color: 'var(--w14-ink-faded)', margin: 0 }}>
            Nur für Inhaber und Steuerberater. Bitte mit einem berechtigten Konto anmelden.
          </p>
        </ParchmentCard>
      </CenterWrap>
    );
  }

  const antwort = closingsQ.data;
  const items = antwort?.items ?? [];
  // `gesamt` ist die volle Trefferzahl des Zeitraums, auch was nicht auf die
  // Seite passt. Ohne sie könnte die Fläche „steht nicht auf dieser Seite"
  // nicht von „gibt es nicht" unterscheiden — und genau diese Verwechslung war
  // der Befund.
  const gesamt = antwort?.gesamt ?? 0;

  const waehleJahr = (jahr: string): void => {
    if (jahr === '') return;
    setVon(jahresAnfang(Number(jahr)));
    setBis(jahresEnde(Number(jahr)));
  };

  return (
    <section
      aria-label="Steuer-Export"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--w14-abstand-24)',
        gap: 'var(--w14-abstand-16)',
        overflowY: 'auto',
      }}
    >
      <header>
        <h1 style={HEADING}>Steuer-Export</h1>
        <p style={{ margin: '4px 0 0', color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-betont)' }}>
          Tagesabschlüsse für Finanzamt und Steuerberater. DATEV und Kassenbericht auf Knopfdruck.
        </p>
      </header>

      {/* ── DER EINE SATZ AN DEN HÄNDLER (20.08.2026) ────────────────────
          Basels Anweisung, sinngemäss: die DATEV-Kontonummern kennt kein
          Händler, und keiner ruft dafür vorher seinen Berater an. Die Kasse
          liefert deshalb ab Werk brauchbare Vorgaben — und sagt in EINEM
          Satz, dass der Berater einmal darüberschauen soll. Kein Formular,
          keine Belehrung, kein Riegel. */}
      <p
        style={{
          margin: 'var(--w14-abstand-12) 0 0',
          padding: 'var(--w14-abstand-10) var(--w14-abstand-12)',
          borderRadius: 'var(--w14-radius-button)',
          background: 'rgb(var(--w14-gilt-rgb) / 0.10)',
          color: 'var(--w14-ink-aged)',
          fontSize: 'var(--w14-schrift-feld)',
          lineHeight: 1.55,
          textWrap: 'pretty',
        }}
      >
        Die Ausfuhr läuft mit den üblichen Vorgaben. Bitte lassen Sie sie einmal von
        Ihrem Steuerberater ansehen, damit die Konten zu seiner Buchführung passen —
        ändern lässt sich alles unter Einstellungen, Steuer und Buchhaltung.
      </p>

      <Zwischentitel />

      {/* Die Wahl des ZEITRAUMS. Sie entscheidet, welche Kassentage der Server
          überhaupt herausgibt — ohne sie kämen nur die 90 neuesten. */}
      <ParchmentCard padding="md">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--w14-abstand-12)',
            alignItems: 'flex-start',
          }}
        >
          <div style={{ minWidth: 180 }}>
            <Field label="Jahr" hint="Zehn Jahre Aufbewahrungspflicht, § 147 AO.">
              <Select
                value={gewaehltesJahr}
                disabled={busyKey !== null}
                onChange={(e) => waehleJahr(e.target.value)}
              >
                {/* Nur sichtbar, solange Von/Bis kein volles Jahr abdecken —
                    sonst stünde ein Eintrag da, der nichts auswählt. */}
                {gewaehltesJahr === '' ? <option value="">Freier Zeitraum</option> : null}
                {jahre.map((j) => (
                  <option key={j} value={String(j)}>
                    {j}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div style={{ minWidth: 180 }}>
            <Field label="Von">
              <Input
                type="date"
                value={von}
                disabled={busyKey !== null}
                onChange={(e) => setVon(e.target.value)}
              />
            </Field>
          </div>
          <div style={{ minWidth: 180 }}>
            <Field label="Bis">
              <Input
                type="date"
                value={bis}
                disabled={busyKey !== null}
                onChange={(e) => setBis(e.target.value)}
              />
            </Field>
          </div>
        </div>

        {zeitraumGueltig ? (
          <p
            style={{
              margin: 'var(--w14-abstand-10) 0 0',
              fontSize: 'var(--w14-schrift-zeile)',
              color: 'var(--w14-ink-faded)',
            }}
          >
            {antwort === undefined
              ? 'Jeder Tag der Aufbewahrungsfrist ist über die Jahreswahl erreichbar.'
              : gesamt === 0
                ? 'In diesem Zeitraum liegt kein Kassentag vor.'
                : gesamt === 1
                  ? 'Ein Kassentag in diesem Zeitraum.'
                  : `${gesamt} Kassentage in diesem Zeitraum.`}
          </p>
        ) : (
          <p
            role="alert"
            style={{
              margin: 'var(--w14-abstand-10) 0 0',
              fontSize: 'var(--w14-schrift-zeile)',
              color: 'var(--w14-wax-red)',
            }}
          >
            Der Tag unter „Von" liegt nach dem Tag unter „Bis". Bitte die beiden Daten tauschen
            oder oben ein Jahr wählen, dann lädt die Liste sofort.
          </p>
        )}
      </ParchmentCard>

      {/* ── Kassennachschau: EIN Griff fuer den ganzen Zeitraum ─────────── */}
      <ParchmentCard padding="md">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--w14-abstand-12)',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ maxWidth: '58ch' }}>
            <h2 style={{ margin: 0, fontSize: 'var(--w14-schrift-betont)', color: 'var(--w14-ink)' }}>
              Kassennachschau, ein Griff
            </h2>
            <p style={{ margin: '4px 0 0', color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-feld)', lineHeight: 1.55 }}>
              Ein ZIP für den Prüfer: alle Tagespakete des gewählten Zeitraums,
              die Verfahrensdokumentation, ein Prüfbericht mit soeben geprüfter
              Prüfsummenkette und Cent-genauen Tagessummen, dazu ein Verzeichnis,
              das ehrlich sagt, was fehlt und warum.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--w14-abstand-10)', flexWrap: 'wrap' }}>
            <Button
              variant="primary"
              disabled={paketLaeuft || busyKey !== null || !zeitraumGueltig}
              onClick={() => void prueferPaketZiehen()}
            >
              {paketLaeuft ? 'Wird gepackt …' : 'Prüferpaket erzeugen'}
            </Button>
            <Button
              variant="ghost"
              disabled={fremdbelegeLaufen || !zeitraumGueltig}
              title="Per Bank oder Karte bezahlte Ausgaben des Zeitraums als eigener DATEV-Buchungsstapel. Bar bezahlte stehen im Stapel ihres Kassentages."
              onClick={() => void fremdbelegeZiehen()}
            >
              {fremdbelegeLaufen ? 'Wird erzeugt …' : 'Fremdbelege (DATEV)'}
            </Button>
            <Button
              variant="ghost"
              disabled={!zeitraumGueltig}
              title="Fertiger deutscher Begleittext für die Mail an die Kanzlei, in die Zwischenablage."
              onClick={() => void schreibenKopieren(closingsQ.data?.items.length ?? 0)}
            >
              Übergabeschreiben kopieren
            </Button>
          </div>
        </div>
      </ParchmentCard>

      {/* Die Wahl des Kontenrahmens. Gilt für jeden DATEV-Knopf dieser Liste. */}
      <ParchmentCard padding="md">
        <KontenrahmenWahl stand={rahmen} disabled={busyKey !== null} />
      </ParchmentCard>

      {/* DSFinV-K + GDPdU standing — honest about the local-bundle scope. */}
      <ParchmentCard padding="md" tone="deep">
        <p
          style={{ margin: 0, fontSize: 'var(--w14-schrift-text)', color: 'var(--w14-ink-aged)', lineHeight: 1.5 }}
        >
          <strong>DSFinV-K</strong> (der Finanzamt-Standard für Kassendaten) lässt sich pro Tag
          direkt als ZIP-Paket herunterladen. Es enthält die DFKA-Taxonomie-Kerndateien (Belege, Positionen,
          USt, Zahlungen, TSE) plus index.xml, für eine Kassen-Nachschau nach §146b AO. Es ist ein
          getreuer <strong>Kern-Export</strong>, kein zertifizierter: vor einer echten Prüfung bitte
          mit dem amtlichen DSFinV-K-Prüftool und dem Steuerberater abgleichen. Zusätzlich
          übermittelt der Nachtlauf weiterhin die Tageszusammenfassung an Fiskaly. Der vollständige{' '}
          <strong>GDPdU/GoBD-Datenträger</strong> für eine Betriebsprüfung ist ein separates Format
          und folgt später.
        </p>
      </ParchmentCard>

      {/* ⚠️ EINE SEITE IST NICHT DER ZEITRAUM. Passt nicht alles auf eine
          Seite, sagt die Fläche die Gesamtzahl UND was hilft — sie zeigt
          niemals still einen Ausschnitt, als wäre er alles. */}
      {antwort?.weitere === true ? (
        <ParchmentCard padding="md">
          <p
            role="alert"
            style={{ margin: 0, color: 'var(--w14-wax-red)', fontSize: 'var(--w14-schrift-text)' }}
          >
            {`Dieser Zeitraum hat ${gesamt} Kassentage; hier stehen die ${items.length} neuesten davon. ` +
              'Bitte oben ein einzelnes Jahr wählen oder den Zeitraum verkleinern, dann ist jeder Tag dabei.'}
          </p>
        </ParchmentCard>
      ) : null}

      {!zeitraumGueltig ? null : closingsQ.isLoading ? (
        <p style={{ color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>Lädt Abschlüsse…</p>
      ) : closingsQ.isError ? (
        <p role="alert" style={{ color: 'var(--w14-wax-red)' }}>
          Abschlüsse konnten nicht geladen werden.
        </p>
      ) : items.length === 0 ? (
        <ParchmentCard padding="md" style={{ textAlign: 'center' }}>
          {/* ⚠️ Hier stand „Noch keine Tagesabschlüsse vorhanden." Das war eine
              Aussage über die GANZE Kasse, gemessen an einem Ausschnitt. Der
              Satz gilt jetzt nur für den gewählten Zeitraum und nennt den Weg
              zu den übrigen Jahren. */}
          <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>
            In diesem Zeitraum liegt kein Kassentag vor. Über die Jahreswahl oben stehen alle zehn
            Jahre der Aufbewahrungsfrist offen.
          </p>
        </ParchmentCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-10)' }}>
          {items.map((c) => (
            <ClosingRow
              key={c.id}
              closing={c}
              busyKey={busyKey}
              datevTitel={
                rahmen.wahl === ''
                  ? `DATEV EXTF · Buchungsstapel${rahmen.gespeichert != null ? ` · ${rahmen.gespeichert}` : ''}`
                  : `DATEV EXTF · Buchungsstapel · ${rahmen.wahl}`
              }
              onDownload={(kind) => void download(c, kind)}
              einrichtung={
                <DatevMandantEinrichtung
                  offen={einrichtungFuer === c.id}
                  onAbbrechen={() => setEinrichtungFuer(null)}
                  onGespeichert={() => {
                    setEinrichtungFuer(null);
                    // Der Händler wollte eine Datei, kein Formular — der
                    // Export nimmt von selbst wieder auf.
                    void download(c, 'datev');
                  }}
                />
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ClosingRow({
  closing,
  busyKey,
  datevTitel,
  onDownload,
  einrichtung,
}: {
  closing: ClosingListItem;
  busyKey: string | null;
  /** Der Aufhänger-Text des DATEV-Knopfes, mit dem Rahmen, sofern bekannt. */
  datevTitel: string;
  onDownload: (kind: ExportKind) => void;
  /** Das DATEV-Einrichtungsformular. Zeigt sich nur, wenn diese Zeile es auslöste. */
  einrichtung?: React.ReactNode;
}): JSX.Element {
  /**
   * ⚠️ 08.08.2026: hier stand `closing.tseFailedCount === 0`, und das war auf
   * JEDER Zeile wahr — der Motor schreibt die Zahl als feste Null. Ein Tag
   * mit zwölf unsignierten Belegen trug ein grünes „alles signiert", während
   * `tse_pending_count = 12` in derselben Datenbankzeile stand.
   *
   * Gezählt wird jetzt, was der Prüfer zählt: jeder Beleg ohne Signatur.
   */
  const ohneSignatur = closing.tseFailedCount + closing.tsePendingCount;
  const tseClean = ohneSignatur === 0;
  const datevBusy = busyKey === `${closing.id}:datev`;
  const kassenBusy = busyKey === `${closing.id}:kassenbericht`;
  const dsfinvkBusy = busyKey === `${closing.id}:dsfinvk`;
  const anyBusy = busyKey !== null;

  return (
    <ParchmentCard padding="md">
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--w14-abstand-14)',
        }}
      >
        {/* Day + state */}
        <div style={{ minWidth: 150 }}>
          <div
            className="w14-tabular"
            style={{ fontFamily: 'var(--w14-font-mono)', fontWeight: 600, fontSize: 'var(--w14-schrift-grund)' }}
          >
            {closing.businessDay}
          </div>
          <span
            className="w14-smallcaps"
            style={{
              fontSize: 'var(--w14-schrift-zeile)',
              letterSpacing: '0.06em',
              color:
                closing.state === 'FINALIZED' ? 'var(--w14-verdigris)' : 'var(--w14-ink-faded)',
            }}
          >
            {closing.state === 'FINALIZED' ? 'abgeschlossen' : 'in Zählung'}
          </span>
        </div>

        {/* Net totals */}
        <div style={{ display: 'flex', gap: 'var(--w14-abstand-16)' }}>
          <Figure label="Verkauf netto" value={closing.netVerkaufEur} />
          <Figure label="Ankauf netto" value={closing.netAnkaufEur} />
        </div>

        {/* TSE health */}
        <div
          title={tseClean ? 'Alle Belege TSE-signiert' : `${ohneSignatur} ohne Signatur`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--w14-abstand-6)',
            color: tseClean ? 'var(--w14-verdigris)' : 'var(--w14-wax-red)',
            fontSize: 'var(--w14-schrift-feld)',
          }}
        >
          <Icon icon={tseClean ? ShieldCheck : TriangleAlert} size={18} />
          {tseClean ? 'alles signiert' : `${ohneSignatur} ${ohneSignatur === 1 ? 'Lücke' : 'Lücken'}`}
        </div>

        {/* Downloads */}
        <div style={{ display: 'flex', gap: 'var(--w14-abstand-8)' }}>
          <Button
            variant="primary"
            size="md"
            iconLeft={<Icon icon={Download} size={16} />}
            disabled={anyBusy}
            onClick={() => onDownload('datev')}
            title={datevTitel}
            style={{ minHeight: 48 }}
          >
            {datevBusy ? 'lädt…' : 'DATEV'}
          </Button>
          <Button
            variant="primary"
            size="md"
            iconLeft={<Icon icon={Download} size={16} />}
            disabled={anyBusy}
            onClick={() => onDownload('kassenbericht')}
            title="Kassenbericht (KassenSichV) · CSV"
            style={{ minHeight: 48 }}
          >
            {kassenBusy ? 'lädt…' : 'Kassenbericht'}
          </Button>
          <Button
            variant="primary"
            size="md"
            iconLeft={<Icon icon={Download} size={16} />}
            disabled={anyBusy}
            onClick={() => onDownload('dsfinvk')}
            title="DSFinV-K · DFKA-Taxonomie Kassendaten (ZIP, Kern-Export)"
            style={{ minHeight: 48 }}
          >
            {dsfinvkBusy ? 'lädt…' : 'DSFinV-K'}
          </Button>
        </div>
      </div>
      {einrichtung !== undefined ? <div style={{ marginTop: 14 }}>{einrichtung}</div> : null}
    </ParchmentCard>
  );
}

function Figure({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span
        className="w14-smallcaps"
        style={{ fontSize: 'var(--w14-schrift-kuerzel)', letterSpacing: '0.06em', color: 'var(--w14-ink-faded)' }}
      >
        {label}
      </span>
      <MoneyAmount valueEur={value} />
    </div>
  );
}

function CenterWrap({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 'var(--w14-abstand-32)' }}>{children}</div>
  );
}

const HEADING = {
  margin: 0,
  fontFamily: 'var(--w14-font-display)',
  fontWeight: 500,
  fontSize: 'var(--w14-schrift-flaeche)',
} as const;

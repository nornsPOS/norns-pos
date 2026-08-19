/**
 * „Drucker erkennen" — eine Liste aller angeschlossenen Geräte, gleich welcher
 * Art, und ein Weg, jedes davon mit einem Griff zu übernehmen.
 *
 * ── WAS ES LÖST (Basel, 25.07.2026) ────────────────────────────────────────
 * Der Etikettendrucker hing per USB am Rechner und war in der Kasse trotzdem
 * nirgends zu sehen. Der Grund war nicht die Kasse: das Betriebssystem hatte
 * für das Gerät noch KEINE Warteschlange angelegt, und ohne Warteschlange
 * taucht es in keiner Auswahl auf.
 *
 * Diese Fläche zeigt beides nebeneinander — was eingerichtet ist und was nur
 * angeschlossen ist — und sagt bei jedem Gerät, WOFÜR es vermutlich da ist und
 * WARUM diese Vermutung gilt. Eine Vermutung ohne Begründung wäre am Tresen
 * wertlos.
 *
 * ── ZUM THEMA TREIBER ──────────────────────────────────────────────────────
 * Ein Beleg- oder Etikettendrucker braucht hier keinen. Die Kasse spricht
 * ESC/POS und ZPL selbst und schickt rohe Bytes; dafür genügt eine ROHE
 * Warteschlange, und die legt „Übernehmen" selbst an. Für einen A4-Bürodrucker
 * gilt das nicht — der erwartet PostScript oder PCL, und dafür ist das
 * Betriebssystem zuständig. Das steht auch so auf der Fläche.
 *
 * ── DER NACHTRAG VOM 26.07.2026: NICHT JEDER SPRICHT ───────────────────────
 * Der Satz oben stimmt für Zebra und für Epson. Für einen DYMO stimmt er
 * nicht: der hat GAR KEINE Druckersprache, sondern nimmt nur Rasterzeilen aus
 * seinem Treiber. Für ihn ist eine rohe Warteschlange die Sackgasse, und genau
 * darin steckte Basels Etikettendrucker.
 *
 * Diese Fläche wusste bereits aus der Geräteadresse, dass da ein DYMO hängt —
 * und warf das Wissen beim Übernehmen weg: geschrieben wurden Anschlussart und
 * Name, die Sprache blieb auf der Vorgabe ZPL. Also: übernommen, geprüft,
 * grün — und beim Drucken kam nichts. Jetzt steht die Sprache sichtbar auf der
 * Fläche, ist von Hand zu ändern und geht beim Übernehmen MIT.
 */

import { useCallback, useEffect, useState } from 'react';

import { Button, Zwischentitel, ParchmentCard } from '@norns/ui-kit';

import {
  type ErkannterDrucker,
  type LabelPrinterType,
  druckerErkennung,
  isRunningInTauri,
} from '../../lib/hardware-client.js';
import { diagnoseAlsZeile } from '../../lib/drucker-diagnose.js';
import { usbGeraete, type UsbGeraet } from '../../lib/hardware-client.js';
import { MARKE_KUERZEL } from '../../lib/marke.js';
import { useHardwareStore } from '../../state/hardware-store.js';
import { useToastStore } from '../../state/toast-store.js';

const ROLLE_WORT: Record<ErkannterDrucker['rolle'], string> = {
  BON: 'Bondrucker',
  ETIKETT: 'Etikettendrucker',
  A4: 'Bürodrucker',
  UNBEKANNT: 'Art unbekannt',
};

const VERBINDUNG_WORT: Record<string, string> = {
  usb: 'USB',
  netzwerk: 'Netzwerk',
  andere: 'anderer Anschluss',
};

/** Wie die Sprachen am Tresen heissen. Kein Fachwort ohne Erklärung. */
const SPRACHE_WORT: Record<LabelPrinterType, string> = {
  ZPL: 'ZPL (Zebra und Verwandte)',
  ESCPOS: 'ESC/POS (Bonreihe)',
  RASTER: 'Rasterbild über den Systemtreiber',
};

/**
 * Die Sprachen, die die Kasse HEUTE dauerhaft merken kann.
 *
 * ── DIE DRITTE SPRACHE, 02.08.2026 GESCHLOSSEN ────────────────────────────
 * Hier stand eine Weiche: die erkannte Rastersprache wurde NICHT gespeichert,
 * weil `hardware-store.ts` sie nicht kannte und ihr Schema beim nächsten Start
 * die ganze Etiketten-Einstellung verworfen hätte. Der Händler bekam eine
 * höfliche Meldung, die Warteschlange stand richtig, die Kasse meldete Erfolg
 * — und der DYMO blieb auf ZPL stehen und damit stumm.
 *
 * Das Schema kennt jetzt alle drei Sprachen (`rastersprache-ist-speicherbar`),
 * der Gerätemanager bietet die dritte an, und die Weiche ist ersatzlos weg.
 * Was gespeichert wird, ist ab hier das, was erkannt wurde.
 */
/** Ein Vorschlag für den Namen der Warteschlange, aus Hersteller und Modell. */
function namensvorschlag(d: ErkannterDrucker): string {
  const kern = `${d.hersteller}-${d.modell}`.trim().replace(/\s+/g, '-');
  // ⚠️ 01.08.2026: hier stand `W14-`. Der Name landet als echte Warteschlange
  // IM BETRIEBSSYSTEM des Händlers, also sichtbar in seiner Druckerliste. Nur
  // ein Vorschlag für NEUE Warteschlangen; bestehende benennt niemand um.
  return `${MARKE_KUERZEL}-${kern}`.slice(0, 40);
}

export function DruckerErkennen(): JSX.Element {
  const [liste, setListe] = useState<ErkannterDrucker[] | null>(null);
  const [sucht, setSucht] = useState(false);
  const [arbeitetAn, setArbeitetAn] = useState<string | null>(null);
  // Was der Mensch von Hand gewählt hat, je Gerät. Leer heisst: die Erkennung
  // gilt. Eine Vermutung, die sich nicht überstimmen lässt, ist eine Behauptung.
  const [sprachwahl, setSprachwahl] = useState<Record<string, LabelPrinterType>>({});
  // ⚠️ ZWEITE QUELLE, 02.08.2026. Bis heute fragte diese Fläche NUR das
  // Drucksystem. Das kennt aber nur, was schon eine Warteschlange hat, und
  // schweigt ganz, wenn CUPS steht — die Kasse hielt das für „nichts
  // angeschlossen" und schickte den Händler ans Kabel.
  //
  // Der Bus schweigt nie. Er meldet Hersteller, Modell und Seriennummer aus
  // dem GERÄT, sobald es steckt, ohne Warteschlange und ohne Rechtefrage.
  // Auf dieser Maschine gemessen: die HP wurde ohne jeden Dialog gefunden.
  //
  // Er ERGÄNZT die Liste, er ersetzt sie nicht: gedruckt wird weiterhin über
  // CUPS bzw. den Windows-Spooler, denn ein USB-Drucker lässt sich auf Windows
  // gar nicht direkt öffnen — er gehört dort `usbprint.sys`.
  const [amBus, setAmBus] = useState<UsbGeraet[]>([]);
  const addToast = useToastStore((s) => s.addToast);
  const setThermal = useHardwareStore((s) => s.setThermal);
  const setLabel = useHardwareStore((s) => s.setLabel);
  const setA4 = useHardwareStore((s) => s.setA4);

  const suchen = useCallback(async (): Promise<void> => {
    if (!isRunningInTauri()) return;
    setSucht(true);
    try {
      // Der Bus zuerst, und sein Versagen darf die Suche nicht anhalten: er
      // ist die Ergänzung, das Drucksystem bleibt die Hauptquelle.
      try {
        setAmBus(await usbGeraete.drucker());
      } catch {
        setAmBus([]);
      }
      setListe(await druckerErkennung.alle());
    } catch (err) {
      // Ein Fehler beim Suchen ist NICHT „keine Drucker gefunden". Die Liste
      // bleibt null, damit die Fläche nicht das Gegenteil behauptet.
      addToast({
        tone: 'alert',
        title: 'Suche fehlgeschlagen',
        // ⚠️ 02.08.2026: hier stand `String(err)`. Der Rumpf lehnt aber nicht
        // mit einem `Error` ab, sondern mit `{ kind, details }`
        // (`src-tauri/src/error.rs:23`) — und `String({…})` ergibt wörtlich
        // „[object Object]". Genau das las der Händler über ein Gerät, das er
        // in der Hand hielt.
        body: diagnoseAlsZeile(err),
      });
    } finally {
      setSucht(false);
    }
  }, [addToast]);

  // ⚠️ 02.08.2026: der Ansteck-Beobachter. Bis heute musste ein Mensch
  // „Suchen" drücken; Basels Auftrag lautet aber, dass die Kasse ein Gerät
  // erkennt, SOBALD es steckt. Der Rumpf beobachtet den Bus (`usb_geraete.rs`)
  // und schickt bei einem DRUCKER ein Ereignis — bei einem Stick nicht, sonst
  // wäre der Hinweis nach einer Woche Rauschen.
  useEffect(() => {
    if (!isRunningInTauri()) return;
    let abbestellen: (() => void) | null = null;
    let abgemeldet = false;
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const stoppA = await listen('drucker-angesteckt', () => void suchen());
      const stoppB = await listen('drucker-abgesteckt', () => void suchen());
      // Wenn die Fläche schneller schliesst als die Anmeldung ankommt, sofort
      // wieder abmelden — sonst bliebe ein Horcher auf einer toten Fläche.
      if (abgemeldet) {
        stoppA();
        stoppB();
        return;
      }
      abbestellen = () => {
        stoppA();
        stoppB();
      };
    })();
    return () => {
      abgemeldet = true;
      abbestellen?.();
    };
  }, [suchen]);

  // Einmal beim Öffnen suchen: wer die Fläche aufruft, will die Liste sehen,
  // nicht erst einen Knopf finden.
  useEffect(() => {
    void suchen();
  }, [suchen]);

  /** Ein Gerät der Kasse zuweisen — und, wenn nötig, erst einrichten. */
  const uebernehmen = useCallback(
    async (d: ErkannterDrucker, als: 'BON' | 'ETIKETT' | 'A4'): Promise<void> => {
      setArbeitetAn(d.deviceUri);
      // Die Sprache entscheidet BEIDES: wie die Warteschlange angelegt wird und
      // was später aus ihr herauskommt. Deshalb wird sie hier einmal bestimmt
      // und dann durchgereicht, statt an zwei Stellen erneut geraten zu werden.
      const sprache = sprachwahl[d.deviceUri] ?? d.sprache;
      try {
        let queue = d.queue;
        if (!d.eingerichtet) {
          if (als === 'A4') {
            addToast({
              tone: 'info',
              title: 'Bürodrucker braucht das System',
              body: 'Ein A4-Drucker erwartet einen Herstellertreiber. Bitte einmal über die Systemeinstellungen hinzufügen; danach erscheint er hier als eingerichtet.',
            });
            return;
          }
          // Nur der Etikettenweg kennt Sprachen. Ein Bondrucker bleibt roh.
          queue = await druckerErkennung.warteschlangeAnlegen(
            d.deviceUri,
            namensvorschlag(d),
            als === 'ETIKETT' ? sprache : undefined,
          );
          addToast({
            tone: 'success',
            title: 'Warteschlange angelegt',
            body:
              als === 'ETIKETT' && sprache === 'RASTER'
                ? `${queue}: mit dem Treiber des Systems, denn dieses Gerät versteht keine Steuerbytes.`
                : `${queue}: roh, ohne Herstellertreiber. Die Kasse spricht das Gerät direkt an.`,
          });
        }

        if (als === 'BON') {
          setThermal({ mode: 'usb', printerName: queue, lastReachable: null, lastCheckedAt: null });
        } else if (als === 'ETIKETT') {
          setLabel({
            mode: 'system',
            printerName: queue,
            lastReachable: null,
            lastCheckedAt: null,
            // Die Sprache geht MIT — alle drei. Genau sie blieb bisher auf der
            // Vorgabe stehen, und damit war jeder DYMO stumm.
            printerType: sprache,
          });
        } else {
          setA4({ printerName: queue });
        }
        addToast({
          tone: 'success',
          title: `Als ${ROLLE_WORT[als]} übernommen`,
          body: `${d.hersteller} ${d.modell} → ${queue}. Jetzt einmal „Verbindung prüfen".`,
        });
        void suchen();
      } catch (err) {
        addToast({
          tone: 'alert',
          title: 'Übernehmen fehlgeschlagen',
          // Dieselbe Falle wie bei der Suche, und hier wiegt sie schwerer:
          // „Übernehmen" scheitert am häufigsten an fehlenden Rechten, und
          // genau dann braucht der Mensch den WEG, nicht das Wort „Forbidden".
          body: diagnoseAlsZeile(err),
        });
      } finally {
        setArbeitetAn(null);
      }
    },
    [addToast, setA4, setLabel, setThermal, suchen, sprachwahl],
  );

  if (!isRunningInTauri()) {
    return (
      <ParchmentCard padding="md">
        <Zwischentitel label="Angeschlossene Drucker" />
        <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-text)' }}>
          Die Druckererkennung läuft nur in der Kassen-Anwendung, nicht im Browser.
        </p>
      </ParchmentCard>
    );
  }

  return (
    <ParchmentCard padding="md">
      <Zwischentitel label="Angeschlossene Drucker" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-10)', marginBottom: 10 }}>
        <Button variant="ghost" size="sm" disabled={sucht} onClick={() => void suchen()}>
          {sucht ? 'Sucht …' : 'Erneut suchen'}
        </Button>
        <span style={{ fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-faded)' }}>
          Zeigt auch Geräte, die das System noch nicht eingerichtet hat.
        </span>
      </div>

      {liste === null ? (
        <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-text)' }}>
          {/* NICHT „keine Drucker": der Stand ist unbekannt, nicht leer. */}
          {sucht ? 'Wird gesucht …' : 'Der Stand ist gerade nicht bekannt. Bitte erneut suchen.'}
        </p>
      ) : liste.length === 0 ? (
        // ⚠️ Der Satz hing bis heute allein an der CUPS-Liste und schickte den
        // Händler ans Kabel, auch wenn das Gerät nachweislich steckte. Jetzt
        // entscheidet der BUS, was hier steht: er sieht das Gerät, sobald es
        // eingesteckt ist, unabhängig davon, ob das System es eingerichtet hat.
        <div style={{ display: 'grid', gap: 'var(--w14-abstand-8)' }}>
          {amBus.length === 0 ? (
            <p
              style={{
                margin: 0,
                color: 'var(--w14-ink-faded)',
                fontSize: 'var(--w14-schrift-text)',
              }}
            >
              Kein Drucker gefunden, auch nicht am USB-Anschluss. Gerät einschalten, Kabel prüfen,
              dann erneut suchen.
            </p>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 'var(--w14-schrift-text)' }}>
                {amBus.length === 1
                  ? 'Ein Drucker hängt am Rechner, aber das Betriebssystem hat ihn noch nicht eingerichtet:'
                  : `${amBus.length} Drucker hängen am Rechner, aber das Betriebssystem hat sie noch nicht eingerichtet:`}
              </p>
              {amBus.map((g) => (
                <p
                  key={`${g.herstellerId}-${g.produktId}-${g.seriennummer ?? ''}`}
                  style={{ margin: 0, fontSize: 'var(--w14-schrift-text)' }}
                >
                  <strong>
                    {[g.hersteller, g.modell].filter(Boolean).join(' ') || 'Unbekanntes Gerät'}
                  </strong>
                  {g.seriennummer !== null ? ` · Seriennummer ${g.seriennummer}` : ''}
                </p>
              ))}
              <p
                style={{
                  margin: 0,
                  color: 'var(--w14-ink-faded)',
                  fontSize: 'var(--w14-schrift-zeile)',
                }}
              >
                Diese Kasse kann Warteschlangen nur anlegen, wenn sie die Rechte dazu hat. Gelingt
                das nicht, den Drucker einmalig in den Systemeinstellungen hinzufügen; danach
                erscheint er oben in der Liste.
              </p>
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--w14-abstand-8)' }}>
          {liste.map((d) => (
            <div
              key={`${d.deviceUri}-${d.queue}`}
              style={{
                display: 'grid',
                gap: 'var(--w14-abstand-6)',
                padding: 'var(--w14-abstand-10) var(--w14-abstand-12)',
                borderRadius: 10,
                border: '1px solid var(--w14-rule)',
                background: d.eingerichtet
                  ? 'var(--w14-parchment-2)'
                  : // Noch nicht eingerichtet: eine Spur tiefer, damit der
                    // Unterschied ohne Lesen sichtbar ist.
                    'var(--w14-parchment-3)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--w14-abstand-8)', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 'var(--w14-schrift-betont)' }}>
                  {d.hersteller} {d.modell}
                </strong>
                <span
                  className="w14-smallcaps"
                  style={{
                    fontSize: 'var(--w14-schrift-kuerzel)',
                    letterSpacing: '0.08em',
                    padding: 'var(--w14-abstand-2) var(--w14-abstand-6)',
                    borderRadius: 'var(--w14-radius-pille)',
                    border: '1px solid var(--w14-rule)',
                    color: 'var(--w14-ink-faded)',
                  }}
                >
                  {ROLLE_WORT[d.rolle]}
                </span>
                <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
                  {VERBINDUNG_WORT[d.verbindung] ?? d.verbindung}
                  {d.eingerichtet ? ` · ${d.queue}` : ' · noch nicht eingerichtet'}
                </span>
              </div>

              <p style={{ margin: 0, fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
                {d.begruendung}
              </p>

              {/*
                * Die Sprache steht bei den Etikettendruckern SICHTBAR da und ist
                * zu ändern. Sie unsichtbar zu lassen war der Fehler: die
                * Erkennung wusste es, der Mensch davor nicht, und die falsche
                * Vorgabe blieb stehen.
                */}
              {d.rolle === 'ETIKETT' || d.rolle === 'UNBEKANNT' ? (
                <div style={{ display: 'grid', gap: 'var(--w14-abstand-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-8)', flexWrap: 'wrap' }}>
                    <label
                      htmlFor={`sprache-${d.deviceUri}`}
                      className="w14-smallcaps"
                      style={{ fontSize: 'var(--w14-schrift-kuerzel)', letterSpacing: '0.08em' }}
                    >
                      Etikettensprache
                    </label>
                    <select
                      id={`sprache-${d.deviceUri}`}
                      value={sprachwahl[d.deviceUri] ?? d.sprache}
                      onChange={(e) =>
                        setSprachwahl((v) => ({
                          ...v,
                          [d.deviceUri]: e.target.value as LabelPrinterType,
                        }))
                      }
                      style={{
                        fontSize: 'var(--w14-schrift-zeile)',
                        padding: 'var(--w14-abstand-2) var(--w14-abstand-6)',
                        borderRadius: 7,
                        border: '1px solid var(--w14-rule)',
                        background: 'var(--w14-parchment-1)',
                        color: 'var(--w14-ink)',
                      }}
                    >
                      {(['ZPL', 'ESCPOS', 'RASTER'] as const).map((s) => (
                        <option key={s} value={s}>
                          {SPRACHE_WORT[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p style={{ margin: 0, fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
                    {sprachwahl[d.deviceUri] === undefined
                      ? d.spracheGrund
                      : 'Von Hand gewählt, die Erkennung wird für dieses Gerät übergangen.'}
                  </p>
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 'var(--w14-abstand-6)', flexWrap: 'wrap' }}>
                {/*
                  * Die WAHRSCHEINLICHE Rolle steht vorn und ist hervorgehoben,
                  * die anderen bleiben erreichbar. Eine Erkennung, die nur eine
                  * Möglichkeit anbietet, zwingt bei jedem Irrtum zum Umweg.
                  */}
                {(['BON', 'ETIKETT', 'A4'] as const)
                  .slice()
                  .sort((a, b) => (a === d.rolle ? -1 : b === d.rolle ? 1 : 0))
                  .map((als) => (
                    <Button
                      key={als}
                      size="sm"
                      variant={als === d.rolle ? 'primary' : 'ghost'}
                      disabled={arbeitetAn !== null}
                      onClick={() => void uebernehmen(d, als)}
                    >
                      {arbeitetAn === d.deviceUri
                        ? 'Moment …'
                        : `Als ${ROLLE_WORT[als]} übernehmen`}
                    </Button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </ParchmentCard>
  );
}

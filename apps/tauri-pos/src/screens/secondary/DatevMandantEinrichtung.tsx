/**
 * Die zwei Ordnungsnummern — erfragt an der Stelle, an der sie gebraucht
 * werden.
 *
 * ── WARUM DIESE FLÄCHE ÜBERHAUPT EXISTIERT (26.07.2026) ────────────────────
 * Norns ist ein Softwarehaus, Warehouse14 ist der erste Kunde. Der zweite
 * Laden hat einen anderen Steuerberater, eine andere Beraternummer, eine
 * andere Mandantennummer. Wanderung 0117 hat deshalb beide Zahlen aus der
 * Bausubstanz entfernt: sie gehören dem Händler, nicht dem Erzeugnis.
 *
 * Seither FEHLEN sie bei jedem neuen Laden, bis er sie einträgt. Das ist ab
 * jetzt der HAUPTWEG, nicht der Ausnahmefall — und ein Hauptweg darf sich
 * nicht wie ein Fehler anfühlen. Bis heute bekam der Händler an dieser Stelle
 * eine rote Meldung und stand vor einer Sackgasse: der Knopf, den er gerade
 * gedrückt hatte, sagte ihm, was fehlt, aber nirgends konnte er es eintragen.
 *
 * ── DIE DREI FESTLEGUNGEN, DIE DIESE DATEI UMSETZT ─────────────────────────
 *   1. GEFRAGT WIRD BEIM ERSTEN EXPORT, AN ORT UND STELLE. Nicht beim Anlegen
 *      des Kontos: dort hat der Händler die Zahlen meist noch gar nicht, er
 *      muss erst seinen Berater fragen. Wer DATEV nie benutzt, wird nie
 *      gefragt.
 *   2. ERKANNT WIRD AM FEHLERCODE, NICHT AM TEXT. Der Aufrufer prüft
 *      `err.code === 'DATEV_MANDANT_FEHLT'`. Ein Vergleich auf den
 *      Meldungstext hätte still aufgehört zu greifen, sobald jemand ein Wort
 *      am Satz ändert — und niemand hätte es gemerkt.
 *   3. NACH DEM SPEICHERN LÄUFT DER EXPORT VON SELBST WEITER. Der Händler
 *      soll nicht zweimal denselben Knopf suchen; er wollte eine Datei, nicht
 *      ein Formular.
 *
 * ── GEPRÜFT WIRD SCHON IM FELD ─────────────────────────────────────────────
 * Beraternummer: vier bis sieben Ziffern. Mandantennummer: eine bis fünf
 * Ziffern, mindestens 1. Beide Regeln spiegeln `pruefeDatevEinstellung` in
 * `apps/api-cloud/src/lib/kontenrahmen.ts` — der Server bleibt die Wahrheit,
 * aber wer sich vertippt, soll es VOR dem Speichern erfahren und nicht nach
 * einer Zweitbestätigung.
 *
 * ── TASTBEDIENUNG ──────────────────────────────────────────────────────────
 * Dieselbe Oberfläche wird später eine iPad-App. Darum: Ziele über 44 Punkten,
 * Zifferntastatur auf beiden Feldern, sichtbarer Fokus, und nichts, das nur
 * beim Zeigen mit der Maus erscheint — jede Auskunft steht als Text auf der
 * Fläche, keine in einem `title`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';

import { ApiError, settingsDatevApi } from '@norns/api-client';
import { describeError } from '@norns/i18n-de';
import { Button, Field, Input, Select } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
// Die zwei Regeln liegen als reine Logik in `lib/`, damit der Prüflauf sie
// wirklich fährt — und damit ein Wächter sie gegen den ECHTEN Serverquelltext
// halten kann. In der `.tsx` wären sie ungeprüft und würden still driften.
import {
  pruefeAuswahlGetroffen,
  pruefeBeraternummer,
  pruefeMandantennummer,
  pruefeSachkontenlaenge,
  pruefeWirtschaftsjahrBeginn,
} from '../../lib/datev-mandant-pruefung.js';

/** Die zwei Schlüssel, die dem Händler gehören. Wörtlich wie in `system_settings`. */
const SCHLUESSEL_BERATER = 'datev.beraternummer';
const SCHLUESSEL_MANDANT = 'datev.mandantennummer';

/**
 * Derselbe Abfrageschlüssel wie in `KontenrahmenWahl.tsx`.
 *
 * Nicht aus Sparsamkeit: beide Flächen lesen dieselbe Antwort, und nach dem
 * Speichern muss AUCH die Rahmenwahl den neuen Stand sehen. Zwei getrennte
 * Schlüssel hätten bedeutet, dass eine der beiden weiter den alten Stand
 * zeigt — die Sorte Widerspruch, die man erst bemerkt, wenn man ihr nicht
 * mehr glaubt.
 */
const ABFRAGE = ['settings', 'datev', 'rahmen'] as const;

export interface DatevMandantEinrichtungProps {
  /** Sichtbar, sobald ein Export mit `DATEV_MANDANT_FEHLT` abgelehnt wurde. */
  offen: boolean;
  /** Der Händler bricht ab — die Fläche schliesst, nichts wurde geschrieben. */
  onAbbrechen: () => void;
  /**
   * Beide Zahlen stehen. Der Aufrufer nimmt den Export hier wieder auf; er
   * muss nicht erneut gedrückt werden.
   */
  onGespeichert: () => void;
}

export function DatevMandantEinrichtung({
  offen,
  onAbbrechen,
  onGespeichert,
}: DatevMandantEinrichtungProps): JSX.Element | null {
  const api = useApiClient();
  const qc = useQueryClient();
  const ueberschriftId = useId();

  const [berater, setBerater] = useState('');
  const [mandant, setMandant] = useState('');
  // `null` = noch nicht geprüft (der Händler tippt gerade zum ersten Mal).
  // Erst beim Verlassen des Feldes oder beim Speichern wird gemeckert.
  const [beraterFehler, setBeraterFehler] = useState<string | null>(null);
  const [mandantFehler, setMandantFehler] = useState<string | null>(null);
  const [speicherFehler, setSpeicherFehler] = useState<string | null>(null);
  /*
   * ── ⛔ 12.08.2026: VIER DER SECHS ANGABEN WAREN HIER EINE SACKGASSE ─────
   *
   * Diese Fläche zeigte fehlende weitere Angaben nur als Liste, mit dem Satz
   * „Sie werden in den Einstellungen unter DATEV eingetragen." Diesen Ort
   * gibt es in der Kasse NICHT — die volle Maske lebte allein in der
   * Inhaber-App auf Android. Ein Händler, der nur die Kasse hat, stand vor
   * einer Sperre, deren beschriebener Ausgang nicht existiert.
   *
   * Jetzt wird JEDE fehlende Angabe HIER erhoben. Beschriftung, Hinweis und
   * Art kommen vom Server (`MANDANT_FELDER` über `settingsDatevApi.lesen`),
   * erfunden wird nichts.
   */
  const [weitere, setWeitere] = useState<Record<string, string>>({});
  const [weitereFehler, setWeitereFehler] = useState<Record<string, string | null>>({});

  // Der gespeicherte Stand. Wir lesen ihn, um ein bereits eingetragenes Feld
  // vorzubelegen: fehlt nur EINE der beiden Zahlen, soll der Händler die
  // andere nicht noch einmal abtippen.
  const stand = useQuery({
    queryKey: ABFRAGE,
    queryFn: () => settingsDatevApi.lesen(api),
    retry: false,
    staleTime: 5 * 60_000,
    enabled: offen,
  });

  /** Der gespeicherte Wert eines Schlüssels, oder '' wenn keiner dasteht. */
  const gespeicherterWert = (schluessel: string): string =>
    stand.data?.mandant.find((m) => m.schluessel === schluessel)?.wert ?? '';

  // Vorbelegen, sobald der Stand da ist — aber nur einmal je Öffnen, damit die
  // Eingabe des Händlers nicht von einem nachlaufenden Lesen überschrieben
  // wird.
  const [vorbelegt, setVorbelegt] = useState(false);
  useEffect(() => {
    if (!offen) {
      setVorbelegt(false);
      return;
    }
    if (vorbelegt || stand.data == null) return;
    const feld = (schluessel: string): string =>
      stand.data.mandant.find((m) => m.schluessel === schluessel)?.wert ?? '';
    setBerater(feld(SCHLUESSEL_BERATER));
    setMandant(feld(SCHLUESSEL_MANDANT));
    const rest: Record<string, string> = {};
    for (const m of stand.data.mandant) {
      if (m.schluessel === SCHLUESSEL_BERATER || m.schluessel === SCHLUESSEL_MANDANT) continue;
      rest[m.schluessel] = m.wert ?? '';
    }
    setWeitere(rest);
    setVorbelegt(true);
  }, [offen, vorbelegt, stand.data]);

  const speichern = useMutation({
    mutationFn: async (werte: {
      berater: string;
      mandant: string;
      weitere: ReadonlyArray<readonly [string, string]>;
    }): Promise<void> => {
      // Nacheinander, nicht nebeneinander: die Route verlangt eine frische
      // Zweitbestätigung, und zwei gleichzeitige Aufrufe würden zwei Dialoge
      // übereinander öffnen.
      //
      // Geschrieben wird nur, was sich WIRKLICH geändert hat. Jeder Schreibweg
      // legt einen Eintrag ins Prüfprotokoll; „29098 geändert zu 29098" ist
      // kein Vorgang, sondern Rauschen in genau dem Protokoll, in dem später
      // jemand nach einem echten Vorgang sucht.
      if (werte.berater !== '' && werte.berater !== gespeicherterWert(SCHLUESSEL_BERATER)) {
        await settingsDatevApi.schreiben(api, SCHLUESSEL_BERATER, werte.berater);
      }
      if (werte.mandant !== '' && werte.mandant !== gespeicherterWert(SCHLUESSEL_MANDANT)) {
        await settingsDatevApi.schreiben(api, SCHLUESSEL_MANDANT, werte.mandant);
      }
      for (const [schluessel, wert] of werte.weitere) {
        if (wert !== '' && wert !== gespeicherterWert(schluessel)) {
          await settingsDatevApi.schreiben(api, schluessel, wert);
        }
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ABFRAGE });
      setSpeicherFehler(null);
      onGespeichert();
    },
    onError: (err: unknown) => {
      // Der Abbruch des Bestätigungsdialogs ist KEIN Fehlschlag — der Händler
      // hat sich anders entschieden. Eine rote Zeile dafür wäre eine Lüge.
      if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') return;
      setSpeicherFehler(describeError(err));
    },
  });

  if (!offen) return null;

  // ── DER CODE IST BREITER ALS DIESES FORMULAR (26.07.2026) ────────────────
  // `ladeDatevMandant` wirft `DATEV_MANDANT_FEHLT`, sobald IRGENDEINE der
  // sechs Kopfangaben fehlt — nicht nur eine der zwei Ordnungsnummern. In der
  // Praxis setzt Wanderung 0115 die vier mandantenneutralen Angaben, also kann
  // heute nur eines der zwei Felder hier fehlen. „In der Praxis" ist aber
  // genau die Annahme, an der dieses Haus schon gestanden hat: fiele eine der
  // vier weg, hätte dieses Formular gespeichert, der Export wäre erneut
  // abgelehnt worden, und der Händler stünde vor denselben zwei ausgefüllten
  // Feldern — eine Schleife, die nichts erklärt.
  //
  // Darum wird der gelesene Stand befragt, nicht geraten. Die Beschriftungen
  // der fehlenden Angaben kommen vom SERVER; erfunden wird hier keine.
  const fehlendeSchluessel = new Set(
    (stand.data?.mandant ?? []).filter((m) => m.herkunft === 'FEHLT').map((m) => m.schluessel),
  );
  // Konnten wir den Stand gar nicht lesen, zeigen wir die zwei Felder — das
  // ist der Fall, den der Server praktisch immer meint. Behauptet wird dabei
  // nichts über das, was gespeichert ist.
  const standUnbekannt = stand.data == null;
  const ordnungsnummernFehlen =
    standUnbekannt ||
    fehlendeSchluessel.has(SCHLUESSEL_BERATER) ||
    fehlendeSchluessel.has(SCHLUESSEL_MANDANT);
  const weitereFehlende = (stand.data?.mandant ?? []).filter(
    (m) =>
      m.herkunft === 'FEHLT' &&
      m.schluessel !== SCHLUESSEL_BERATER &&
      m.schluessel !== SCHLUESSEL_MANDANT,
  );

  /** Die Feldpruefung je Schluessel — dieselben Regeln wie der Server. */
  const pruefeWeiteresFeld = (schluessel: string, wert: string): string | null => {
    switch (schluessel) {
      case 'datev.wirtschaftsjahr_beginn':
        return pruefeWirtschaftsjahrBeginn(wert);
      case 'datev.sachkontenlaenge':
        return pruefeSachkontenlaenge(wert);
      case 'datev.festschreibung':
        return pruefeAuswahlGetroffen(wert, 'ja oder nein');
      case 'datev.sachkontenrahmen':
        return pruefeAuswahlGetroffen(wert, 'SKR03 oder SKR04');
      default:
        // Ein Schluessel, den diese Kasse nicht kennt: nichts erfinden. Der
        // Server prueft ohnehin; hier gilt nur „nicht leer".
        return wert.trim() === '' ? 'Bitte einen Wert eintragen.' : null;
    }
  };

  const absenden = (): void => {
    const b = ordnungsnummernFehlen ? pruefeBeraternummer(berater) : null;
    const m = ordnungsnummernFehlen ? pruefeMandantennummer(mandant) : null;
    setBeraterFehler(b);
    setMandantFehler(m);
    const fehlerNeu: Record<string, string | null> = {};
    let weitereKaputt = false;
    for (const feld of weitereFehlende) {
      const f = pruefeWeiteresFeld(feld.schluessel, weitere[feld.schluessel] ?? '');
      fehlerNeu[feld.schluessel] = f;
      if (f !== null) weitereKaputt = true;
    }
    setWeitereFehler(fehlerNeu);
    if (b !== null || m !== null || weitereKaputt) return;
    setSpeicherFehler(null);
    speichern.mutate({
      berater: ordnungsnummernFehlen ? berater.trim() : '',
      mandant: ordnungsnummernFehlen ? mandant.trim() : '',
      weitere: weitereFehlende.map(
        (f) => [f.schluessel, (weitere[f.schluessel] ?? '').trim()] as const,
      ),
    });
  };

  const busy = speichern.isPending;

  return (
    <section aria-labelledby={ueberschriftId} style={FLAECHE}>
      <div style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
        <h4 id={ueberschriftId} style={TITEL}>
          DATEV ist noch nicht eingerichtet
        </h4>
        {/* Die Zahl im Satz muss stimmen. Steht die Beraternummer schon und
            fehlt nur die Mandantennummer, ist „Zwei Zahlen fehlen" falsch —
            und der Händler sucht nach etwas, das längst da ist. */}
        <p style={UNTERTITEL}>
          {!ordnungsnummernFehlen
            ? 'Es fehlt noch eine Angabe im Kopf des Buchungsstapels.'
            : standUnbekannt ||
                (fehlendeSchluessel.has(SCHLUESSEL_BERATER) &&
                  fehlendeSchluessel.has(SCHLUESSEL_MANDANT))
              ? 'Zwei Zahlen fehlen. Tragen Sie sie einmal ein, danach läuft jeder weitere Export ohne Nachfrage.'
              : `Es fehlt die ${
                  fehlendeSchluessel.has(SCHLUESSEL_BERATER) ? 'Beraternummer' : 'Mandantennummer'
                }. Tragen Sie sie einmal ein, danach läuft jeder weitere Export ohne Nachfrage.`}
        </p>
      </div>

      {/* ⚠️ Hier stand bis zum 12.08.2026 eine Liste mit dem Satz „Sie werden
          in den Einstellungen unter DATEV eingetragen" — einen solchen Ort
          gibt es in der Kasse nicht. Statt der Liste stehen hier jetzt die
          FELDER selbst; Beschriftung und Hinweis kommen vom Server. */}

      {ordnungsnummernFehlen ? (
        <>
          {/* Woher die Zahlen kommen. Zwei ruhige Sätze, bevor irgendein Feld
              nach etwas fragt, das der Händler vielleicht gar nicht zur Hand
              hat. */}
          <p style={ERKLAERUNG}>
            Beide Zahlen kennt nur Ihr Steuerberater. Die <strong>Beraternummer</strong> vergibt
            DATEV an seine Kanzlei; sie steht auf jedem seiner Schreiben. Die{' '}
            <strong>Mandantennummer</strong> vergibt die Kanzlei an diesen Laden. Es ist Ihre Nummer
            in ihrem Bestand.
          </p>

          {/* Warum es darauf ankommt. Das ist kein Kleingedrucktes, also steht
              es auch nicht klein und nicht in einem Hinweisfähnchen. */}
          <p style={WARNUNG}>
            <strong>Eine falsche Mandantennummer fällt niemandem auf.</strong> Die beiden Zahlen
            sind die Anschrift, an die DATEV Ihre Buchungen liefert. Steht dort eine fremde Nummer,
            landen sie still in den Büchern eines fremden Betriebs, und bemerkt würde das erst beim
            Jahresabschluss. Deshalb wird ohne sie keine Datei erzeugt.
          </p>
        </>
      ) : weitereFehlende.length === 0 ? (
        // Nichts zu erheben — der seltene Fall, dass der Stand zwischen
        // Ablehnung und Öffnen dieser Fläche vollständig wurde.
        <div style={{ display: 'flex', gap: 'var(--w14-abstand-12)', flexWrap: 'wrap' }}>
          <Button type="button" variant="ghost" size="lg" onClick={onAbbrechen}>
            Schliessen
          </Button>
        </div>
      ) : null}

      {ordnungsnummernFehlen || weitereFehlende.length > 0 ? (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            absenden();
          }}
          style={{ display: 'grid', gap: 'var(--w14-abstand-14)' }}
        >
          {ordnungsnummernFehlen ? (
            <div style={FELDER}>
              <Field
                label="Beraternummer"
                hint="Vier bis sieben Ziffern."
                error={beraterFehler}
                required
              >
                <Input
                  id="datev-beraternummer"
                  mono
                  value={berater}
                  disabled={busy}
                  inputMode="numeric"
                  autoComplete="off"
                  enterKeyHint="next"
                  maxLength={7}
                  placeholder="z. B. 29098"
                  onChange={(e) => {
                    setBerater(e.target.value);
                    // Eine stehende Fehlerzeile, die schon behoben ist, ist
                    // Lärm — sie verschwindet, sobald die Eingabe stimmt.
                    if (beraterFehler !== null)
                      setBeraterFehler(pruefeBeraternummer(e.target.value));
                  }}
                  onBlur={(e) => setBeraterFehler(pruefeBeraternummer(e.target.value))}
                />
              </Field>

              <Field
                label="Mandantennummer"
                hint="Eine bis fünf Ziffern."
                error={mandantFehler}
                required
              >
                <Input
                  id="datev-mandantennummer"
                  mono
                  value={mandant}
                  disabled={busy}
                  inputMode="numeric"
                  autoComplete="off"
                  enterKeyHint="done"
                  maxLength={5}
                  placeholder="z. B. 1042"
                  onChange={(e) => {
                    setMandant(e.target.value);
                    if (mandantFehler !== null)
                      setMandantFehler(pruefeMandantennummer(e.target.value));
                  }}
                  onBlur={(e) => setMandantFehler(pruefeMandantennummer(e.target.value))}
                />
              </Field>
            </div>
          ) : null}

          {/* Die weiteren fehlenden Angaben — jede mit dem Feldtyp, den der
            Server nennt (`art`): Datum und Zahl als Eingabe, ja/nein und
            Kontenrahmen als Auswahl. */}
          {weitereFehlende.length > 0 ? (
            <div style={FELDER}>
              {weitereFehlende.map((feld) => (
                <Field
                  key={feld.schluessel}
                  label={feld.label}
                  hint={feld.hinweis}
                  error={weitereFehler[feld.schluessel] ?? null}
                  required
                >
                  {feld.art === 'jaNein' ? (
                    <Select
                      id={`datev-${feld.schluessel}`}
                      value={weitere[feld.schluessel] ?? ''}
                      disabled={busy}
                      onChange={(e) => {
                        setWeitere((w) => ({ ...w, [feld.schluessel]: e.target.value }));
                        setWeitereFehler((f) => ({ ...f, [feld.schluessel]: null }));
                      }}
                    >
                      <option value="">Bitte wählen …</option>
                      <option value="true">Ja, festschreiben</option>
                      <option value="false">Nein</option>
                    </Select>
                  ) : feld.art === 'rahmen' ? (
                    <Select
                      id={`datev-${feld.schluessel}`}
                      value={weitere[feld.schluessel] ?? ''}
                      disabled={busy}
                      onChange={(e) => {
                        setWeitere((w) => ({ ...w, [feld.schluessel]: e.target.value }));
                        setWeitereFehler((f) => ({ ...f, [feld.schluessel]: null }));
                      }}
                    >
                      <option value="">Bitte wählen …</option>
                      <option value="SKR03">SKR03</option>
                      <option value="SKR04">SKR04</option>
                    </Select>
                  ) : (
                    <Input
                      id={`datev-${feld.schluessel}`}
                      mono
                      value={weitere[feld.schluessel] ?? ''}
                      disabled={busy}
                      inputMode={feld.art === 'zahl' ? 'numeric' : 'text'}
                      autoComplete="off"
                      placeholder={feld.art === 'datum' ? 'z. B. 2026-01-01' : ''}
                      onChange={(e) => {
                        const wert = e.target.value;
                        setWeitere((w) => ({ ...w, [feld.schluessel]: wert }));
                        if ((weitereFehler[feld.schluessel] ?? null) !== null) {
                          setWeitereFehler((f) => ({
                            ...f,
                            [feld.schluessel]: pruefeWeiteresFeld(feld.schluessel, wert),
                          }));
                        }
                      }}
                      onBlur={(e) =>
                        setWeitereFehler((f) => ({
                          ...f,
                          [feld.schluessel]: pruefeWeiteresFeld(feld.schluessel, e.target.value),
                        }))
                      }
                    />
                  )}
                </Field>
              ))}
            </div>
          ) : null}

          {/* Ein Fehlschlag des Servers steht HIER, neben den Feldern, nicht als
            Meldung am Bildschirmrand: er gehört zu dem, was der Händler gerade
            versucht hat. */}
          {speicherFehler !== null ? (
            <p role="alert" style={SPEICHERFEHLER}>
              {speicherFehler}
            </p>
          ) : null}

          <div style={{ display: 'flex', gap: 'var(--w14-abstand-12)', flexWrap: 'wrap' }}>
            <Button type="submit" variant="primary" size="lg" disabled={busy}>
              {busy ? 'Speichert…' : 'Speichern und Export fortsetzen'}
            </Button>
            <Button type="button" variant="ghost" size="lg" disabled={busy} onClick={onAbbrechen}>
              Abbrechen
            </Button>
          </div>

          <p style={FUSSNOTE}>
            Speichern fragt den Gerätecode ab; ändern jederzeit unter Einstellungen, Steuer und
            Buchhaltung.
          </p>
        </form>
      ) : null}
    </section>
  );
}

// ── Gestaltung ──────────────────────────────────────────────────────────────
// Ausschliesslich Marken, die in `packages/ui-kit/src/tokens.css` wirklich
// stehen. Eine `var()` auf eine nicht existierende Marke verwirft die GANZE
// Deklaration — davon hatte dieses Haus sechs gleichzeitig, live.

const FLAECHE: React.CSSProperties = {
  display: 'grid',
  gap: 'var(--w14-abstand-14)',
  padding: 'var(--w14-abstand-16)',
  border: '1px solid var(--w14-gold)',
  borderRadius: 'var(--w14-radius-card)',
  background: 'var(--w14-parchment-2)',
  boxShadow: 'var(--w14-shadow-card)',
};

const TITEL: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--w14-schrift-grund)',
  fontWeight: 600,
  color: 'var(--w14-ink)',
};

const UNTERTITEL: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--w14-schrift-text)',
  color: 'var(--w14-ink-faded)',
};

const ERKLAERUNG: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--w14-schrift-text)',
  lineHeight: 1.6,
  color: 'var(--w14-ink-aged)',
  maxWidth: '68ch',
};

const WARNUNG: React.CSSProperties = {
  margin: 0,
  padding: 'var(--w14-abstand-12) var(--w14-abstand-14)',
  borderLeft: '3px solid var(--w14-wax-red)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-wax-red-soft)',
  fontSize: 'var(--w14-schrift-text)',
  lineHeight: 1.6,
  color: 'var(--w14-ink)',
  maxWidth: '68ch',
};

const FELDER: React.CSSProperties = {
  display: 'grid',
  gap: 'var(--w14-abstand-14)',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  maxWidth: 560,
};

const SPEICHERFEHLER: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--w14-schrift-text)',
  lineHeight: 1.5,
  color: 'var(--w14-wax-red)',
  maxWidth: '68ch',
};

const FUSSNOTE: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--w14-schrift-zeile)',
  lineHeight: 1.5,
  color: 'var(--w14-ink-faded)',
  maxWidth: '68ch',
};

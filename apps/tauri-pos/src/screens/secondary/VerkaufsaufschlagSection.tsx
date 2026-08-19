/**
 * Der Verkaufsaufschlag — der Ort, an dem Basel selbst entscheidet, was er
 * auf den Materialwert schlägt.
 *
 * ── WARUM ES DIESE FLÄCHE GIBT ─────────────────────────────────────────────
 *
 * Basel, 05.08.2026: „اذا شترييت قرام ذهب بسعر معين وبعد يومين ارتفع سعر
 * الذهب هل سعر المنتج يرتفع؟" Die gemessene Antwort war nein: jeder Preis
 * blieb für immer, wie er einmal eingetippt wurde.
 *
 * Seit heute rechnet die Kasse:
 *
 *     Feingewicht × Tageskurs je Gramm × (1 + Aufschlag)
 *
 * Der Aufschlag gehört dem Händler, nicht dem Quelltext. Auf seine Frage,
 * welchen Wert ich eintragen solle, hat er geantwortet: „ضبطه بنفسك من
 * الإعدادات" — er stellt ihn selbst. Also steht er hier, und die Vorgabe
 * bleibt NULL: lieber der nackte Materialwert, den er sofort als zu niedrig
 * erkennt, als ein von mir erfundener Zuschlag, den niemand bemerkt.
 *
 * ── ⚠️ PROZENT AUF DEM SCHIRM, ANTEIL AUF DER LEITUNG ──────────────────────
 *
 * Der Händler denkt und tippt in PROZENT („12"). Der Server und die Rechnung
 * führen einen ANTEIL („0.12"), genau wie die Ankaufmarge seit jeher. Diese
 * Datei ist die EINZIGE Stelle, an der umgerechnet wird, und sie tut es in
 * beide Richtungen an genau einem Ort. Zwei Einheiten im selben System wären
 * ein Preisfehler um den Faktor hundert, und zwar still.
 */

import { type CSSProperties, useCallback, useEffect, useState } from 'react';

import { ApiError, type MetalKind, type Verkaufsaufschlag, metalPricesApi } from '@norns/api-client';
import { describeError } from '@norns/i18n-de';
import { Button, Input } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { isStepUpCancelled } from '../../state/step-up-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { ohneApiFehlerSatz } from '../../lib/eingereiht.js';

/** Die vier Metalle mit Tageskurs, in der Reihenfolge des Ladens. */
const METALLE: ReadonlyArray<{ schluessel: MetalKind; name: string }> = [
  { schluessel: 'gold', name: 'Gold' },
  { schluessel: 'silver', name: 'Silber' },
  { schluessel: 'platinum', name: 'Platin' },
  { schluessel: 'palladium', name: 'Palladium' },
];

/** Anteil („0.12") → Prozent für den Schirm („12"). */
function alsProzent(anteil: string): string {
  const n = Number(anteil);
  if (!Number.isFinite(n)) return '0';
  // toFixed(2) und dann die Nullen weg: aus 0.125 wird „12,5", nicht „12,50".
  return String(Number((n * 100).toFixed(2))).replace('.', ',');
}

/** Prozent vom Schirm („12,5") → Anteil für die Leitung (0.125), oder null. */
function alsAnteil(prozent: string): number | null {
  const s = prozent.trim().replace(',', '.');
  if (s === '' || !/^\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  // Auf vier Nachkommastellen runden: 12,5 Prozent sind exakt 0.125, und
  // Gleitkomma soll daraus keine 0.12500000000000003 machen.
  return Number((n / 100).toFixed(4));
}

const zeile: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(96px, 140px) 1fr auto',
  alignItems: 'center',
  gap: 'var(--w14-abstand-12)',
  padding: 'var(--w14-abstand-8) 0',
};

export function VerkaufsaufschlagSection({
  pad,
  card,
  SectionTitle,
}: {
  pad: CSSProperties;
  card: CSSProperties;
  SectionTitle: (p: { title: string; subtitle: string }) => JSX.Element;
}): JSX.Element {
  const api = useApiClient();
  const addToast = useToastStore((s) => s.addToast);

  const [stand, setStand] = useState<Verkaufsaufschlag | null>(null);
  const [entwurf, setEntwurf] = useState<Record<string, string>>({});
  const [laedt, setLaedt] = useState(true);
  const [speichert, setSpeichert] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const uebernehmen = useCallback((s: Verkaufsaufschlag) => {
    setStand(s);
    setEntwurf({
      global: alsProzent(s.global),
      gold: alsProzent(s.gold),
      silver: alsProzent(s.silver),
      platinum: alsProzent(s.platinum),
      palladium: alsProzent(s.palladium),
    });
  }, []);

  useEffect(() => {
    let lebt = true;
    metalPricesApi
      .leseVerkaufsaufschlag(api)
      .then((s) => {
        if (lebt) uebernehmen(s);
      })
      .catch((e: unknown) => {
        if (lebt) setFehler(describeError(e));
      })
      .finally(() => {
        if (lebt) setLaedt(false);
      });
    return () => {
      lebt = false;
    };
  }, [api, uebernehmen]);

  async function speichern(welches: 'global' | MetalKind): Promise<void> {
    const anteil = alsAnteil(entwurf[welches] ?? '');
    if (anteil === null) {
      // ⚠️ Kein stilles Verwerfen. Wer „viel" oder „120" eintippt, muss
      // erfahren, WAS erlaubt ist — sonst drückt er noch dreimal.
      addToast({
        tone: 'alert',
        title: 'Aufschlag ungültig',
        body: 'Bitte eine Zahl zwischen 0 und 100 eintragen. 12 heisst zwölf Prozent.',
      });
      return;
    }
    setSpeichert(welches);
    try {
      const neu = await metalPricesApi.setzeVerkaufsaufschlag(api, {
        ...(welches === 'global' ? {} : { metal: welches }),
        aufschlagAnteil: anteil,
      });
      uebernehmen(neu);
      addToast({
        tone: 'success',
        title: 'Aufschlag gespeichert',
        // ⚠️ Hier stand „Alle Stücke dieses Metalls ziehen mit." Das ist
        // dieselbe zu grosse Zusage wie oben im Fliesstext: gerechnet wird nur
        // für Stücke mit Gewicht und Feingehalt, und gebucht wird weiterhin
        // der gespeicherte Preis. Der Toast sagt jetzt, was wirklich passiert.
        body:
          welches === 'global'
            ? `Gilt für jedes Metall ohne eigenen Wert: ${alsProzent(String(anteil))} Prozent. Der gerechnete Tagespreis folgt ab jetzt diesem Wert.`
            : `${METALLE.find((m) => m.schluessel === welches)?.name}: ${alsProzent(String(anteil))} Prozent. Der gerechnete Tagespreis dieses Metalls folgt ab jetzt diesem Wert.`,
      });
    } catch (e) {
      if (isStepUpCancelled(e)) {
        addToast({
          tone: 'alert',
          title: 'Abgebrochen',
          body: 'Der Aufschlag wurde nicht geändert.',
        });
      } else {
        addToast({
          tone: 'alert',
          title: 'Nicht gespeichert',
          body: e instanceof ApiError ? describeError(e) : ohneApiFehlerSatz(e),
        });
      }
    } finally {
      setSpeichert(null);
    }
  }

  const feld = (welches: 'global' | MetalKind, beschriftung: string, erbt?: string): JSX.Element => (
    <div key={welches} style={zeile}>
      <span style={{ fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink)' }}>
        {beschriftung}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-8)' }}>
        <Input
          value={entwurf[welches] ?? ''}
          onChange={(ev) => setEntwurf((e) => ({ ...e, [welches]: ev.target.value }))}
          inputMode="decimal"
          aria-label={`${beschriftung} in Prozent`}
          style={{ width: 96 }}
        />
        <span style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-feld)' }}>
          Prozent
        </span>
        {erbt !== undefined && (
          <span style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)' }}>
            {erbt}
          </span>
        )}
      </div>
      <Button
        variant="zweit"
        size="sm"
        onClick={() => void speichern(welches)}
        disabled={speichert !== null}
      >
        {speichert === welches ? 'Speichert…' : 'Setzen'}
      </Button>
    </div>
  );

  return (
    <div style={pad}>
      <SectionTitle
        title="Verkaufsaufschlag"
        subtitle="Was auf den reinen Materialwert kommt. Daraus rechnet die Kasse den Tagespreis, den sie neben dem gespeicherten Preis zeigt."
      />

      {/* ⚠️ ZWEI ZUSAGEN STANDEN HIER NACHEINANDER, UND BEIDE WAREN ZU GROSS.
          ── Die erste (alte Zeile 217): „Steigt der Goldkurs, steigen alle
          Goldstücke mit, ohne dass Sie ein einziges anfassen." Der Motor
          rechnete den Tagespreis zwar, aber KEINE Fläche las ihn, und die
          Karte bucht bis heute den gespeicherten Preis.
          ── Die zweite, an ihrer Stelle: „zeigt die Kasse bei jedem Goldstück
          sofort den neuen Tagespreis". Nachgemessen stimmte daran beides
          nicht.

          „BEI JEDEM": `kurspreisFuerStueck`
          (`packages/domain/src/pricing/metallpreis.ts`) gibt KEINEN Preis
          zurück, wenn Metall, Gewicht, Feingehalt oder der Tageskurs fehlen
          oder wenn das Stück fest gepflegt ist. Ein Goldring ohne
          eingetragenes Gewicht bekommt nichts, und das sind im Bestand die
          Regel, nicht die Ausnahme.

          „SOFORT": die Lagerliste hält dreissig Sekunden, der Katalog im
          Verkauf zehn, und keine der beiden holt bei Fensterwechsel nach
          (`Lager.tsx`, `CatalogGrid.tsx`). Eine offen stehende Fläche
          rechnet gar nicht nach. Deshalb steht dort jetzt der STAND mit
          Uhrzeit — eine Messung statt einer Zusage.

          Der Text nennt jetzt die Menge, für die er gilt, die Verzögerung und
          den Weg, der wirklich zum Feld führt. Er wird erst wieder kürzer,
          wenn die Karte den Tagespreis selbst übernimmt. */}
      <div style={card}>
        <p
          style={{
            margin: 0,
            fontSize: 'var(--w14-schrift-feld)',
            color: 'var(--w14-ink-aged)',
            lineHeight: 1.5,
          }}
        >
          Der Tagespreis ist <strong>Feingewicht × Tageskurs + Aufschlag</strong>. Die Kasse rechnet
          ihn für jedes Stück, an dem <strong>Metall, Gewicht und Feingehalt</strong> eingetragen
          sind und für dessen Metall ein Tageskurs vorliegt. Fehlt eines davon, steht an dem Stück,
          was fehlt; ein Stück mit festem Preis folgt dem Kurs bewusst nicht.
        </p>
        <p
          style={{
            margin: 0,
            marginTop: 'var(--w14-abstand-8)',
            fontSize: 'var(--w14-schrift-feld)',
            color: 'var(--w14-ink-aged)',
            lineHeight: 1.5,
          }}
        >
          Gezeigt wird er im Lager in der Preisspalte jedes Stücks, im Verkauf unter dem Preis auf
          der Kachel, sobald er abweicht. <strong>Beide Flächen lesen den Stand beim Öffnen</strong>{' '}
          und rechnen danach nicht von selbst weiter; über der Liste steht die Uhrzeit, zu der
          gelesen wurde. Neu geöffnet, steht dort die neue Uhrzeit.
        </p>
        <p
          style={{
            margin: 0,
            marginTop: 'var(--w14-abstand-8)',
            fontSize: 'var(--w14-schrift-feld)',
            color: 'var(--w14-ink-aged)',
            lineHeight: 1.5,
          }}
        >
          <strong>Gebucht wird weiterhin der gespeicherte Preis.</strong> Der Tagespreis ist die
          Auskunft, nicht der Betrag auf dem Beleg. Zum Übernehmen: im Lager die Zeile des Stücks
          anklicken und im Produktblatt unter „Details" den Verkaufspreis auf den Betrag setzen.
          Das darf nur die Ladenleitung; ab dann kassiert die Karte ihn. Verkaufte Ware behält für
          immer den Betrag auf ihrem Beleg.
        </p>
      </div>

      {fehler !== null && (
        <div style={card}>
          <p style={{ margin: 0, color: 'var(--w14-wax-red)' }}>{fehler}</p>
        </div>
      )}

      {laedt ? (
        <div style={card}>
          <p style={{ margin: 0, color: 'var(--w14-ink-faded)' }}>Wird gelesen…</p>
        </div>
      ) : (
        <>
          <div style={card}>
            {feld('global', 'Alle Metalle')}
            <p
              style={{
                margin: 0,
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-faded)',
              }}
            >
              Gilt für jedes Metall, das unten keinen eigenen Wert hat.
            </p>
          </div>

          <div style={card}>
            {METALLE.map((m) =>
              feld(
                m.schluessel,
                m.name,
                stand && stand[m.schluessel] === stand.global ? 'folgt dem allgemeinen Wert' : undefined,
              ),
            )}
          </div>

          <div style={card}>
            <p
              style={{
                margin: 0,
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-faded)',
                lineHeight: 1.5,
              }}
            >
              Steht überall 0, zeigt die Kasse den reinen Materialwert ohne Gewinn. Das ist die
              Vorgabe, bis Sie Ihren Aufschlag eintragen: ein zu niedriger Preis fällt beim ersten
              Blick auf, ein erfundener nicht.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

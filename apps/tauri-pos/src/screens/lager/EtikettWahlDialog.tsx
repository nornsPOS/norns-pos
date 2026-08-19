/**
 * EtikettWahlDialog — der Inhaber wählt, welches Etikett gedruckt wird.
 *
 * ── WAS AM TRESEN SCHIEFGING ───────────────────────────────────────────────
 * Es gab keine Wahl. Jeder Etikettendruck nahm die eine fest verdrahtete
 * Grösse, das Adressetikett mit 88,9 mm Länge. Für eine Münze in einer Kapsel
 * ist das ein Fähnchen, das dreimal so lang ist wie das Stück: es klebt
 * daneben, und daneben verrutscht. Der Drucker kann zehn Medien; neun davon
 * hat die Kasse nie angeboten.
 *
 * ── WARUM DIESE FLÄCHE SO AUSSIEHT ─────────────────────────────────────────
 * Drei Entscheidungen, die alle dasselbe wollen — dass niemand blind druckt:
 *
 *   1. DIE VORSCHAU IST MASSSTÄBLICH, und zwar so, wie der Drucker WIRKLICH
 *      setzt: Papier, darin die bedruckbare Fläche gestrichelt, darin der
 *      Bauplan — mittig eingepasst und, wenn er zu gross ist, verkleinert,
 *      genau wie es `label.rs` tut. Eine Vorschau, die den Einpassfaktor
 *      verschweigt, wäre eine Lüge über das, was aus dem Gerät kommt.
 *
 *   2. DER MASSSTAB WIRD NICHT BEHAUPTET, SONDERN GEZEIGT. Ein Bildschirm
 *      verrät seine wirkliche Punktdichte nicht; „Originalgrösse" wäre also
 *      eine Zusicherung, die diese Fläche nicht halten kann. Stattdessen liegt
 *      ein 10-mm-Massstab IM Bild, in denselben Koordinaten. Was der Browser
 *      auch skaliert — der Balken skaliert mit und bleibt wahr.
 *
 *   3. GESPERRTE GRÖSSEN BLEIBEN SICHTBAR, mit ihrem Grund. Eine Grösse
 *      wegzulassen lässt einen Menschen suchen; eine Grösse mit Begründung
 *      beantwortet die Frage, bevor sie gestellt wird. Und niemals wird
 *      heimlich verkleinert: passt ein Code nicht, wird das gesagt.
 *
 * Die Entscheidung selbst steht NICHT hier, sondern in `etikett-wahl.ts` —
 * ohne Bildschirm, damit jede Regel und jede Sperre geprüft werden kann.
 */

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  Icon,
  Lock,
  Printer,
} from '@norns/ui-kit';

import {
  type EtikettArtikel,
  type EtikettGroesse,
  type EtikettMoeglichkeit,
  etikettWahl,
  mm,
} from '../../lib/etikett-wahl.js';

// ───────────────────────────────────────────────────────────────────────────
// DER BAUPLAN, WIE IHN DIESE FLÄCHE BRAUCHT
// ───────────────────────────────────────────────────────────────────────────

/**
 * Der Bauplan wird ABSICHTLICH nicht aus `etikett-layout.ts` importiert.
 *
 * Diese Fläche muss nur zeichnen können, was ihr gereicht wird: Rechtecke und
 * Texte in Millimetern. Eine eigene, genügsame Beschreibung davon macht sie
 * unabhängig davon, wie der Bauplan gerade heisst und welche Felder er noch
 * bekommt — und ein Primitiv, das sie nicht kennt, wird nicht verschwiegen,
 * sondern gezählt und benannt.
 */
export interface VorschauRechteck {
  art: 'rechteck';
  x: number;
  y: number;
  breite: number;
  hoehe: number;
  ton?: string | undefined;
}

export interface VorschauText {
  art: 'text';
  x: number;
  /** Die GRUNDLINIE, nicht die Oberkante. */
  y: number;
  text: string;
  /** Die Versalhöhe, nicht der Schriftgrad. */
  hoeheMm: number;
  schrift?: string | undefined;
  fett?: boolean | undefined;
  anker?: string | undefined;
  sperrung?: number | undefined;
  ton?: string | undefined;
}

export type VorschauPrimitiv = VorschauRechteck | VorschauText | { art: string };

export interface VorschauPlan {
  masse: { breiteMm: number; hoeheMm: number };
  primitive: readonly VorschauPrimitiv[];
}

function istRechteck(p: VorschauPrimitiv): p is VorschauRechteck {
  return p.art === 'rechteck' && 'breite' in p;
}

function istText(p: VorschauPrimitiv): p is VorschauText {
  return p.art === 'text' && 'text' in p;
}

/**
 * Versalhöhe je Geviert der beiden Schriften.
 *
 * Ein SVG kennt nur den Schriftgrad; der Bauplan denkt in Versalhöhe, weil das
 * die Höhe ist, die ein Mensch am Regal sieht. Diese beiden Zahlen rechnen
 * zwischen beidem um. Sie stehen auch im Setzer des Druckwegs — dieselbe
 * Eigenschaft derselben Schriften, an zwei Stellen gebraucht.
 */
const VERSAL_JE_GEVIERT: Readonly<Record<string, number>> = { mono: 0.562, sans: 0.717 };

/** Die Ränder des Druckers in Millimetern. Aus der PPD, siehe `etikett-wahl.ts`. */
const SEITENRAND_MM = (2 * 25.4) / 72;
const ENDRAND_LEISTE_MM = (14.9 * 25.4) / 72;

/** Wie hoch die Leiste unter dem Etikett ist, in der der Massstab liegt. */
const MASSSTAB_LEISTE_MM = 5.2;

// ───────────────────────────────────────────────────────────────────────────
// DIE FLÄCHE
// ───────────────────────────────────────────────────────────────────────────

export interface EtikettWahlDialogProps {
  open: boolean;
  onClose: () => void;
  /** Das Stück, für das ein Etikett gedruckt werden soll. */
  artikel: EtikettArtikel;
  /** Wieviele Etiketten dieses Stücks gedruckt werden. Vorgabe: eines. */
  anzahl?: number;
  /**
   * Der Bauplan zu einer Grösse — oder `null`, wenn es keinen gibt.
   *
   * Bewusst als Rückruf und nicht als fertiger Bauplan: welche Grösse gezeigt
   * wird, entscheidet dieser Dialog, und ein Bauplan je Grösse im Voraus zu
   * rechnen hiesse, zehn zu rechnen, von denen neun niemand ansieht.
   *
   * Fehlt der Rückruf ganz, zeigt die Vorschau ehrlich nur Papier und
   * bedruckbare Fläche und sagt, dass der Aufdruck fehlt. Sie erfindet keinen.
   */
  planFuer?: (groesse: EtikettGroesse) => VorschauPlan | null;
  /** Wird mit der gewählten Grösse gerufen. Der Dialog druckt selbst nicht. */
  onDrucken: (groesse: EtikettGroesse) => void;
  /** Solange der Druckauftrag läuft: alles gesperrt, nichts doppelt. */
  laeuft?: boolean;
}

export function EtikettWahlDialog({
  open,
  onClose,
  artikel,
  anzahl = 1,
  planFuer,
  onDrucken,
  laeuft = false,
}: EtikettWahlDialogProps): JSX.Element | null {
  const wahl = useMemo(() => etikettWahl(artikel), [artikel]);
  const [gewaehlt, setGewaehlt] = useState<EtikettGroesse | null>(wahl.vorschlag);

  // Bei jedem Öffnen zurück auf den Vorschlag. Ohne das trüge der Dialog die
  // Wahl vom vorigen Stück mit sich — und dann druckt jemand für eine Münze
  // die Grösse, die er beim Armband davor gewählt hat.
  useEffect(() => {
    if (open) setGewaehlt(wahl.vorschlag);
  }, [open, wahl.vorschlag]);

  const aktiv = wahl.moeglichkeiten.find((m) => m.groesse === gewaehlt) ?? null;
  const kannDrucken = aktiv !== null && aktiv.waehlbar && !laeuft;
  const waehlbare = wahl.moeglichkeiten.filter((m) => m.waehlbar);
  const ersteWaehlbare = waehlbare[0]?.groesse ?? null;
  const gruppeRef = useRef<HTMLDivElement>(null);

  /**
   * Pfeiltasten in der Grössenliste.
   *
   * Eine Gruppe, die sich `radiogroup` nennt, MUSS auf Pfeiltasten hören —
   * sonst ist die Rolle eine Behauptung, auf die sich eine Vorlesehilfe
   * verlässt und die niemand einlöst. Übersprungen werden die gesperrten
   * Grössen: sie sind sichtbar, aber nicht wählbar, und eine Taste, die auf
   * etwas Unwählbarem stehen bleibt, fühlt sich kaputt an.
   */
  function pfeiltasten(e: KeyboardEvent<HTMLDivElement>): void {
    if (laeuft || waehlbare.length === 0) return;
    const vor = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (vor === 0) return;
    e.preventDefault();
    const jetzt = waehlbare.findIndex((m) => m.groesse === gewaehlt);
    const von = jetzt === -1 ? (vor === 1 ? -1 : 0) : jetzt;
    const ziel = waehlbare[(von + vor + waehlbare.length) % waehlbare.length];
    if (ziel === undefined) return;
    setGewaehlt(ziel.groesse);
    gruppeRef.current
      ?.querySelector<HTMLButtonElement>(`[data-groesse="${ziel.groesse}"]`)
      ?.focus();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Etikett wählen"
      size="xl"
      closeOnBackdrop={!laeuft}
      closeOnEsc={!laeuft}
    >
      <DialogBody style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <ArtikelZeile artikel={artikel} anzahl={anzahl} />

        <p style={SATZ}>{wahl.begruendung}</p>

        <div
          style={{
            display: 'grid',
            // minmax(0, …) auf BEIDEN Spalten: eine reine `1fr`-Spalte wird so
            // breit wie ihr Inhalt und schiebt die Nachbarspalte aus dem
            // Fenster. Eine lange Sperrbegründung täte genau das.
            gridTemplateColumns: 'minmax(0, 260px) minmax(0, 1fr)',
            gap: 'var(--space-4)',
            alignItems: 'start',
          }}
        >
          <div
            ref={gruppeRef}
            role="radiogroup"
            aria-label="Grösse des Etiketts"
            onKeyDown={pfeiltasten}
            style={LISTE}
          >
            {wahl.moeglichkeiten.map((m) => (
              <GroessenZeile
                key={m.groesse}
                moeglichkeit={m}
                gewaehlt={m.groesse === gewaehlt}
                gesperrt={laeuft}
                // Wanderndes Tabstopp: nur EIN Knopf der Gruppe liegt im
                // Tabweg, sonst müsste man sich durch zehn Knöpfe tippen, um
                // zum Drucken zu kommen.
                imTabweg={m.groesse === (gewaehlt ?? ersteWaehlbare)}
                onWaehlen={() => setGewaehlt(m.groesse)}
              />
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {aktiv === null ? (
              <p style={SATZ}>Keine Grösse gewählt.</p>
            ) : (
              <>
                <EtikettVorschau
                  moeglichkeit={aktiv}
                  plan={planFuer ? planFuer(aktiv.groesse) : null}
                  planFehlt={planFuer === undefined}
                />
                <Kennzahlen moeglichkeit={aktiv} />
              </>
            )}
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={laeuft}>
          Abbrechen
        </Button>
        <Button
          variant="primary"
          disabled={!kannDrucken}
          onClick={() => {
            if (gewaehlt !== null && kannDrucken) onDrucken(gewaehlt);
          }}
        >
          <Icon icon={Printer} size={18} />
          {laeuft
            ? 'Wird gesendet…'
            : anzahl > 1
              ? `${anzahl} Etiketten drucken`
              : 'Etikett drucken'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// DIE TEILE
// ───────────────────────────────────────────────────────────────────────────

/** Welches Stück ist gemeint — damit niemand für das falsche druckt. */
function ArtikelZeile({
  artikel,
  anzahl,
}: {
  artikel: EtikettArtikel;
  anzahl: number;
}): JSX.Element {
  const kurzcode = (artikel.kurzcode ?? '').trim();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w14-abstand-2)',
        padding: 'var(--space-3)',
        background: 'var(--w14-parchment-1)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: 'var(--w14-schrift-betont)',
          color: 'var(--w14-ink)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={artikel.name ?? ''}
      >
        {artikel.name === null || artikel.name === undefined || artikel.name.trim() === ''
          ? 'Ohne Namen'
          : artikel.name}
      </span>
      <span
        className="w14-tabular"
        style={{ fontFamily: 'var(--w14-font-mono)', fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}
      >
        {artikel.sku}
        {kurzcode === '' ? ' · kein Kurzcode' : ` · Kurzcode ${kurzcode}`}
        {anzahl > 1 ? ` · ${anzahl} Etiketten` : ''}
      </span>
    </div>
  );
}

/** Eine Grösse in der Liste — wählbar oder mit ihrem Grund ausgegraut. */
function GroessenZeile({
  moeglichkeit,
  gewaehlt,
  gesperrt,
  imTabweg,
  onWaehlen,
}: {
  moeglichkeit: EtikettMoeglichkeit;
  gewaehlt: boolean;
  gesperrt: boolean;
  imTabweg: boolean;
  onWaehlen: () => void;
}): JSX.Element {
  const m = moeglichkeit;
  const aus = !m.waehlbar || gesperrt;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={gewaehlt}
      data-groesse={m.groesse}
      tabIndex={imTabweg ? 0 : -1}
      disabled={aus}
      onClick={onWaehlen}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-3)',
        width: '100%',
        minHeight: 'var(--w14-touch-min)',
        // ── DIE ZEILEN LAGEN ÜBEREINANDER (30.07.2026, Basels Foto) ──────────
        // Die Liste ist eine Spalte mit Deckel (maxHeight 420 + eigener
        // Roller). In einer solchen Spalte SCHRUMPFEN Kinder von sich aus,
        // bis sie hineinpassen — und ein Knopf, dessen Text zwei Zeilen
        // Beschreibung trägt, wurde auf sein Mindestmass gequetscht, während
        // der Text stehen blieb: acht Etikettennamen druckten sich gegenseitig
        // durch. `minHeight` allein rettet nichts, es setzt nur den Boden für
        // den KASTEN, nicht für den Inhalt. Wer nicht schrumpfen darf, rollt.
        flexShrink: 0,
        textAlign: 'left',
        padding: 'var(--space-3)',
        background: gewaehlt ? 'var(--w14-parchment-2)' : 'transparent',
        border: `1px solid ${gewaehlt ? 'var(--w14-gilt)' : 'var(--w14-rule)'}`,
        borderRadius: 'var(--w14-radius-card)',
        color: 'var(--w14-ink)',
        cursor: aus ? 'not-allowed' : 'pointer',
        opacity: m.waehlbar ? 1 : 0.62,
      }}
    >
      <MassSchnipsel moeglichkeit={m} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-2)', minWidth: 0, flex: '1 1 auto' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-6)', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--w14-font-display)', fontSize: 'var(--w14-schrift-betont)', fontWeight: 500 }}>
            {m.bauartName ?? m.medium.name}
          </span>
          {m.istVorschlag && (
            <span
              style={{
                fontSize: 'var(--w14-schrift-kuerzel)',
                letterSpacing: 'var(--w14-tracking-eyebrow)',
                textTransform: 'uppercase',
                padding: 'var(--w14-abstand-2) var(--w14-abstand-6)',
                borderRadius: 'var(--w14-radius-button)',
                background: 'var(--w14-gilt)',
                color: 'var(--w14-accent-ink)',
              }}
            >
              Vorschlag
            </span>
          )}
          {!m.waehlbar && <Icon icon={Lock} size={14} style={{ color: 'var(--w14-ink-faded)' }} />}
        </span>
        <span className="w14-tabular" style={KLEIN}>
          {m.medium.name} · {mm(m.medium.papierQuerMm)} × {mm(m.medium.papierLaufMm)} mm
        </span>
        {m.waehlbar ? (
          <span style={KLEIN}>
            {m.strichcode?.quelle === 'kurzcode' ? 'Kurzcode' : 'Artikelnummer'} als Strichcode,
            {' '}
            {m.strichcode?.modulPunkte} Druckpunkte je Linie
          </span>
        ) : (
          <span style={{ ...KLEIN, color: 'var(--w14-wax-red)' }}>{m.sperrgrund}</span>
        )}
      </span>
    </button>
  );
}

/**
 * Ein winziges, aber massstabtreues Abbild der Papiergrösse.
 *
 * Alle zehn Schnipsel teilen sich EINEN Massstab. Nur so beantwortet die Liste
 * die eigentliche Frage auf einen Blick: wie klein ist das kleine wirklich?
 */
function MassSchnipsel({ moeglichkeit }: { moeglichkeit: EtikettMoeglichkeit }): JSX.Element {
  // Das längste Medium misst 190,5 mm; bei diesem Faktor wird es 76 Bildpunkte
  // breit und passt neben den Text.
  const faktor = 0.4;
  const b = moeglichkeit.medium.papierLaufMm * faktor;
  const h = moeglichkeit.medium.papierQuerMm * faktor;
  return (
    <span
      aria-hidden="true"
      style={{
        flex: '0 0 auto',
        display: 'block',
        width: 78,
        height: 24,
        position: 'relative',
        marginTop: 3,
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: 0,
          top: `${Math.max(0, (24 - h) / 2)}px`,
          width: `${b}px`,
          height: `${h}px`,
          background: 'var(--w14-parchment)',
          border: '1px solid var(--w14-ink-faded)',
          borderRadius: 1,
        }}
      />
    </span>
  );
}

/**
 * Die Vorschau — Papier, bedruckbare Fläche, Bauplan, Massstab.
 *
 * Der Bauplan wird GENAU SO eingesetzt, wie `label.rs` ihn einsetzt: mittig in
 * die bedruckbare Fläche, verkleinert wenn er zu gross ist, niemals
 * vergrössert. Kommt dabei ein Faktor unter 1,0 heraus, steht das als Satz
 * darunter — denn dieser Faktor verkleinert auch jede Linie des Strichcodes.
 */
function EtikettVorschau({
  moeglichkeit,
  plan,
  planFehlt,
}: {
  moeglichkeit: EtikettMoeglichkeit;
  plan: VorschauPlan | null;
  planFehlt: boolean;
}): JSX.Element {
  const m = moeglichkeit.medium;
  const hoeheGesamt = m.papierQuerMm + MASSSTAB_LEISTE_MM;

  const einpassung =
    plan === null
      ? null
      : Math.min(
          m.druckLaufMm / plan.masse.breiteMm,
          m.druckQuerMm / plan.masse.hoeheMm,
          1,
        );

  const versatzX =
    plan === null || einpassung === null
      ? 0
      : ENDRAND_LEISTE_MM + (m.druckLaufMm - plan.masse.breiteMm * einpassung) / 2;
  const versatzY =
    plan === null || einpassung === null
      ? 0
      : SEITENRAND_MM + (m.druckQuerMm - plan.masse.hoeheMm * einpassung) / 2;

  const unbekannt =
    plan === null ? 0 : plan.primitive.filter((p) => !istRechteck(p) && !istText(p)).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <svg
        viewBox={`0 0 ${m.papierLaufMm} ${hoeheGesamt}`}
        width={m.papierLaufMm * 5}
        role="img"
        aria-label={`Vorschau des Etiketts ${moeglichkeit.bauartName ?? m.name} auf ${mm(m.papierQuerMm)} mal ${mm(m.papierLaufMm)} Millimeter Papier`}
        style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
      >
        {/* Das Papier. */}
        <rect
          x={0}
          y={0}
          width={m.papierLaufMm}
          height={m.papierQuerMm}
          rx={1}
          style={{ fill: 'var(--w14-parchment)', stroke: 'var(--w14-rule)', strokeWidth: 0.2 }}
        />
        {/* Was der Kopf erreicht. Gestrichelt, damit klar ist: das ist keine Kante. */}
        <rect
          x={ENDRAND_LEISTE_MM}
          y={SEITENRAND_MM}
          width={m.druckLaufMm}
          height={m.druckQuerMm}
          style={{
            fill: 'none',
            stroke: 'var(--w14-ink-faded)',
            strokeWidth: 0.12,
            strokeDasharray: '0.8 0.6',
          }}
        />

        {plan !== null && einpassung !== null && (
          <g transform={`translate(${versatzX} ${versatzY}) scale(${einpassung})`}>
            {plan.primitive.map((p, i) => {
              if (istRechteck(p)) {
                return (
                  <rect
                    key={i}
                    x={p.x}
                    y={p.y}
                    width={p.breite}
                    height={p.hoehe}
                    style={{ fill: p.ton === 'blass' ? 'var(--w14-ink-faded)' : 'var(--w14-ink)' }}
                  />
                );
              }
              if (istText(p)) {
                const versal = VERSAL_JE_GEVIERT[p.schrift ?? 'sans'] ?? 0.717;
                return (
                  <text
                    key={i}
                    x={p.x}
                    y={p.y}
                    textAnchor={p.anker === 'rechts' ? 'end' : 'start'}
                    style={{
                      fill: p.ton === 'blass' ? 'var(--w14-ink-faded)' : 'var(--w14-ink)',
                      fontFamily:
                        p.schrift === 'mono' ? 'var(--w14-font-mono)' : 'var(--w14-font-inter)',
                      fontSize: `${p.hoeheMm / versal}px`, // schriftleiter-frei: Etikettvorschau im Millimeter-Raum des Druckers
                      fontWeight: p.fett === true ? 700 : 400,
                      letterSpacing: p.sperrung === undefined ? undefined : `${p.sperrung}px`,
                    }}
                  >
                    {p.text}
                  </text>
                );
              }
              return null;
            })}
          </g>
        )}

        {/* Der Massstab liegt IM Bild und in denselben Koordinaten. Was der
            Browser auch mit der Breite macht — dieser Balken bleibt wahr. */}
        <g style={{ fill: 'var(--w14-ink-aged)' }}>
          <rect x={0} y={m.papierQuerMm + 2.2} width={10} height={0.35} />
          <rect x={0} y={m.papierQuerMm + 1.4} width={0.3} height={1.9} />
          <rect x={9.7} y={m.papierQuerMm + 1.4} width={0.3} height={1.9} />
          <text x={10.9} y={m.papierQuerMm + 3} style={{ fontSize: '2.4px' /* schriftleiter-frei: Etikettvorschau im Millimeter-Raum des Druckers */ }}>
            10 mm
          </text>
        </g>
      </svg>

      {planFehlt && (
        <p style={{ ...KLEIN, color: 'var(--w14-ink-aged)' }}>
          Der Aufdruck wird hier nicht gezeigt: dieser Fläche wurde kein Bauplan gereicht. Papier
          und bedruckbare Fläche stimmen, alles andere wäre erfunden.
        </p>
      )}
      {!planFehlt && plan === null && (
        <p style={{ ...KLEIN, color: 'var(--w14-ink-aged)' }}>
          Für diese Grösse gibt es keinen Bauplan. Papier und bedruckbare Fläche sind echt, ein
          Aufdruck entstünde nicht.
        </p>
      )}
      {einpassung !== null && einpassung < 0.999 && (
        <p style={{ ...KLEIN, color: 'var(--w14-wax-red)' }}>
          Der Bauplan ist grösser als die bedruckbare Fläche und wird beim Drucken auf{' '}
          {(einpassung * 100).toFixed(1).replace('.', ',')} Prozent verkleinert. Damit schrumpft
          auch jede Linie des Strichcodes.
        </p>
      )}
      {unbekannt > 0 && (
        <p style={{ ...KLEIN, color: 'var(--w14-wax-red)' }}>
          {unbekannt} Bestandteile des Bauplans kann diese Vorschau nicht zeichnen. Sie fehlen im
          Bild, nicht auf dem Papier.
        </p>
      )}
    </div>
  );
}

/** Die Zahlen, die über Lesbarkeit entscheiden — im Klartext, nicht versteckt. */
function Kennzahlen({ moeglichkeit }: { moeglichkeit: EtikettMoeglichkeit }): JSX.Element {
  const m = moeglichkeit;
  const zeilen: { was: string; wert: string }[] = [
    {
      was: 'Papier',
      wert: `${mm(m.medium.papierQuerMm)} × ${mm(m.medium.papierLaufMm)} mm`,
    },
    {
      was: 'Bedruckbar',
      wert: `${mm(m.medium.druckQuerMm)} × ${mm(m.medium.druckLaufMm)} mm`,
    },
  ];
  if (m.strichcode !== null) {
    zeilen.push(
      { was: 'Strichcode', wert: `${m.strichcode.inhalt} (${m.strichcode.module} Module)` },
      {
        was: 'Schmalste Linie',
        wert: `${m.strichcode.modulPunkte} Druckpunkte, ${m.strichcode.modulbreiteMm.toFixed(3).replace('.', ',')} mm`,
      },
      {
        was: 'Ruhezone',
        wert: `${m.strichcode.ruhezoneFaktor.toFixed(2).replace('.', ',')} mal so viel Weiss wie gefordert`,
      },
    );
  }
  if (m.maximaleZeichen !== null) {
    zeilen.push({ was: 'Fasst höchstens', wert: `${m.maximaleZeichen} Zeichen` });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)' }}>
      {m.zweck !== null && <p style={{ ...KLEIN, margin: 0 }}>{m.zweck}</p>}
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, auto) minmax(0, 1fr)',
          gap: 'var(--w14-abstand-2) var(--space-3)',
          margin: 0,
        }}
      >
        {zeilen.map((z) => (
          <div key={z.was} style={{ display: 'contents' }}>
            <dt style={{ ...KLEIN, margin: 0 }}>{z.was}</dt>
            <dd className="w14-tabular" style={{ ...KLEIN, margin: 0, color: 'var(--w14-ink)' }}>
              {z.wert}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const SATZ = {
  margin: 0,
  fontSize: 'var(--w14-schrift-text)',
  lineHeight: 1.5,
  color: 'var(--w14-ink-aged)',
  fontFamily: 'var(--w14-font-display)',
} as const;

const KLEIN = {
  margin: 0,
  fontSize: 'var(--w14-schrift-zeile)',
  lineHeight: 1.45,
  color: 'var(--w14-ink-faded)',
} as const;

const LISTE = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  maxHeight: 420,
  overflowY: 'auto',
  paddingRight: 'var(--w14-abstand-4)',
} as const;

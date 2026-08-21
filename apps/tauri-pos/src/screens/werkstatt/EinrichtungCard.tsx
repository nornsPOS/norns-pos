/**
 * Die Startliste als Aufgabentafel — was dieser Kasse noch fehlt, und was
 * sie schon geschafft hat. Auf der ersten Fläche, vor dem ersten Kunden.
 *
 * ── WARUM HIER UND NICHT IN DEN EINSTELLUNGEN ──────────────────────────────
 *
 * Eine frisch ausgelieferte Kasse kann nicht verkaufen, nicht exportieren und
 * keine Termine annehmen. Jede dieser Sperren ist einzeln begründet, aber
 * jede meldet sich erst in dem Augenblick, in dem der Händler sie TRIFFT:
 * beim Bezahlen, beim Export, beim ersten Termin. Immer mit einem Kunden
 * davor, und immer als Absage statt als Auskunft.
 *
 * Diese Tafel dreht das um. Sie steht auf der Werkstatt, der Fläche, auf der
 * die Kasse startet — nicht drei Klicks entfernt in den Einstellungen.
 *
 * ⚠️ Sie entscheidet NICHTS selbst. Die Liste kommt vollständig vom Server
 * (`GET /api/einrichtung`), der genau die Quellen liest, die auch die Riegel
 * lesen. Eine Tafel mit eigener Meinung über Vollständigkeit wäre die
 * gefährlichste Fassung dieses Problems: sie sagte „alles bereit", und das
 * Bezahlen lehnte weiter ab.
 *
 * ── 14.08.2026: VON DER MÄNGELLISTE ZUR AUFGABENTAFEL ──────────────────────
 *
 * Bis heute kannte die Karte nur die LÜCKEN: ein erledigter Punkt verschwand
 * spurlos. Basels Auftrag: die Punkte sollen sich wie Aufgaben anfühlen, mit
 * sichtbarem Fortschritt und einem Griff, der exakt an die Stelle führt.
 * Der Motor liefert seitdem ALLE Punkte samt Stand; die Tafel zeigt oben die
 * Fortschrittslinie („5 von 11"), darunter die offenen Aufgaben nach
 * Dringlichkeit, und das Geschaffte eingeklappt darunter — als Beleg, nicht
 * als Lärm. Erst wenn ALLES erledigt ist, verschwindet die Tafel ganz.
 *
 * ── DER BEFUND VOM 08.08.2026 (bleibt die Grundregel) ──────────────────────
 *
 * Die Karte beschrieb sieben Wege und öffnete NULL davon. Jetzt trägt jeder
 * offene Punkt einen Griff, der wirklich dorthin führt. Der Ort kommt vom
 * Motor als `ziel`, maschinenlesbar, aus derselben Quelle wie der Riegel.
 *
 * ⚠️ Und die Liste frischt sich auf, wenn der Mensch zurückkommt. Ohne das
 * bliebe ein gelöster Punkt offen stehen, und die Tafel würde zur Lügnerin.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Icon } from '@norns/ui-kit';
import { ArrowRight, Check, ChevronRight, Lock } from 'lucide-react';

import { useApiClient } from '../../lib/api-context.js';
import { useSessionStore } from '../../state/session-store.js';

interface Ziel {
  pfad: string;
  bereich?: string;
  nurInhaber: boolean;
}
interface Schritt {
  titel: string;
  erklaerung: string;
  sperre: string;
  wohin: string;
  ziel: Ziel;
  schluessel?: string;
  erledigt: boolean;
}
interface Antwort {
  kannVerkaufen: boolean;
  gesamt: number;
  erledigtZahl: number;
  schritte: Schritt[];
}

/**
 * Wie dringend ein Punkt ist, in Worten des Hauses.
 *
 * ⚠️ 13.08.2026: `MELDUNG` kam dazu. Ohne diese Zeile hätte die Rückfalllinie
 * unten (`?? s.sperre`) das rohe Wort MELDUNG auf die Fläche geschrieben —
 * ein Grosskennzeichen aus dem Motor mitten im deutschen Satz, und genau die
 * Sorte Leck, die dieses Haus an anderer Stelle schon eingesammelt hat.
 */
const SPERRE_WORT: Readonly<Record<string, string>> = {
  VERKAUF: 'Kein Verkauf möglich',
  EXPORT: 'Kein Steuerexport möglich',
  // Hält in der Kasse nichts auf, läuft aber gegen eine gesetzliche Frist.
  // „Empfohlen" wäre hier die falsche Auskunft: die Mitteilung nach
  // § 146a Abs. 4 AO ist bussgeldbewehrt.
  MELDUNG: 'Frist läuft',
  TERMINE: 'Keine Termine möglich',
  KOSMETIK: 'Empfohlen',
};

/** Die Farbe der Dringlichkeit. Nur der blockierende Rang trägt den Faden. */
function tonFarbe(sperre: string): string {
  if (sperre === 'VERKAUF') return 'var(--w14-danger)';
  if (sperre === 'MELDUNG') return 'var(--w14-gold)';
  if (sperre === 'KOSMETIK') return 'var(--w14-ink-aged)';
  return 'var(--w14-ink-faded)';
}

/** Die Adresse aus dem Ziel bauen. Eine Stelle, kein zweites Vokabular. */
function adresse(z: Ziel): string {
  return z.bereich === undefined || z.bereich === '' ? z.pfad : `${z.pfad}?bereich=${z.bereich}`;
}

export function EinrichtungCard(): JSX.Element | null {
  const api = useApiClient();
  const navigate = useNavigate();
  const ort = useLocation();
  const kammer = useQueryClient();
  const istInhaber = useSessionStore((s) => s.actor?.isOwner ?? false);
  const istAdmin = useSessionStore((s) => s.actor?.role === 'ADMIN');
  const darfAlles = istInhaber || istAdmin;

  const { data, isError } = useQuery<Antwort>({
    queryKey: ['einrichtung'],
    queryFn: () => api.request('GET', '/api/einrichtung') as Promise<Antwort>,
    // Die Antwort ändert sich nur, wenn jemand etwas einträgt. Ein Blick beim
    // Öffnen genügt; häufiger zu fragen wäre Lärm auf dem Motor.
    staleTime: 60_000,
  });

  /**
   * ⚠️ Zurück auf der Werkstatt heisst: neu fragen.
   *
   * Fünf von sechs Lösewegen frischten die Liste nicht auf. Wer die TSE
   * einträgt und zurückkommt, sah den Punkt weiter dastehen und glaubte, es
   * habe nicht geklappt.
   */
  useEffect(() => {
    void kammer.invalidateQueries({ queryKey: ['einrichtung'] });
  }, [ort.key, kammer]);

  /**
   * ⚠️ Ein Lesefehler darf die Tafel nicht WORTLOS verschwinden lassen.
   *
   * 14.08.2026, Begehung: `/api/einrichtung` warf 500 (der Entwicklungsstand
   * hatte eine Wanderung verpasst), und die Werkstatt sah aus, als sei die
   * Einrichtung fertig — kein Kasten, keine Warnung. Für eine Karte, die
   * fiskalische Pflichten anzeigt, ist stilles Verschwinden eine Lüge.
   */
  if (isError) {
    return (
      <section
        aria-label="Die Einrichtung dieser Kasse"
        style={{
          border: '1px solid var(--w14-rule)',
          borderRadius: 'var(--w14-radius-card)',
          background: 'var(--w14-card)',
          padding: 'var(--w14-abstand-16)',
        }}
      >
        <p style={{ margin: 0, fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
          Der Stand der Einrichtung liess sich gerade nicht lesen. Ob noch
          Aufgaben offen sind, ist damit UNBEKANNT, nicht erledigt.
        </p>
      </section>
    );
  }

  if (data === undefined) return null;

  const offen = data.schritte.filter((s) => !s.erledigt);
  const geschafft = data.schritte.filter((s) => s.erledigt);

  // Alles erledigt: die Tafel verschwindet ganz. Kein „alles erledigt"-Kasten,
  // der dauerhaft Platz nimmt und nichts mehr sagt.
  if (offen.length === 0) return null;

  // ⚠️ „Blockierend" heisst: die Kasse arbeitet deswegen nicht. Die
  // Kassenmeldung ans Finanzamt gehört NICHT dazu — sie läuft ausserhalb der
  // Kasse. Sie hier mitzuzählen hiesse dem Händler sagen, ein Punkt halte
  // seinen Betrieb auf, den er im Betrieb gar nicht bemerkt.
  /*
   * ── ⛔ DIE KOPFZEILE WARF ALLES ZUSAMMEN (21.08.2026) ───────────────────
   *
   * `blockierend` war „alles ausser KOSMETIK und MELDUNG" — also VERKAUF,
   * EXPORT und TERMINE in EINER Zahl. Unter der Überschrift „Diese Kasse kann
   * noch nicht verkaufen" las der Händler dann:
   *
   *     „7 Aufgaben halten den Betrieb auf."
   *
   * Und das stimmte nicht. Das Haus hat es am 20.08. selbst nachgemessen und
   * in den Plan geschrieben: „von zwölf Punkten halten nur ZWEI den Verkauf
   * auf". Die ZEILEN sagen es auch richtig („Kein Verkauf möglich" gegen
   * „Kein Steuerexport möglich"), und die Farben ebenso — nur die Kopfzeile
   * behauptete etwas anderes als alles darunter.
   *
   * ⚠️ Der Unterschied ist nicht kosmetisch. Wer glaubt, sieben Dinge
   * hinderten ihn am Verkaufen, räumt am ersten Tag sieben Dinge weg, bevor
   * er den ersten Kunden bedient — statt zwei. Der Steuerexport eilt nicht
   * am Tresen; er eilt zum Monatsende.
   */
  const haltenDenVerkaufAuf = offen.filter((s) => s.sperre === 'VERKAUF');
  const haltenSonstAuf = offen.filter(
    (s) => s.sperre !== 'KOSMETIK' && s.sperre !== 'MELDUNG' && s.sperre !== 'VERKAUF',
  );
  const anteil = data.gesamt === 0 ? 0 : Math.round((data.erledigtZahl / data.gesamt) * 100);

  return (
    <section
      aria-label="Einrichtung"
      style={{
        border: `1px solid var(${data.kannVerkaufen ? '--w14-rule' : '--w14-danger'})`,
        background: 'var(--w14-card)',
        borderRadius: 'var(--w14-radius-card)',
        padding: 'var(--w14-abstand-12)',
        display: 'grid',
        gap: 'var(--w14-abstand-8)',
      }}
    >
      {/* Die Fortschrittslinie atmet, wenn ein Punkt dazukommt; wer Bewegung
          reduziert hat, sieht den neuen Stand sofort ohne Fahrt. */}
      <style>{`
        .w14-einrichtung-balken { transition: width var(--w14-dur-fast) var(--w14-ease-hover); }
        @media (prefers-reduced-motion: reduce) {
          .w14-einrichtung-balken { transition: none; }
        }
      `}</style>

      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 'var(--w14-abstand-8)',
          flexWrap: 'wrap',
        }}
      >
        <strong
          style={{
            fontSize: 'var(--w14-schrift-text)',
            color: 'var(--w14-ink)',
            fontFamily: 'var(--w14-font-display)',
          }}
        >
          {data.kannVerkaufen ? 'Die Einrichtung dieser Kasse' : 'Diese Kasse kann noch nicht verkaufen'}
        </strong>
        <span
          className="w14-smallcaps"
          aria-label={`${data.erledigtZahl} von ${data.gesamt} Punkten erledigt`}
          style={{
            fontVariantNumeric: 'tabular-nums',
            fontSize: 'var(--w14-schrift-zeile)',
            color: 'var(--w14-ink-faded)',
            letterSpacing: '0.08em',
          }}
        >
          {data.erledigtZahl} von {data.gesamt} erledigt
        </span>
      </header>

      {/* Die gemessene Linie: Anteil des Geschafften, in der Farbe des
          Ernstes — rot solange der Verkauf steht, sonst gold. */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={data.gesamt}
        aria-valuenow={data.erledigtZahl}
        style={{
          height: 3,
          borderRadius: 2,
          background: 'var(--w14-rule)',
          overflow: 'hidden',
        }}
      >
        <div
          className="w14-einrichtung-balken"
          style={{
            height: '100%',
            width: `${anteil}%`,
            borderRadius: 2,
            background: data.kannVerkaufen ? 'var(--w14-gold)' : 'var(--w14-danger)',
          }}
        />
      </div>

      {!data.kannVerkaufen ? (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--w14-schrift-zeile)',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {haltenDenVerkaufAuf.length === 1
            ? 'Eine Aufgabe hält den Verkauf auf. Sie steht hier, damit sie nicht erst beim Bezahlen auffällt. Ein Klick führt hin.'
            : `${haltenDenVerkaufAuf.length} Aufgaben halten den Verkauf auf. Sie stehen hier, damit sie nicht erst beim Bezahlen auffallen. Ein Klick führt hin.`}
          {haltenSonstAuf.length > 0 && (
            /* Leiser danebengesetzt: der Steuerexport eilt zum Monatsende,
               nicht am Tresen. Eine eigene Zahl, damit die erste stimmt. */
            <>
              {' '}
              <span style={{ color: 'var(--w14-ink-faded)' }}>
                {haltenSonstAuf.length === 1
                  ? 'Eine weitere wartet auf die Steuerausfuhr.'
                  : `${haltenSonstAuf.length} weitere warten auf die Steuerausfuhr.`}
              </span>
            </>
          )}
        </p>
      ) : (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--w14-schrift-zeile)',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {offen.length === 1
            ? 'Eine Aufgabe ist noch offen. Ein Klick führt hin.'
            : `${offen.length} Aufgaben sind noch offen. Ein Klick führt hin.`}
        </p>
      )}

      <ol
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'grid',
          gap: 'var(--w14-abstand-4)',
        }}
      >
        {offen.map((s) => (
          <SchrittZeile
            key={s.titel}
            schritt={s}
            gesperrt={s.ziel.nurInhaber && !darfAlles}
            hingehen={() => navigate(adresse(s.ziel))}
          />
        ))}
      </ol>

      {geschafft.length > 0 ? (
        <details style={{ marginTop: 'var(--w14-abstand-4)' }}>
          <summary
            className="w14-smallcaps"
            style={{
              cursor: 'pointer',
              listStyle: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--w14-abstand-4)',
              fontSize: 'var(--w14-schrift-zeile)',
              color: 'var(--w14-ink-aged)',
              letterSpacing: '0.08em',
              minHeight: 32,
            }}
          >
            <Icon icon={ChevronRight} size={14} aria-hidden style={{ color: 'var(--w14-ink-aged)' }} />
            <Icon icon={Check} size={14} aria-hidden style={{ color: 'var(--w14-verdigris)' }} />
            Erledigt · {geschafft.length}
          </summary>
          <ul
            style={{
              margin: 'var(--w14-abstand-4) 0 0',
              padding: 0,
              listStyle: 'none',
              display: 'grid',
              gap: 'var(--w14-abstand-2)',
            }}
          >
            {geschafft.map((s) => (
              <li
                key={s.titel}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  alignItems: 'start',
                  gap: 'var(--w14-abstand-8)',
                  padding: 'var(--w14-abstand-4) var(--w14-abstand-8)',
                }}
              >
                <Icon
                  icon={Check}
                  size={14}
                  aria-hidden
                  style={{ color: 'var(--w14-verdigris)', marginTop: '0.2em' }}
                />
                <span style={{ display: 'grid', gap: 'var(--w14-abstand-2)', minWidth: 0 }}>
                  <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
                    <strong style={{ color: 'var(--w14-ink)' }}>{s.titel}</strong>
                  </span>
                  <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-aged)' }}>
                    {s.erklaerung}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/**
 * Eine offene Aufgabe mit Griff.
 *
 * ⚠️ Ein `button`, kein `div` mit `onClick`: der Punkt muss mit der Tastatur
 * erreichbar sein und dem Vorleseprogramm sagen, dass er etwas TUT.
 *
 * ⚠️ Und wenn das Ziel dem Inhaber vorbehalten ist und der Angemeldete nicht
 * der Inhaber ist, gibt es KEINEN Knopf, sondern einen ehrlichen Satz. Ein
 * blinder Knopf, der auf eine Sperrfläche führt, ist schlimmer als kein Knopf.
 */
function SchrittZeile({
  schritt: s,
  gesperrt,
  hingehen,
}: {
  schritt: Schritt;
  gesperrt: boolean;
  hingehen: () => void;
}): JSX.Element {
  const [ueber, setzeUeber] = useState(false);

  const inhalt = (
    <>
      {/* Der leere Ring: die Aufgabe wartet. Sein Rand trägt den Ernst. */}
      <span
        aria-hidden
        style={{
          width: 14,
          height: 14,
          marginTop: '0.25em',
          flexShrink: 0,
          borderRadius: '50%',
          border: `1.5px solid ${tonFarbe(s.sperre)}`,
          background: 'transparent',
        }}
      />
      <span style={{ display: 'grid', gap: 'var(--w14-abstand-2)', minWidth: 0 }}>
        <span style={{ fontSize: 'var(--w14-schrift-text)', color: 'var(--w14-ink)' }}>
          <strong>{s.titel}</strong>
          {' · '}
          <span style={{ color: tonFarbe(s.sperre) }}>{SPERRE_WORT[s.sperre] ?? s.sperre}</span>
        </span>
        <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
          {s.erklaerung}
        </span>
        <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-aged)' }}>
          {gesperrt ? `Das trägt der Inhaber ein, unter ${s.wohin}.` : `Öffnen: ${s.wohin}`}
        </span>
      </span>
    </>
  );

  const rahmen = {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto',
    alignItems: 'start',
    gap: 'var(--w14-abstand-8)',
    width: '100%',
    textAlign: 'left' as const,
    padding: 'var(--w14-abstand-8)',
    borderRadius: 'var(--w14-radius-card)',
    border: '1px solid transparent',
    background: 'transparent',
    font: 'inherit',
    color: 'inherit',
  };

  if (gesperrt) {
    return (
      <li>
        <div style={{ ...rahmen, cursor: 'default' }}>
          {inhalt}
          <Icon
            icon={Lock}
            size={16}
            style={{ color: 'var(--w14-ink-aged)', marginTop: '0.2em' }}
            aria-label="Dem Inhaber vorbehalten"
          />
        </div>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={hingehen}
        onMouseEnter={() => setzeUeber(true)}
        onMouseLeave={() => setzeUeber(false)}
        onFocus={() => setzeUeber(true)}
        onBlur={() => setzeUeber(false)}
        aria-label={`${s.titel} einrichten, öffnet ${s.wohin}`}
        style={{
          ...rahmen,
          cursor: 'pointer',
          minHeight: 44,
          borderColor: ueber ? 'var(--w14-rule)' : 'transparent',
          background: ueber ? 'var(--w14-parchment-2)' : 'transparent',
          // Ruhig und kurz. Eine Tafel, die beim Ausklappen federt, wirkt
          // verspielt an einer Stelle, an der es um eine Sperre geht.
          transition:
            'background var(--w14-dur-fast) var(--w14-ease-hover), border-color var(--w14-dur-fast) var(--w14-ease-hover)',
        }}
      >
        {inhalt}
        <Icon
          icon={ArrowRight}
          size={18}
          aria-hidden
          style={{
            color: ueber ? tonFarbe(s.sperre) : 'var(--w14-ink-aged)',
            marginTop: '0.2em',
            transform: ueber ? 'translateX(3px)' : 'none',
            transition:
              'transform var(--w14-dur-fast) var(--w14-ease-hover), color var(--w14-dur-fast) var(--w14-ease-hover)',
          }}
        />
      </button>
    </li>
  );
}

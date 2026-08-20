/**
 * „Alle Flächen" — der sichtbare Weg zu allem, was nicht auf der Schiene liegt.
 *
 * ── DER FUND (Basel, 25.07.2026) ───────────────────────────────────────────
 * „كان في داشبورد متصلة بل ريسكو والمخاطر وهل أمور موصوله بكلودفير؟ ماشوفها؟"
 *
 * Er hat recht, und die Flächen sind NICHT verschwunden. Risikoanalyse,
 * Leitstand und Schaufenster (der Edge-Schutz von Cloudflare) sind alle drei
 * gebaut, verdrahtet und im Register eingetragen. Sie sind nur `secondary` —
 * und eine sekundäre Fläche war bis heute AUSSCHLIESSLICH über die
 * Spotlight-Suche erreichbar. Kein Menü, kein Knopf, keine Liste.
 *
 * Wer die Suche kennt und das richtige Wort tippt, findet sie in zwei
 * Sekunden. Wer sie nicht kennt, findet sie nie — und für ihn ist die Fläche
 * so gut wie nicht gebaut. Sechsundzwanzig Flächen hingen an einem Wort, das
 * man raten musste.
 *
 * Diese Fläche zeigt sie alle, gruppiert, mit ihrem Beschreibungssatz aus dem
 * Register. Nichts wird hier doppelt gepflegt: Titel, Satz und Sichtbarkeit
 * kommen aus `surface-registry.ts`, damit eine neue Fläche automatisch
 * erscheint und eine entfernte automatisch verschwindet.
 */

import { useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { Zwischentitel } from '@norns/ui-kit';

import {
  SECONDARY_SURFACES,
  type SurfaceDescriptor,
  visibleSurfaces,
} from '../../app/chrome/surface-registry.js';
import { Reveal } from '../../lib/motion.js';
import { useSessionStore } from '../../state/session-store.js';

// 20.08.2026: `GRUPPEN` wohnt jetzt in `gruppen.ts` — eine Liste ist keine
// Fläche. Hier steht nur noch die Wiederausfuhr, damit die bestehenden Leser
// nicht auf einen Schlag umziehen müssen.
import { GRUPPEN } from './gruppen.js';

export { GRUPPEN };


export function Uebersicht(): JSX.Element {
  // ── Die Kartenwand ist Geschichte (27.07.2026, Basels Ordnung) ─────────
  // Die sekundaeren Flaechen wohnen jetzt gruppiert in der Einstellungs-
  // Spalte (EIN Ort, EIN Weg). Dieser Pfad lebt als Weiche weiter, damit
  // alte Tiefenlinks, Spotlight-Treffer und Muskelgedaechtnis nicht ins
  // Leere greifen. GRUPPEN oben bleibt exportiert: die Einstellungs-Spalte
  // liest die Ordnung von HIER — eine Wahrheit, kein Zwilling.
  return <Navigate to="/einstellungen" replace />;
}

// Bewusst unbenutzt aufbewahrt (Referenz der alten Kartenwand, greppbar).
void UebersichtKartenwandAusgemustert;
function UebersichtKartenwandAusgemustert(): JSX.Element {
  const navigate = useNavigate();

  // 14.08.2026: hier stand die Rechnung fuer die ausgegrauten Online-Kacheln.
  // Der Kundenshop ist mit der Trennung von warehouse14 gefallen, es gibt
  // keine Online-Kachel mehr auszugrauen.
  const isOwner = useSessionStore((s) => s.actor?.isOwner ?? false);

  const { gruppen, weiteres } = useMemo(() => {
    const sichtbar = visibleSurfaces(SECONDARY_SURFACES, isOwner);
    const nachPfad = new Map(sichtbar.map((s) => [s.path, s]));
    const vergeben = new Set<string>();

    const gruppen = GRUPPEN.map((g) => {
      const flaechen: SurfaceDescriptor[] = [];
      for (const pfad of g.pfade) {
        const s = nachPfad.get(pfad);
        if (s) {
          flaechen.push(s);
          vergeben.add(pfad);
        }
      }
      return { ...g, flaechen };
    }).filter((g) => g.flaechen.length > 0);

    // Was in keine Gruppe fiel, verschwindet NICHT — es bekommt eine eigene.
    // Eine Liste, die still etwas auslässt, ist schlimmer als eine unordentliche.
    // Nur diese Fläche selbst fehlt: eine Kachel, die auf den Bildschirm führt,
    // auf dem man schon steht, ist keine Hilfe.
    const weiteres = sichtbar.filter((s) => !vergeben.has(s.path) && s.path !== '/uebersicht');
    return { gruppen, weiteres };
  }, [isOwner]);

  const alle = [
    ...gruppen,
    ...(weiteres.length > 0
      ? [{ titel: 'Weiteres', satz: 'Noch nicht einsortiert.', flaechen: weiteres }]
      : []),
  ];

  return (
    <section
      aria-label="Alle Flächen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--w14-abstand-20)',
        gap: 'var(--w14-abstand-14)',
        overflow: 'auto',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-12)' }}>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-summe)',
          }}
        >
          Alle Flächen
        </h1>
        <span
          className="w14-smallcaps"
          style={{ color: 'var(--w14-ink-faded)', letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)' }}
        >
          {alle.reduce((n, g) => n + g.flaechen.length, 0)} erreichbar
        </span>
      </header>
      <Zwischentitel />

      {/* Die Gruppen legen sich beim Erscheinen nacheinander hin — EINE
          Staffelung je GRUPPE (höchstens sechs Schritte), nicht je Kachel:
          dreissig einzeln aufblitzende Kacheln wären Unruhe, sechs sich
          setzende Abschnitte sind ein Karteikasten, der geöffnet wird.
          <Reveal> deckt reduced-motion selbst ab (dann sofort sichtbar). */}
      {alle.map((g, gi) => (
        <Reveal key={g.titel} index={Math.min(gi, 5)} style={{ display: 'grid', gap: 'var(--w14-abstand-8)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--w14-abstand-10)', flexWrap: 'wrap' }}>
            <h2
              style={{
                margin: 0,
                fontFamily: 'var(--w14-font-display)',
                fontWeight: 500,
                fontSize: 'var(--w14-schrift-grund)',
              }}
            >
              {g.titel}
            </h2>
            <span style={{ fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-faded)' }}>{g.satz}</span>
          </div>

          <div
            style={{
              display: 'grid',
              // Ohne Haltepunkte: die Kacheln ordnen sich nach der Breite, die
              // wirklich da ist. Auf einem Tresen-Bildschirm sind das drei, auf
              // einem Laptop zwei.
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 'var(--w14-abstand-8)',
            }}
          >
            {g.flaechen.map((s) => (
              <button
                key={s.path}
                type="button"
                onClick={() => navigate(s.path)}
                style={{
                  textAlign: 'left',
                  display: 'grid',
                  gap: 'var(--w14-abstand-2)',
                  padding: 'var(--w14-abstand-12) var(--w14-abstand-14)',
                  minHeight: 72,
                  // Kachel = Karte: die Karten-Marke, kein stummer Zwischenwert.
                  borderRadius: 'var(--w14-radius-card)',
                  border: '1px solid var(--w14-rule)',
                  background: 'var(--w14-parchment-2)',
                  cursor: 'pointer',
                  font: 'inherit',
                  color: 'var(--w14-ink)',
                }}
              >
                <span style={{ fontSize: 'var(--w14-schrift-betont)', fontWeight: 600 }}>
                  {s.label}
                </span>
                <span
                  style={{
                    fontSize: 'var(--w14-schrift-zeile)',
                    color: 'var(--w14-ink-faded)',
                    lineHeight: 1.45,
                  }}
                >
                  {s.description}
                </span>
              </button>
            ))}
          </div>
        </Reveal>
      ))}
    </section>
  );
}

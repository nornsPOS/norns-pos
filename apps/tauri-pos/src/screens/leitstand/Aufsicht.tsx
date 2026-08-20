/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Aufsicht — vier Türen sind eine geworden
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── BASELS ANWEISUNG (20.08.2026) ──────────────────────────────────────────
 *
 * „Leg sie logisch zusammen, nach Dienst und Wichtigkeit — besonders das
 * Konfliktpostfach."
 *
 * Die Gruppe „Aufsicht und Schutz" trug FÜNF Türen nebeneinander in der
 * Einstellungs-Spalte: Leitstand, Konfliktpostfach, Risikoanalyse, Zielkarte,
 * Tagebuch. Vier davon beantworten dieselbe Frage — „läuft alles, und was ist
 * passiert?" — und der Leitstand sagte das im eigenen Quelltext schon selbst:
 * er trage „die Türen in die tieferen Überwachungsflächen".
 *
 * Wer die Antwort sucht, klickte trotzdem viermal an verschiedenen Stellen.
 *
 * ── WAS HIER ZUSAMMENKOMMT ─────────────────────────────────────────────────
 *
 *   Übersicht    — der Systemzustand, wie der Leitstand ihn zeigt
 *   Konflikte    — die Buchungen, die beim Nachtragen abgewichen sind
 *   Risiko       — Warnungen, Beobachtungsliste, Sanktionen
 *   Tagebuch     — was wirklich passiert ist, Zeile für Zeile
 *
 * Die Zielkarte bleibt eigenständig: sie zeigt ZIELE, nicht den Zustand. Sie
 * gehört zum Geschäft, nicht zur Aufsicht.
 *
 * ── WARUM DIE FLÄCHEN SELBST UNANGETASTET BLEIBEN ──────────────────────────
 *
 * ⚠️ Zusammengelegt wird die NAVIGATION, nicht der Quelltext. Die vier
 * Flächen sind zusammen rund 1600 Zeilen, jede mit eigenen Abfragen, eigenen
 * Riegeln und eigenen Proben — vier davon in eine Datei zu giessen wäre genau
 * das „alles ineinanderstopfen", gegen das Basel sich wehrt, und es würde
 * jede ihrer Proben wertlos machen.
 *
 * Diese Hülle wählt einen Bereich und zeigt die zugehörige Fläche. Dasselbe
 * Muster führt die Einstellungs-Spalte seit dem 08.08.2026.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { InfoPunkt, Zwischentitel } from '@norns/ui-kit';

import { Konfliktpostfach } from '../secondary/Konfliktpostfach.js';
import { Tagebuch } from '../secondary/Tagebuch.js';
import { Risikoanalyse } from '../risiko/Risikoanalyse.js';
import { Leitstand } from './Leitstand.js';

/** Die vier Bereiche der Aufsicht. */
export type AufsichtBereich = 'uebersicht' | 'konflikte' | 'risiko' | 'tagebuch';

interface Bereichsangabe {
  id: AufsichtBereich;
  label: string;
  /** Ein Satz, der sagt, was der Bereich beantwortet. */
  frage: string;
}

export const AUFSICHT_BEREICHE: readonly Bereichsangabe[] = [
  { id: 'uebersicht', label: 'Übersicht', frage: 'Läuft alles?' },
  { id: 'konflikte', label: 'Konflikte', frage: 'Hängt eine Buchung fest?' },
  { id: 'risiko', label: 'Risiko', frage: 'Gibt es Warnungen?' },
  { id: 'tagebuch', label: 'Tagebuch', frage: 'Was ist passiert?' },
];

const KENNUNGEN = new Set<string>(AUFSICHT_BEREICHE.map((b) => b.id));

/** Die Adresse eines Bereichs — für Verweise von aussen. */
export function aufsichtsAdresse(bereich: AufsichtBereich): string {
  return `/leitstand?bereich=${bereich}`;
}

export function Aufsicht(): JSX.Element {
  /*
   * Der Bereich wohnt in der ADRESSE, nicht nur im Kopf des Fensters —
   * dieselbe Regel wie in den Einstellungen. Nur so lässt sich die Aufsicht
   * auf einem bestimmten Bereich öffnen, und nur so trägt der Weg zurück.
   * Ein unbekannter Wert wird ignoriert statt angenommen.
   */
  const [suche, setzeSuche] = useSearchParams();
  const ausDerAdresse = suche.get('bereich');
  const [bereich, setBereich] = useState<AufsichtBereich>(
    ausDerAdresse !== null && KENNUNGEN.has(ausDerAdresse)
      ? (ausDerAdresse as AufsichtBereich)
      : 'uebersicht',
  );

  useEffect(() => {
    if (ausDerAdresse !== null && KENNUNGEN.has(ausDerAdresse)) {
      setBereich(ausDerAdresse as AufsichtBereich);
    }
  }, [ausDerAdresse]);

  const waehlen = (id: AufsichtBereich): void => {
    setBereich(id);
    setzeSuche({ bereich: id }, { replace: true });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--w14-abstand-4)',
          padding: 'var(--w14-abstand-20) var(--w14-abstand-20) 0',
        }}
      >
        <Zwischentitel tone="gold" label="Aufsicht" style={{ flex: 1 }} />
        <InfoPunkt
          ariaLabel="Was ist die Aufsicht?"
          richtung="links"
          text="Alles, was der Inhaber im Blick behält: der Zustand der Anlage, festhängende Buchungen, Warnungen und das Tagebuch. Nur für den Inhaber."
        />
      </div>

      {/* Die vier Bereiche. Jeder trägt seine FRAGE unter dem Namen — wer
          sucht, sucht eine Antwort, nicht eine Überschrift. */}
      <nav
        aria-label="Bereiche der Aufsicht"
        style={{
          display: 'flex',
          gap: 'var(--w14-abstand-4)',
          padding: 'var(--w14-abstand-12) var(--w14-abstand-20)',
          borderBottom: '1px solid var(--w14-rule)',
          overflowX: 'auto',
          scrollbarWidth: 'thin',
        }}
      >
        {AUFSICHT_BEREICHE.map((b) => {
          const aktiv = b.id === bereich;
          return (
            <button
              key={b.id}
              type="button"
              aria-current={aktiv ? 'page' : undefined}
              onClick={() => waehlen(b.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 'var(--w14-abstand-2)',
                minHeight: 44,
                padding: 'var(--w14-abstand-8) var(--w14-abstand-12)',
                borderRadius: 'var(--w14-radius-button)',
                border: '1px solid',
                borderColor: aktiv ? 'var(--w14-gold)' : 'transparent',
                background: aktiv ? 'var(--w14-parchment-3)' : 'transparent',
                color: aktiv ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
                cursor: 'pointer',
                textAlign: 'left',
                flex: '0 0 auto',
                transition: 'color var(--w14-dur-fast) var(--w14-ease-hover)',
              }}
            >
              <span style={{ fontSize: 'var(--w14-schrift-betont)', fontWeight: aktiv ? 600 : 500 }}>
                {b.label}
              </span>
              <span
                style={{
                  fontSize: 'var(--w14-schrift-zeile)',
                  color: 'var(--w14-ink-faded)',
                  fontFamily: 'var(--w14-font-display)',
                  fontStyle: 'italic',
                }}
              >
                {b.frage}
              </span>
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {bereich === 'uebersicht' && <Leitstand />}
        {bereich === 'konflikte' && <Konfliktpostfach />}
        {bereich === 'risiko' && <Risikoanalyse />}
        {bereich === 'tagebuch' && <Tagebuch />}
      </div>
    </div>
  );
}

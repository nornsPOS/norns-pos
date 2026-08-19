/**
 * SurfaceChip — one chip in the Karteikasten-Index top rail.
 *
 * Locked by memory.md §11.2:
 *   <mono digit>  ·  <Cormorant small-caps label>
 *
 * Visual states (resting / hover / active) implemented inline so the rail
 * never blinks during route transitions. The active state owns a 2 px
 * gold hairline; hover raises a 2 px gold-soft hairline. No box, no fill.
 */

import type { CSSProperties } from 'react';

import { Icon, type LucideIcon } from '@norns/ui-kit';

export interface SurfaceChipProps {
  digit: number;
  label: string;
  description: string;
  /** Das Zeichen der Fläche aus dem surface-registry (27.07.2026). */
  icon: LucideIcon;
  /**
   * Die Farbe des Zeichens im RUHENDEN Reiter, nach Taetigkeit
   * (19.08.2026, `symbolfarbe.ts`). Der aktive Reiter bleibt gold — er ist
   * der Ort, an dem der Haendler gerade steht, und diese Aussage schlaegt
   * jede Taetigkeitsfarbe.
   */
  symbolfarbe?: string;
  active: boolean;
  onActivate: () => void;
  className?: string;
  style?: CSSProperties;
}

export function SurfaceChip({
  digit,
  label,
  description,
  icon,
  symbolfarbe,
  active,
  onActivate,
  className,
  style,
}: SurfaceChipProps): JSX.Element {
  const containerStyle: CSSProperties = {
    // `relative`, damit der goldene Strich unten im Knopf verankert liegt und
    // sich mit transform bewegen darf (Bewegungsregel: nie Layout animieren).
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'baseline',
    // Verdichtet (27.07.2026): mit 8er-Fuge, 10er-Polster und 0.08em Sperrung
    // brauchten die acht Reiter 889 Punkte — bei 1280 Fensterbreite standen
    // nur 737 zur Verfuegung. Reiter 7 war mitten im Wort abgeschnitten,
    // Reiter 8 UNSICHTBAR, und der Roller trug keinerlei Anzeichen. Gemessen
    // im lebenden Browser. Die gesperrte Form „Ziffer · Name" bleibt; nur
    // Fuge, Polster und Sperrung ruecken zusammen, bis alle acht bei 1280
    // WIRKLICH stehen.
    gap: 'var(--w14-abstand-4)',
    padding: 'var(--w14-abstand-6) var(--w14-abstand-6)',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: active ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
    // Der 2-px-Boden bleibt IMMER reserviert (transparent), damit der Wechsel
    // auf aktiv nie das Layout verschiebt. Aktiv zeichnet nicht mehr der Rand,
    // sondern der animierte Strich unten — der Rand traegt nur noch den Hover.
    borderBottom: '2px solid transparent',
    transition:
      'border-color var(--w14-dur-fast) var(--w14-ease-curator),' +
      ' color var(--w14-dur-fast) var(--w14-ease-curator)',
    ...style,
  };

  const digitStyle: CSSProperties = {
    display: 'inline-flex',
    alignSelf: 'center',
    color: active ? 'var(--w14-gold)' : (symbolfarbe ?? 'inherit'),
  };

  const labelStyle: CSSProperties = {
    fontFamily: 'var(--w14-font-display)',
    fontVariant: 'all-small-caps',
    letterSpacing: '0.05em',
    fontSize: 'var(--w14-schrift-feld)',
    fontWeight: 500,
  };

  return (
    <button
      type="button"
      // Die Ziffer bleibt als Tastenkuerzel am Leben — sie wohnt jetzt im
      // Tooltip statt im Reiter selbst (Basels Zeichen-Dekret, 27.07.2026).
      title={`Taste ${digit} · ${description}`}
      aria-current={active ? 'page' : undefined}
      onClick={onActivate}
      onMouseEnter={(ev) => {
        if (active) return;
        (ev.currentTarget as HTMLButtonElement).style.borderBottomColor = 'var(--w14-gold-soft)';
        (ev.currentTarget as HTMLButtonElement).style.color = 'var(--w14-ink-aged)';
      }}
      onMouseLeave={(ev) => {
        // IMMER zuruecksetzen, auch auf dem aktiven Reiter. Der alte fruehe
        // Ausstieg liess die von Hand gesetzte Hover-Farbe stehen, wenn man den
        // Reiter anklickte (aktiv wurde) und erst danach den Zeiger wegzog —
        // React schreibt die konstante border-Eigenschaft nie neu, also blieb
        // der Strich haengen, bis der Reiter wieder inaktiv war. Am laufenden
        // Bild gefunden (27.07.2026). Den aktiven Strich zeichnet ohnehin der
        // Span unten, nicht mehr der Rand.
        (ev.currentTarget as HTMLButtonElement).style.borderBottomColor = 'transparent';
        if (active) return;
        (ev.currentTarget as HTMLButtonElement).style.color = 'var(--w14-ink-faded)';
      }}
      className={className}
      style={containerStyle}
    >
      {/* Das Zeichen statt der Ziffer (27.07.2026): „ein Zahnrad braucht
          kein Wort" — und eine Ziffer erklaert die Flaeche nicht. Das
          allgemein bekannte Zeichen tut es auf einen Blick; die Ziffer
          arbeitet weiter als Taste und steht im Tooltip. Gemessen: das
          15er-Zeichen ist schmaler als Ziffer plus Mittelpunkt, die acht
          Reiter stehen weiter bei 1280. */}
      <span style={digitStyle} aria-hidden>
        <Icon icon={icon} size={15} className="w14-symbol" />
      </span>
      <span style={labelStyle}>{label}</span>
      {active && (
        // Der goldene Strich entfaltet sich beim Wechsel aus der Mitte —
        // einmal, beim Aktivwerden (der Span wird dann neu aufgebaut). Nur
        // transform + opacity; die Keyframes stehen in AppShellHeader.
        <span
          aria-hidden
          className="w14-chip-strich"
          style={{
            position: 'absolute',
            left: 6,
            right: 6,
            bottom: 0,
            height: 2,
            background: 'var(--w14-gold)',
            transformOrigin: 'center',
          }}
        />
      )}
    </button>
  );
}

/**
 * SuchFeld — das eine Suchfeld der Kasse.
 *
 * WARUM ES DAS GIBT (Basel, 25.07.2026): „مافي بحث برقم الفاتورة". Weder die
 * Bestellungen noch das Kassenbuch hatten eine Suche. Am Tresen steht ein
 * Mensch und sagt eine Nummer; ohne Suche wird gescrollt, während er wartet.
 *
 * WAS ES ANDERS MACHT ALS EIN NACKTES `<input>`
 *
 *   • ES BRENNT NICHT AUF DEM PAPIER: die Lupe ist das Zeichen des Hauses
 *     (`MagnifierIcon`), nicht das allgemeine Glas irgendeiner Bibliothek, und
 *     sie ist STUMM für die Vorlesehilfe — daneben steht ein benanntes Feld,
 *     und zweimal „Suche" vorgelesen zu bekommen hilft niemandem.
 *
 *   • DIE ESC-TASTE LEERT. Wer sich vertippt, will nicht siebenmal die
 *     Rücktaste drücken. Der Fokus BLEIBT danach im Feld, sonst muss man erst
 *     wieder hineinklicken, um neu zu tippen.
 *
 *   • DER LÖSCH-KNOPF ERSCHEINT NUR, WENN ES ETWAS ZU LÖSCHEN GIBT, und er ist
 *     32 mal 32 gross. Ein 12-Pixel-Kreuzchen ist an einem Tresen mit kalten
 *     Fingern kein Ziel.
 *
 *   • ES IST EIN `type="search"` OHNE die Browser-eigene Löschtaste
 *     (`appearance: none`): sonst stehen zwei Kreuzchen nebeneinander, eines
 *     davon in einer fremden Gestalt.
 */

import { type CSSProperties, useId, useRef } from 'react';

import { MagnifierIcon } from '@norns/ui-kit';

export interface SuchFeldProps {
  wert: string;
  setzen: (wert: string) => void;
  /** Was im leeren Feld steht. Nennt die Beispiele, nach denen gesucht wird. */
  platzhalter?: string;
  /** Der vorgelesene Name des Feldes. Immer deutsch, nie leer. */
  name?: string;
  /** Breite der Spur. Vorgabe passt in eine Kopfleiste. */
  breite?: number;
}

const RAHMEN: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--w14-abstand-8)',
  height: 38,
  padding: '0 var(--w14-abstand-6) 0 var(--w14-abstand-12)',
  borderRadius: 'var(--w14-radius-pille)',
  border: '1px solid var(--w14-rule)',
  background: 'var(--w14-parchment-2)',
};

export function SuchFeld({
  wert,
  setzen,
  platzhalter = 'Nummer, Name, Telefon oder Stück',
  name = 'Suchen',
  breite = 300,
}: SuchFeldProps): JSX.Element {
  const feldId = useId();
  const feld = useRef<HTMLInputElement>(null);
  const hatText = wert.length > 0;

  return (
    <div style={{ ...RAHMEN, width: breite, maxWidth: '100%' }}>
      {/* Zierde, kein Name: das Feld daneben trägt den Namen. */}
      <MagnifierIcon size={16} tone="faded" aria-hidden />
      <label htmlFor={feldId} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        {name}
      </label>
      <input
        id={feldId}
        ref={feld}
        type="search"
        value={wert}
        onChange={(e) => setzen(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && hatText) {
            // Nicht weiterreichen: sonst schliesst ein umgebender Dialog mit,
            // und der Mensch verliert die Fläche statt nur seiner Eingabe.
            e.stopPropagation();
            e.preventDefault();
            setzen('');
          }
        }}
        placeholder={platzhalter}
        // Ein Suchfeld ist kein Passwortfeld und auch kein Name: der Browser
        // soll hier nichts vorschlagen und nichts gross schreiben.
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        style={{
          flex: 1,
          minWidth: 0,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--w14-ink)',
          fontFamily: 'var(--w14-font-inter)',
          fontSize: 'var(--w14-schrift-text)',
          // Die eigene Löschtaste des Browsers abschalten — sonst zwei Kreuze.
          appearance: 'none',
          WebkitAppearance: 'none',
        }}
      />
      {hatText && (
        <button
          type="button"
          onClick={() => {
            setzen('');
            feld.current?.focus();
          }}
          aria-label="Suche leeren"
          title="Suche leeren (Esc)"
          style={{
            width: 32,
            height: 32,
            flex: '0 0 auto',
            display: 'grid',
            placeItems: 'center',
            borderRadius: 'var(--w14-radius-pille)',
            border: 'none',
            background: 'transparent',
            color: 'var(--w14-ink-aged)',
            cursor: 'pointer',
            fontSize: 'var(--w14-schrift-grund)',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

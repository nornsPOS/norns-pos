/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Der Zettel — ein Notfallschlüssel, genau einmal sichtbar
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Diese Fläche hat EINE Aufgabe, und sie ist unüblich für einen Bildschirm:
 * sie soll dazu führen, dass jemand etwas mit der Hand aufschreibt.
 *
 * Daraus folgt jede Entscheidung hier:
 *
 *   • Der Schlüssel steht gross, in gleichbreiter Schrift, in Vierergruppen.
 *     Wer abschreibt, verliert sonst die Stelle.
 *   • Kein Knopf „Kopieren". Die Zwischenablage ist der Ort, an dem ein
 *     Geheimnis liegen bleibt — und ein Schlüssel, der in einer Nachricht
 *     landet, ist genau die zweite Kopie, die es nicht geben darf.
 *   • Der Weg weiter ist mit Absicht schwer: ein Häkchen, das man setzen
 *     muss. Ein einzelner „Weiter"-Knopf wird weggeklickt, und der Schlüssel
 *     ist fort.
 *   • Der Satz nennt die Folge, nicht die Vorschrift: was passiert, wenn er
 *     fehlt.
 */

import { useState } from 'react';

import { Button, ParchmentCard, Zwischentitel } from '@norns/ui-kit';

interface Eigenschaften {
  schluessel: string;
  /** Kopfzeile — beim ersten Mal anders als beim Erneuern. */
  titel?: string;
  onWeiter: () => void;
  weiterLabel?: string;
}

export function SchluesselZettel({
  schluessel,
  titel = 'Ihr Notfallschlüssel',
  onWeiter,
  weiterLabel = 'Notiert, weiter zur Kasse',
}: Eigenschaften): JSX.Element {
  const [notiert, setNotiert] = useState(false);

  return (
    <ParchmentCard
      style={{
        maxWidth: 560,
        margin: '0 auto',
        padding: 'var(--w14-abstand-24)',
        textAlign: 'center',
      }}
    >
      <Zwischentitel label={titel} />

      <p
        style={{
          margin: 'var(--w14-abstand-12) auto 0',
          maxWidth: '46ch',
          lineHeight: 1.6,
          color: 'var(--w14-ink-aged)',
          textWrap: 'pretty',
        }}
      >
        Schreiben Sie ihn jetzt auf und legen Sie ihn dorthin, wo Sie Ihre
        Geschäftspapiere aufbewahren. Er steht genau einmal hier.
      </p>

      {/*
        ── DER SCHLÜSSEL, WIE MAN IHN ABSCHREIBT ───────────────────────────

        ⛔ ZWEIMAL AM LAUFENDEN BILDSCHIRM GESEHEN (21.08.2026):

        Erst als EIN Text gesetzt — er brach mitten im Kasten um, und der
        Bindestrich stand am Zeilenende wie eine Worttrennung:

            NORNS-AT6R-P57G-RVH4-
            LE8U

        Dann gruppenweise umbrechend — der Strich stand immer noch am Ende.
        Wer das abschreibt, schreibt einen Strich zu viel oder zu wenig.

        ── DIE LÖSUNG KOMMT AUS DEM MOTOR ──────────────────────────────────

        `normiereSchluessel` in `@norns/auth-pin` WIRFT DAS VORWORT WEG,
        bevor es prüft: „NORNS" gehört gar nicht zum Geheimnis, es steht auf
        jedem Zettel gleich. Das Geheimnis sind die sechzehn Zeichen.

        Also wird es auch so gezeigt: das Vorwort als leise Zeile darüber,
        die vier Gruppen darunter, gross und mit Luft dazwischen. Kein
        Strich, der am Zeilenende lügt; ein Umbruch fällt gar nicht mehr auf.
        Wer nur die vier Gruppen abschreibt, kommt trotzdem hinein.
      */}
      <div
        // Für Vorleseprogramme buchstabenweise, sonst spricht die Stimme die
        // Gruppen als Silbenbrei.
        aria-label={`Notfallschlüssel: ${[...schluessel.replace(/^NORNS-/, '')].join(' ')}`}
        style={{
          margin: 'var(--w14-abstand-20) 0',
          padding: 'var(--w14-abstand-16) var(--w14-abstand-12)',
          border: '1px solid var(--w14-rule)',
          borderRadius: 'var(--w14-radius-button)',
          background: 'var(--w14-parchment-3)',
          userSelect: 'text',
        }}
      >
        <span
          className="w14-smallcaps"
          aria-hidden="true"
          style={{
            display: 'block',
            fontSize: 'var(--w14-schrift-kuerzel)',
            letterSpacing: '0.14em',
            color: 'var(--w14-ink-faded)',
            marginBottom: 'var(--w14-abstand-8)',
          }}
        >
          Norns
        </span>
        <span
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 'var(--w14-abstand-6) var(--w14-abstand-16)',
            fontFamily: 'var(--w14-font-mono)',
            // Die Stufe der Leiter: dieselbe Leseweite wie eine Summe im
            // Stehen, denn genau so wird er gelesen — über den Tresen hinweg.
            fontSize: 'var(--w14-schrift-summe)',
            letterSpacing: '0.1em',
            color: 'var(--w14-ink)',
            lineHeight: 1.35,
          }}
        >
          {schluessel
            .replace(/^NORNS-/, '')
            .split('-')
            .map((teil) => (
              <span key={teil} style={{ whiteSpace: 'nowrap' }}>
                {teil}
              </span>
            ))}
        </span>
      </div>

      <p
        style={{
          margin: 0,
          maxWidth: '44ch',
          marginInline: 'auto',
          lineHeight: 1.6,
          fontSize: 'var(--w14-schrift-zeile)',
          color: 'var(--w14-wax-red)',
          textWrap: 'pretty',
        }}
      >
        Mit ihm setzen Sie einen neuen Kassencode, falls Sie Ihren vergessen.
        Anmelden kann man sich damit nicht. Ohne ihn kommt niemand mehr in
        diese Kasse, auch wir nicht.
      </p>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--w14-abstand-8)',
          margin: 'var(--w14-abstand-20) 0 var(--w14-abstand-12)',
          minHeight: 44,
          cursor: 'pointer',
          color: 'var(--w14-ink)',
        }}
      >
        <input
          type="checkbox"
          checked={notiert}
          onChange={(e) => setNotiert(e.target.checked)}
          style={{ width: 20, height: 20, accentColor: 'var(--w14-ink)' }}
        />
        Ich habe den Schlüssel aufgeschrieben.
      </label>

      {/* Der Knopf des Hauses, nicht ein nachgeschnitzter: Druckzustand,
          Tastaturfokus und Farben leben in `tokens.css` und gelten überall
          gleich. */}
      <Button variant="primary" size="lg" fullWidth disabled={!notiert} onClick={onWeiter}>
        {weiterLabel}
      </Button>
    </ParchmentCard>
  );
}

/**
 * StepUpModal — die Nachbestätigung vor einer empfindlichen Handlung.
 *
 * SIE VERLANGT DEN KASSENCODE — dieselbe PIN wie bei der Anmeldung, geprüft
 * auf dem SERVER. Ein Code, ein Schloss, ein Mensch nach § 146a AO.
 *
 * ── WARUM SIE ZUM ZWEITEN MAL UMGEBAUT WURDE (Begehung, 14.08.2026) ──────
 *
 * Die Anordnung vom 05.08.2026 lautete „ein Code, einmal, fertig": der
 * lokale Gerätecode samt Sperrschirm wurde abgeschafft, die Anmeldung ist
 * der Kassencode. App.tsx wurde umgestellt — DIESER Dialog nicht. Er
 * prüfte weiter mit `verifyLocalPin` gegen einen lokalen Datensatz, den
 * seit dem Umbau NIEMAND mehr setzen kann, und wollte im Leerfall „zum
 * Sperrschirm schicken", den es nicht mehr gibt.
 *
 * Auf jeder frischen Kasse waren damit Storno, Z-Bon, DATEV-Export und
 * Löschungen UNMÖGLICH: die Maske fragte nach einem Code, den es nie gab,
 * zählte Fehlversuche und hätte nach zehn „den Gerätecode gelöscht".
 * Gefunden in der Begehung: der erste echte Storno der frischen Bühne
 * lief gegen „Falscher Gerätecode. Noch 9 Versuche."
 *
 * Das war die Klasse „der halbe Fix an derselben Ampel": eine Quelle
 * umgestellt, die zweite übersehen.
 *
 * ── WO JETZT GEPRÜFT WIRD ────────────────────────────────────────────────
 *
 * `POST /api/auth/step-up` — der Server prüft die PIN gegen den Kassen-
 * UND den Zwangs-Hash (Stillalarm), führt seinen eigenen Fehlversuchs-
 * zähler samt Sperre, schreibt das Tagebuch und stempelt das
 * Zehn-Minuten-Fenster in die Sitzung. Der Dialog zeigt nur noch, was der
 * Server sagt. Kein zweiter Zähler, keine zweite Wahrheit.
 *
 * Esc oder ein Klick daneben bricht ab; der ursprüngliche Aufruf bekommt
 * dann seinen `STEP_UP_REQUIRED` zurück und die Fläche meldet „abgebrochen".
 */

import { useEffect, useState } from 'react';

import { ApiError, authPin } from '@norns/api-client';
import { describeError } from '@norns/i18n-de';
import { Dialog, Zwischentitel, Lock, PinPad, RomanIndex, Seal } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useSessionStore } from '../../state/session-store.js';
import { useStepUpStore } from '../../state/step-up-store.js';
import { ohneApiFehlerSatz } from '../../lib/eingereiht.js';

export function StepUpModal(): JSX.Element | null {
  const active = useStepUpStore((s) => s.active);
  const complete = useStepUpStore((s) => s.complete);
  const cancel = useStepUpStore((s) => s.cancel);

  const api = useApiClient();
  const recordStepUp = useSessionStore((s) => s.recordStepUp);

  const [pin, setPin] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /**
   * Nur ANZEIGE. Die Wahrheit über Fehlversuche und Sperren führt der
   * Server; dieser Zähler spiegelt lediglich, was in DIESEM Dialoglauf
   * schiefging, damit die Hand an der Theke den Stand sieht.
   */
  const [failedAttempts, setFailedAttempts] = useState<number>(0);

  useEffect(() => {
    if (!active) return;
    setPin('');
    setErrorMsg(null);
    setFailedAttempts(0);
  }, [active]);

  async function handleSubmit(): Promise<void> {
    // 18.08.2026: genau sechs (PinLogin traegt die Begruendung).
    if (submitting || !/^\d{6}$/.test(pin)) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      // Der Server prüft den Kassencode, zählt Fehlversuche, erkennt die
      // Zwangs-PIN und stempelt das Fenster — alles in EINEM Aufruf.
      const res = await authPin.stepUp(api, { pin });
      recordStepUp(res.lastPinStepUpAt);
      complete();
    } catch (err) {
      if (err instanceof ApiError) {
        setFailedAttempts((n) => n + 1);
        setErrorMsg(describeError(err));
      } else {
        setErrorMsg(ohneApiFehlerSatz(err));
      }
      setPin('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={active} onClose={cancel} ariaLabel="Bestätigung mit dem Kassencode" size="sm" showClose={false}>
      <div style={{ padding: 'var(--w14-abstand-24)', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {/* Strich-Schloss statt Emoji: das 🔒 im SVG-Text wurde auf Windows
              als buntes Segoe-Emoji gerendert und zerschnitt das gestempelte
              Siegel (Basels Dekret „Symbole statt Emoji", 26.07.2026). Das
              lucide-Schloss sitzt als verschachteltes SVG im 100er-Raum. */}
          <Seal size="md" tone="gold">
            <Lock x={31} y={30} width={38} height={38} strokeWidth={2} />
          </Seal>
        </div>
        <h2
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-kopf)',
            margin: '14px 0 2px',
          }}
        >
          Kassencode bestätigen
        </h2>
        <p
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: 'var(--w14-schrift-betont)',
          }}
        >
          Derselbe Code wie bei der Anmeldung.
        </p>
        <Zwischentitel />

        <PinPad
          // Die Spanne des Kassencodes, dieselbe wie auf dem Server:
          // Genau sechs Ziffern (18.08.2026): sechs Felder, Abschicken
          // beim sechsten Zeichen von selbst.
          pinLength={6}
          value={pin}
          onChange={setPin}
          onSubmit={() => void handleSubmit()}
          disabled={submitting}
          bindKeyboard
        />

        {errorMsg && (
          <p
            role="alert"
            style={{
              color: 'var(--w14-wax-red)',
              margin: '14px 0 0',
              fontSize: 'var(--w14-schrift-betont)',
            }}
          >
            {errorMsg}
          </p>
        )}

        {failedAttempts > 0 && (
          <p style={{ margin: '12px 0 0', color: 'var(--w14-wax-red-soft)' }}>
            <RomanIndex value={failedAttempts} variant="lower" tone="wax-red" />
            &nbsp;
            <span style={{ fontFamily: 'var(--w14-font-display)', fontStyle: 'italic' }}>
              Fehlversuch{failedAttempts === 1 ? '' : 'e'}
            </span>
          </p>
        )}

        <button
          type="button"
          onClick={cancel}
          style={{
            marginTop: 16,
            background: 'transparent',
            border: 'none',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            fontSize: 'var(--w14-schrift-text)',
            cursor: 'pointer',
          }}
        >
          Abbrechen (Esc)
        </button>
      </div>
    </Dialog>
  );
}

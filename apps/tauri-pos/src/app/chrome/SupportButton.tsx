/**
 * SupportButton — der Knopf im Kopf, der den Support-Code hergibt.
 *
 * ── 01.08.2026: DER SPRACHASSISTENT IST AUSGEZOGEN ──────────────────────────
 *
 * Bis heute öffnete dieses Antippen den Sprachassistenten, und der
 * Support-Code lag auf dem Rechtsklick.
 *
 * Der Assistent konnte auf einer Norns-Kasse nie verbinden, und das ist
 * gemessen, nicht vermutet: er brauchte eine Sitzung bei einem externen
 * Dienst, und der Rumpf (`src-tauri/src/tresor.rs:57`) reicht eine
 * GESCHLOSSENE Liste von vier Geheimnissen an den Motor durch — der
 * Schlüssel dieses Dienstes ist keines davon. Es gab keinen Weg, ihn
 * hineinzugeben; am 19.08.2026 sind auch seine Serverwege ausgebaut
 * (Wanderung 0149).
 *
 * Der Knopf hätte also in jedem Kopf jeder Seite gestanden und bei jedem Druck
 * dasselbe gesagt: geht nicht. Dieselbe Regel wie bei der Google-Tür in
 * `App.tsx`: eine sichtbare Tür, hinter der auf einer Kasse ohne Netz niemand
 * steht, kostet den Kassierer morgens zehn Minuten Ratlosigkeit.
 *
 * ── UND DAMIT WIRD DAS ANTIPPEN FREI ────────────────────────────────────────
 *
 * Der alte Kommentar hier beschrieb den Fehler schon selbst: „Der Code lag auf
 * dem RECHTSKLICK. Auf einem Tresen-Touchbildschirm gibt es keinen." Genau
 * dieser Griff ist jetzt frei. Antippen kopiert den Code, der Rechtsklick tut
 * dasselbe, und beide sagen, ob es geklappt hat.
 *
 * Wenn die Kasse nicht mehr druckt und der Mensch am Telefon nach dem Code
 * gefragt wird, ist Raten die falsche Antwort.
 */

import { useCallback } from 'react';

import { KOPF_ZIEL } from '../../lib/bedienziele.js';
import { useToastStore } from '../../state/toast-store.js';
import { IconSupport } from './Icons.js';
import { SUPPORT_CODE, supportZeile } from './support-code.js';

export function SupportButton(): JSX.Element {
  const addToast = useToastStore((s) => s.addToast);

  const copyCode = useCallback(() => {
    const zwischenablage = navigator.clipboard;
    if (!zwischenablage) {
      // Kein stilles Scheitern: wer den Code braucht, bekommt ihn wenigstens
      // zu lesen.
      addToast({ tone: 'info', title: 'Support-Code', body: SUPPORT_CODE });
      return;
    }
    void zwischenablage
      .writeText(supportZeile())
      .then(() =>
        addToast({ tone: 'success', title: 'Support-Code kopiert', body: SUPPORT_CODE }),
      )
      .catch(() => addToast({ tone: 'info', title: 'Support-Code', body: SUPPORT_CODE }));
  }, [addToast]);

  return (
    <button
      type="button"
      onClick={copyCode}
      onContextMenu={(e) => {
        e.preventDefault();
        copyCode();
      }}
      title={`Support-Code ${SUPPORT_CODE} kopieren`}
      aria-label={`Support-Code ${SUPPORT_CODE} in die Zwischenablage kopieren`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        // 26.07.2026: 36 → gemeinsames 44er-Touchziel (bedienziele.ts).
        width: KOPF_ZIEL,
        height: KOPF_ZIEL,
        flex: '0 0 auto',
        color: 'var(--w14-ink-faded)',
        background: 'transparent',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-button)',
        cursor: 'pointer',
      }}
    >
      <IconSupport size={20} />
    </button>
  );
}

/**
 * ShiftOpenPanel — the Kasse "no shift" sub-view.
 *
 * Empty-state hero centred on parchment. Operator types the opening float
 * (Wechselgeld), optionally a note ("Bargeld vom Tresor übernommen"), and
 * confirms. On success: toast.success + dashboard/shift query invalidation
 * so the Werkstatt footer counter lights gold within the next render.
 *
 * ── ⚠️ HIER WOHNT DER TAGESABSCHLUSS (13.08.2026) ──────────────────────────
 *
 * `closingsApi.finalize` — der Abschluss des Kassentags, der die Zeile in
 * `daily_closings` schreibt — hatte in der ganzen Kasse NULL Aufrufer; einzig
 * die Inhaber-App rief ihn. Der Händler schloss abends die Schicht, las eine
 * Erfolgsmeldung und hielt den Tag für erledigt, während für diesen Tag weder
 * Kassenbericht noch DATEV noch DSFinV-K entstehen konnten.
 *
 * Der Abschluss lebt auf DIESER Fläche und nicht im Kassenbuch, weil der
 * Server ihn ablehnt, solange noch eine Kasse offen ist
 * (`closings-finalize.ts:289`). Diese Fläche erscheint genau dann, wenn keine
 * Schicht mehr offen ist — der Knopf steht also dort, wo er auch wirkt.
 */

import { useCallback, useState } from 'react';

import { ApiError, shifts as shiftsApi } from '@norns/api-client';
import { Button, Zwischentitel, ParchmentCard } from '@norns/ui-kit';

import { useCurrentShift } from '../../hooks/useCurrentShift.js';
import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';
import { eingereihtHinweis, istSicherEingereiht, ohneApiFehlerSatz } from '../../lib/eingereiht.js';

import { EuroInput } from './EuroInput.js';
import { TagesabschlussDialog } from './TagesabschlussDialog.js';
import { describeError } from '@norns/i18n-de';

export function ShiftOpenPanel(): JSX.Element {
  const api = useApiClient();
  const { invalidateShiftScope } = useCurrentShift();
  const addToast = useToastStore((s) => s.addToast);

  const [openingFloatEur, setOpeningFloatEur] = useState<string>('200.00');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [tagesabschlussOffen, setTagesabschlussOffen] = useState<boolean>(false);

  const valid = /^\d{1,16}(\.\d{1,2})?$/.test(openingFloatEur);

  const submit = useCallback(async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const body =
        notes.trim().length > 0 ? { openingFloatEur, notes: notes.trim() } : { openingFloatEur };
      const opened = await shiftsApi.open(api, body);
      addToast({
        tone: 'success',
        title: 'Schicht eröffnet',
        body: `Wechselgeld ${formatPreview(opened.openingFloatEur)} · ID ${opened.id.slice(0, 8)}…`,
      });
      await invalidateShiftScope();
    } catch (err) {
      // Sicher eingereiht ist ein ERFOLG, kein Fehler. Siehe
      // src/lib/eingereiht.ts: ApiOfflineQueuedError erbt von `Error`
      // und NICHT von `ApiError`, deshalb fiel dieser Zweig bisher
      // durch und die Kassiererin las „Netzwerk pruefen" — worauf
      // sie folgerichtig erneut drueckte.
      if (istSicherEingereiht(err)) {
        // Kein Dialog zum Schliessen: dieses Feld sitzt fest auf dem Schirm.
        // Der Hinweis genuegt, und die Ansicht wird aufgefrischt, damit die
        // optimistisch geoeffnete Schicht sichtbar wird.
        addToast(eingereihtHinweis('Schichtöffnung'));
        await invalidateShiftScope();
        return;
      }
      if (err instanceof ApiError) {
        if (err.code === 'CONFLICT') {
          setError('Eine Schicht ist bereits geöffnet auf diesem Gerät.');
        } else if (err.code === 'DEVICE_NOT_AUTHORIZED') {
          setError('Dieses Gerät ist nicht für die Kasse autorisiert.');
        } else {
          setError(describeError(err));
        }
      } else {
        setError(ohneApiFehlerSatz(err));
      }
    } finally {
      setSubmitting(false);
    }
  }, [addToast, api, invalidateShiftScope, notes, openingFloatEur, submitting, valid]);

  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-7)',
      }}
    >
      <div
        style={{
          width: 'min(520px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-5)',
        }}
      >
      <ParchmentCard padding="lg" style={{ width: '100%', textAlign: 'center' }}>
        <h1
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-betrag)',
            margin: 'var(--space-5) 0 var(--space-1)',
          }}
        >
          Tag beginnen
        </h1>
        <p
          className="w14-smallcaps"
          style={{
            margin: 0,
            color: 'var(--w14-ink-faded)',
            letterSpacing: '0.08em',
            fontSize: 'var(--w14-schrift-feld)',
          }}
        >
          Schicht öffnen
        </p>
        <p
          style={{
            margin: 'var(--space-2) 0 0',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
          }}
        >
          Zähle dein Startgeld in der Schublade.
        </p>
        <Zwischentitel label="Eröffnung" />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-5)',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <EuroInput
              label="Startgeld"
              valueEur={openingFloatEur}
              onValueChange={setOpeningFloatEur}
              autoFocus
            />
            <p
              style={{
                margin: 0,
                color: 'var(--w14-ink-faded)',
                fontSize: 'var(--w14-schrift-feld)',
                lineHeight: 1.4,
              }}
            >
              Das Wechselgeld, mit dem du den Tag beginnst (z. B. 200 €), damit du Kunden
              herausgeben kannst.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <label
              htmlFor="kasse-notes"
              className="w14-smallcaps"
              style={{ color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-zeile)' }}
            >
              Notiz (optional)
            </label>
            <input
              id="kasse-notes"
              type="text"
              value={notes}
              onChange={(ev) => setNotes(ev.target.value)}
              disabled={submitting}
              maxLength={500}
              style={{
                width: '100%',
                border: 'none',
                outline: 'none',
                borderBottom: '2px solid var(--w14-feldlinie)',
                background: 'transparent',
                color: 'var(--w14-ink)',
                fontFamily: 'var(--w14-font-body)',
                fontSize: 'var(--w14-schrift-betont)',
                padding: 'var(--space-2) var(--space-1)',
              }}
            />
          </div>
        </div>

        {error && (
          <p
            role="alert"
            style={{
              color: 'var(--w14-wax-red)',
              margin: 'var(--space-4) 0 0',
              fontSize: 'var(--w14-schrift-betont)',
            }}
          >
            {error}
          </p>
        )}

        <div style={{ marginTop: 'var(--space-6)' }}>
          <Button
            variant="primary"
            size="lg"
            onClick={() => void submit()}
            disabled={!valid || submitting}
            fullWidth
          >
            {submitting ? 'Beginne…' : 'Tag beginnen'}
          </Button>
        </div>
      </ParchmentCard>

        {/*
          ── DER ABSCHLUSS DES KASSENTAGS ────────────────────────────────────
          Hier und nirgends sonst: es ist keine Schicht offen, also nimmt der
          Server den Abschluss überhaupt an. Bewusst ruhig gehalten und NICHT
          rot — der häufigere Fall auf dieser Fläche ist der Tagesbeginn.
        */}
        <ParchmentCard padding="md" style={{ width: '100%' }}>
          <span
            className="w14-smallcaps"
            style={{
              color: 'var(--w14-ink-aged)',
              fontSize: 'var(--w14-schrift-feld)',
              letterSpacing: '0.08em',
            }}
          >
            Kassentag abschließen
          </span>
          <p
            style={{
              margin: 'var(--space-2) 0 var(--space-4)',
              color: 'var(--w14-ink-aged)',
              fontSize: 'var(--w14-schrift-feld)',
              lineHeight: 1.5,
            }}
          >
            Es ist keine Schicht mehr offen. Jetzt lässt sich der Kassentag abschließen. Daraus
            entstehen Kassenbericht, DATEV und DSFinV-K. Der Schritt ist unwiderruflich; das Fenster
            zeigt vorher, welcher Tag gemeint ist.
          </p>
          <Button
            variant="zweit"
            size="lg"
            onClick={() => setTagesabschlussOffen(true)}
            disabled={submitting}
            fullWidth
          >
            Tagesabschluss öffnen
          </Button>
        </ParchmentCard>
      </div>

      <TagesabschlussDialog
        open={tagesabschlussOffen}
        onClose={() => setTagesabschlussOffen(false)}
      />
    </div>
  );
}

/** Tiny inline copy of the EuroInput preview, used in the success toast. */
function formatPreview(canonical: string): string {
  const [whole = '0', frac = ''] = canonical.split('.');
  const wholeFmt = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fracFmt = frac.padEnd(2, '0').slice(0, 2);
  return `${wholeFmt},${fracFmt} €`;
}

/**
 * TerminDetailSheet — right-edge drawer for one appointment: type/status
 * badge, Berlin time, status transitions (optimistic), link to the
 * Kundenakte, and an inline staff-note editor (status-less PATCH).
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { AppointmentListItem, AppointmentPatchStatus } from '@norns/api-client';
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS } from '@norns/api-client';
import { Button, DialogBody, DialogFooter, Field, Sheet, Textarea } from '@norns/ui-kit';

import { useToastStore } from '../../state/toast-store.js';
import {
  ALLOWED_APPOINTMENT_TRANSITIONS,
  APPOINTMENT_TYPE_COLORS,
  TRANSITION_ACTION_LABELS,
  berlinDayKey,
  berlinTime,
  canReschedule,
} from './appointment-display.js';
import { useOptimisticStatus, useUpdateStaffNotes } from './useTermineMutations.js';
import { grundAbfragen } from '../../lib/grund-abfragen.js';

/** The list row + the note columns the route exposes for the drawer. */
export interface TermineAppointment extends AppointmentListItem {
  staff_notes?: string | null;
  customer_notes?: string | null;
}

const dayFmt = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

interface TerminDetailSheetProps {
  appointment: TermineAppointment | null;
  onClose: () => void;
}

export function TerminDetailSheet({
  appointment,
  onClose,
}: TerminDetailSheetProps): JSX.Element | null {
  if (!appointment) return null;
  return (
    <Sheet open onClose={onClose} title="Termin-Details">
      {/* key → the note editor re-seeds when another appointment opens */}
      <DetailContent key={appointment.id} appointment={appointment} onClose={onClose} />
    </Sheet>
  );
}

function DetailContent({
  appointment,
  onClose,
}: {
  appointment: TermineAppointment;
  onClose: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const setStatus = useOptimisticStatus();
  const saveNotes = useUpdateStaffNotes();

  const seedNotes = appointment.staff_notes ?? '';
  const [notes, setNotes] = useState(seedNotes);
  const notesDirty = notes !== seedNotes;

  const color = APPOINTMENT_TYPE_COLORS[appointment.appointment_type];
  const transitions = ALLOWED_APPOINTMENT_TRANSITIONS[appointment.status];

  const transition = (status: AppointmentPatchStatus): void => {
    let reason: string | undefined;
    if (status === 'CANCELLED') {
      // Fragt nach, bis der Grund traegt. Vorher fiel ein zu kurzer Grund
      // lautlos durch, und der Termin blieb ohne ein Wort gebucht.
      const grund = grundAbfragen({
        frage: 'Warum wird der Termin abgesagt?',
        melden: (body) => addToast({ tone: 'alert', title: 'Grund zu kurz', body }),
      });
      if (grund === null) return;
      reason = grund;
    }
    setStatus.mutate(
      { id: appointment.id, status, ...(reason ? { reason } : {}) },
      {
        onError: () =>
          addToast({
            tone: 'alert',
            title: 'Statuswechsel fehlgeschlagen',
            body: 'Der Termin wurde zurückgesetzt. Bitte erneut versuchen.',
          }),
      },
    );
  };

  return (
    <>
      <DialogBody>
        <div style={{ display: 'grid', gap: 'var(--w14-abstand-16)' }}>
          {/* Type badge + status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-10)', flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-block',
                padding: 'var(--w14-abstand-2) var(--w14-abstand-10)',
                borderRadius: 'var(--w14-radius-pille)',
                background: color.bg,
                color: color.text,
                fontSize: 'var(--w14-schrift-zeile)',
                fontWeight: 600,
                letterSpacing: '0.03em',
              }}
            >
              {APPOINTMENT_TYPE_LABELS[appointment.appointment_type]}
            </span>
            <span style={{ fontSize: 'var(--w14-schrift-text)', color: 'var(--w14-ink-aged)' }}>
              {APPOINTMENT_STATUS_LABELS[appointment.status]}
            </span>
          </div>

          {/* When */}
          <div style={{ display: 'grid', gap: 'var(--w14-abstand-2)' }}>
            <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
              {dayFmt.format(new Date(appointment.starts_at))}
            </span>
            <span
              className="w14-tabular"
              style={{ fontSize: 'var(--w14-schrift-titel)', fontWeight: 600, color: 'var(--w14-ink)' }}
            >
              {berlinTime(appointment.starts_at)} bis {berlinTime(appointment.ends_at)} Uhr
            </span>
            <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
              Dauer {appointment.duration_minutes} Minuten
              {appointment.linked_product_ids.length > 0
                ? ` · ${appointment.linked_product_ids.length} verknüpfte Artikel`
                : ''}
            </span>
          </div>

          {/* Status transitions */}
          {transitions.length > 0 ? (
            <div style={{ display: 'grid', gap: 'var(--w14-abstand-8)' }}>
              <h4 style={{ margin: 0, fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-faded)' }}>
                Status ändern
              </h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--w14-abstand-8)' }}>
                {transitions.map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    variant={
                      t === 'CANCELLED' || t === 'NO_SHOW'
                        ? 'destructive'
                        : t === 'COMPLETED'
                          ? 'primary'
                          : 'ghost'
                    }
                    disabled={setStatus.isPending}
                    onClick={() => transition(t)}
                  >
                    {TRANSITION_ACTION_LABELS[t]}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-faded)' }}>
              Endzustand erreicht. Keine Statuswechsel mehr möglich.
            </p>
          )}

          {canReschedule(appointment.status) ? (
            <p style={{ margin: 0, fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
              Tipp: Ziehen Sie den Termin im Kalender auf eine neue Uhrzeit, um ihn zu verschieben.
            </p>
          ) : null}

          {/* Customer link */}
          {appointment.customer_id ? (
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/kunden?id=${appointment.customer_id}`)}
              >
                Kundenakte öffnen
              </Button>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
              Kein Kundenkonto verknüpft.
            </p>
          )}

          {/* Customer note (read-only) */}
          {appointment.customer_notes ? (
            <div style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
              <h4 style={{ margin: 0, fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-faded)' }}>
                Kundennotiz
              </h4>
              <p
                style={{
                  margin: 0,
                  fontSize: 'var(--w14-schrift-text)',
                  color: 'var(--w14-ink-aged)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {appointment.customer_notes}
              </p>
            </div>
          ) : null}

          {/* Staff note editor */}
          <Field label="Interne Notiz" hint="Nur für das Team sichtbar.">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Notiz zum Termin …"
            />
          </Field>
          <div>
            <Button
              variant="primary"
              size="sm"
              disabled={!notesDirty || saveNotes.isPending}
              onClick={() =>
                saveNotes.mutate(
                  { id: appointment.id, staffNotes: notes },
                  {
                    onSuccess: () => addToast({ tone: 'success', title: 'Notiz gespeichert' }),
                    onError: () =>
                      addToast({
                        tone: 'alert',
                        title: 'Notiz konnte nicht gespeichert werden',
                        body: 'Bitte erneut versuchen.',
                      }),
                  },
                )
              }
            >
              {saveNotes.isPending ? 'Speichert …' : 'Notiz speichern'}
            </Button>
          </div>

          <p
            className="w14-tabular"
            style={{
              margin: 0,
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-kuerzel)',
              color: 'var(--w14-ink-faded)',
            }}
          >
            {/*
              * Die KURZE Kennung. Vorher stand hier die volle UUID unter jedem
              * geoeffneten Termin — 36 Zeichen Maschinentext in einer Ansicht
              * fuer Menschen. Die ersten acht genuegen, um am Telefon denselben
              * Termin zu meinen.
              */}
            {berlinDayKey(appointment.starts_at)} · Kennung {appointment.id.slice(0, 8)}
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Schließen
        </Button>
      </DialogFooter>
    </>
  );
}

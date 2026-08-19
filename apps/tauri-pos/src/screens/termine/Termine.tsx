/**
 * Termine — the shop's scheduling cockpit (deepened AppointmentsWorkspace).
 *
 *   • Center  — FullCalendar: Tag / Woche / Monat / Liste, Europe/Berlin,
 *               colour-coded by type (gold=Ankauf · olive=Besichtigung ·
 *               ink=Beratung · terra=Abholung), drag-to-reschedule for
 *               SCHEDULED/CONFIRMED (POST /:id/reschedule, optimistic +
 *               revert on failure), empty-slot click → quick-create.
 *   • Right   — "Heute" rail with one-tap Bestätigen/Einchecken (optimistic,
 *               <400 ms) + the ICS feed subscription card (ADMIN).
 *   • Click   — detail drawer: status transitions, Kundenakte link, note edit.
 *
 * Time zone: the calendar runs on the terminal's LOCAL clock (the shop
 * hardware is in Schorndorf / Europe/Berlin). Passing a named `timeZone`
 * WITHOUT a FullCalendar timezone plugin would hand UTC-coerced fake Dates
 * to select/drop callbacks and corrupt the rescheduled instant — so we
 * deliberately stay on 'local'; the rail/drawer pin Europe/Berlin via Intl.
 */

import type {
  DateSelectArg,
  DatesSetArg,
  EventClickArg,
  EventDropArg,
  EventInput,
} from '@fullcalendar/core';
import deLocale from '@fullcalendar/core/locales/de';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { useMemo, useState } from 'react';

import { APPOINTMENT_TYPE_LABELS, type AppointmentType } from '@norns/api-client';

import { useAppointments } from '../../hooks/useAppointments.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { HeuteRail } from './HeuteRail.js';
import { ArbeitszeitenCard } from './ArbeitszeitenCard.js';
import { IcsFeedCard } from './IcsFeedCard.js';
import { QuickCreateDialog } from './QuickCreateDialog.js';
import { TerminDetailSheet, type TermineAppointment } from './TerminDetailSheet.js';
import { APPOINTMENT_TYPE_COLORS, canReschedule, toCalendarEvents } from './appointment-display.js';
import { useOptimisticReschedule } from './useTermineMutations.js';

const LEGEND: AppointmentType[] = ['BUYBACK_EVAL', 'VIEWING', 'CONSULTATION', 'PICKUP'];

export function Termine(): JSX.Element {
  const actor = useSessionStore((s) => s.actor);
  const addToast = useToastStore((s) => s.addToast);

  // Visible calendar range — seeded to the current week, updated by datesSet.
  const [range, setRange] = useState<{ from: string; to: string }>(() => {
    const now = new Date();
    return {
      from: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      to: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    };
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quickCreateStart, setQuickCreateStart] = useState<Date | null>(null);

  const { data, isError } = useAppointments(range.from, range.to);
  const reschedule = useOptimisticReschedule();

  const events = useMemo<EventInput[]>(() => toCalendarEvents(data), [data]);
  const selected: TermineAppointment | null = useMemo(
    () => (data.find((a) => a.id === selectedId) as TermineAppointment | undefined) ?? null,
    [data, selectedId],
  );

  const onDatesSet = (arg: DatesSetArg): void => {
    setRange({ from: arg.start.toISOString(), to: arg.end.toISOString() });
  };

  // Empty-slot click/select → quick-create, pre-filled with the slot start.
  const onSelect = (arg: DateSelectArg): void => {
    setQuickCreateStart(arg.start);
  };

  const onEventClick = (arg: EventClickArg): void => {
    setSelectedId(arg.event.id);
  };

  // Drag-to-reschedule → POST /:id/reschedule. The cache moves optimistically;
  // on failure FullCalendar reverts the chip and we toast.
  const onEventDrop = (arg: EventDropArg): void => {
    const appt = data.find((a) => a.id === arg.event.id);
    const newStart = arg.event.start;
    if (!appt || !newStart || !canReschedule(appt.status)) {
      arg.revert();
      return;
    }
    reschedule.mutate(
      {
        id: appt.id,
        body: { startsAt: newStart.toISOString() },
        durationMinutes: appt.duration_minutes,
      },
      {
        onSuccess: () => {
          // The clone gets a NEW id — close a drawer that points at the old one.
          setSelectedId((cur) => (cur === appt.id ? null : cur));
          addToast({ tone: 'success', title: 'Termin verschoben' });
        },
        onError: () => {
          arg.revert();
          addToast({
            tone: 'alert',
            title: 'Verschieben fehlgeschlagen',
            body: 'Der Termin bleibt auf der alten Uhrzeit.',
          });
        },
      },
    );
  };

  return (
    <div
      className="termine-cockpit"
      style={{ display: 'flex', gap: 'var(--w14-abstand-16)', height: '100%', minHeight: 0, padding: 'var(--w14-abstand-16)' }}
    >
      {/* Center — the scheduling grid */}
      <main
        aria-label="Terminkalender"
        style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-10)' }}
      >
        {/* ⚠️ Vor allem anderen. Ohne Arbeitszeiten scheitert JEDER Termin auf
            dieser Fläche mit 409, und die Meldung klingt nach Auslastung. */}
        <ArbeitszeitenCard />
        <header
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 'var(--w14-abstand-8)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 'var(--w14-schrift-titel)', fontWeight: 600, color: 'var(--w14-ink)' }}>
            Termine
          </h2>
          {/* Colour legend */}
          <ul
            aria-label="Farblegende Terminarten"
            style={{
              display: 'flex',
              gap: 'var(--w14-abstand-14)',
              listStyle: 'none',
              margin: 0,
              padding: 0,
              flexWrap: 'wrap',
            }}
          >
            {LEGEND.map((t) => (
              <li key={t} style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-6)' }}>
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: APPOINTMENT_TYPE_COLORS[t].bg,
                    display: 'inline-block',
                  }}
                />
                <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-aged)' }}>
                  {APPOINTMENT_TYPE_LABELS[t]}
                </span>
              </li>
            ))}
          </ul>
        </header>

        {isError ? (
          <p role="alert" style={{ margin: 0, color: 'var(--w14-wax-red)' }}>
            Termine konnten nicht geladen werden.
          </p>
        ) : null}

        <div style={{ flexGrow: 1, minHeight: 0 }}>
          <FullCalendar
            plugins={[timeGridPlugin, dayGridPlugin, listPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            locale={deLocale}
            firstDay={1}
            nowIndicator
            selectable
            editable
            eventDurationEditable={false}
            slotMinTime="07:00:00"
            slotMaxTime="20:00:00"
            height="100%"
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'timeGridDay,timeGridWeek,dayGridMonth,listWeek',
            }}
            buttonText={{
              today: 'Heute',
              day: 'Tag',
              week: 'Woche',
              month: 'Monat',
              list: 'Liste',
            }}
            events={events}
            datesSet={onDatesSet}
            select={onSelect}
            eventClick={onEventClick}
            eventDrop={onEventDrop}
          />
        </div>
      </main>

      {/* Right — Heute rail + ICS subscription */}
      <aside
        aria-label="Heute und Kalender-Abo"
        style={{
          width: 300,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w14-abstand-14)',
          overflowY: 'auto',
          minHeight: 0,
        }}
      >
        <HeuteRail appointments={data} now={new Date()} onOpenDetail={setSelectedId} />
        {actor?.role === 'ADMIN' ? <IcsFeedCard /> : null}
      </aside>

      {/* Drawers */}
      <TerminDetailSheet appointment={selected} onClose={() => setSelectedId(null)} />
      <QuickCreateDialog slotStart={quickCreateStart} onClose={() => setQuickCreateStart(null)} />
    </div>
  );
}

/**
 * Appointments domain client. Mirrors `apps/api-cloud/src/routes/appointments.ts`.
 */

import type { ApiClient } from '../client.js';

export type AppointmentType = 'VIEWING' | 'BUYBACK_EVAL' | 'CONSULTATION' | 'PICKUP';
export type AppointmentStatus =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'NO_SHOW'
  | 'CANCELLED'
  | 'RESCHEDULED';

/** German display labels for the appointment type. Operator-facing surfaces
 *  (calendar titles, the booking picker) MUST render these — never the raw
 *  SCREAMING_CASE enum value. */
export const APPOINTMENT_TYPE_LABELS: Readonly<Record<AppointmentType, string>> = {
  VIEWING: 'Besichtigung',
  BUYBACK_EVAL: 'Ankauf-Bewertung',
  CONSULTATION: 'Beratung',
  PICKUP: 'Abholung',
};

/** German display labels for the appointment status. */
export const APPOINTMENT_STATUS_LABELS: Readonly<Record<AppointmentStatus, string>> = {
  SCHEDULED: 'Geplant',
  CONFIRMED: 'Bestätigt',
  CHECKED_IN: 'Eingecheckt',
  IN_PROGRESS: 'Läuft',
  COMPLETED: 'Abgeschlossen',
  NO_SHOW: 'Nicht erschienen',
  CANCELLED: 'Storniert',
  RESCHEDULED: 'Verschoben',
};

export interface AvailableSlot {
  staff_user_id: string;
  slot_starts_at: string;
  slot_ends_at: string;
}

export interface AvailableSlotsQuery {
  type: AppointmentType;
  from: string;
  to: string;
  durationMinutes?: number;
  staffUserId?: string;
}

export interface BookAppointmentRequest {
  type: AppointmentType;
  startsAt: string;
  staffUserId: string;
  bookedVia: 'control_desktop' | 'storefront' | 'pos' | 'whatsapp_bot';
  durationMinutes?: number;
  customerId?: string;
  linkedProductIds?: string[];
  customerNotes?: string;
  customerEmail?: string;
  customerPhone?: string;
}

export type AppointmentPatchStatus =
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface RescheduleRequest {
  startsAt: string;
  durationMinutes?: number;
  staffUserId?: string;
  reason?: string;
}

function qs(query: AvailableSlotsQuery): string {
  const p = new URLSearchParams();
  p.set('type', query.type);
  p.set('from', query.from);
  p.set('to', query.to);
  if (query.durationMinutes !== undefined) p.set('durationMinutes', String(query.durationMinutes));
  if (query.staffUserId) p.set('staffUserId', query.staffUserId);
  return p.toString();
}

export interface AppointmentListItem {
  id: string;
  appointment_type: AppointmentType;
  status: AppointmentStatus;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  staff_user_id: string;
  customer_id: string | null;
  linked_product_ids: string[];
}

export interface AppointmentListQuery {
  from: string;
  to: string;
  staffUserId?: string;
}

export const appointments = {
  list(
    client: ApiClient,
    query: AppointmentListQuery,
  ): Promise<{ appointments: AppointmentListItem[] }> {
    const p = new URLSearchParams({ from: query.from, to: query.to });
    if (query.staffUserId) p.set('staffUserId', query.staffUserId);
    return client.request('GET', `/api/appointments?${p.toString()}`);
  },
  availableSlots(
    client: ApiClient,
    query: AvailableSlotsQuery,
  ): Promise<{ slots: AvailableSlot[] }> {
    return client.request<{ slots: AvailableSlot[] }>(
      'GET',
      `/api/appointments/available-slots?${qs(query)}`,
    );
  },
  book(client: ApiClient, body: BookAppointmentRequest): Promise<{ id: string; status: string }> {
    return client.request('POST', '/api/appointments', body);
  },
  setStatus(
    client: ApiClient,
    id: string,
    body: { status: AppointmentPatchStatus; cancellationReason?: string; staffNotes?: string },
  ): Promise<{ id: string; status: string }> {
    return client.request('PATCH', `/api/appointments/${id}`, body);
  },
  reschedule(
    client: ApiClient,
    id: string,
    body: RescheduleRequest,
  ): Promise<{ id: string; rescheduledFrom: string }> {
    return client.request('POST', `/api/appointments/${id}/reschedule`, body);
  },
};

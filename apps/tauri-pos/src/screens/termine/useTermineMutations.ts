/**
 * useTermineMutations — write paths of the Termine cockpit.
 *
 * Status transitions and drag-reschedules update the TanStack cache
 * OPTIMISTICALLY (Doherty: the chip/rail reflects the tap in <400 ms),
 * roll back on error and re-sync on settle. Note edits and the ICS
 * feed-token rotation are plain mutations.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import type {
  AppointmentListItem,
  AppointmentPatchStatus,
  RescheduleRequest,
} from '@norns/api-client';
import { appointments } from '@norns/api-client';

import { useApiClient } from '../../lib/api-context.js';

type ApptListData = { appointments: AppointmentListItem[] } | undefined;

/** All cached appointment windows (every from/to range the calendar visited). */
const APPT_KEY = ['appointments'] as const;

function patchCachedAppointment(
  data: ApptListData,
  id: string,
  patch: Partial<AppointmentListItem>,
): ApptListData {
  if (!data) return data;
  return {
    ...data,
    appointments: data.appointments.map((a) => (a.id === id ? { ...a, ...patch } : a)),
  };
}

interface OptimisticCtx {
  snapshots: Array<[readonly unknown[], unknown]>;
}

function useOptimisticListPatch() {
  const qc = useQueryClient();
  return {
    async apply(id: string, patch: Partial<AppointmentListItem>): Promise<OptimisticCtx> {
      await qc.cancelQueries({ queryKey: APPT_KEY });
      const snapshots = qc.getQueriesData({ queryKey: APPT_KEY });
      qc.setQueriesData({ queryKey: APPT_KEY }, (old: unknown) =>
        patchCachedAppointment(old as ApptListData, id, patch),
      );
      return { snapshots };
    },
    rollback(ctx: OptimisticCtx | undefined): void {
      for (const [key, data] of ctx?.snapshots ?? []) {
        qc.setQueryData(key, data);
      }
    },
    resync(): void {
      void qc.invalidateQueries({ queryKey: APPT_KEY });
    },
  };
}

/** Optimistic status transition (Bestätigen / Einchecken / … / Stornieren). */
export function useOptimisticStatus() {
  const api = useApiClient();
  const cache = useOptimisticListPatch();
  return useMutation({
    mutationFn: (vars: { id: string; status: AppointmentPatchStatus; reason?: string }) =>
      appointments.setStatus(api, vars.id, {
        status: vars.status,
        ...(vars.reason ? { cancellationReason: vars.reason } : {}),
      }),
    onMutate: (vars) => cache.apply(vars.id, { status: vars.status }),
    onError: (_err, _vars, ctx) => cache.rollback(ctx),
    onSettled: () => cache.resync(),
  });
}

/** Optimistic drag-reschedule via POST /:id/reschedule (clone + chain). */
export function useOptimisticReschedule() {
  const api = useApiClient();
  const cache = useOptimisticListPatch();
  return useMutation({
    mutationFn: (vars: { id: string; body: RescheduleRequest; durationMinutes: number }) =>
      appointments.reschedule(api, vars.id, vars.body),
    onMutate: (vars) => {
      const startMs = new Date(vars.body.startsAt).getTime();
      return cache.apply(vars.id, {
        starts_at: vars.body.startsAt,
        ends_at: new Date(startMs + vars.durationMinutes * 60_000).toISOString(),
      });
    },
    onError: (_err, _vars, ctx) => cache.rollback(ctx),
    onSettled: () => cache.resync(),
  });
}

/**
 * Note-only edit — PATCH /api/appointments/:id with { staffNotes } and no
 * status (the route treats a status-less PATCH as a metadata update).
 */
export function useUpdateStaffNotes() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; staffNotes: string }) =>
      api.request<{ id: string; status: string }>('PATCH', `/api/appointments/${vars.id}`, {
        staffNotes: vars.staffNotes,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: APPT_KEY });
    },
  });
}

export interface FeedTokenResponse {
  token: string;
  url: string;
}

/**
 * Rotate + fetch the ICS feed token (CONTRACT endpoint 3). ADMIN-only — a
 * needed step-up is opened automatically by the api-client interceptor.
 */
export function useFeedToken() {
  const api = useApiClient();
  return useMutation({
    mutationFn: () => api.request<FeedTokenResponse>('POST', '/api/appointments/feed-token'),
  });
}

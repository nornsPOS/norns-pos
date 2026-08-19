/**
 * useAppointments — TanStack Query wrappers around the appointments API
 * (ADR-0020). List for the calendar/next-hour panel + book / status / reschedule
 * mutations.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type AppointmentListItem,
  type AppointmentPatchStatus,
  type BookAppointmentRequest,
  appointments,
} from '@norns/api-client';

import { useApiClient } from '../lib/api-context.js';

export const appointmentsQueryKey = (from: string, to: string) =>
  ['appointments', from, to] as const;

export interface UseAppointmentsResult {
  data: AppointmentListItem[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

export function useAppointments(from: string, to: string): UseAppointmentsResult {
  const api = useApiClient();
  const q = useQuery({
    queryKey: appointmentsQueryKey(from, to),
    queryFn: () => appointments.list(api, { from, to }),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  return {
    data: q.data?.appointments ?? [],
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
  };
}

export function useBookAppointment() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BookAppointmentRequest) => appointments.book(api, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['appointments'] });
    },
  });
}

export function useSetAppointmentStatus() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; status: AppointmentPatchStatus }) =>
      appointments.setStatus(api, vars.id, { status: vars.status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['appointments'] });
    },
  });
}

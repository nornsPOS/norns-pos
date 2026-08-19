/**
 * ledger-feed-store — atomic, append-only buffer of the most recent ledger
 * events for the Werkstatt live feed.
 *
 * Why Zustand (not TanStack Query):
 *   The ledger is a STREAM, not a "queryable resource". We don't refetch it
 *   on mount, we don't paginate it from cache, we don't invalidate it. We
 *   append individual events as they arrive over SSE. Zustand's selector
 *   subscription model gives us **atomic-row updates** — a new event causes
 *   exactly one `<LedgerEntry/>` to render, not the whole list.
 *
 * The buffer is capped at `CAP` rows. Older rows fall off the bottom; this
 * is the "scroll-back" the Werkstatt shows. To audit deeper history the
 * operator opens the dedicated /tagebuch screen (Phase 2 Day 4) that
 * paginates `ledger_events` directly.
 *
 * `lastEventId` lets the SSE hook resume after a reconnect via the
 * `Last-Event-ID` header (the SSE spec automatically sends it).
 */

import { create } from 'zustand';
import { shallow } from 'zustand/shallow';

import type { LedgerEvent } from '@norns/api-client';

const CAP = 200;

export interface LedgerFeedState {
  /** Newest first. `events[0]` is the most recent. Capped at CAP. */
  events: LedgerEvent[];
  /** Bigint id of the last received event; used for SSE resume. */
  lastEventId: number | null;
  /** Pulse counter — bumps once per appended event. Drives the gold dot on
   *  the metal-prices panel + any other "something happened" badge. */
  pulse: number;

  /** SSE-source hook calls this once per arriving event. */
  push: (event: LedgerEvent) => void;
  /** Bulk push — replay path after reconnect. Order: oldest → newest. */
  pushMany: (events: LedgerEvent[]) => void;
  /** Reset on sign-out so the next operator starts clean. */
  clear: () => void;
}

export const useLedgerFeed = create<LedgerFeedState>((set) => ({
  events: [],
  lastEventId: null,
  pulse: 0,

  push: (event) =>
    set((state) => {
      // Guard against duplicate ids (we de-dupe by id; the replay window
      // may overlap with live events for one tick).
      if (state.lastEventId !== null && event.id <= state.lastEventId) {
        return state;
      }
      const next = [event, ...state.events];
      if (next.length > CAP) next.length = CAP;
      return {
        events: next,
        lastEventId: event.id,
        pulse: state.pulse + 1,
      };
    }),

  pushMany: (events) =>
    set((state) => {
      let merged = state.events;
      let lastId = state.lastEventId;
      for (const ev of events) {
        if (lastId !== null && ev.id <= lastId) continue;
        merged = [ev, ...merged];
        lastId = ev.id;
      }
      if (merged.length > CAP) merged = merged.slice(0, CAP);
      return {
        events: merged,
        lastEventId: lastId,
        pulse: state.pulse + events.length,
      };
    }),

  clear: () => set({ events: [], lastEventId: null, pulse: 0 }),
}));

/**
 * Selector — returns just the events array. Use with `shallow` equality so
 * unrelated `pulse` bumps don't trigger re-renders.
 *
 *   const events = useLedgerFeed(selectEvents, shallow);
 */
export const selectEvents = (s: LedgerFeedState): LedgerEvent[] => s.events;
export const selectPulse = (s: LedgerFeedState): number => s.pulse;
export const selectLastEventId = (s: LedgerFeedState): number | null => s.lastEventId;

// Re-export for stable shallow comparisons in components.
export { shallow };

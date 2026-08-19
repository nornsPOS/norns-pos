/**
 * AppointmentsWorkspace — compatibility shim. The calendar workspace was
 * deepened into the Termine scheduling cockpit (`../termine/Termine.tsx`):
 * day/week/month/list views, type colour-coding, detail drawer, optimistic
 * Heute rail, drag-to-reschedule, quick-create and the ICS feed card.
 * Keep importing from here or use `Termine` directly.
 */

export { Termine as AppointmentsWorkspace } from '../termine/Termine.js';

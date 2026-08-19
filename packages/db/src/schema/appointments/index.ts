/**
 * appointments/ — Smart Appointment System.
 *
 * Capacity model: staff_working_hours + staff_time_off + shop_holidays.
 * Master schedule: appointments (4 types × 8 statuses).
 * VIEWING linkage: appointment_linked_products → trigger → product_viewing_holds.
 *
 * The `available_slots()` SQL function (defined in migration 0012) is the
 * canonical slot generator — DST-correct via Europe/Berlin.
 *
 * See ADR-0020 + ADR-0016 §6.
 */

export * from './enums.js';
export * from './staffWorkingHours.js';
export * from './staffTimeOff.js';
export * from './shopHolidays.js';
export * from './appointments.js';
export * from './appointmentLinkedProducts.js';
export * from './productViewingHolds.js';
export * from './appointmentNotifications.js';

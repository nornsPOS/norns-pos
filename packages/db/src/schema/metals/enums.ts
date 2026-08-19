/**
 * metal_price_source — PG enum landed in migration 0021.
 *
 *   LBMA              — official London Bullion Market fix
 *   XAUEUR_VENDOR     — third-party live API (metalpriceapi.com, etc.)
 *   SPOT_VENDOR       — Anbieter-Spotkurs, umgerechnet mit dem EZB-Referenzkurs
 *                       (Wanderung 0129). Die ehrliche Herkunft für alles, was
 *                       KEIN lizenzierter LBMA-Fix ist.
 *   MANUAL            — ADMIN override (requires user_id + reason — see CHECK)
 *   INTERNAL_ESTIMATE — fallback when no live feed
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const metalPriceSource = pgEnum('metal_price_source', [
  'LBMA',
  'XAUEUR_VENDOR',
  // ⚠️ 31.07.2026 nachgetragen. Wanderung 0129 hatte den Wert der Datenbank
  // hinzugefügt (`ALTER TYPE metal_price_source ADD VALUE 'SPOT_VENDOR'`), das
  // Schema hier blieb bei vier. Rohes SQL ist für die Typprüfung unsichtbar:
  // nichts wurde rot, und der Server lieferte trotzdem 500, weil sein
  // Antwortschema denselben Wert nicht kannte.
  'SPOT_VENDOR',
  'MANUAL',
  'INTERNAL_ESTIMATE',
]);

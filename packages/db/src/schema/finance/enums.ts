/**
 * Enums backing the finance tables (migration 0075, Owner OS finance backend).
 */

import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Womit eine Betriebsausgabe bezahlt wurde (migration 0133). Eigenes
 * Vokabular, getrennt von `payment_method` (das ist die Zahlart einer
 * Einnahme und traegt Werte wie `TRADE_IN`, `EBAY`, die fuer eine Ausgabe
 * keinen Sinn ergeben).
 *
 * NUR `BAR` bewegt den Kassenbestand. `UNBEKANNT` sind Zeilen aus der Zeit
 * vor dem 06.08.2026, in der die Frage nicht gestellt wurde, und werden
 * ausdruecklich NICHT als bar geraten.
 */
export const ausgabeZahlweg = pgEnum('ausgabe_zahlweg', ['BAR', 'BANK', 'KARTE', 'UNBEKANNT']);

export const AUSGABE_ZAHLWEGE = ['BAR', 'BANK', 'KARTE', 'UNBEKANNT'] as const;
export type AusgabeZahlweg = (typeof AUSGABE_ZAHLWEGE)[number];

/**
 * Categories for one-off operating expenses (Betriebsausgaben). Kept broad and
 * stable; the route validates against this same source of truth.
 */
export const expenseCategory = pgEnum('expense_category', [
  'WARENEINKAUF', // goods / consumables not via Ankauf
  'MIETE', // one-off rent-adjacent (deposit, etc.)
  'MARKETING', // ads, print, listings fees
  'VERSAND', // postage / courier
  'BUEROMATERIAL', // office supplies
  'REPARATUR', // repairs / maintenance
  'GEBUEHREN', // bank / platform / professional fees
  'REISEKOSTEN', // travel
  'SONSTIGES', // other
]);

export const EXPENSE_CATEGORIES = [
  'WARENEINKAUF',
  'MIETE',
  'MARKETING',
  'VERSAND',
  'BUEROMATERIAL',
  'REPARATUR',
  'GEBUEHREN',
  'REISEKOSTEN',
  'SONSTIGES',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

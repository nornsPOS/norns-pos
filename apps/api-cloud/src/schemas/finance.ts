/**
 * TypeBox schemas for the Owner OS finance surface (migration 0075).
 *
 * Two families:
 *   • READ aggregates — profit / revenue / inventory value / metal weights.
 *     Money is INTEGER CENTS on the wire (the finance contract speaks cents
 *     end-to-end; the dashboard consumer formats with the de-DE Money helper).
 *   • CRUD — operating_expenses (one-off) + fixed_costs (recurring).
 */

import { type Static, Type } from '@sinclair/typebox';

// ────────────────────────────────────────────────────────────────────────
// Shared
// ────────────────────────────────────────────────────────────────────────

/** Integer cents. Signed — net profit and per-line nets can be negative. */
const Cents = Type.Integer({
  description: 'Amount in integer EUR cents (signed).',
});
/** Non-negative integer cents — for amounts that cannot be negative. */
const NonNegCents = Type.Integer({
  minimum: 0,
  description: 'Non-negative amount in integer EUR cents.',
});

export const PeriodDayMonth = Type.Union([Type.Literal('day'), Type.Literal('month')]);
export const PeriodMonth = Type.Literal('month');

export const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export const EXPENSE_CATEGORY = Type.Union([
  Type.Literal('WARENEINKAUF'),
  Type.Literal('MIETE'),
  Type.Literal('MARKETING'),
  Type.Literal('VERSAND'),
  Type.Literal('BUEROMATERIAL'),
  Type.Literal('REPARATUR'),
  Type.Literal('GEBUEHREN'),
  Type.Literal('REISEKOSTEN'),
  Type.Literal('SONSTIGES'),
]);

/**
 * Womit eine Betriebsausgabe bezahlt wurde (migration 0133). Eigenes
 * Vokabular, getrennt von der Zahlart einer Einnahme. NUR `BAR` bewegt den
 * Kassenbestand. `UNBEKANNT` ist kein Angebot beim Anlegen — nur ein
 * Zustand alter Zeilen aus der Zeit vor dem 06.08.2026.
 */
export const AUSGABE_ZAHLWEG = Type.Union([
  Type.Literal('BAR'),
  Type.Literal('BANK'),
  Type.Literal('KARTE'),
  Type.Literal('UNBEKANNT'),
]);

/**
 * Der waehlbare Ausschnitt von `AUSGABE_ZAHLWEG` — ohne `UNBEKANNT`. Wer
 * heute eine Ausgabe anlegt oder aendert, kennt die Zahlart; `UNBEKANNT` ist
 * ein Zustand alter Zeilen, keine Wahl (siehe migration 0133).
 */
export const AUSGABE_ZAHLWEG_WAEHLBAR = Type.Union([
  Type.Literal('BAR'),
  Type.Literal('BANK'),
  Type.Literal('KARTE'),
]);

// ────────────────────────────────────────────────────────────────────────
// GET /api/finance/profit?period=day|month
// ────────────────────────────────────────────────────────────────────────

export const ProfitQuery = Type.Object({
  period: Type.Optional(PeriodDayMonth),
});
export const ProfitResponse = Type.Object({
  period: PeriodDayMonth,
  /** Gross VERKAUF revenue for the period (storno rows net out). */
  grossRevenueCents: NonNegCents,
  /** Gross ANKAUF spend for the period. */
  grossAnkaufCents: NonNegCents,
  /** Σ one-off operating_expenses booked in the period. */
  expensesCents: NonNegCents,
  /** Fixed costs allocated to the period (full month, or per-day share). */
  fixedCostsAllocatedCents: NonNegCents,
  /** revenue − ankauf − expenses − fixed (signed). */
  netProfitCents: Cents,
});
export type TProfitQuery = Static<typeof ProfitQuery>;
export type TProfitResponse = Static<typeof ProfitResponse>;

// ────────────────────────────────────────────────────────────────────────
// GET /api/finance/revenue?period=month
// ────────────────────────────────────────────────────────────────────────

export const RevenueQuery = Type.Object({
  period: Type.Optional(PeriodMonth),
});
export const RevenueResponse = Type.Object({
  monthToDateRevenueCents: NonNegCents,
});
export type TRevenueQuery = Static<typeof RevenueQuery>;
export type TRevenueResponse = Static<typeof RevenueResponse>;

// ────────────────────────────────────────────────────────────────────────
// GET /api/inventory/value
// ────────────────────────────────────────────────────────────────────────

export const InventoryValueResponse = Type.Object({
  /** Σ list_price_eur of on-hand stock (AVAILABLE + RESERVED). */
  listValueCents: NonNegCents,
  /** Σ acquisition_cost_eur of on-hand stock. */
  acquisitionValueCents: NonNegCents,
  /** Count of on-hand items. */
  availableCount: Type.Integer({ minimum: 0 }),
});
export type TInventoryValueResponse = Static<typeof InventoryValueResponse>;

// ────────────────────────────────────────────────────────────────────────
// GET /api/inventory/metal-weights
// ────────────────────────────────────────────────────────────────────────

const Grams = Type.Number({ minimum: 0, description: 'Fine-metal grams (feingewicht).' });
export const MetalWeightsResponse = Type.Object({
  goldGrams: Grams,
  silverGrams: Grams,
  platinumGrams: Grams,
  palladiumGrams: Grams,
});
export type TMetalWeightsResponse = Static<typeof MetalWeightsResponse>;

// ────────────────────────────────────────────────────────────────────────
// operating_expenses CRUD
// ────────────────────────────────────────────────────────────────────────

export const ExpenseRow = Type.Object({
  id: Type.String({ format: 'uuid' }),
  date: Type.String({ format: 'date' }),
  category: EXPENSE_CATEGORY,
  amountCents: Type.Integer({ minimum: 1 }),
  zahlweg: AUSGABE_ZAHLWEG,
  note: Type.Union([Type.String(), Type.Null()]),
  createdByUserId: Type.String({ format: 'uuid' }),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

export const ListExpensesQuery = Type.Object({
  from: Type.Optional(Type.String({ format: 'date' })),
  to: Type.Optional(Type.String({ format: 'date' })),
  category: Type.Optional(EXPENSE_CATEGORY),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});
export const ListExpensesResponse = Type.Object({
  items: Type.Array(ExpenseRow),
  total: Type.Integer({ minimum: 0 }),
  limit: Type.Integer(),
  offset: Type.Integer(),
  hasMore: Type.Boolean(),
});

export const CreateExpenseBody = Type.Object({
  date: Type.String({ format: 'date' }),
  category: EXPENSE_CATEGORY,
  amountCents: Type.Integer({ minimum: 1 }),
  /**
   * Pflicht beim Anlegen. Wer heute eine Ausgabe erfasst, weiss, womit er
   * bezahlt hat — eine stille Vorgabe würde die Lücke von vor dem
   * 06.08.2026 (migration 0133) von vorne wieder aufmachen.
   */
  zahlweg: AUSGABE_ZAHLWEG_WAEHLBAR,
  note: Type.Optional(Type.String({ maxLength: 500 })),
});
export const UpdateExpenseBody = Type.Object({
  date: Type.Optional(Type.String({ format: 'date' })),
  category: Type.Optional(EXPENSE_CATEGORY),
  amountCents: Type.Optional(Type.Integer({ minimum: 1 })),
  zahlweg: Type.Optional(AUSGABE_ZAHLWEG_WAEHLBAR),
  note: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
});
export const ExpenseIdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

export type TExpenseRow = Static<typeof ExpenseRow>;
export type TListExpensesQuery = Static<typeof ListExpensesQuery>;
export type TCreateExpenseBody = Static<typeof CreateExpenseBody>;
export type TUpdateExpenseBody = Static<typeof UpdateExpenseBody>;
export type TExpenseIdParams = Static<typeof ExpenseIdParams>;

// ────────────────────────────────────────────────────────────────────────
// fixed_costs CRUD
// ────────────────────────────────────────────────────────────────────────

export const FixedCostRow = Type.Object({
  id: Type.String({ format: 'uuid' }),
  label: Type.String(),
  monthlyAmountCents: Type.Integer({ minimum: 1 }),
  activeFrom: Type.String({ format: 'date' }),
  activeTo: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

export const ListFixedCostsQuery = Type.Object({
  /** When true, only cost lines still running (active_to IS NULL). */
  activeOnly: Type.Optional(Type.Boolean()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});
export const ListFixedCostsResponse = Type.Object({
  items: Type.Array(FixedCostRow),
  total: Type.Integer({ minimum: 0 }),
  limit: Type.Integer(),
  offset: Type.Integer(),
  hasMore: Type.Boolean(),
});

export const CreateFixedCostBody = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 200 }),
  monthlyAmountCents: Type.Integer({ minimum: 1 }),
  activeFrom: Type.String({ format: 'date' }),
  activeTo: Type.Optional(Type.Union([Type.String({ format: 'date' }), Type.Null()])),
});
export const UpdateFixedCostBody = Type.Object({
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  monthlyAmountCents: Type.Optional(Type.Integer({ minimum: 1 })),
  activeFrom: Type.Optional(Type.String({ format: 'date' })),
  activeTo: Type.Optional(Type.Union([Type.String({ format: 'date' }), Type.Null()])),
});
export const FixedCostIdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

export type TFixedCostRow = Static<typeof FixedCostRow>;
export type TListFixedCostsQuery = Static<typeof ListFixedCostsQuery>;
export type TCreateFixedCostBody = Static<typeof CreateFixedCostBody>;
export type TUpdateFixedCostBody = Static<typeof UpdateFixedCostBody>;
export type TFixedCostIdParams = Static<typeof FixedCostIdParams>;

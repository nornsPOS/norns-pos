/**
 * TypeBox schemas for the belegtext_templates API surface (Day 26).
 */

import { type Static, Type } from '@sinclair/typebox';

const BELEGTEXT_KIND = Type.Union([
  Type.Literal('MARGIN_25A'),
  Type.Literal('STANDARD_19'),
  Type.Literal('REDUCED_7'),
  Type.Literal('INVESTMENT_GOLD_25C'),
  Type.Literal('KLEINUNTERNEHMER_19'),
  Type.Literal('ANKAUFBELEG_DECLARATION'),
  Type.Literal('REVERSE_CHARGE_13B'),
  Type.Literal('GENERIC_HEADER'),
  Type.Literal('GENERIC_FOOTER'),
]);

const TAX_TREATMENT_CODE = Type.Union([
  Type.Literal('MARGIN_25A'),
  Type.Literal('STANDARD_19'),
  Type.Literal('REDUCED_7'),
  Type.Literal('INVESTMENT_GOLD_25C'),
]);

const LANGUAGE = Type.String({
  pattern: '^[a-z]{2}(-[A-Z]{2})?$',
  default: 'de',
  examples: ['de', 'en', 'de-AT'],
});

export const BelegtextRow = Type.Object({
  id: Type.String({ format: 'uuid' }),
  kind: BELEGTEXT_KIND,
  language: Type.String(),
  bodyText: Type.String(),
  validFrom: Type.String({ format: 'date-time' }),
  validTo: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  createdByUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/belegtext-templates
// ────────────────────────────────────────────────────────────────────────

export const ListBelegtextQuery = Type.Object({
  kind: Type.Optional(BELEGTEXT_KIND),
  language: Type.Optional(LANGUAGE),
  currentOnly: Type.Optional(Type.Boolean({ default: true })),
});

export const ListBelegtextResponse = Type.Object({
  items: Type.Array(BelegtextRow),
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/belegtext-templates/current?kind=&language=
// ────────────────────────────────────────────────────────────────────────

export const CurrentBelegtextQuery = Type.Object({
  kind: BELEGTEXT_KIND,
  language: Type.Optional(LANGUAGE),
});

export const CurrentBelegtextResponse = Type.Object({
  kind: BELEGTEXT_KIND,
  language: Type.String(),
  bodyText: Type.Union([Type.String(), Type.Null()], {
    description: 'NULL when no template is configured for (kind, language).',
  }),
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/belegtext-templates/resolve?taxTreatmentCode=&language=
// ────────────────────────────────────────────────────────────────────────

export const ResolveBelegtextQuery = Type.Object({
  taxTreatmentCode: TAX_TREATMENT_CODE,
  language: Type.Optional(LANGUAGE),
});

export const ResolveBelegtextResponse = Type.Object({
  taxTreatmentCode: TAX_TREATMENT_CODE,
  language: Type.String(),
  bodyText: Type.Union([Type.String(), Type.Null()]),
});

// ────────────────────────────────────────────────────────────────────────
// POST /api/belegtext-templates
//
// Close-out + insert: in one TX, the current template for (kind, language)
// gets its valid_to stamped to now() and a new CURRENT row is inserted.
// ────────────────────────────────────────────────────────────────────────

export const PublishBelegtextBody = Type.Object({
  kind: BELEGTEXT_KIND,
  language: Type.Optional(LANGUAGE),
  bodyText: Type.String({ minLength: 1, maxLength: 4000 }),
  notes: Type.Optional(Type.String({ maxLength: 1000 })),
});

export const PublishBelegtextResponse = Type.Object({
  kind: BELEGTEXT_KIND,
  language: Type.String(),
  validFrom: Type.String({ format: 'date-time' }),
  previousBodyText: Type.Union([Type.String(), Type.Null()]),
});

export type TListBelegtextQuery = Static<typeof ListBelegtextQuery>;
export type TCurrentBelegtextQuery = Static<typeof CurrentBelegtextQuery>;
export type TResolveBelegtextQuery = Static<typeof ResolveBelegtextQuery>;
export type TPublishBelegtextBody = Static<typeof PublishBelegtextBody>;

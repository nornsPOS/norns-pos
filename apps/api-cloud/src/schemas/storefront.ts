/**
 * TypeBox schemas for storefront routes (Day 19).
 *
 * Wire contract for /api/storefront/* and /api/webhooks/stripe.
 */

import { type Static, Type } from '@sinclair/typebox';

import { DecimalString } from './money.js';

// ────────────────────────────────────────────────────────────────────────
// Country + language enums
// ────────────────────────────────────────────────────────────────────────

const Iso2Country = Type.String({
  pattern: '^[A-Z]{2}$',
  description: 'ISO 3166-1 alpha-2 country code, uppercase.',
});

/**
 * The language a SHOPPER reads. Deliberately a pattern and not a union of the
 * three we once shipped: the storefront now offers thirteen, and a schema
 * that rejects "tr" would silently store German for a Turkish customer, which
 * is exactly the bug this replaced. Anything the app does not translate falls
 * back to German at read time, so an unknown but well formed tag is harmless.
 */
const Language = Type.String({
  pattern: '^[a-z]{2}$',
  description: 'ISO 639 1 language code, lowercase.',
});

// ────────────────────────────────────────────────────────────────────────
// Address sub-objects
// ────────────────────────────────────────────────────────────────────────

const Address = Type.Object({
  recipientName: Type.String({ minLength: 1, maxLength: 256 }),
  line1: Type.String({ minLength: 1, maxLength: 256 }),
  line2: Type.Optional(Type.String({ maxLength: 256 })),
  postalCode: Type.String({ minLength: 1, maxLength: 32 }),
  city: Type.String({ minLength: 1, maxLength: 128 }),
  country: Iso2Country,
});
export type Address = Static<typeof Address>;

// ────────────────────────────────────────────────────────────────────────
// POST /api/storefront/auth/sign-up
// ────────────────────────────────────────────────────────────────────────

export const SignUpBody = Type.Object({
  email: Type.String({ format: 'email', maxLength: 256 }),
  password: Type.String({ minLength: 10, maxLength: 128 }),
  fullName: Type.String({ minLength: 1, maxLength: 256 }),
  phone: Type.Optional(Type.String({ minLength: 4, maxLength: 64 })),
  preferredLanguage: Type.Optional(Language),
  marketingConsent: Type.Optional(Type.Boolean({ default: false })),
});
export type SignUpBody = Static<typeof SignUpBody>;

export const SignUpResponse = Type.Object({
  shopperId: Type.String({ format: 'uuid' }),
  customerId: Type.String({ format: 'uuid' }),
  emailVerified: Type.Boolean(),
});
export type SignUpResponse = Static<typeof SignUpResponse>;

// ────────────────────────────────────────────────────────────────────────
// POST /api/storefront/auth/sign-in
// ────────────────────────────────────────────────────────────────────────

export const SignInBody = Type.Object({
  email: Type.String({ format: 'email', maxLength: 256 }),
  password: Type.String({ minLength: 1, maxLength: 128 }),
});
export type SignInBody = Static<typeof SignInBody>;

export const SignInResponse = Type.Object({
  shopperId: Type.String({ format: 'uuid' }),
  emailVerified: Type.Boolean(),
  sessionExpiresAt: Type.String({ format: 'date-time' }),
});
export type SignInResponse = Static<typeof SignInResponse>;

// ────────────────────────────────────────────────────────────────────────
// Cart routes
// ────────────────────────────────────────────────────────────────────────

export const CartItemSnapshot = Type.Object({
  id: Type.String({ format: 'uuid' }),
  productId: Type.String({ format: 'uuid' }),
  unitPriceEur: DecimalString,
  quantity: Type.Integer({ minimum: 1 }),
  addedAt: Type.String({ format: 'date-time' }),
});

export const CartView = Type.Object({
  id: Type.String({ format: 'uuid' }),
  status: Type.Union([
    Type.Literal('ACTIVE'),
    Type.Literal('CHECKOUT'),
    Type.Literal('ABANDONED'),
    Type.Literal('CONVERTED'),
    Type.Literal('RESERVED'),
    Type.Literal('CANCELLED'),
  ]),
  items: Type.Array(CartItemSnapshot),
  totalEur: DecimalString,
  checkoutExpiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
});
export type CartView = Static<typeof CartView>;

export const AddCartItemBody = Type.Object({
  productId: Type.String({ format: 'uuid' }),
});
export type AddCartItemBody = Static<typeof AddCartItemBody>;

// ────────────────────────────────────────────────────────────────────────
// POST /api/storefront/cart/checkout
// ────────────────────────────────────────────────────────────────────────

export const CheckoutBody = Type.Object({
  shippingAddress: Address,
  /** When omitted, billing = shipping. */
  billingAddress: Type.Optional(Address),
  /** Stripe payment-method allow-list — overrides the per-route default if supplied. */
  paymentMethodTypes: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal('card'),
        Type.Literal('sepa_debit'),
        Type.Literal('klarna'),
        Type.Literal('ideal'),
        Type.Literal('giropay'),
      ]),
      { minItems: 1, maxItems: 8 },
    ),
  ),
});
export type CheckoutBody = Static<typeof CheckoutBody>;

export const CheckoutResponse = Type.Object({
  cartId: Type.String({ format: 'uuid' }),
  paymentIntentId: Type.String({ format: 'uuid' }),
  provider: Type.Literal('STRIPE'),
  providerIntentId: Type.String(),
  amountEur: DecimalString,
  /** Stripe client_secret for inline payment widget. */
  clientSecret: Type.String(),
  /** When set when checkout expires — matches inventory-lock 15-min TTL. */
  expiresAt: Type.String({ format: 'date-time' }),
});
export type CheckoutResponse = Static<typeof CheckoutResponse>;

// ────────────────────────────────────────────────────────────────────────
// Webhook — POST /api/webhooks/stripe
//
// We declare no `body` schema because the Stripe handler reads the RAW
// bytes (the signature is over the raw body); Fastify's JSON parser is
// bypassed for this route.
// ────────────────────────────────────────────────────────────────────────

export const WebhookAck = Type.Object({
  received: Type.Boolean(),
  idempotent: Type.Boolean(),
  /** Stripe event id (`evt_*`) we matched / inserted into webhook_events. */
  eventId: Type.String(),
});
export type WebhookAck = Static<typeof WebhookAck>;

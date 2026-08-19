/**
 * Storefront commerce enums — landed in migration 0018.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const cartStatus = pgEnum('cart_status', [
  'ACTIVE',
  'CHECKOUT',
  'ABANDONED',
  'CONVERTED',
  'RESERVED',
  /** Customer-initiated cancellation of a RESERVED pickup order (0087). */
  'CANCELLED',
]);

export const paymentProvider = pgEnum('payment_provider', ['STRIPE', 'PAYPAL', 'MOLLIE']);

export const paymentIntentStatus = pgEnum('payment_intent_status', [
  'CREATED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
  'EXPIRED',
]);

export const salesChannel = pgEnum('sales_channel', ['POS', 'WEB', 'EBAY', 'PHONE']);

export const shippingStatus = pgEnum('shipping_status', [
  'NOT_REQUIRED',
  'PENDING',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'RETURNED',
]);

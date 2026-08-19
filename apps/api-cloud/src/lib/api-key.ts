/**
 * API-key minting + hashing (Track E).
 *
 * A key is `w14k_` + 32 random bytes (base64url). Only its SHA-256 hash is ever
 * stored; the plaintext is returned to the creator exactly once. The `w14k_`
 * marker lets the auth preHandler tell an API key from a session token in the
 * same `Authorization: Bearer` slot.
 */

import { createHash, randomBytes } from 'node:crypto';

/** Marker prefix identifying an API key in the Bearer slot. */
export const API_KEY_PREFIX = 'w14k_';

export interface GeneratedApiKey {
  /** The plaintext secret — shown to the creator ONCE, never stored. */
  token: string;
  /** SHA-256 hex of the full token; this is what is stored + looked up. */
  tokenHash: string;
  /** `w14k_` + first 8 secret chars, stored for display/identification. */
  tokenPrefix: string;
}

/** Mint a new API key. */
export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(32).toString('base64url');
  const token = `${API_KEY_PREFIX}${secret}`;
  return {
    token,
    tokenHash: hashApiKey(token),
    tokenPrefix: token.slice(0, API_KEY_PREFIX.length + 8),
  };
}

/** SHA-256 hex of the full token (storage + lookup key). */
export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Does this Bearer value look like an API key (vs a session token)? */
export function isApiKeyToken(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}

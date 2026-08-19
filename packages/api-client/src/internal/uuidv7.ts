/**
 * UUID v7 (RFC 9562) — 48-bit Unix-millis prefix + 74 random bits, encoded
 * as the canonical 36-char dashed string.
 *
 * Why v7 and not `crypto.randomUUID()` (v4): the offline outbox needs keys
 * that are *time-ordered* so SQLite index locality on `enqueued_at`
 * correlation holds and the replay loop's FIFO assumptions degrade
 * gracefully even if `monotonic_seq` is unavailable (ADR-0044 §4).
 *
 * Zero dependencies on purpose — `@norns/api-client` stays pure
 * (no `uuid` package) so it remains safe to share with backend test
 * harnesses. Relies only on the Web Crypto `getRandomValues`, present in
 * every Tauri webview and in Node ≥ 18 (`globalThis.crypto`).
 */

const byteToHex = (b: number | undefined): string => (b ?? 0).toString(16).padStart(2, '0');

/**
 * Generate a time-ordered UUID v7. Monotonic at millisecond resolution;
 * two calls within the same millisecond differ in their random tail.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);

  // 48-bit big-endian millisecond timestamp across bytes 0..5. Use
  // floored division + modulo (NOT bitwise) — `now` exceeds 32 bits and
  // bitwise operators would silently truncate it.
  let ts = Math.floor(now);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256;
    ts = Math.floor(ts / 256);
  }

  // Bytes 6..15 are random; version + variant bits are stamped after.
  crypto.getRandomValues(bytes.subarray(6));

  // Version 7 in the high nibble of byte 6.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  // RFC 4122 variant (10xx) in the high bits of byte 8.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  let out = '';
  for (let i = 0; i < 16; i++) {
    out += byteToHex(bytes[i]);
    if (i === 3 || i === 5 || i === 7 || i === 9) out += '-';
  }
  return out;
}

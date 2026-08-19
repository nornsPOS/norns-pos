/**
 * Local KYC ID-document store — the encrypted-at-rest replacement for the
 * never-configured R2 bucket (migration 0074). KYC images are highly sensitive
 * Ausweis PII (GwG §8 + DSGVO); moving them to local disk MUST keep every
 * guarantee R2's server-side encryption gave. This module is that layer.
 *
 *   1. COMPRESS — `compressKycImage()` decodes any jpeg/png/webp/heic, bakes the
 *      EXIF orientation then STRIPS all metadata, and emits a SINGLE high-quality
 *      WebP (longest edge ≤ 2000px, quality 92). Higher quality than product
 *      photos (q80/1600px) ON PURPOSE — an ID must stay legible / OCR-able. The
 *      raw upload is NEVER persisted. ⚑ Quality flagged for Roman/OCR at go-live.
 *
 *   2. ENCRYPT — AES-256-GCM (authenticated). File layout, self-framed so no IV
 *      or tag is ever stored beside the file in the DB:
 *          [1-byte version=0x01][12-byte IV][ciphertext][16-byte GCM tag]
 *      • The IV is `crypto.randomBytes(12)` FRESH per encryption — NEVER derived
 *        from the storage key/time and NEVER reused (GCM nonce-reuse is
 *        catastrophic). See the invariant in `encryptKycImage`.
 *      • AAD binds the ciphertext to its DB row: `kyc:v1:<customerId>:<docId>:
 *        <storageKey>`, reconstructed on decrypt from the AUTHORITATIVE row — a
 *        file swapped onto another row fails the tag.
 *      • The [version] byte selects the key via a Map, so a v2 key rotation is a
 *        clean add (decrypt old with the old key, encrypt new with the new).
 *      • A tag failure / unknown version / truncated file is a HARD ERROR — the
 *        caller serves NOTHING and audits a security event.
 *
 *   3. STORE — sharded `.enc` files under a SEPARATE KYC_PHOTOS_DIR (never the
 *      public PHOTOS_DIR). `deleteKycImage` is the single delete chokepoint used
 *      by the retention purge (and any future erasure endpoint).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import sharp from 'sharp';

import type { Env } from '../config/env.js';

// ── Compression knobs (legible / OCR-able ID) ───────────────────────────────
const KYC_MAX_EDGE = 2000;
const KYC_QUALITY = 92;
export const KYC_CONTENT_TYPE = 'image/webp' as const;

export interface CompressedKycImage {
  webp: Buffer;
  /** lowercase 64-hex SHA-256 of the COMPRESSED bytes (server-computed). */
  sha256Hex: string;
  width: number;
  height: number;
}

/**
 * Decode arbitrary image bytes → a single high-quality WebP with EXIF/ICC
 * stripped, plus the server-computed sha256 of the compressed bytes. Throws if
 * the input is not a decodable image (the route maps that to a 400).
 */
export async function compressKycImage(input: Buffer): Promise<CompressedKycImage> {
  // `rotate()` (no args) bakes the EXIF orientation BEFORE metadata is stripped
  // (Sharp strips it unless `.withMetadata()` is called — we never call it).
  const out = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize(KYC_MAX_EDGE, KYC_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: KYC_QUALITY, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  const webp = out.data;
  const sha256Hex = createHash('sha256').update(webp).digest('hex');
  return { webp, sha256Hex, width: out.info.width, height: out.info.height };
}

// ── Encryption ──────────────────────────────────────────────────────────────
const VERSION = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_MIN = 1 + IV_LEN + TAG_LEN;

export class KycCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KycCryptoError';
  }
}

/** version → 32-byte AES-256 key. Built once at boot; v2 is a clean add. */
export type KycKeyring = ReadonlyMap<number, Buffer>;

/**
 * Build the keyring from env. The decoded length is asserted at boot
 * (assertKycImageKeyValid in config/env.ts); we re-assert here defensively.
 */
export function buildKycKeyring(env: Env): KycKeyring {
  const key = Buffer.from(env.KYC_IMAGE_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) {
    throw new KycCryptoError('KYC_IMAGE_ENCRYPTION_KEY must decode to 32 bytes (AES-256).');
  }
  return new Map<number, Buffer>([[VERSION, key]]);
}

/** AAD binding the ciphertext to its DB row. Reconstructed identically on read. */
export function kycImageAad(customerId: string, docId: string, storageKey: string): Buffer {
  return Buffer.from(`kyc:v1:${customerId}:${docId}:${storageKey}`, 'utf8');
}

/**
 * Encrypt the compressed image. The 12-byte IV is FRESH random per call and
 * MUST NEVER be reused or derived — GCM nonce reuse breaks confidentiality AND
 * authenticity. Returns the self-framed `[version][iv][ct][tag]` buffer.
 */
export function encryptKycImage(plaintext: Buffer, aad: Buffer, keyring: KycKeyring): Buffer {
  const key = keyring.get(VERSION);
  if (!key) throw new KycCryptoError(`No key for KYC image version ${VERSION}.`);
  const iv = randomBytes(IV_LEN); // INVARIANT: fresh per encryption, never reused.
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, ciphertext, tag]);
}

/**
 * Decrypt a self-framed file. A bad version, a truncated file, or a GCM tag
 * mismatch (tamper / wrong AAD / wrong key) throws KycCryptoError — the caller
 * serves NOTHING and audits a security event. NEVER catch-and-serve.
 */
export function decryptKycImage(file: Buffer, aad: Buffer, keyring: KycKeyring): Buffer {
  if (file.length < HEADER_MIN) {
    throw new KycCryptoError(`KYC image file too short (${file.length} < ${HEADER_MIN}).`);
  }
  const version = file.readUInt8(0);
  const key = keyring.get(version);
  if (!key) throw new KycCryptoError(`Unknown KYC image version byte ${version}.`);
  const iv = file.subarray(1, 1 + IV_LEN);
  const tag = file.subarray(file.length - TAG_LEN);
  const ciphertext = file.subarray(1 + IV_LEN, file.length - TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // `final()` throws on tag mismatch — do NOT leak detail, do NOT return bytes.
    throw new KycCryptoError('KYC image authentication failed (tamper, wrong key, or wrong row).');
  }
}

// ── On-disk layout (separate from the public PHOTOS_DIR) ─────────────────────
function shardFor(storageKey: string): string {
  return (storageKey.slice(0, 2) || 'xx').toLowerCase();
}

export function kycPathFor(env: Env, storageKey: string): string {
  return join(env.KYC_PHOTOS_DIR, shardFor(storageKey), `${storageKey}.enc`);
}

/** Persist the encrypted file. Creates the shard dir on first write. */
export async function writeKycImage(
  env: Env,
  storageKey: string,
  encrypted: Buffer,
): Promise<void> {
  const path = kycPathFor(env, storageKey);
  await mkdir(join(env.KYC_PHOTOS_DIR, shardFor(storageKey)), { recursive: true });
  await writeFile(path, encrypted, { mode: 0o600 });
}

/** Read the encrypted file, or null if missing (purged / never written). */
export async function readKycImage(env: Env, storageKey: string): Promise<Buffer | null> {
  try {
    return await readFile(kycPathFor(env, storageKey));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * THE single delete chokepoint — used by the retention purge (and any future
 * erasure endpoint). `force: true` makes a missing file a SUCCESS (idempotent),
 * but EACCES/EIO/etc. RETHROW: the purge must fail + retry, never strand a LIVE
 * expired ID by marking the row a shell while the encrypted bytes survive.
 */
export async function deleteKycImage(dir: string, storageKey: string): Promise<void> {
  const path = join(dir, shardFor(storageKey), `${storageKey}.enc`);
  await rm(path, { force: true }); // do NOT wrap in try/catch — let EACCES/EIO propagate.
}

// ── Capacity (separate cap; product-photo SUM would undercount) ───────────────
export interface KycCapacityCheck {
  ok: boolean;
  usedBytes: number;
  maxBytes: number;
}

export function checkKycCapacity(
  env: Env,
  usedBytes: number,
  incomingBytes: number,
): KycCapacityCheck {
  const maxBytes = env.KYC_STORE_MAX_BYTES;
  return { ok: usedBytes + incomingBytes <= maxBytes, usedBytes, maxBytes };
}

/** size on disk of one stored encrypted file (capacity accounting). */
export async function kycFileSize(env: Env, storageKey: string): Promise<number> {
  try {
    return (await stat(kycPathFor(env, storageKey))).size;
  } catch {
    return 0;
  }
}

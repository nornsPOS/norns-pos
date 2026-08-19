/**
 * Local product-photo store — the durable replacement for the empty R2 bucket.
 *
 * Photos are MEDIA, not fiscal records, and the shop only ever holds a few
 * thousand of them, so the bytes live on the API server's local disk instead of
 * an external object store. Three concerns live here:
 *
 *   1. COMPRESSION — `compressPhoto()` decodes ANY raster input (jpeg/png/webp,
 *      and heic/avif when the platform Sharp build supports it), strips EXIF,
 *      and emits two WebP renditions:
 *         • MAIN  — longest edge ≤ 1600px, quality ~80  (target ~120 KB)
 *         • THUMB — longest edge ≤ 400px,  quality ~70  (target ~25 KB)
 *      The raw upload is NEVER persisted.
 *
 *   2. STORAGE — `writeRenditions()` writes the two WebP buffers to PHOTOS_DIR,
 *      sharded by the first two hex chars of the photo id:
 *         <PHOTOS_DIR>/<ab>/<id>.webp        (main)
 *         <PHOTOS_DIR>/<ab>/<id>_thumb.webp  (thumb)
 *      `readRendition()` / `deleteRenditions()` are the inverse.
 *
 *   3. CAP — `assertCapacity()` enforces PHOTO_STORE_MAX_BYTES against the live
 *      SUM(size_bytes) of local rows, so the limited server disk can never be
 *      filled by photos. Purging sold/deleted product photos frees the quota.
 *
 * Pure-ish: every fs path is derived from PHOTOS_DIR + the id; the caller owns
 * the DB row + the running-total query.
 */

import { type ReadStream, createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import sharp from 'sharp';

import type { Env } from '../config/env.js';

// ── Compression knobs ───────────────────────────────────────────────────────
const MAIN_MAX_EDGE = 1600;
const MAIN_QUALITY = 80;
const THUMB_MAX_EDGE = 400;
const THUMB_QUALITY = 70;

export const PHOTO_CONTENT_TYPE = 'image/webp' as const;

export interface CompressedPhoto {
  main: Buffer;
  thumb: Buffer;
  /** MAIN rendition pixel dimensions after the resize. */
  width: number;
  height: number;
}

/**
 * Decode arbitrary image bytes and produce the MAIN + THUMB WebP renditions.
 * EXIF/ICC metadata is dropped (Sharp strips it unless `.withMetadata()` is
 * called — we never call it). `failOn: 'none'` keeps partially-corrupt phone
 * captures from hard-failing the whole upload.
 *
 * Throws if the input is not a decodable image — the route maps that to a 400.
 */
export async function compressPhoto(input: Buffer): Promise<CompressedPhoto> {
  // One shared decode pipeline; `rotate()` with no args bakes in the EXIF
  // orientation BEFORE we strip metadata, so portrait phone shots stay upright.
  const decoded = sharp(input, { failOn: 'none' }).rotate();

  const main = await decoded
    .clone()
    .resize(MAIN_MAX_EDGE, MAIN_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: MAIN_QUALITY, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  const thumb = await decoded
    .clone()
    .resize(THUMB_MAX_EDGE, THUMB_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY, effort: 4 })
    .toBuffer();

  return {
    main: main.data,
    thumb,
    width: main.info.width,
    height: main.info.height,
  };
}

// ── On-disk layout ───────────────────────────────────────────────────────────

/** Two-char shard from the id prefix (mirrors object-store key sharding). */
function shardFor(id: string): string {
  // ids are uuids → always ≥2 hex chars; fall back defensively.
  return (id.slice(0, 2) || 'xx').toLowerCase();
}

function dirFor(env: Env, id: string): string {
  return join(env.PHOTOS_DIR, shardFor(id));
}

export function mainPathFor(env: Env, id: string): string {
  return join(dirFor(env, id), `${id}.webp`);
}

export function thumbPathFor(env: Env, id: string): string {
  return join(dirFor(env, id), `${id}_thumb.webp`);
}

/** Persist the two renditions. Creates the shard dir on first write. */
export async function writeRenditions(env: Env, id: string, photo: CompressedPhoto): Promise<void> {
  await mkdir(dirFor(env, id), { recursive: true });
  await Promise.all([
    writeFile(mainPathFor(env, id), photo.main),
    writeFile(thumbPathFor(env, id), photo.thumb),
  ]);
}

export type Rendition = 'main' | 'thumb';

/**
 * Open a read stream for a stored rendition, or `null` if the file is missing.
 * The route streams this with `image/webp` + immutable cache headers.
 */
export async function readRendition(
  env: Env,
  id: string,
  rendition: Rendition,
): Promise<ReadStream | null> {
  const path = rendition === 'thumb' ? thumbPathFor(env, id) : mainPathFor(env, id);
  try {
    await stat(path); // existence + readability probe before we hand back a stream
  } catch {
    return null;
  }
  return createReadStream(path);
}

/**
 * Delete both renditions for an id (sold/deleted product purge). Idempotent —
 * missing files are not an error, so a partial prior delete still completes.
 */
export async function deleteRenditions(env: Env, id: string): Promise<void> {
  await Promise.all([
    rm(mainPathFor(env, id), { force: true }),
    rm(thumbPathFor(env, id), { force: true }),
  ]);
}

// ── Capacity ─────────────────────────────────────────────────────────────────

export interface CapacityCheck {
  ok: boolean;
  usedBytes: number;
  maxBytes: number;
  /** Bytes free before the cap (never negative). */
  freeBytes: number;
}

/**
 * Decide whether `incomingBytes` fit under PHOTO_STORE_MAX_BYTES given the
 * current `usedBytes` (SUM of local rows' size_bytes). Pure — the caller runs
 * the SUM query and persists the row.
 */
export function checkCapacity(env: Env, usedBytes: number, incomingBytes: number): CapacityCheck {
  const maxBytes = env.PHOTO_STORE_MAX_BYTES;
  const ok = usedBytes + incomingBytes <= maxBytes;
  return {
    ok,
    usedBytes,
    maxBytes,
    freeBytes: Math.max(0, maxBytes - usedBytes),
  };
}

/**
 * Cloudflare R2 client wrapper (Day 16).
 *
 * R2 is S3-compatible; we drive it with `@aws-sdk/client-s3` pointed at the
 * R2 endpoint. The single primitive this module exposes is
 * `getPresignedPutUrl()` — the photo route generates a short-TTL URL, the
 * Control Desktop uploads bytes directly to R2, the API never touches the
 * bytes.
 *
 * Failure mode if env is missing: `getR2Client()` throws — keeps the
 * configuration bug visible. The route layer maps the throw to a 500 with a
 * stable error code so operations sees it on the first photo upload attempt
 * rather than discovering it silently months later.
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { Env } from '../config/env.js';

/** Cached client per (accessKeyId,endpoint) tuple — avoids per-request reconstruction. */
let cachedClient: { client: S3Client; key: string } | null = null;

function getR2Client(env: Env): S3Client {
  if (!env.R2_ACCOUNT_ID || !env.R2_BUCKET || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error(
      'R2 not configured — set R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY before using the photo upload route.',
    );
  }
  const cacheKey = `${env.R2_ACCOUNT_ID}:${env.R2_ACCESS_KEY_ID}`;
  if (cachedClient && cachedClient.key === cacheKey) return cachedClient.client;

  const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const client = new S3Client({
    region: 'auto', // R2 ignores the region; "auto" is the convention
    endpoint,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true, // R2 prefers path-style addressing
  });
  cachedClient = { client, key: cacheKey };
  return client;
}

export interface PresignedPutInput {
  /** Key inside the bucket — e.g. `products/<uuid>/photo-<uuid>.jpg`. */
  key: string;
  /** MIME type the client will PUT. Bound into the signature. */
  contentType: string;
  /** Max object size in bytes (binds Content-Length). */
  maxBytes: number;
  /** TTL of the URL in seconds. Defaults to 600 (10 minutes). */
  ttlSeconds?: number;
}

export interface PresignedPutResult {
  /** URL the client PUTs to. Carries auth + integrity bindings in query params. */
  url: string;
  /** Echo of the key (caller persists this in product_photos.r2_key). */
  key: string;
  /** Final public URL the storefront / Bridge will read from. */
  publicUrl: string;
  /** Headers the client MUST send on the PUT — content-type + content-length. */
  requiredHeaders: { 'content-type': string };
  /** UTC ISO when the presigned URL stops working. */
  expiresAt: string;
}

/**
 * Generate a one-shot presigned PUT URL. The browser / Tauri client uploads
 * bytes directly to R2 — the API never proxies the bytes (cost + memory).
 */
export async function getPresignedPutUrl(
  env: Env,
  input: PresignedPutInput,
): Promise<PresignedPutResult> {
  const ttl = input.ttlSeconds ?? 600;
  const client = getR2Client(env);

  const cmd = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: input.key,
    ContentType: input.contentType,
    ContentLength: input.maxBytes,
  });

  const url = await getSignedUrl(client, cmd, {
    expiresIn: ttl,
    // Limit which headers a tampered request can carry.
    signableHeaders: new Set(['content-type', 'content-length']),
  });

  const publicUrl = env.R2_PUBLIC_URL_BASE
    ? `${env.R2_PUBLIC_URL_BASE.replace(/\/$/, '')}/${input.key}`
    : `https://${env.R2_BUCKET}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${input.key}`;

  return {
    url,
    key: input.key,
    publicUrl,
    requiredHeaders: { 'content-type': input.contentType },
    expiresAt: new Date(Date.now() + ttl * 1_000).toISOString(),
  };
}

/**
 * Server-side direct upload of bytes to R2 (used by the media engine to store
 * generated marketing cards — the bytes are produced in-process, so there is no
 * browser to presign for). Returns the public URL.
 */
export async function putObjectToR2(
  env: Env,
  key: string,
  bytes: Buffer | Uint8Array,
  contentType: string,
): Promise<{ key: string; publicUrl: string }> {
  const client = getR2Client(env);
  await client.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }),
  );
  const publicUrl = env.R2_PUBLIC_URL_BASE
    ? `${env.R2_PUBLIC_URL_BASE.replace(/\/$/, '')}/${key}`
    : `https://${env.R2_BUCKET}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
  return { key, publicUrl };
}

/**
 * Build the public URL the storefront / POS reads an R2 object from, given its
 * key. Mirrors the construction used by the presign + server-upload helpers so
 * a `product_photos.r2_key` row can always be turned into a viewable URL.
 */
export function buildR2PublicUrl(env: Env, key: string): string {
  return env.R2_PUBLIC_URL_BASE
    ? `${env.R2_PUBLIC_URL_BASE.replace(/\/$/, '')}/${key}`
    : `https://${env.R2_BUCKET}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
}

/** Deterministic R2 key for a generated marketing card. */
export function buildMarketingCardKey(productId: string, variant: string): string {
  return `marketing-cards/${productId}/${variant}.webp`;
}

/**
 * Build a deterministic R2 key for a product photo.
 * Shape: `products/<productId>/photo-<photoId>.<ext>`.
 */
export function buildPhotoKey(productId: string, photoId: string, mimeType: string): string {
  const ext =
    mimeType === 'image/jpeg'
      ? 'jpg'
      : mimeType === 'image/png'
        ? 'png'
        : mimeType === 'image/webp'
          ? 'webp'
          : 'bin';
  return `products/${productId}/photo-${photoId}.${ext}`;
}

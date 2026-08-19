/**
 * Unit tests for the KYC encrypted-at-rest store (lib/kyc-store.ts). Pure crypto
 * + compression — no DB. Covers the compliance-critical invariants from the
 * review: round-trip, fresh-IV-per-encryption, GCM tamper detection, AAD row
 * binding (file-swap defence), version/length rejection, server-computed sha256.
 */
import { createHash, randomBytes } from 'node:crypto';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../src/config/env.js';
import {
  KycCryptoError,
  buildKycKeyring,
  compressKycImage,
  decryptKycImage,
  encryptKycImage,
  kycImageAad,
} from '../../src/lib/kyc-store.js';

const keyring = buildKycKeyring({
  KYC_IMAGE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
} as unknown as Env);

function aTestImage(): Promise<Buffer> {
  return sharp({
    create: { width: 160, height: 100, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
}

describe('kyc-store — compression', () => {
  it('compresses to WebP and server-computes the sha256 of the output', async () => {
    const c = await compressKycImage(await aTestImage());
    expect(c.webp.subarray(8, 12).toString()).toBe('WEBP'); // RIFF....WEBP
    expect(createHash('sha256').update(c.webp).digest('hex')).toBe(c.sha256Hex);
    expect(c.width).toBeGreaterThan(0);
  });

  it('rejects non-image bytes', async () => {
    await expect(compressKycImage(Buffer.from('not an image'))).rejects.toThrow();
  });
});

describe('kyc-store — AES-256-GCM', () => {
  const aad = kycImageAad('cust-1', 'doc-1', 'sk-1');

  it('round-trips encrypt → decrypt and frames [version][iv][ct][tag]', async () => {
    const { webp } = await compressKycImage(await aTestImage());
    const enc = encryptKycImage(webp, aad, keyring);
    expect(enc[0]).toBe(0x01); // version byte
    expect(enc.length).toBe(1 + 12 + webp.length + 16);
    expect(decryptKycImage(enc, aad, keyring).equals(webp)).toBe(true);
  });

  it('uses a FRESH iv per encryption (two ciphertexts of the same input differ)', async () => {
    const { webp } = await compressKycImage(await aTestImage());
    const e1 = encryptKycImage(webp, aad, keyring);
    const e2 = encryptKycImage(webp, aad, keyring);
    expect(e1.equals(e2)).toBe(false);
    expect(e1.subarray(1, 13).equals(e2.subarray(1, 13))).toBe(false); // IVs differ
  });

  it('rejects a tampered ciphertext (GCM tag) — hard error, no plaintext', async () => {
    const { webp } = await compressKycImage(await aTestImage());
    const enc = encryptKycImage(webp, aad, keyring);
    if (enc[20] === undefined) throw new Error('Geheimtext zu kurz fuer diese Probe');
    enc[20] ^= 0xff; // flip a ciphertext byte
    expect(() => decryptKycImage(enc, aad, keyring)).toThrow(KycCryptoError);
  });

  it('rejects an AAD swap — a file moved onto another customer/doc/key fails auth', async () => {
    const { webp } = await compressKycImage(await aTestImage());
    const enc = encryptKycImage(webp, aad, keyring);
    expect(() => decryptKycImage(enc, kycImageAad('cust-2', 'doc-1', 'sk-1'), keyring)).toThrow(
      KycCryptoError,
    );
    expect(() => decryptKycImage(enc, kycImageAad('cust-1', 'doc-2', 'sk-1'), keyring)).toThrow(
      KycCryptoError,
    );
    expect(() => decryptKycImage(enc, kycImageAad('cust-1', 'doc-1', 'sk-2'), keyring)).toThrow(
      KycCryptoError,
    );
  });

  it('rejects an unknown version byte and a truncated file', () => {
    expect(() =>
      decryptKycImage(Buffer.concat([Buffer.from([0x02]), randomBytes(40)]), aad, keyring),
    ).toThrow(KycCryptoError);
    expect(() => decryptKycImage(Buffer.from([0x01, 1, 2]), aad, keyring)).toThrow(KycCryptoError);
  });

  it('rejects a wrong key (different keyring)', async () => {
    const { webp } = await compressKycImage(await aTestImage());
    const enc = encryptKycImage(webp, aad, keyring);
    const other = buildKycKeyring({
      KYC_IMAGE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    } as unknown as Env);
    expect(() => decryptKycImage(enc, aad, other)).toThrow(KycCryptoError);
  });
});

describe('kyc-store — keyring', () => {
  it('refuses a key that does not decode to 32 bytes', () => {
    expect(() =>
      buildKycKeyring({ KYC_IMAGE_ENCRYPTION_KEY: 'too-short' } as unknown as Env),
    ).toThrow(KycCryptoError);
  });
});

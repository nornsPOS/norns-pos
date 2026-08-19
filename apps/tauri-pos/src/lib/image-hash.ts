/**
 * image-hash — SHA-256 of a Blob via the Web Crypto Subtle API.
 *
 * Used by the Foto-Werkstatt KYC mode (#I-47 closure): the client
 * computes the hash before uploading to R2 so the kyc_documents row
 * carries verifiable tamper detection. The hex string is what the
 * backend `decode(?, 'hex')` lands as BYTEA.
 *
 * `crypto.subtle.digest('SHA-256', …)` is available in:
 *   • all browsers since 2015
 *   • Tauri's WebKit (macOS) and WebView2 (Windows)
 *   • Node 19+ (we don't run there, but it works in Vitest)
 * On insecure origins (plain `http://`) subtle is missing. In Tauri
 * dev `http://localhost:1420` is considered a secure context. In
 * production Tauri the bundle URL is also secure.
 */

export async function sha256HexOfBlob(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return bufferToHex(digest);
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i] as number).toString(16).padStart(2, '0');
  }
  return out;
}

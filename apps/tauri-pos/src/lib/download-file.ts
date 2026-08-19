/**
 * downloadTextFile — trigger a browser/webview "save as" for an in-memory text
 * payload (CSV exports). The CSV body has already been fetched through the
 * api-client (so the session cookie + step-up interceptor applied); here we
 * only turn the string into a file the operator can hand to the Steuerberater.
 *
 * Works in the Tauri webview (Chromium): a Blob URL on a transient anchor.
 */
export function downloadTextFile(
  filename: string,
  text: string,
  mime = 'text/csv;charset=utf-8',
): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * downloadBase64File — trigger a "save as" for a binary payload that arrived
 * base64-encoded (the DSFinV-K ZIP rides the text-only api-client path, so the
 * route base64-encodes it; here we decode back to the exact bytes and download).
 */
export function downloadBase64File(
  filename: string,
  base64: string,
  mime = 'application/zip',
): void {
  const binary = atob(base64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * downloadBytesFile — eine Datei BYTE FÜR BYTE speichern, ohne Umkodierung.
 *
 * ── WARUM ES DAS BRAUCHT (30.07.2026) ───────────────────────────────────────
 *
 * `downloadTextFile` nimmt eine Zeichenkette, und ein `Blob` aus einer
 * Zeichenkette wird IMMER als UTF-8 geschrieben. Für DATEV ist das falsch: der
 * Server liefert absichtlich Windows-1252, weil der Steuerberater genau das
 * erwartet.
 *
 * Der Schaden entstand sogar schon eine Stufe früher, beim Lesen der Antwort
 * mit `res.text()`. Gemessen: aus dem Byte 0xFC (ü) wurde EF BF BD, aus einem
 * Byte wurden drei, und zurück geht es nicht. Deshalb reisen die DATEV-Wege
 * jetzt vom Server bis auf die Platte als `ArrayBuffer` und fassen nie eine
 * Zeichenkette an.
 *
 * `mime` trägt bewusst KEIN charset: die Bytes sagen selbst, was sie sind.
 */
export function downloadBytesFile(
  filename: string,
  bytes: ArrayBuffer,
  mime = 'text/csv',
): void {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

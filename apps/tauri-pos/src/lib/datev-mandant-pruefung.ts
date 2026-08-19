/**
 * Die Feldprüfung der zwei DATEV-Ordnungsnummern — reine Regeln, ohne
 * Oberfläche.
 *
 * ── WARUM ÜBERHAUPT IM FELD GEPRÜFT WIRD (26.07.2026) ──────────────────────
 * Der Server bleibt die Wahrheit; er prüft dieselben zwei Regeln in
 * `pruefeDatevEinstellung` (`apps/api-cloud/src/lib/kontenrahmen.ts`). Aber
 * das Speichern verlangt eine frische Zweitbestätigung: wer sich vertippt,
 * bestätigt erst den Gerätecode und erfährt DANACH, dass eine Ziffer zu viel
 * war. Diese Regeln fangen den Vertipper davor ab.
 *
 * ── WARUM ALS EIGENE DATEI ─────────────────────────────────────────────────
 * Der Prüflauf dieser App fährt reine Logik ohne Oberfläche. Lägen die Regeln
 * in der `.tsx`, wären sie ungeprüft — und eine ungeprüfte Regel, die neben
 * einer Serverregel herläuft, driftet still auseinander. Der Wächter
 * `datev-mandant-pruefung.test.ts` liest darum den ECHTEN Serverquelltext und
 * hält ihn gegen diese Datei.
 */

/**
 * Beraternummer: vier bis sieben Ziffern.
 *
 * Gibt die deutsche Fehlerzeile zurück — oder `null`, wenn die Eingabe steht.
 */
export function pruefeBeraternummer(eingabe: string): string | null {
  const roh = eingabe.trim();
  if (roh === '') return 'Bitte die Beraternummer eintragen.';
  if (!/^\d+$/.test(roh)) return 'Die Beraternummer besteht nur aus Ziffern.';
  if (roh.length < 4 || roh.length > 7) {
    return `Die Beraternummer hat vier bis sieben Ziffern; eingegeben wurden ${String(roh.length)}.`;
  }
  return null;
}

/**
 * Mandantennummer: eine bis fünf Ziffern, mindestens 1.
 *
 * Die Untergrenze ist keine Förmlichkeit: eine 0 wäre für DATEV keine gültige
 * Mandantennummer, und der Server weist sie ab.
 */
export function pruefeMandantennummer(eingabe: string): string | null {
  const roh = eingabe.trim();
  if (roh === '') return 'Bitte die Mandantennummer eintragen.';
  if (!/^\d+$/.test(roh)) return 'Die Mandantennummer besteht nur aus Ziffern.';
  if (roh.length > 5) {
    return `Die Mandantennummer hat eine bis fünf Ziffern; eingegeben wurden ${String(roh.length)}.`;
  }
  if (Number(roh) < 1) return 'Die Mandantennummer ist mindestens 1.';
  return null;
}

/**
 * Beginn des Wirtschaftsjahres: JJJJ-MM-TT.
 *
 * ⚠️ 12.08.2026 nachgetragen, zusammen mit den zwei Regeln darunter: bis dahin
 * waren vier der sechs DATEV-Angaben in der Kasse NIRGENDS eintragbar. Die
 * Maske verwies auf „Einstellungen unter DATEV" — einen Ort, den es nur in
 * der Inhaber-App gab. Dieselben Regeln wie `pruefeDatevEinstellung` auf dem
 * Server; der Wächter hält beide gegeneinander.
 */
export function pruefeWirtschaftsjahrBeginn(eingabe: string): string | null {
  const roh = eingabe.trim();
  if (roh === '') return 'Bitte den Beginn des Wirtschaftsjahres eintragen.';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(roh);
  if (!m) {
    return 'Der Beginn des Wirtschaftsjahres wird als JJJJ-MM-TT eingegeben, zum Beispiel 2026-01-01.';
  }
  const monat = Number(m[2]);
  const tag = Number(m[3]);
  if (monat < 1 || monat > 12 || tag < 1 || tag > 31) {
    return `„${roh}" ist kein gültiges Datum.`;
  }
  return null;
}

/** Länge der Sachkonten: ganze Zahl, vier bis acht. */
export function pruefeSachkontenlaenge(eingabe: string): string | null {
  const roh = eingabe.trim();
  if (roh === '') return 'Bitte die Länge der Sachkonten eintragen.';
  const n = Number(roh);
  if (!Number.isInteger(n) || n < 4 || n > 8) {
    return `Die Sachkontenlänge muss vier bis acht Stellen haben; eingegeben wurde „${roh}".`;
  }
  return null;
}

/** Eine Auswahl, die getroffen sein muss — Festschreibung und Kontenrahmen. */
export function pruefeAuswahlGetroffen(eingabe: string, was: string): string | null {
  if (eingabe.trim() === '') return `Bitte ${was} wählen.`;
  return null;
}

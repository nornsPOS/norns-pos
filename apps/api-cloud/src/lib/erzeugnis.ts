/**
 * Wie sich die Kasse SELBST nennt — an genau einer Stelle.
 *
 * Nicht zu verwechseln mit dem Ladennamen (`laden-identitaet.ts`): der gehört
 * dem Händler und wird nie erfunden. Die Werte hier gehören dem ERZEUGNIS und
 * sind für jeden Mandanten dieselben.
 *
 * ⚠️ 01.08.2026, in der amtlichen Ausfuhr gefunden: hier standen zwei fest
 * eingetippte Marken, und beide nannten den falschen Namen.
 *
 *   `routes/closing-export.ts:1451`   brand: 'Warehouse14'
 *   `lib/dsfinvk-daten.ts:549`        swBrand: 'warehouse14'
 *
 * Beide landen in `cashregister.csv` der DSFinV-K-Ausfuhr, in den Feldern
 * `KASSE_BRAND` und `KASSE_SW_BRAND`. Die amtliche Beschreibung nennt sie
 * „Marke der Kasse" und „Markenbezeichnung der Software" — das ist die
 * Aussage der Kasse über sich selbst gegenüber dem Finanzamt. Der Händler
 * steht getrennt in `location.csv`.
 *
 * Der Händler zog also seinen Steuerexport und meldete dem Prüfer die Marke
 * einer fremden Firma. Direkt daneben standen Seriennummer und Version
 * korrekt aus den Einstellungen; nur die Marke war eingetippt.
 *
 * Wer hier etwas ändert, ändert es für die amtliche Ausfuhr. Der Wächter
 * `erzeugnis.test.ts` hält die Namen fest und geht rot, sobald irgendwo
 * wieder eine Marke von Hand danebengeschrieben wird.
 */

/** Die Marke der Kasse. Steht in `cashregister.csv` als `KASSE_BRAND`. */
export const ERZEUGNIS_MARKE = 'Norns';

/**
 * Das Modell. Stand hier einmal als `tauri-pos` — das ist der Name eines
 * Paketordners, kein Erzeugnis. Der Prüfer liest den Produktnamen, und der
 * steht in `apps/tauri-pos/src-tauri/tauri.conf.json` als `productName`.
 */
export const ERZEUGNIS_MODELL = 'Norns POS';

/**
 * Die Marke der Software. In der Norm getrennt von der Marke der Kasse,
 * weil beides verschiedene Hersteller sein können. Hier ist es dasselbe Haus.
 */
export const ERZEUGNIS_SOFTWARE_MARKE = 'Norns';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  gruppen — welche Fläche in welcher Gruppe wohnt
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── WARUM DAS EIN EIGENES WURZELSTÜCK IST (20.08.2026) ─────────────────────
 *
 * Diese Zuordnung stand mitten in `Uebersicht.tsx` — einer Fläche, die es
 * nur noch als Weiche für alte Tiefenlinks gibt. Drei fremde Stellen lasen
 * sie von dort: die Einstellungs-Spalte, der Symbolfarben-Wächter und der
 * Rückweg. Damit hing ein Stück Ordnung des ganzen Hauses an einem
 * Bildschirm, den niemand mehr öffnet.
 *
 * Jetzt steht sie für sich: eine Liste, keine Fläche. Wer eine Gruppe
 * ändert, ändert sie hier, und alle vier Leser folgen.
 */

/**
 * Die Ordnung der Fläche.
 *
 * Nach TÄTIGKEIT gruppiert, nicht alphabetisch: wer den Edge-Schutz sucht,
 * sucht ihn unter „Aufsicht", nicht unter S. Ein Pfad, der in keine Gruppe
 * passt, landet unter „Weiteres" — sichtbar bleibt er in jedem Fall.
 */
export const GRUPPEN: ReadonlyArray<{ titel: string; satz: string; pfade: readonly string[] }> = [
  {
    titel: 'Aufsicht und Schutz',
    satz: 'Was der Inhaber im Blick behält.',
    // ⚠️ 01.08.2026: `/schaufenster` stand hier weiter, nachdem die Fläche
    // ausgezogen war (sie zeigte den Webshop, den diese Kasse nicht hat).
    // Die Kachel führte ins Leere. Der Wächter unten hat es gefangen.
    pfade: ['/leitstand', '/risiko', '/zielkarte', '/tagebuch'],
  },
  {
    titel: 'Geld und Steuer',
    satz: 'Zahlen, Belege und was das Finanzamt sehen will.',
    pfade: ['/finanzen', '/steuer-export', '/dokumente', '/belegtexte'],
  },
  {
    titel: 'Ware und Kanäle',
    satz: 'Was hereinkommt, was hinausgeht, und über welchen Weg.',
    // ⚠️ 01.08.2026: `/ebay` ist ausgezogen. Der Kanal braucht `EBAY_API_TOKEN`
    // aus der Umgebung, und der Rumpf reicht eine geschlossene Liste von vier
    // Geheimnissen durch. Schlimmer noch: ohne Zugang meldete der Kanal
    // Erfolg, ohne zu senden.
    // 19.08.2026: /fotos ausgebaut (Webshop-Erbe) — siehe surface-registry.
    pfade: ['/inventur', '/bewertung', '/kurse'],
  },
  {
    titel: 'Kundschaft',
    satz: 'Anfragen, Nachrichten und was noch offen ist.',
    // Ebenso `/kalender`: die Google-Kalender-Fläche ist ausgezogen, `/termine`
    // ist der eigene Terminweg dieser Kasse und bleibt.
    // Ebenso `/anfragen` (der Gmail-Abholer wohnt im Arbeiter, der nicht
    // mitreist) und `/whatsapp` (der Eingang kommt per Webhook von Meta, den
    // eine Kasse ohne Tunnel nie bekommt).
    pfade: ['/compliance-inbox', '/termine', '/aufgaben'],
  },
  {
    titel: 'Haus und Personal',
    satz: 'Einstellungen und wer am Tresen steht.',
    pfade: ['/einstellungen', '/team'],
  },
];

/**
 * Die HEIMAT jeder sekundären Fläche: welche Gruppe sie beherbergt, als
 * Adresse ihrer Tür.
 *
 * Der Rückweg liest das. Steht eine Fläche in keiner Gruppe, steht sie hier
 * auch nicht — und bekommt keinen Knopf, der ins Leere führt.
 *
 * ⚠️ Alle Gruppen wohnen in der Einstellungs-Spalte; die Tür ist deshalb für
 * alle dieselbe. Bekommt eine Gruppe eines Tages eine eigene Fläche, ist
 * DIESE Zuordnung die Stelle, an der es steht — und nicht vier Stellen.
 */
export const GRUPPEN_HEIMAT: ReadonlyMap<string, string> = new Map(
  GRUPPEN.flatMap((g) => g.pfade.map((p) => [p, '/einstellungen'] as const)),
);

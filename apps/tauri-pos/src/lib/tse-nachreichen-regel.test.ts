/**
 * ════════════════════════════════════════════════════════════════════════
 *  Eine fiskale Aufzeichnung wird nicht nach 35 Sekunden aufgegeben
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 *     MAX_ATTEMPTS = 8, Takt fest 5 Sekunden, danach `markFailedTerminal`.
 *
 * Rund 35 Sekunden, dann wurde die Zeile NIE WIEDER ausgewählt, auch nicht
 * nach einem Neustart der Kasse. Eine Wolken-TSE ist regelmässig länger weg;
 * ein Netz, das eine Minute hakt, kostete eine Signatur für immer.
 */

import { describe, expect, it } from 'vitest';

import {
  ERSTE_WARTEZEIT_MS,
  MAX_WARTEZEIT_MS,
  istDauerhaftAbgelehnt,
  istWiederFaellig,
  wartezeitNachVersuchen,
} from './tse-nachreichen-regel.js';

describe('Die Wartezeit wächst und hat einen Deckel', () => {
  it('der erste Versuch wartet gar nicht', () => {
    expect(wartezeitNachVersuchen(0)).toBe(0);
  });

  it('danach verdoppelt sie sich', () => {
    expect(wartezeitNachVersuchen(1)).toBe(5_000);
    expect(wartezeitNachVersuchen(2)).toBe(10_000);
    expect(wartezeitNachVersuchen(3)).toBe(20_000);
    expect(wartezeitNachVersuchen(4)).toBe(40_000);
  });

  it('⚠️ und sie hört bei einer Viertelstunde auf zu wachsen', () => {
    // Ohne Deckel wären es beim zwanzigsten Versuch Wochen, und die Signatur
    // käme nie zurück, obwohl die TSE längst wieder da ist.
    expect(wartezeitNachVersuchen(30)).toBe(MAX_WARTEZEIT_MS);
    expect(wartezeitNachVersuchen(1000)).toBe(MAX_WARTEZEIT_MS);
  });

  it('⛔ sie wird NIE unendlich — es gibt kein Aufgeben über die Zeit', () => {
    for (const n of [8, 9, 50, 10_000]) {
      const w = wartezeitNachVersuchen(n);
      expect(Number.isFinite(w), `${n} Versuche`).toBe(true);
      expect(w).toBeLessThanOrEqual(MAX_WARTEZEIT_MS);
    }
  });
});

describe('Wann ist eine Zeile wieder dran?', () => {
  it('sofort, wenn sie noch nie versucht wurde', () => {
    expect(istWiederFaellig(0, null, 1_000)).toBe(true);
  });

  it('nach dem ersten Fehlschlag erst fünf Sekunden später', () => {
    const t = 1_000_000;
    expect(istWiederFaellig(1, t, t + 4_999)).toBe(false);
    expect(istWiederFaellig(1, t, t + ERSTE_WARTEZEIT_MS)).toBe(true);
  });

  it('⚠️ und nach dem achten Fehlschlag IMMER NOCH — nur später', () => {
    /**
     * Der Kern des Befunds. Bei acht Versuchen war vorher Schluss. Jetzt ist
     * die Zeile weiterhin fällig, nur mit Abstand.
     */
    const t = 2_000_000;
    expect(istWiederFaellig(8, t, t + 1_000)).toBe(false);
    expect(istWiederFaellig(8, t, t + MAX_WARTEZEIT_MS)).toBe(true);
  });

  it('auch beim tausendsten Versuch kommt sie wieder dran', () => {
    const t = 3_000_000;
    expect(istWiederFaellig(1000, t, t + MAX_WARTEZEIT_MS)).toBe(true);
  });
});

describe('⛔ Aufgegeben wird NUR bei dauerhafter Ablehnung', () => {
  it('kein Netz, Zeitüberschreitung, Unbekanntes: vorübergehend', () => {
    for (const f of [
      new Error('fetch failed'),
      new Error('network timeout'),
      { message: 'ECONNREFUSED' },
      null,
      undefined,
      'irgendein Text',
    ]) {
      expect(istDauerhaftAbgelehnt(f), String(f)).toBe(false);
    }
  });

  it('5xx ist die Gegenstelle, nicht wir: vorübergehend', () => {
    for (const s of [500, 502, 503, 504]) {
      expect(istDauerhaftAbgelehnt({ status: s }), String(s)).toBe(false);
    }
  });

  it('⚠️ 408 und 429 sind ausdrücklich vorübergehend', () => {
    // „Zu viele Anfragen" heisst warte, nicht hör auf. Wer das als dauerhaft
    // liest, gibt genau dann auf, wenn die Gegenstelle nur überlastet ist.
    expect(istDauerhaftAbgelehnt({ status: 408 })).toBe(false);
    expect(istDauerhaftAbgelehnt({ status: 429 })).toBe(false);
  });

  it('⚠️ 401 und 403 sind die SITZUNG, nicht der Rumpf: vorübergehend', () => {
    /**
     * ── DIE ZEILE, DIE DEN FEHLER PINNTE (bis 11.08.2026) ──────────────
     *
     * Hier stand `401` und `403` in der Liste der DAUERHAFTEN Ablehnungen.
     * Gemessen wurde damit ein Verlust: eine Zeile mit fertiger Signatur
     * ging beim ERSTEN 401 auf `failed_terminal`, ohne einen einzigen
     * Wiederholversuch, und wurde nie wieder ausgewählt.
     *
     * Beide Antworten sagen nichts über den Rumpf. Sie sagen: gerade
     * nimmt dich niemand an. Die Personal-Sitzung läuft nach acht Stunden
     * ab, ein Kassierer ohne aufgelöste Gerätekennung bekommt 403 — und
     * beides kommt mit der nächsten Anmeldung von selbst zurück.
     */
    expect(istDauerhaftAbgelehnt({ status: 401 })).toBe(false);
    expect(istDauerhaftAbgelehnt({ status: 403 })).toBe(false);
  });

  it('jeder andere 4xx ist dauerhaft: der Rumpf wird nie angenommen', () => {
    // Die Gegenprobe zur Zeile darüber: die Unterscheidung darf nicht
    // dadurch sterben, dass alles vorübergehend wird. Ein falsch gebauter
    // Rumpf wird beim tausendsten Versuch genauso abgelehnt.
    for (const s of [400, 404, 409, 422]) {
      expect(istDauerhaftAbgelehnt({ status: s }), String(s)).toBe(true);
    }
  });

  it('der Status wird auch aus dem Fehlertext gelesen', () => {
    // Der Rust-Weg reicht den Fehler als Satz durch, siehe
    // `Fiskaly PATCH /tx returned 400 Bad Request: …`.
    expect(istDauerhaftAbgelehnt(new Error('Fiskaly PATCH /tx returned 400 Bad Request'))).toBe(
      true,
    );
    expect(istDauerhaftAbgelehnt(new Error('Fiskaly PATCH /tx returned 502 Bad Gateway'))).toBe(
      false,
    );
  });

  it('⚠️ im Zweifel VORÜBERGEHEND', () => {
    /**
     * Eine zu oft wiederholte Zeile kostet Rechenzeit. Eine zu früh
     * aufgegebene kostet eine gesetzlich verlangte Signatur. Die beiden
     * Fehler sind nicht gleich schwer, und die Voreinstellung folgt dem.
     */
    expect(istDauerhaftAbgelehnt({ irgendwas: 'ohne Status' })).toBe(false);
  });
});

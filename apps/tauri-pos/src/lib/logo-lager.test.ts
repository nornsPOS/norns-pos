/**
 * Der Offline-Zwischenspeicher des Haendler-Logos — rein, mit gespieltem Storage.
 *
 * WARUM ES IHN GIBT (26.07.2026): der shop-info-Weg hat KEINE
 * Offline-Zwischenspeicherung — faellt der Server aus, greift nur die
 * eingebaute Konstante, und die traegt bewusst kein Logo. Ein Bon ohne Netz
 * muss sein Logo trotzdem tragen. Gespeichert wird das BEREINIGTE ORIGINAL
 * (svg/png/jpeg) samt Format, wie es GET /api/shop-info liefert — die
 * Rust-Seite rastert selbst (resvg bzw. image), es gibt kein Zwischen-PNG.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { LOGO_LAGER_SCHLUESSEL, logoEntfernen, logoLaden, logoSpeichern } from './logo-lager.js';
import type { GespeichertesLogo } from './logo-lager.js';

/** Ein Storage aus einer Map — genug fuer getItem/setItem/removeItem. */
function speicherAttrappe(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: () => null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

const BEISPIEL: GespeichertesLogo = {
  datenBase64: 'PHN2ZyB4bWxucz0iLi4uIi8+',
  format: 'svg',
  stufe: 'mittel',
  hochgeladenAm: '2026-07-26T12:00:00.000Z',
};

let lager: Storage;
beforeEach(() => {
  lager = speicherAttrappe();
});

describe('logoSpeichern / logoLaden', () => {
  it('gibt zurueck, was gespeichert wurde', () => {
    logoSpeichern(BEISPIEL, lager);
    expect(logoLaden(lager)).toEqual(BEISPIEL);
  });

  it('liefert null, wenn nie etwas gespeichert wurde', () => {
    expect(logoLaden(lager)).toBeNull();
  });

  it('logoEntfernen loescht den Eintrag wirklich', () => {
    logoSpeichern(BEISPIEL, lager);
    logoEntfernen(lager);
    expect(logoLaden(lager)).toBeNull();
    expect(lager.getItem(LOGO_LAGER_SCHLUESSEL)).toBeNull();
  });
});

describe('logoLaden misstraut dem Speicher', () => {
  it('kaputtes JSON ergibt null, keinen Absturz', () => {
    lager.setItem(LOGO_LAGER_SCHLUESSEL, '{nicht json');
    expect(logoLaden(lager)).toBeNull();
  });

  it('eine fremde Gestalt ergibt null', () => {
    lager.setItem(LOGO_LAGER_SCHLUESSEL, JSON.stringify({ irgendwas: 1 }));
    expect(logoLaden(lager)).toBeNull();
  });

  it('ein unbekanntes Format ergibt null — die Rust-Seite wuerde es verwerfen', () => {
    lager.setItem(LOGO_LAGER_SCHLUESSEL, JSON.stringify({ ...BEISPIEL, format: 'webp' }));
    expect(logoLaden(lager)).toBeNull();
  });

  it('eine unbekannte Stufe ergibt null — lieber kein Logo als ein falsches', () => {
    lager.setItem(LOGO_LAGER_SCHLUESSEL, JSON.stringify({ ...BEISPIEL, stufe: 'riesig' }));
    expect(logoLaden(lager)).toBeNull();
  });

  it('leere Bilddaten ergeben null', () => {
    lager.setItem(LOGO_LAGER_SCHLUESSEL, JSON.stringify({ ...BEISPIEL, datenBase64: '' }));
    expect(logoLaden(lager)).toBeNull();
  });

  it('base64 mit fremden Zeichen ergibt null — der Speicher ist eine Grenze', () => {
    lager.setItem(
      LOGO_LAGER_SCHLUESSEL,
      JSON.stringify({ ...BEISPIEL, datenBase64: 'abc<script>' }),
    );
    expect(logoLaden(lager)).toBeNull();
  });
});

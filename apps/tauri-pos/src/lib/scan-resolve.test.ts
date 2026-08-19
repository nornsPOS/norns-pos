/**
 * scan-resolve — pure logic for the cashier barcode scan→cart loop.
 *
 * The printed label carries a Code128 barcode of the SKU; a USB scanner emits
 * that SKU as keystrokes. This module is the PURE part: normalise the raw scan,
 * then classify it against the rows the catalog lookup returned so the caller
 * can give precise feedback (found+add / not-found / already-sold /
 * already-reserved / draft). No network, no React — trivially testable.
 */
import { describe, expect, it } from 'vitest';

import type { ProductListRow } from '@norns/api-client';

import { classifyScanMatch, entpackeHausverweis, normalizeScan } from './scan-resolve.js';

/** Minimal row stub — only the fields the resolver reads. */
function row(partial: Partial<ProductListRow>): ProductListRow {
  return {
    id: 'id',
    sku: 'W14-AU-750-0012',
    barcode: null,
    status: 'AVAILABLE',
    name: 'Ring',
    listPriceEur: '100.00',
    ...partial,
  } as ProductListRow;
}

describe('normalizeScan', () => {
  it('trims surrounding whitespace and a trailing carriage return', () => {
    expect(normalizeScan('  W14-AU-750-0012 \r')).toBe('W14-AU-750-0012');
  });

  it('uppercases so case-variant scans still match', () => {
    expect(normalizeScan('w14-au-750-0012')).toBe('W14-AU-750-0012');
  });

  it('collapses to empty for blank input', () => {
    expect(normalizeScan('   ')).toBe('');
  });
});

/*
 * ── Die eigene Kennzeichnung, gelesen wie am Tresen ──────────────────────────
 *
 * Bis zum 26.07.2026 war der QR auf jedem Etikett Zierde: `w14://p/MZ-0042`
 * ging als Suchbegriff an den Katalog, und kein Artikel heisst so. Diese
 * Prüfungen decken jede Form ab, die auf einem Etikett oder in einer Kamera
 * landen kann — und, genauso wichtig, die Formen, die NICHT angefasst werden
 * dürfen.
 */
describe('entpackeHausverweis', () => {
  it('liest das NEUE Schema, das diese Kasse druckt', () => {
    expect(entpackeHausverweis('norns://p/MZ-0042')).toBe('MZ-0042');
  });

  /**
   * ⚠️ 01.08.2026, DER SATZ MIT DEM MEISTEN GEWICHT.
   *
   * Ab heute druckt der Etikettendrucker `norns://`. Jedes Etikett, das
   * VORHER geklebt wurde, trägt `w14://`. Fiele das alte Schema aus dem
   * Leser, fände die Kasse am Tag der Auslieferung ihre eigene Ware nicht
   * mehr — Regal für Regal, und niemand wüsste warum.
   *
   * Dieser Satz darf nie gelöscht werden, solange irgendwo ein Etikett von
   * vor dem 01.08.2026 klebt. Das ist praktisch für immer.
   */
  it('liest AUCH das alte Schema, sonst wären alle geklebten Etiketten tot', () => {
    expect(entpackeHausverweis('w14://p/MZ-0042')).toBe('MZ-0042');
  });

  it('liest gleichgültig, ob gross oder klein geschrieben', () => {
    // Ein Lesegerät im Tastaturbetrieb kann bei gedrückter Umschalttaste alles
    // in Grossbuchstaben tippen — und der Alphanumerik-Modus des QR verlangt
    // ohnehin Grossschrift.
    expect(entpackeHausverweis('NORNS://P/MZ-0042')).toBe('MZ-0042');
    expect(entpackeHausverweis('W14://P/MZ-0042')).toBe('MZ-0042');
  });

  it('verträgt Rand, Wagenrücklauf, Schlussstrich, Abfrage und Sprungmarke', () => {
    expect(entpackeHausverweis('  norns://p/MZ-0042 \r')).toBe('MZ-0042');
    expect(entpackeHausverweis('  w14://p/MZ-0042 \r')).toBe('MZ-0042');
    expect(entpackeHausverweis('norns://p/MZ-0042/')).toBe('MZ-0042');
    expect(entpackeHausverweis('norns://p/MZ-0042?von=etikett')).toBe('MZ-0042');
    expect(entpackeHausverweis('norns://p/MZ-0042#preis')).toBe('MZ-0042');
  });

  it('lässt eine blosse Artikelnummer unangetastet', () => {
    expect(entpackeHausverweis('W14-AU-750-0012')).toBe('W14-AU-750-0012');
  });

  /*
   * DIE WICHTIGSTE GRUPPE. Ein fremder Strichcode, der verstümmelt wird, ist
   * schlimmer als einer, der nicht gefunden wird: die Kasse legt dann
   * womöglich den FALSCHEN Artikel in den Korb.
   */
  it('lässt einen fremden Code mit Schrägstrich unangetastet', () => {
    expect(entpackeHausverweis('10/2026')).toBe('10/2026');
    expect(entpackeHausverweis('LOT/4711/P/9')).toBe('LOT/4711/P/9');
    expect(entpackeHausverweis('4006381333931')).toBe('4006381333931');
  });

  it('lässt JEDE Netzadresse unangetastet, auch mit gleichem Pfad', () => {
    // ⚠️ 01.08.2026: Diese Kasse hat KEINEN Webshop, und die Liste der eigenen
    // Rechnernamen ist entsprechend leer. Vorher standen dort `warehouse14.de`
    // und `www.warehouse14.de` — der Shop einer fremden Firma, den ein
    // Norns-Händler nie betreibt.
    expect(entpackeHausverweis('https://example.com/p/MZ-0042')).toBe(
      'https://example.com/p/MZ-0042',
    );
    // Auch der ehemals eigene Name ist jetzt ein fremder wie jeder andere.
    expect(entpackeHausverweis('https://warehouse14.de/p/MZ-0042')).toBe(
      'https://warehouse14.de/p/MZ-0042',
    );
  });

  it('lässt das eigene Schema ohne saubere Artikelnummer unangetastet', () => {
    // Kein Artikelverweis: nicht auspacken, sondern ehrlich stehen lassen,
    // damit der Verkäufer sieht, was das Lesegerät gelesen hat.
    expect(entpackeHausverweis('norns://kontakt')).toBe('norns://kontakt');
    expect(entpackeHausverweis('norns://p/')).toBe('norns://p/');
    expect(entpackeHausverweis('w14://p/')).toBe('w14://p/');
    expect(entpackeHausverweis('norns://p/MZ-0042/teil')).toBe('norns://p/MZ-0042/teil');
  });
});

describe('normalizeScan mit der eigenen Kennzeichnung', () => {
  it('führt den gedruckten QR auf die reine Artikelnummer zurück', () => {
    expect(normalizeScan('norns://p/mz-0042')).toBe('MZ-0042');
    expect(normalizeScan('w14://p/mz-0042')).toBe('MZ-0042');
    expect(normalizeScan('norns://p/w14-au-750-0012\r')).toBe('W14-AU-750-0012');
  });

  it('findet den Artikel über den gedruckten QR', () => {
    const ware = row({ id: 'q1', sku: 'W14-AU-750-0012', status: 'AVAILABLE' });
    expect(classifyScanMatch('norns://p/W14-AU-750-0012', [ware])).toEqual({
      kind: 'found',
      product: ware,
    });
    // Und über ein Etikett von vor der Umstellung ebenso.
    expect(classifyScanMatch('w14://p/W14-AU-750-0012', [ware]).kind).toBe('found');
  });

  it('packt GESPEICHERTE Werte nicht aus und stiehlt so keinen Scan', () => {
    // Stünde in der Strichcodespalte einmal etwas, das wie ein Verweis
    // aussieht, dürfte es beim Vergleich nicht verkürzt werden: sonst
    // beanspruchte diese Zeile den Scan „MZ-0042" für sich und die Kasse legte
    // den FALSCHEN Artikel in den Korb.
    const sonderbar = row({ id: 'q2', sku: 'W14-XX-0001', barcode: 'w14://p/MZ-0042' });
    const echt = row({ id: 'q3', sku: 'MZ-0042', status: 'AVAILABLE' });
    const treffer = classifyScanMatch('MZ-0042', [sonderbar, echt]);
    expect(treffer).toEqual({ kind: 'found', product: echt });
    expect(classifyScanMatch('MZ-0042', [sonderbar]).kind).toBe('not-found');
  });
});

describe('classifyScanMatch', () => {
  const target = row({ id: 'p1', sku: 'W14-AU-750-0012', status: 'AVAILABLE' });

  it('AVAILABLE exact SKU → found (ready to reserve)', () => {
    const m = classifyScanMatch('W14-AU-750-0012', [target]);
    expect(m).toEqual({ kind: 'found', product: target });
  });

  it('matches case-insensitively after normalization', () => {
    const m = classifyScanMatch(' w14-au-750-0012\r', [target]);
    expect(m.kind).toBe('found');
  });

  it('no row in the result set → not-found', () => {
    expect(classifyScanMatch('W14-XX-000-9999', [target])).toEqual({ kind: 'not-found' });
  });

  it('blank scan → not-found (never matches a row)', () => {
    expect(classifyScanMatch('   ', [target]).kind).toBe('not-found');
  });

  it('SOLD row → sold (do not add)', () => {
    const sold = row({ id: 'p2', sku: 'W14-AG-999-0003', status: 'SOLD' });
    expect(classifyScanMatch('W14-AG-999-0003', [sold])).toEqual({ kind: 'sold', product: sold });
  });

  it('RESERVED row → reserved (another channel holds it)', () => {
    const res = row({ id: 'p3', sku: 'W14-PT-950-0007', status: 'RESERVED' });
    expect(classifyScanMatch('W14-PT-950-0007', [res])).toEqual({ kind: 'reserved', product: res });
  });

  it('DRAFT row → draft (not yet verkaufsbereit)', () => {
    const d = row({ id: 'p4', sku: 'W14-AU-585-0021', status: 'DRAFT' });
    expect(classifyScanMatch('W14-AU-585-0021', [d])).toEqual({ kind: 'draft', product: d });
  });

  it('falls back to the barcode column when the scan is not the SKU', () => {
    const byBarcode = row({ id: 'p5', sku: 'W14-AU-750-0099', barcode: '4006381333931' });
    expect(classifyScanMatch('4006381333931', [byBarcode])).toEqual({
      kind: 'found',
      product: byBarcode,
    });
  });

  it('picks the exact SKU even when an ILIKE query returned near-matches', () => {
    const a = row({ id: 'a', sku: 'W14-AU-750-0012', status: 'AVAILABLE' });
    const b = row({ id: 'b', sku: 'W14-AU-750-00120', status: 'AVAILABLE' });
    const m = classifyScanMatch('W14-AU-750-0012', [b, a]);
    expect(m).toEqual({ kind: 'found', product: a });
  });
});

/**
 * Kassenbericht as a PRINTABLE A4 page.
 *
 * WHY THIS EXISTS. Until now the day's cash report could only be downloaded as
 * a CSV. That is the right thing to hand a Steuerberater, who imports it, and
 * the wrong thing entirely when a Prüfer stands at the counter during a
 * Kassen-Nachschau (§ 146b AO) and asks to be handed the day. A CSV opened in
 * Excel is a spreadsheet with the shop's column widths, not a document: no
 * letterhead, no VAT id, no statement of who closed the day and when.
 *
 * NO SECOND SOURCE OF TRUTH. This renders the very same `KassenberichtInput`
 * the CSV builder renders, through the very same label maps, so the printed
 * page and the imported file can never disagree. If a figure is missing it says
 * so in words here too; nothing is rounded, recomputed or invented on the way
 * to paper.
 *
 * Self-contained: inline CSS, no font or image fetch, so it prints identically
 * on a shop machine with no network. `@page A4` plus a print colour-adjust so
 * the hairlines survive the printer driver.
 */

import {
  buildKassenberichtRows,
  type KassenberichtInput,
  type KassenberichtSection,
} from './kassenbericht-export.js';

/** Minimal HTML escape. The values are our own, but a shop name is free text. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface KassenberichtPrintShop {
  name: string;
  addressLine1: string;
  addressLine2: string;
  vatId: string;
  phone: string;
}

/**
 * Render the report as one self-contained A4 page.
 *
 * `shop` comes from `system_settings`, the same identity the receipt prints, so
 * a Prüfer comparing a receipt with this report sees one business, not two.
 */
export function renderKassenberichtHtml(
  c: KassenberichtInput,
  shop: KassenberichtPrintShop,
): string {
  const sections = buildKassenberichtRows(c);

  const body = sections
    .map((s: KassenberichtSection) => {
      const rows = s.rows
        .map(
          (r) =>
            `<tr class="${r.emphasis ? 'sum' : ''}">` +
            `<td class="k">${esc(r.label)}</td>` +
            `<td class="v">${esc(r.value)}</td></tr>`,
        )
        .join('');
      return `<section><h2>${esc(s.title)}</h2><table>${rows}</table></section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<title>Kassenbericht ${esc(c.businessDay)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 10.5pt; line-height: 1.45; color: #1a1a1a; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  header { border-bottom: 1.5pt solid #1a1a1a; padding-bottom: 5mm; margin-bottom: 7mm; }
  .brand { font-size: 15pt; font-weight: 700; letter-spacing: 0.02em; }
  .ident { font-size: 8.5pt; color: #555; margin-top: 1.5mm; }
  h1 { font-size: 13pt; margin: 6mm 0 0; font-weight: 700; }
  .day { font-size: 11pt; color: #333; margin-top: 1mm; }
  section { margin-bottom: 6mm; break-inside: avoid; }
  h2 {
    font-size: 8pt; text-transform: uppercase; letter-spacing: 0.14em;
    color: #666; margin: 0 0 1.5mm; font-weight: 700;
  }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1.4mm 0; border-bottom: 0.4pt solid #ddd; vertical-align: baseline; }
  td.k { color: #333; }
  td.v { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.sum td { font-weight: 700; border-top: 0.8pt solid #1a1a1a; border-bottom: none; }
  footer {
    margin-top: 9mm; padding-top: 4mm; border-top: 0.4pt solid #ddd;
    font-size: 8pt; color: #666;
  }
</style></head>
<body>
  <header>
    <div class="brand">${esc(shop.name)}</div>
    <div class="ident">${esc(shop.addressLine1)}, ${esc(shop.addressLine2)}
      &middot; USt IdNr ${esc(shop.vatId)} &middot; Telefon ${esc(shop.phone)}</div>
    <h1>Kassenbericht</h1>
    <div class="day">Gesch&auml;ftstag ${esc(c.businessDay)}</div>
  </header>
  ${body}
  <footer>
    Erstellt aus den festgeschriebenen Tagesabschlussdaten. Die Betr&auml;ge sind
    unver&auml;ndert &uuml;bernommen und werden f&uuml;r diese Darstellung weder
    gerundet noch neu berechnet. Eine fehlende Z&auml;hlung ist als solche
    benannt und nicht als Null dargestellt.
  </footer>
</body></html>`;
}

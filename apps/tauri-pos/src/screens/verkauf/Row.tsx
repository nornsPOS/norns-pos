/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Row — eine Zeile Beschriftung und Wert
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── WARUM DAS EIN EIGENES STÜCK IST (20.08.2026) ──────────────────────────
 *
 * Basel, mehrfach und deutlich: „nicht die Welt ineinanderstopfen."
 * `BezahlenDialog.tsx` trug 4018 Zeilen — die Zahlfläche selbst (2414 Zeilen
 * in EINER Funktion), fünf Bauteile, die Rechtshinweise, die Scheinstückelung
 * und zwei Fehlerhelfer, alles in einer Datei.
 *
 * ⚠️ Ausgezogen wird ZEILE FÜR ZEILE, ohne eine Ziffer am Verhalten zu
 * ändern. Der Zahlweg ist der fiskalische Kern der Kasse; ein Umbau, der
 * „bei der Gelegenheit" auch noch etwas verbessert, wäre an dieser Stelle
 * leichtsinnig. Was hier steht, stand vorher genauso weiter unten.
 *
 * Ein Bauteil von acht Zeilen, das die Zahlfläche und das Belegergebnis
 * beide benutzen.
 */



export function Row({
  label,
  value,
  emphasised = false,
  valueColor,
}: {
  label: string;
  value: JSX.Element;
  emphasised?: boolean;
  valueColor?: string;
}): JSX.Element {
  return (
    <tr>
      <td
        style={{
          padding: 'var(--w14-abstand-8) 0',
          color: emphasised ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontVariant: 'all-small-caps',
          letterSpacing: '0.08em',
          fontSize: emphasised ? 'var(--w14-schrift-betont)' : 'var(--w14-schrift-feld)',
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: 'var(--w14-abstand-8) 0',
          textAlign: 'right',
          color: valueColor,
        }}
      >
        {value}
      </td>
    </tr>
  );
}

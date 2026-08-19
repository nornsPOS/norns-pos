/**
 * KassePurposeBanner — eine Zeile Klartext statt eines Erklärkastens.
 *
 * ── VORHER / NACHHER (27.07.2026, Basels Zeitungs-Befund) ──────────────────
 * Vorher: Überschrift, ein Absatz UND drei erklärende Schrittkarten — ein
 * Lehrbuchkasten, der jeden Tag denselben Platz besetzte, obwohl seine
 * Botschaft nach dem ersten Tag sitzt. Nachher: das Zeichen, die Überschrift,
 * EIN kurzer Satz — und die drei Schritte des Kassentags warten hinter dem
 * Fragezeichen (InfoPunkt), einen Tipp entfernt statt dauernd im Blick.
 *
 * Die Botschaft selbst bleibt unverändert wichtig: **Tageskasse ≠ Verkauf.**
 * Verkauft wird in Verkauf; hier wohnt die tägliche Geld-Schublade.
 *
 * ── ⚠️ DER DRITTE SCHRITT WAR FALSCH BENANNT (13.08.2026) ──────────────────
 *
 * Hier stand: „Am Abend bar zählen und den Z-Bon ausgeben, den gesetzlichen
 * Tagesabschluss." Das Zählen und Schliessen ruft aber `shiftsApi.close` — den
 * SCHICHTSCHLUSS. Der gesetzliche Tagesabschluss ist `closingsApi.finalize`,
 * und den rief in der ganzen Kasse niemand. Wer diesen Satz las, ging abends
 * nach Hause und hatte keine Zeile in `daily_closings` — also keinen
 * Kassenbericht, kein DATEV und kein DSFinV-K für den Tag.
 *
 * Jetzt nennt der Kassentag VIER Schritte, und die letzten beiden sind sauber
 * getrennt.
 *
 * ── ⚠️ UND DER WÄCHTER LAS DIESE DATEI ZUERST GAR NICHT (nachgemessen) ─────
 *
 * Der erste Wächter suchte Flächen, die `shiftsApi.close` rufen oder das
 * Schichtschlussfenster zeichnen. Diese Datei tut beides nicht — sie fiel
 * durch und war ungeschützt, obwohl der Bericht sie selbst als dritte
 * Lügenstelle nannte. `schichtschluss-ist-kein-tagesabschluss.test.ts` sucht
 * jetzt zusätzlich nach dem Fragezeichen (`InfoPunkt`), das den Kassentag
 * erklärt, und hält hier zwei Dinge fest:
 *
 *   1. Kein Z-Bon, keine Kassensicherungsverordnung, kein „gesetzlich" —
 *      diese Fläche bucht den Kassentag nicht.
 *   2. Der Abschluss des Kassentags MUSS in der Erklärung vorkommen. Endet
 *      sie wieder beim Schichtschluss, wird der Wächter rot.
 */

import { Icon, InfoPunkt, Wallet } from '@norns/ui-kit';

export function KassePurposeBanner(): JSX.Element {
  return (
    <section
      aria-label="Was ist die Tageskasse?"
      style={{
        backgroundColor: 'var(--w14-parchment-2)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        boxShadow: 'var(--w14-shadow-card)',
        padding: 'var(--w14-abstand-16) var(--w14-abstand-20)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--w14-abstand-14)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 40,
          height: 40,
          borderRadius: 'var(--w14-radius-button)',
          background: 'var(--w14-accent)',
          color: 'var(--w14-accent-ink)',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Icon icon={Wallet} size={22} />
      </span>
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 'var(--w14-abstand-10)', flexWrap: 'wrap' }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-titel)',
            lineHeight: 1.1,
          }}
        >
          Tageskasse
        </h2>
        <span
          style={{
            color: 'var(--w14-ink-aged)',
            fontFamily: 'var(--w14-font-body)',
            fontSize: 'var(--w14-schrift-text)',
          }}
        >
          Die Geld-Schublade des Tages. Verkauft wird in Verkauf.
        </span>
        <InfoPunkt
          ariaLabel="Was ist die Tageskasse?"
          text={
            'Der Kassentag in vier Schritten: Tag öffnen und das Startgeld zählen. ' +
            'Jeder Barverkauf aus Verkauf landet automatisch hier. ' +
            'Am Abend die Lade zählen und die Schicht abschließen. ' +
            'Zuletzt den Tagesabschluss buchen. Erst er schließt den Kassentag ab.'
          }
        />
      </div>
    </section>
  );
}

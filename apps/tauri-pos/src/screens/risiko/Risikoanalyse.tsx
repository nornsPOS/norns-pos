/**
 * Risikoanalyse — the analytical view over the risk signals that until now only
 * lived as `alert.*` ledger events: an alert rollup by type over the trailing 30
 * days, a recent-alert feed, and the customer watchlist (SUSPICIOUS / BANNED /
 * sanctions / PEP). Reads `GET /api/risk/overview` (ADMIN, read-only).
 *
 * Ported into tauri-pos as a pure ADDITION; the local `Dot` stands in for the
 * control-desktop StatusDot (ui-kit has none).
 */

import { type CSSProperties, type ReactNode } from 'react';

import { useQuery } from '@tanstack/react-query';

import { Zwischentitel, ParchmentCard, ZustandFehler } from '@norns/ui-kit';
import { describeError } from '@norns/i18n-de';

import { useApiClient } from '../../lib/api-context.js';
import { Reveal } from '../../lib/motion.js';

type DotTone = 'ok' | 'watch' | 'alert' | 'info';

function Dot({ tone, size = 10 }: { tone: DotTone; size?: number }): JSX.Element {
  const color =
    tone === 'ok'
      ? 'var(--w14-verdigris)'
      : tone === 'watch'
        ? 'var(--w14-gilt)'
        : tone === 'alert'
          ? 'var(--w14-wax-red)'
          : 'var(--w14-ink-faded)';
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }}
    />
  );
}

interface RiskOverview {
  windowDays: number;
  totalAlerts: number;
  alertCounts: Record<string, number>;
  recentAlerts: Array<{ id: string; eventType: string; createdAt: string }>;
  watchlist: { suspicious: number; banned: number; sanctions: number; pep: number };
}

const ALERT_DE: Record<string, string> = {
  'alert.suspicious_aml_flagged': 'Geldwäsche-Verdacht',
  'alert.smurfing_detected': 'Strukturierung erkannt',
  'alert.anomaly_detected': 'Auffälliges Muster',
  'alert.customer_marked_suspicious': 'Kunde als verdächtig markiert',
  'alert.customer_banned': 'Kunde gesperrt',
  'alert.ebay_sale_conflict': 'eBay-Verkaufskonflikt',
  'alert.ebay_double_sale_attempt': 'eBay-Doppelverkauf',
  'alert.hash_chain_verification_failed': 'Prüfsummenkette fehlerhaft',
  'alert.worker_job_dead_letter': 'Hintergrundjob fehlgeschlagen',
  'alert.tse_cert_expiry': 'TSE-Zertifikat läuft ab',
  'alert.tse_critical_failure': 'TSE: kritischer Fehler',
  'alert.duress': 'Notfall-Anmeldung',
};

function alertLabel(eventType: string): string {
  const m = ALERT_DE[eventType];
  if (m) return m;
  return eventType
    .replace(/^alert\./, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const captionStyle: CSSProperties = {
  margin: 0,
  color: 'var(--w14-ink-faded)',
  fontSize: 'var(--w14-schrift-text)',
  lineHeight: 1.5,
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

// ⚠️ 01.08.2026 — DER ABSCHNITT „Edge-Schutz · Cloudflare" IST RAUS.
//
// Er zeigte abgewehrte Bedrohungen am Rand einer Cloudflare-Zone. Das ist die
// Infrastruktur von Warehouse14, nicht die eines Händlers mit einer Kasse auf
// dem Tresen. Norns POS läuft ohne Netz; die Kachel konnte hier nur ewig
// „Cloudflare-Analyse ist nicht konfiguriert" sagen und den Händler nach einem
// Schlüssel fragen, den es für ihn nie geben wird.

function WatchTile({ label, value, tone }: { label: string; value: ReactNode; tone: DotTone }): JSX.Element {
  return (
    <ParchmentCard tone="parchment" padding="md" style={{ flex: '1 1 150px', minWidth: 150 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-8)' }}>
        <Dot tone={tone} size={10} />
        <span
          style={{
            fontSize: 'var(--w14-schrift-zeile)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ marginTop: 8, fontSize: 'var(--w14-schrift-flaeche)', fontFamily: 'var(--w14-font-display)' }}>{value}</div>
    </ParchmentCard>
  );
}

export function Risikoanalyse(): JSX.Element {
  const client = useApiClient();

  const query = useQuery<RiskOverview>({
    queryKey: ['risk', 'overview'],
    queryFn: () => client.request<RiskOverview>('GET', '/api/risk/overview'),
    staleTime: 30_000,
  });

  const d = query.data;
  const countRows = d ? Object.entries(d.alertCounts).sort((a, b) => b[1] - a[1]) : [];
  const maxCount = countRows.reduce((m, [, n]) => Math.max(m, n), 0);

  return (
    <div style={{ padding: 'var(--w14-abstand-20)' }}>
      <Zwischentitel tone="gold" label="Risikoanalyse" />
      <p style={{ ...captionStyle, marginTop: 8, marginBottom: 20, maxWidth: 640 }}>
        Warnsignale der letzten {d?.windowDays ?? 30} Tage im Überblick: Auffälligkeiten,
        Strukturierung, Sanktions- und PEP-Treffer sowie die Beobachtungsliste der Kunden.
      </p>

      {query.isLoading ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={captionStyle}>Lädt Risikoübersicht …</p>
        </ParchmentCard>
      ) : query.isError ? (
        // FUND: eine Risikofläche, die bei einem Ausfall nur „derzeit nicht
        // verfügbar" sagt, ist gefährlicher als eine, die gar nichts sagt: der
        // Inhaber liest sie als „nichts Auffälliges" und geht weiter. Der Grund
        // und der Knopf gehören sichtbar dazu.
        <ZustandFehler
          satz={describeError(query.error)}
          folge="Ob Warnsignale offen sind, lässt sich jetzt nicht sagen. Ein leerer Bildschirm ist hier keine Entwarnung."
          onErneut={() => void query.refetch()}
        />
      ) : !d ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 920 }}>
          <p style={captionStyle}>Risikoübersicht derzeit nicht verfügbar.</p>
        </ParchmentCard>
      ) : (
        <>
          <Reveal index={1}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--w14-abstand-12)', marginBottom: 20, maxWidth: 1400 }}>
              <WatchTile label="Verdächtig" value={d.watchlist.suspicious} tone="watch" />
              <WatchTile label="Gesperrt" value={d.watchlist.banned} tone="alert" />
              <WatchTile label="Sanktionen" value={d.watchlist.sanctions} tone="alert" />
              <WatchTile label="PEP" value={d.watchlist.pep} tone="watch" />
            </div>
          </Reveal>

          <Reveal index={2}>
          {/* Breitbild (26.07.2026): die zwei unabhängigen Karten (Warnungen
              nach Art, Letzte Warnungen) standen einspaltig unter einem
              920er-Deckel neben viel Leere. Sie fließen jetzt nebeneinander,
              sobald zwei Spalten à 520 Punkte Platz haben — flüssig über
              auto-fit, bei 1280 bleibt es die eine Spalte von heute. */}
          <div
            style={{
              display: 'grid',
              gap: 'var(--w14-abstand-16)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))',
              alignItems: 'start',
              maxWidth: 1400,
            }}
          >
          <ParchmentCard tone="parchment" padding="md">
            <div
              style={{
                fontSize: 'var(--w14-schrift-zeile)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--w14-ink-faded)',
                marginBottom: 12,
              }}
            >
              Warnungen nach Art · {d.totalAlerts} gesamt
            </div>
            {countRows.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-10)' }}>
                <Dot tone="ok" size={10} />
                <p style={captionStyle}>Keine Warnungen im Zeitraum. Alles ruhig.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-8)' }}>
                {countRows.map(([type, n]) => (
                  <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-12)' }}>
                    <span style={{ width: 220, fontSize: 'var(--w14-schrift-text)' }}>{alertLabel(type)}</span>
                    <div
                      style={{
                        flex: 1,
                        height: 8,
                        background: 'var(--w14-parchment-3)',
                        borderRadius: 'var(--w14-radius-fein)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${maxCount > 0 ? Math.round((n / maxCount) * 100) : 0}%`,
                          height: '100%',
                          background: 'var(--w14-ink-aged)',
                        }}
                      />
                    </div>
                    <span
                      style={{ width: 36, textAlign: 'right', fontFamily: 'var(--w14-font-mono)', fontSize: 'var(--w14-schrift-text)' }}
                    >
                      {n}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ParchmentCard>

          <ParchmentCard tone="parchment" padding="md">
            <div
              style={{
                fontSize: 'var(--w14-schrift-zeile)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--w14-ink-faded)',
                marginBottom: 10,
              }}
            >
              Letzte Warnungen
            </div>
            {d.recentAlerts.length === 0 ? (
              <p style={captionStyle}>Keine Einträge.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {d.recentAlerts.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 'var(--w14-abstand-12)',
                      padding: 'var(--w14-abstand-8) 0',
                      borderBottom: '1px solid var(--w14-rule)',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--w14-abstand-8)' }}>
                      <Dot tone="watch" size={8} />
                      <span style={{ fontSize: 'var(--w14-schrift-betont)' }}>{alertLabel(a.eventType)}</span>
                    </span>
                    <span
                      style={{ fontFamily: 'var(--w14-font-mono)', fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-faded)' }}
                    >
                      {formatDateTime(a.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ParchmentCard>
          </div>
          </Reveal>
        </>
      )}
    </div>
  );
}

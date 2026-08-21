/**
 * Leitstand — the Owner's control room.
 *
 * One calm page that answers "läuft alles?": a top-line verdict, the state of
 * each subsystem (server, database, background jobs, fiscal/TSE, warnings, edge
 * protection), the genuinely-open problems (each with the door to fix it), and
 * the doors into the deeper monitoring surfaces (Risiko + Edge-Schutz and the
 * Schaufenster). Reads `GET /api/system/health` (Owner only).
 *
 * On-system by construction: warm parchment ground, ink text, gilt only as a
 * thread, and the functional colours (verdigris / gilt / wax-red) carry the ok /
 * watch / alert meaning — never decoration. Motion is the house reveal: a calm
 * staggered rise, honouring prefers-reduced-motion via <Reveal>.
 */

import { type CSSProperties, type ReactNode } from 'react';

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '@norns/api-client';
import { InfoPunkt, Zwischentitel, ParchmentCard, ZustandFehler } from '@norns/ui-kit';
import { describeError } from '@norns/i18n-de';

import { useApiClient } from '../../lib/api-context.js';
import { Reveal } from '../../lib/motion.js';

// ── Wire contract (mirrors apps/api-cloud/src/routes/system-health.ts) ───────

type Tone = 'ok' | 'watch' | 'alert';

interface SystemHealth {
  status: Tone;
  computedAt: string;
  components: {
    api: { status: Tone };
    database: { status: Tone; migrationsApplied: number | null; latestMigration: string | null };
    worker: {
      status: Tone;
      deadLetter: number;
      oldestDeadLetterAt: string | null;
      running: number;
      chainLastVerifiedAt: string | null;
    };
    fiscal: { status: Tone; tseCertDaysRemaining: number | null; tseCertValidUntil: string | null };
    alerts: { status: Tone; last24h: number; last7d: number };
    edge: { status: 'ok' | 'unconfigured'; configured: boolean };
  };
  integrations: Array<{ key: string; label: string; configured: boolean }>;
  problems: Array<{
    id: string;
    severity: 'watch' | 'alert';
    title: string;
    detail: string;
    surface: string | null;
  }>;
}

// ── Tokens + small helpers ───────────────────────────────────────────────────

const TONE_COLOR: Record<Tone, string> = {
  ok: 'var(--w14-verdigris)',
  watch: 'var(--w14-gilt)',
  alert: 'var(--w14-wax-red)',
};

const VERDICT_WORD: Record<Tone, string> = {
  ok: 'Alles in Ordnung',
  watch: 'Achtung erforderlich',
  alert: 'Störung',
};

const captionStyle: CSSProperties = {
  margin: 0,
  color: 'var(--w14-ink-faded)',
  fontSize: 'var(--w14-schrift-text)',
  lineHeight: 1.55,
};

const eyebrowStyle: CSSProperties = {
  fontSize: 'var(--w14-schrift-kuerzel)',
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
  fontWeight: 700,
};

function clockLabel(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '--:--';
  return new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date(t));
}

function dateLabel(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(t),
  );
}

function relativeLabel(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'gerade eben';
  if (mins < 60) return `vor ${mins} ${mins === 1 ? 'Minute' : 'Minuten'}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `vor ${hrs} ${hrs === 1 ? 'Stunde' : 'Stunden'}`;
  const days = Math.round(hrs / 24);
  return `vor ${days} ${days === 1 ? 'Tag' : 'Tagen'}`;
}

function Dot({ tone, size = 10 }: { tone: Tone; size?: number }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: TONE_COLOR[tone],
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  );
}

// ── The verdict hero ─────────────────────────────────────────────────────────

/** A struck seal in the verdict colour with a fine engraved ring, echoing the
 *  house seal motif. Static — the page's motion is the calm reveal, not a glow. */
function VerdictSeal({ tone }: { tone: Tone }): JSX.Element {
  const glyph = tone === 'ok' ? '✓' : '!';
  return (
    <span
      aria-hidden="true"
      style={{
        width: 58,
        height: 58,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        flex: '0 0 auto',
        fontSize: 'var(--w14-schrift-flaeche)',
        fontFamily: 'var(--w14-font-display)',
        fontWeight: 700,
        background: TONE_COLOR[tone],
        boxShadow: `0 0 0 4px color-mix(in srgb, ${TONE_COLOR[tone]} 18%, transparent), 0 1px 3px rgba(20,16,8,0.28)`,
      }}
    >
      {/* 19.08.2026: '#fff' mass 2,18:1 auf verdigris im Dunkelthema. */}
      <span style={{ color: 'var(--w14-parchment)' }}>{glyph}</span>
    </span>
  );
}

function StatusHero({ d }: { d: SystemHealth }): JSX.Element {
  const openCount = d.problems.length;
  const summary =
    d.status === 'ok'
      ? 'Alle Systeme laufen sauber. Keine offenen Punkte.'
      : `${openCount} ${openCount === 1 ? 'offener Punkt braucht' : 'offene Punkte brauchen'} Ihre Aufmerksamkeit.`;

  return (
    <ParchmentCard tone="parchment" padding="lg" style={{ marginBottom: 18 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--w14-abstand-20)',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-16)', minWidth: 0 }}>
          <VerdictSeal tone={d.status} />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--w14-font-display)',
                fontWeight: 700,
                fontSize: 'var(--w14-schrift-kachel)',
                lineHeight: 1.1,
                color: 'var(--w14-ink)',
              }}
            >
              {VERDICT_WORD[d.status]}
            </div>
            <p style={{ ...captionStyle, marginTop: 5, maxWidth: 460 }}>{summary}</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--w14-abstand-24)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <HeroStat label="Offene Punkte" value={String(openCount)} tone={openCount > 0 ? d.status : 'ok'} />
          <HeroStat
            label="Warnsignale 24 h"
            value={String(d.components.alerts.last24h)}
            tone={d.components.alerts.last24h > 0 ? 'watch' : 'ok'}
          />
          <div>
            <div style={eyebrowStyle}>Stand</div>
            <div
              className="w14-tabular"
              style={{ marginTop: 6, fontFamily: 'var(--w14-font-mono)', fontSize: 'var(--w14-schrift-grund)', color: 'var(--w14-ink-aged)' }}
            >
              {clockLabel(d.computedAt)}
            </div>
          </div>
        </div>
      </div>
    </ParchmentCard>
  );
}

function HeroStat({ label, value, tone }: { label: string; value: string; tone: Tone }): JSX.Element {
  return (
    <div>
      <div style={eyebrowStyle}>{label}</div>
      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-8)' }}>
        <Dot tone={tone} size={9} />
        <span style={{ fontFamily: 'var(--w14-font-display)', fontWeight: 600, fontSize: 'var(--w14-schrift-summe)', color: 'var(--w14-ink)' }}>
          {value}
        </span>
      </div>
    </div>
  );
}

// ── Subsystem tiles ──────────────────────────────────────────────────────────

function HealthTile({
  label,
  tone,
  value,
  sub,
}: {
  label: string;
  tone: Tone;
  value: ReactNode;
  sub: string;
}): JSX.Element {
  return (
    <ParchmentCard tone="parchment" padding="md" style={{ height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-8)' }}>
        <Dot tone={tone} />
        <span style={eyebrowStyle}>{label}</span>
      </div>
      <div
        style={{
          marginTop: 10,
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 600,
          fontSize: 'var(--w14-schrift-kopf)',
          lineHeight: 1.15,
          color: 'var(--w14-ink)',
        }}
      >
        {value}
      </div>
      <p style={{ ...captionStyle, marginTop: 4, fontSize: 'var(--w14-schrift-feld)' }}>{sub}</p>
    </ParchmentCard>
  );
}

function buildTiles(d: SystemHealth): Array<{ label: string; tone: Tone; value: ReactNode; sub: string }> {
  const c = d.components;
  const migVal = c.database.migrationsApplied === null ? 'unbekannt' : `${c.database.migrationsApplied} Migrationen`;
  // Show only the numeric schema ordinal — never the raw filename (its
  // underscores must not surface in UI text).
  const migNumber = c.database.latestMigration ? (c.database.latestMigration.match(/^\d+/)?.[0] ?? null) : null;
  const migLatest = migNumber
    ? `Schema-Stand ${migNumber}`
    : c.database.migrationsApplied === null
      ? 'Schema-Stand nicht lesbar'
      : 'Schema auf aktuellem Stand';

  const tseVal =
    c.fiscal.tseCertDaysRemaining === null
      ? 'Keine TSE'
      : `${c.fiscal.tseCertDaysRemaining} Tage`;
  const tseValidUntil = dateLabel(c.fiscal.tseCertValidUntil);
  const tseSub =
    c.fiscal.tseCertDaysRemaining === null
      ? 'Keine Sicherungseinrichtung hinterlegt.'
      : tseValidUntil
        ? `Zertifikat gültig bis ${tseValidUntil}`
        : 'Zertifikat-Restlaufzeit';

  const workerVal = c.worker.deadLetter > 0 ? `${c.worker.deadLetter} fehlgeschlagen` : 'Läuft';
  const chainRel = relativeLabel(c.worker.chainLastVerifiedAt);
  const workerSub =
    c.worker.deadLetter > 0
      ? 'Vorgänge in der Fehler-Warteschlange.'
      : chainRel
        ? `Prüfsummenkette verifiziert ${chainRel}.`
        : `${c.worker.running} laufende Vorgänge.`;

  return [
    { label: 'Server', tone: c.api.status, value: 'Erreichbar', sub: 'Die Kasse spricht mit dem Server.' },
    { label: 'Datenbank', tone: c.database.status, value: migVal, sub: migLatest },
    { label: 'Hintergrund-Jobs', tone: c.worker.status, value: workerVal, sub: workerSub },
    { label: 'Fiskal · TSE', tone: c.fiscal.status, value: tseVal, sub: tseSub },
    {
      label: 'Warnsignale',
      tone: c.alerts.status,
      value: `${c.alerts.last24h} · 24 h`,
      sub: `${c.alerts.last7d} in den letzten 7 Tagen.`,
    },
    // ⚠️ 01.08.2026 — die Kachel „Edge-Schutz" ist RAUS. Sie meldete, ob
    // Cloudflare Angriffe am Rand abwehrt. Das ist fremde Infrastruktur; ein
    // Händler mit einer Kasse ohne Netz hat keine Zone und keinen Schlüssel.
  ];
}

// ── Problems ─────────────────────────────────────────────────────────────────

function ProblemRow({
  problem,
  onOpen,
}: {
  problem: SystemHealth['problems'][number];
  onOpen: (surface: string) => void;
}): JSX.Element {
  const tone: Tone = problem.severity;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--w14-abstand-12)',
        padding: 'var(--w14-abstand-12) 0',
        borderBottom: '1px solid var(--w14-rule)',
      }}
    >
      <span style={{ marginTop: 3 }}>
        <Dot tone={tone} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--w14-font-display)', fontWeight: 600, fontSize: 'var(--w14-schrift-grund)', color: 'var(--w14-ink)' }}>
          {problem.title}
        </div>
        <p style={{ ...captionStyle, marginTop: 3, fontSize: 'var(--w14-schrift-text)' }}>{problem.detail}</p>
      </div>
      {problem.surface && (
        <button
          type="button"
          onClick={() => onOpen(problem.surface as string)}
          style={{
            flex: '0 0 auto',
            alignSelf: 'center',
            border: '1px solid var(--w14-rule)',
            background: 'var(--w14-parchment-2)',
            color: 'var(--w14-ink-aged)',
            borderRadius: 'var(--w14-radius-button)',
            padding: 'var(--w14-abstand-6) var(--w14-abstand-12)',
            fontSize: 'var(--w14-schrift-feld)',
            cursor: 'pointer',
            transition: 'border-color var(--w14-dur-short) var(--w14-ease-curator), color var(--w14-dur-short) var(--w14-ease-curator)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--w14-gilt)';
            e.currentTarget.style.color = 'var(--w14-ink)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--w14-rule)';
            e.currentTarget.style.color = 'var(--w14-ink-aged)';
          }}
        >
          Öffnen →
        </button>
      )}
    </div>
  );
}

// ── Doors into the deeper surfaces ───────────────────────────────────────────

function DoorCard({
  title,
  body,
  onOpen,
}: {
  title: string;
  body: string;
  onOpen: () => void;
}): JSX.Element {
  return (
    <ParchmentCard
      tone="parchment"
      padding="md"
      onClick={onOpen}
      style={{
        flex: '1 1 260px',
        cursor: 'pointer',
        transition:
          'box-shadow var(--w14-dur-short) var(--w14-ease-curator), transform var(--w14-dur-short) var(--w14-ease-curator)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = 'var(--w14-shadow-lift)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'var(--w14-shadow-card)';
        e.currentTarget.style.transform = 'none';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--w14-abstand-10)' }}>
        <span style={{ fontFamily: 'var(--w14-font-display)', fontWeight: 600, fontSize: 'var(--w14-schrift-lead)', color: 'var(--w14-ink)' }}>
          {title}
        </span>
        <span aria-hidden="true" style={{ color: 'var(--w14-gilt)', fontSize: 'var(--w14-schrift-lead)' }}>
          →
        </span>
      </div>
      <p style={{ ...captionStyle, marginTop: 6 }}>{body}</p>
    </ParchmentCard>
  );
}

// ── Pure body ────────────────────────────────────────────────────────────────

export interface LeitstandViewProps {
  d: SystemHealth;
  /** Navigate to a surface path (a problem's door, or a Vertiefen card). */
  onOpen: (surface: string) => void;
}

/** The control-room body — pure, so it renders identically in the shell and in
 *  isolation (SSR preview, tests). All wiring lives in `Leitstand`. */
export function LeitstandView({ d, onOpen }: LeitstandViewProps): JSX.Element {
  return (
    <>
      <Reveal index={0}>
        <StatusHero d={d} />
      </Reveal>

      <div style={{ ...eyebrowStyle, marginBottom: 10 }}>Systemzustand</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 'var(--w14-abstand-12)',
          marginBottom: 22,
        }}
      >
        {buildTiles(d).map((t, i) => (
          <Reveal key={t.label} index={1 + i} style={{ height: '100%' }}>
            <HealthTile label={t.label} tone={t.tone} value={t.value} sub={t.sub} />
          </Reveal>
        ))}
      </div>

      <Reveal index={2}>
        <ParchmentCard tone="parchment" padding="md" style={{ marginBottom: 22 }}>
          <div style={{ ...eyebrowStyle, marginBottom: 6 }}>
            Offene Probleme{d.problems.length > 0 ? ` · ${d.problems.length}` : ''}
          </div>
          {d.problems.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-10)', paddingTop: 'var(--w14-abstand-6)' }}>
              <Dot tone="ok" />
              <p style={captionStyle}>Keine offenen Probleme. Der Betrieb läuft sauber.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {d.problems.map((p) => (
                <ProblemRow key={p.id} problem={p} onOpen={onOpen} />
              ))}
            </div>
          )}
        </ParchmentCard>
      </Reveal>

      <Reveal index={3}>
        <div style={{ ...eyebrowStyle, marginBottom: 10 }}>Vertiefen</div>
        <div style={{ display: 'flex', gap: 'var(--w14-abstand-12)', flexWrap: 'wrap' }}>
          <DoorCard
            title="Risikoanalyse"
            body="Warnsignale und die Kunden-Beobachtungsliste an einem Ort."
            onOpen={() => onOpen('/risiko')}
          />
          <DoorCard
            title="Schaufenster"
            body="Wer vor dem Fenster steht: Besucher, Herkunft, Browser und die Gesundheit des Ladens."
            onOpen={() => onOpen('/schaufenster')}
          />
        </div>
      </Reveal>
    </>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────

export function Leitstand(): JSX.Element {
  const client = useApiClient();
  const navigate = useNavigate();

  const q = useQuery<SystemHealth>({
    queryKey: ['system', 'health'],
    queryFn: () => client.request<SystemHealth>('GET', '/api/system/health'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const d = q.data;
  // Typed refusal checks — never sniff raw wire text (honesty gate).
  const isForbidden = q.error instanceof ApiError && q.error.code === 'FORBIDDEN';
  // An OLDER server (endpoint ships with the next deploy) answers 404 — say
  // exactly that, calmly, instead of a generic failure.
  const isMissing = q.error instanceof ApiError && q.error.code === 'NOT_FOUND';

  return (
    <div style={{ padding: 'var(--w14-abstand-20)', maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-4)', marginBottom: 20 }}>
        <Zwischentitel tone="gold" label="Leitstand" style={{ flex: 1 }} />
        <InfoPunkt
          ariaLabel="Was ist der Leitstand?"
          richtung="links"
          text="Der Zustand des ganzen Hauses auf einen Blick: Systeme, offene Probleme, Zugang zu Risiko, Edge-Schutz und Schaufenster. Nur für den Inhaber."
        />
      </div>

      {q.isLoading ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 1000 }}>
          <p style={captionStyle}>Lädt Systemzustand …</p>
        </ParchmentCard>
      ) : isForbidden ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 1000 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-10)' }}>
            <Dot tone="watch" />
            <p style={captionStyle}>Der Leitstand ist dem Inhaber vorbehalten.</p>
          </div>
        </ParchmentCard>
      ) : isMissing ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 1000 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-10)' }}>
            <Dot tone="watch" />
            <p style={captionStyle}>
              Der Systemzustand erscheint mit dem nächsten Server-Update. Risikoanalyse und
              Schaufenster unten sind bereits erreichbar.
            </p>
          </div>
        </ParchmentCard>
      ) : q.isError ? (
        // FUND: hier stand ein selbstgeschriebener Satz, „Systemzustand derzeit
        // nicht abrufbar." — er nannte weder den Grund noch bot er einen Weg
        // zurück. Der Leitstand ist die Fläche, auf die der Inhaber schaut, WEIL
        // etwas nicht stimmt; ausgerechnet sie durfte nicht schweigen. Der Satz
        // kommt jetzt aus dem gemeinsamen Wortschatz, samt Knopf.
        <ZustandFehler
          satz={describeError(q.error)}
          folge="Ob im Haus gerade etwas klemmt, lässt sich jetzt nicht sagen. Kein Befund ist hier kein Freispruch."
          onErneut={() => void q.refetch()}
        />
      ) : !d ? (
        <ParchmentCard tone="parchment" padding="lg" style={{ maxWidth: 1000 }}>
          <p style={captionStyle}>Systemzustand derzeit nicht abrufbar.</p>
        </ParchmentCard>
      ) : (
        <LeitstandView d={d} onOpen={(s) => navigate(s)} />
      )}
    </div>
  );
}

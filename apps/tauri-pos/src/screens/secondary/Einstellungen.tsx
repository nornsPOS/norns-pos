/**
 * Einstellungen — the operator settings HUB. A left rail of sections, each a
 * focused panel, instead of scattered config. Sections:
 *   Geräte & Kasse · KI & Automatisierung · Server & Verbindung ·
 *   Social & Nachrichten · Kundenservice (Chatwoot) · Beleg & Shop.
 *
 * Secrets that must stay on the server (external service keys,
 * R2…) are shown as STATUS, never stored on the terminal. Operator-tunable,
 * terminal-local integration config (Chatwoot widget, social handles, AI
 * feature toggles) lives in the integration-settings store.
 */

import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';

import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button, Zwischentitel, Icon, ShieldCheck, ArrowDownToLine, Landmark, Cpu, KeyRound, Boxes, Scale, ReceiptText, HandCoins } from '@norns/ui-kit';

import { findSurfaceByPath } from '../../app/chrome/surface-registry.js';
import { GRUPPEN } from './Uebersicht.js';

import { IconPower, IconServer } from '../../app/chrome/Icons.js';
import { useApiClient } from '../../lib/api-context.js';
import { NORNS_BAUART } from '../../lib/bauart.js';
import { requestSignOut } from '../../lib/session-actions.js';
import { useKursstreifenStore } from '../../state/kursstreifen-store.js';
import { VerkaufsaufschlagSection } from './VerkaufsaufschlagSection.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { Belegdesigner } from './Belegdesigner.js';
import { GeraeteManager } from './GeraeteManager.js';
import { BetriebSection } from './BetriebSection.js';
import { KursquelleSection } from './KursquelleSection.js';
import { hilfeFuer } from '../einrichtung/einrichtungs-schritte.js';
import { TEXT_SCALE_KEY, type TextScale, applyTextScale, storedTextScale } from '../../state/text-scale.js';
import { SammlungenSection } from './SammlungenSection.js';
import { ApiKeysSection } from './ApiKeysSection.js';
import { SteuerComplianceSection } from './SteuerComplianceSection.js';
import { LizenzSection } from './LizenzSection.js';
import { SicherungSection } from './SicherungSection.js';

/**
 * Norns POS oder Warehouse14. Ein Ort, eine Wahrheit; wer die Edition wissen
 * muss, fragt hier und nicht an zwanzig Stellen im Werk.
 */
// Die Bauart steht jetzt an EINER Stelle, siehe lib/bauart.ts.
const NORNS_EDITION = NORNS_BAUART;

// Die Kennungen 'ai', 'integrationen', 'social' und 'chatwoot' wurden am
// 14.08.2026 mit der Trennung von warehouse14 ausgetragen: ihre Dienste
// (Bilderkennung, WhatsApp/Meta, Chatwoot) existieren nicht mehr.
type SectionId =
  | 'lizenz'
  | 'sicherung'
  | 'hardware'
  | 'aufschlag'
  | 'darstellung'
  | 'apikeys'
  | 'server'
  | 'beleg'
  | 'betrieb'
  | 'kurse'
  | 'sammlungen'
  | 'steuer'
  | 'hilfe';

type SectionDef = {
  id: SectionId;
  label: string;
  icon: ReactNode;
  desc: string;
  adminOnly?: boolean;
};

/**
 * ── NORNS POS: VIER BEREICHE, NICHTS GELÖSCHT (30.07.2026, Basels Ordnung) ──
 *
 * Wörtlich: „الاعدادات خفضها لاقل شي ممكن" — die Einstellungen auf das
 * Nötigste kürzen. Und ebenso wörtlich: „لا تحذف" — nicht löschen.
 *
 * Beides zugleich geht nur so: die Liste unten bleibt VOLLSTÄNDIG, jeder
 * Bereich lebt weiter im Werk und ist über die Suche erreichbar. Nur die
 * Spalte zeigt die vier, die ein Händler wirklich braucht: seine Ausfuhr an
 * den Steuerberater, seine drei Drucker, den Zustand seiner TSE, und ob sein
 * Programm freigeschaltet ist.
 *
 * Ein Bereich, der hier fehlt, ist NICHT entfernt. Er ist nur nicht im Weg.
 */
const NORNS_BEREICHE: ReadonlySet<SectionId> = new Set<SectionId>([
  'lizenz',    // ist diese Kasse freigeschaltet
  // Kommt zu Basels vier Bereichen dazu, und zwar nicht aus Geschmack: die
  // Datenbank liegt IN diesem Gerät. Ohne diese Fläche gäbe es keinen Weg, an
  // dem der Händler seine Bücher retten kann, und § 147 AO verlangt sie zehn
  // Jahre lang. Ein Rettungsweg, den niemand findet, ist kein Rettungsweg.
  'sicherung',
  'steuer',    // DATEV, DSFinV-K, Kassenbericht — der Monatsabschluss
  'hardware',  // die drei Drucker und die TSE, Wolke oder Gerät
  'betrieb',   // die Stammdaten, ohne die kein Prüferpaket entsteht
  // Woher der Metallkurs kommt. Basels Anweisung vom 02.08.2026: der Inhaber
  // wählt die Quelle und kann ohne Netz von Hand eintragen. An diesem Kurs
  // hängt jeder Ankaufpreis, also gehört er zu den Bereichen, die eine
  // Ladenkasse IMMER zeigt.
  'kurse',
  'beleg',     // der Beleg und das Logo des Ladens
  /*
   * ⛔ 14.08.2026: DIESER BEREICH FEHLTE, UND DAS KOSTETE DEN GANZEN GEWINN.
   *
   * ── DER BEFUND ────────────────────────────────────────────────────────
   *
   * Der Verkaufsaufschlag ist der Prozentsatz, den die Kasse auf den
   * Metallkurs schlägt, wenn sie einen Verkaufspreis rechnet. Vier Zeilen
   * belegen, was seine Abwesenheit hier anrichtete:
   *
   *   1. `lib/verkaufsaufschlag.ts`: `const VORGABE = '0'`, also NULL Prozent.
   *   2. `lib/kurspreise-lesen.ts` liest ihn und rechnet mit ihm JEDEN
   *      Verkaufspreis: `kurspreisFuerStueck(s, kurse, aufschlag)`.
   *   3. Die EINZIGE Fläche, die ihn setzen kann, ist
   *      `VerkaufsaufschlagSection`, und die liegt in genau diesem Bereich.
   *   4. Der Bereich stand nicht in dieser Liste.
   *
   * Wirkung am Tresen: jeder aus dem Kurs gerechnete Verkaufspreis trug
   * NULL Aufschlag. Der Händler verkaufte Gold zum Einkaufspreis, und es gab
   * keinen Weg, das zu ändern.
   *
   * ── UND DIE URSACHE WAR EINE GUTE ABSICHT ─────────────────────────────
   *
   * Diese Liste ist dafür da, dem Händler die Bereiche zu ersparen, die er
   * nicht braucht. Richtig gedacht. Sie hat dabei einen Bereich mitgenommen,
   * von dem der SERVER abhängt: der Schalter blieb im Motor, die Hand, die
   * ihn dreht, verschwand aus der Fläche.
   *
   * Der Wächter `was-der-motor-liest-muss-erreichbar-sein` misst das jetzt.
   */
  'aufschlag',
]);

const SECTIONS: SectionDef[] = [
  {
    id: 'lizenz',
    label: 'Lizenz',
    icon: <Icon icon={ShieldCheck} size={18} />,
    desc: 'Freischaltung dieser Kasse',
  },
  {
    id: 'sicherung',
    label: 'Sicherung',
    icon: <Icon icon={ArrowDownToLine} size={18} />,
    desc: 'Die Bücher auf einen zweiten Datenträger',
    adminOnly: true,
  },
  {
    id: 'hardware',
    label: 'Geräte & Kasse',
    icon: <Icon icon={Cpu} size={18} />,
    desc: 'Drucker · Terminal · TSE',
  },
  {
    id: 'aufschlag',
    label: 'Verkaufsaufschlag',
    icon: <Icon icon={Scale} size={18} />,
    desc: 'Was auf den Materialwert kommt',
  },
  {
    id: 'darstellung',
    label: 'Darstellung',
    icon: <Icon icon={HandCoins} size={18} />,
    desc: 'Metallkurse ein- oder ausblenden',
  },
  {
    id: 'apikeys',
    label: 'API-Schlüssel',
    icon: <Icon icon={KeyRound} size={18} />,
    desc: 'Programmatische Zugänge',
    adminOnly: true,
  },
  {
    id: 'server',
    label: 'Server & Verbindung',
    icon: <IconServer size={18} />,
    desc: 'API · Synchronisation',
  },
  { id: 'beleg', label: 'Beleg & Shop', icon: <Icon icon={ReceiptText} size={18} />, desc: 'Geschäftsdaten' },
  {
    id: 'betrieb',
    label: 'Betrieb',
    icon: <Icon icon={Landmark} size={18} />,
    desc: 'Stammdaten für Prüferpaket und DATEV',
    adminOnly: true,
  },
  {
    id: 'kurse',
    label: 'Metallkurse',
    icon: <Icon icon={HandCoins} size={18} />,
    // 19.08.2026: hier stand zusaetzlich Eingabe von Hand, sie ist seit dem
    // 18.08. abgeschafft; die Beschreibung darf nichts Abgeschafftes anbieten.
    desc: 'Herkunft der Kurse',
    adminOnly: true,
  },
  {
    id: 'sammlungen',
    label: 'Sammlungen',
    icon: <Icon icon={Boxes} size={18} />,
    desc: 'Web-Shop-Kategorien',
    adminOnly: true,
  },
  {
    id: 'steuer',
    label: 'Steuer-Export & Compliance',
    icon: <Icon icon={Scale} size={18} />,
    desc: 'DATEV · DSFinV-K · TSE · GoBD',
    adminOnly: true,
  },
  {
    id: 'hilfe',
    label: 'Hilfe & Norns',
    icon: <Icon icon={ShieldCheck} size={18} />,
    desc: 'Anleitung · Support · Preise',
  },
];

/**
 * Die Flächen-Gruppen in der Spalte, geordnet nach TAGESBEDARF (Basels
 * Ordnung, 27.07.2026): was der Tresen täglich braucht zuerst, die Aufsicht
 * des Inhabers danach. Die GRUPPEN selbst (Zugehörigkeit + Sätze) wohnen in
 * Uebersicht.ts — hier steht nur die Reihung; `/einstellungen` fällt raus,
 * denn diese Spalte IST die Einstellung.
 */
const FLAECHEN_REIHUNG: readonly string[] = [
  'Kundschaft',
  'Ware und Kanäle',
  'Geld und Steuer',
  'Aufsicht und Schutz',
  'Haus und Personal',
];

/** Alle gültigen Bereichskennungen — für die Prüfung der Adresse. */
const BEREICHSKENNUNGEN: ReadonlySet<string> = new Set(SECTIONS.map((s) => s.id));

export function Einstellungen(): JSX.Element {
  /**
   * ⚠️ DER BEREICH WOHNT IN DER ADRESSE, NICHT NUR IM KOPF DES FENSTERS.
   *
   * Bis zum 08.08.2026 lag er allein in `useState`. Damit gab es keinen Weg,
   * die Einstellungen auf einem bestimmten Bereich zu öffnen — und die
   * Startliste auf der Werkstatt konnte ihre sieben Punkte nur BESCHREIBEN,
   * nie öffnen.
   *
   * Jetzt trägt `/einstellungen?bereich=betrieb` den Bereich. Ein unbekannter
   * Wert wird ignoriert statt angenommen, sonst führte ein alter Verweis auf
   * eine leere Fläche.
   */
  const [suche, setzeSuche] = useSearchParams();
  const ausDerAdresse = suche.get('bereich');
  const [section, setSection] = useState<SectionId>(
    ausDerAdresse !== null && BEREICHSKENNUNGEN.has(ausDerAdresse)
      ? (ausDerAdresse as SectionId)
      : 'hardware',
  );

  // Ein Wechsel der Adresse von aussen (Griff aus der Startliste, Zurück-Taste)
  // muss den Bereich mitziehen.
  useEffect(() => {
    if (ausDerAdresse !== null && BEREICHSKENNUNGEN.has(ausDerAdresse)) {
      setSection(ausDerAdresse as SectionId);
    }
  }, [ausDerAdresse]);

  /** Bereich wechseln UND die Adresse mitführen, damit Zurück funktioniert. */
  const bereichWaehlen = (id: SectionId): void => {
    setSection(id);
    setzeSuche({ bereich: id }, { replace: true });
  };

  const navigate = useNavigate();
  const role = useSessionStore((s) => s.actor?.role);
  const isOwner = useSessionStore((s) => s.actor?.isOwner ?? false);
  const isAdmin = role === 'ADMIN';

  const flaechenGruppen = FLAECHEN_REIHUNG.map((titel) => {
    const g = GRUPPEN.find((x) => x.titel === titel);
    const flaechen = (g?.pfade ?? [])
      .filter((pfad) => pfad !== '/einstellungen')
      .map((pfad) => findSurfaceByPath(pfad))
      .filter((s): s is NonNullable<typeof s> => s !== undefined)
      .filter((s) => !s.ownerOnly || isOwner);
    return { titel, flaechen };
  }).filter((g) => g.flaechen.length > 0);

  // Admin-only sections are hidden from non-ADMIN operators in the rail AND
  // gated on render (defence in depth — the steuer section also self-locks
  // behind a manager-PIN step-up).
  const visibleSections = SECTIONS.filter(
    (s) => (!s.adminOnly || isAdmin) && (!NORNS_EDITION || NORNS_BEREICHE.has(s.id)),
  );
  const activeSection: SectionId = visibleSections.some((s) => s.id === section)
    ? section
    : 'hardware';

  return (
    <section
      aria-label="Einstellungen"
      style={{ display: 'flex', height: '100%', minHeight: 0, background: 'var(--w14-parchment)' }}
    >
      <nav
        aria-label="Bereiche"
        style={{
          width: 250,
          flex: '0 0 auto',
          borderRight: '1px solid var(--w14-rule)',
          background: 'var(--w14-parchment-2)',
          padding: 'var(--w14-abstand-14)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <h1
          style={{
            margin: '4px 8px 14px',
            fontSize: 'var(--w14-schrift-lead)',
            fontWeight: 600,
            color: 'var(--w14-ink)',
          }}
        >
          Einstellungen
        </h1>
        <div style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
          {visibleSections.map((s) => {
            const active = s.id === activeSection;
            return (
              <button
                key={s.id}
                type="button"
                // ── WO BIN ICH? (26.07.2026) ──────────────────────────────
                // An der laufenden Kasse gemessen: `aria-current` kam in
                // dieser Seitenleiste NICHT vor. Der aktive Abschnitt war
                // allein an Hintergrund und Schriftstärke zu erkennen — für
                // eine Vorlesehilfe also gar nicht, und für jemanden mit
                // Farbschwäche oder auf einem billigen Ladenbildschirm kaum.
                //
                // Die obere Flächenleiste macht es über `SurfaceChip` längst
                // richtig; hier fehlte es. Ein Attribut, zehn Einträge.
                aria-current={active ? 'page' : undefined}
                title={s.desc}
                onClick={() => bereichWaehlen(s.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--w14-abstand-12)',
                  width: '100%',
                  textAlign: 'left',
                  padding: 'var(--w14-abstand-10) var(--w14-abstand-12)',
                  border: '1px solid transparent',
                  borderRadius: 'var(--w14-radius-button)',
                  cursor: 'pointer',
                  background: active ? 'var(--w14-parchment-3)' : 'transparent',
                  color: active ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
                }}
              >
                <span style={{ color: active ? 'var(--w14-gold)' : 'var(--w14-ink-faded)' }}>
                  {/* Die EINE Hülle statt elf Klassen: jedes Bereichszeichen
                      atmet unter der Hand (w14-symbol in tokens.css). */}
                  <span className="w14-symbol" style={{ display: 'inline-flex' }}>
                    {s.icon}
                  </span>
                </span>
                {/* Weniger Zeitung (27.07.2026): die Erklaerzeile wohnt im
                    Tooltip, die Spalte traegt nur noch Zeichen + Namen. */}
                <span style={{ fontSize: 'var(--w14-schrift-text)', fontWeight: active ? 600 : 500 }}>
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Alle Flächen, eingezogen (27.07.2026) ─────────────────────
            Die frühere Kartenwand „Alle Flächen" wohnt jetzt HIER: jede
            sekundäre Fläche als Zeile mit ihrem Zeichen, gruppiert und nach
            Tagesbedarf geordnet. Ein Tipp öffnet die Fläche. Die Erklärung
            jeder Fläche liegt im Tooltip, nicht als Textzeile — das Zeichen
            spricht, der Satz wartet. */}
        {flaechenGruppen.map((g) => (
          <div key={g.titel} style={{ marginTop: 'var(--w14-abstand-16)' }}>
            <div
              className="w14-smallcaps"
              style={{
                padding: '0 var(--w14-abstand-12) var(--w14-abstand-4)',
                fontSize: 'var(--w14-schrift-kuerzel)',
                letterSpacing: '0.09em',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {g.titel}
            </div>
            <div style={{ display: 'grid', gap: 'var(--w14-abstand-2)' }}>
              {g.flaechen.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  title={f.description}
                  onClick={() => navigate(f.path)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--w14-abstand-10)',
                    width: '100%',
                    textAlign: 'left',
                    padding: 'var(--w14-abstand-6) var(--w14-abstand-12)',
                    border: '1px solid transparent',
                    borderRadius: 'var(--w14-radius-button)',
                    cursor: 'pointer',
                    background: 'transparent',
                    color: 'var(--w14-ink-aged)',
                    font: 'inherit',
                    fontSize: 'var(--w14-schrift-text)',
                  }}
                >
                  <span style={{ display: 'inline-flex', color: 'var(--w14-ink-faded)' }}>
                    <Icon icon={f.icon} size={16} />
                  </span>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        ))}

        <TextScaleControl />
        <SignOutFooter />
      </nav>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {activeSection === 'lizenz' && <LizenzSection />}
        {activeSection === 'sicherung' && <SicherungSection />}
        {activeSection === 'hardware' && <GeraeteManager />}
        {activeSection === 'aufschlag' && (
          <VerkaufsaufschlagSection pad={pad} card={card} SectionTitle={SectionTitle} />
        )}
        {activeSection === 'darstellung' && <DarstellungSection />}
        {activeSection === 'apikeys' && isAdmin && <ApiKeysSection />}
        {activeSection === 'server' && <ServerSection />}
        {activeSection === 'beleg' && <BelegSection />}
        {activeSection === 'betrieb' && isAdmin && (
          <BetriebSection onOpenSteuer={() => bereichWaehlen('steuer')} />
        )}
        {activeSection === 'kurse' && isAdmin && <KursquelleSection />}
        {activeSection === 'sammlungen' && isAdmin && <SammlungenSection />}
        {activeSection === 'steuer' && isAdmin && <SteuerComplianceSection />}
        {activeSection === 'hilfe' && <HilfeSection />}
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Shared bits
// ════════════════════════════════════════════════════════════════════════

// Breitbild (26.07.2026): der 760er-Deckel ließ bei 1920 über 1100 Punkte
// brach liegen. Die Karten fließen jetzt zweispaltig, sobald zwei Spalten
// à 520 Punkte Platz haben — flüssig über auto-fit, ohne Medienabfrage.
// Bei schmalem Fenster bleibt es die eine Spalte von heute.
const pad: CSSProperties = {
  padding: 'var(--w14-abstand-24)',
  display: 'grid',
  gap: 'var(--w14-abstand-16)',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))',
  alignContent: 'start',
  maxWidth: 1400,
};
const card: CSSProperties = {
  background: 'var(--w14-parchment-2)',
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-card)',
  padding: 'var(--w14-abstand-20)',
  display: 'grid',
  gap: 'var(--w14-abstand-14)',
  boxShadow: 'var(--w14-shadow-card)',
};
const labelStyle: CSSProperties = {
  fontSize: 'var(--w14-schrift-zeile)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
};
const inputStyle: CSSProperties = {
  padding: 'var(--w14-abstand-8) var(--w14-abstand-10)',
  border: '1px solid var(--w14-feldlinie)',
  borderRadius: 'var(--w14-radius-button)',
  background: 'var(--w14-parchment)',
  color: 'var(--w14-ink)',
  fontSize: 'var(--w14-schrift-betont)',
  width: '100%',
};

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }): JSX.Element {
  return (
    // gridColumn: die Überschrift überspannt im zweispaltigen Karten-Raster
    // (siehe `pad`) immer die volle Breite.
    <div style={{ gridColumn: '1 / -1' }}>
      <h2 style={{ margin: 0, fontSize: 'var(--w14-schrift-titel)', fontWeight: 600, color: 'var(--w14-ink)' }}>
        {title}
      </h2>
      <p style={{ margin: '4px 0 0', color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-text)' }}>
        {subtitle}
      </p>
      <Zwischentitel style={{ margin: '14px 0 0' }} />
    </div>
  );
}

function StatusDot({ ok, label: text }: { ok: boolean; label: string }): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--w14-abstand-6)', fontSize: 'var(--w14-schrift-feld)' }}>
      <span
        aria-hidden="true"
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: ok ? 'var(--w14-verdigris)' : 'var(--w14-ink-faded)',
        }}
      />
      {text}
    </span>
  );
}

function Field({
  title,
  value,
  onChange,
  placeholder,
  mono,
  readOnly,
  type,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  readOnly?: boolean;
  type?: 'text' | 'password';
}): JSX.Element {
  return (
    <label style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
      <span style={labelStyle}>{title}</span>
      <input
        type={type ?? 'text'}
        style={{
          ...inputStyle,
          fontFamily: mono ? 'var(--w14-font-mono)' : 'var(--w14-font-body)',
        }}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function Toggle({
  on,
  onChange,
  title,
  desc,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  title: string;
  desc: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--w14-abstand-14)',
        padding: 'var(--w14-abstand-12) var(--w14-abstand-14)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-button)',
        background: 'var(--w14-parchment)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ display: 'grid', gap: 'var(--w14-abstand-2)' }}>
        <span style={{ fontSize: 'var(--w14-schrift-betont)', color: 'var(--w14-ink)' }}>{title}</span>
        <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>{desc}</span>
      </span>
      <span
        aria-hidden="true"
        style={{
          width: 42,
          height: 24,
          flex: '0 0 auto',
          borderRadius: 'var(--w14-radius-pille)',
          background: on ? 'var(--w14-accent)' : 'var(--w14-rule)',
          position: 'relative',
          transition: 'background var(--w14-dur-exit) var(--w14-ease-hover)',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: on ? 21 : 3,
            width: 18,
            height: 18,
            borderRadius: '50%',
            // 19.08.2026: reines Weiss (Hausverbot) und 1,24:1 auf der Aus-Schiene.
            background: 'var(--w14-parchment-2)',
            border: '1px solid var(--w14-feldlinie)',
            transition: 'left var(--w14-dur-exit) var(--w14-ease-hover)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
          }}
        />
      </span>
    </button>
  );
}

/**
 * SignOutFooter — pinned to the bottom of the section rail. The header lock was
 * removed, so this is the operator's way out. A calm confirm guards the click;
 * `requestSignOut` runs the AppShell-owned sign-out (store resets + PIN logout).
 */
function SignOutFooter(): JSX.Element {
  const onAbmelden = (): void => {
    if (window.confirm('Wirklich abmelden?')) requestSignOut();
  };
  return (
    <div style={{ marginTop: 'auto', paddingTop: 'var(--w14-abstand-14)' }}>
      <button
        type="button"
        onClick={onAbmelden}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'var(--w14-abstand-8)',
          width: '100%',
          minHeight: 44,
          padding: 'var(--w14-abstand-10) var(--w14-abstand-12)',
          border: '1px solid var(--w14-rule)',
          borderRadius: 'var(--w14-radius-button)',
          cursor: 'pointer',
          background: 'var(--w14-parchment)',
          color: 'var(--w14-ink)',
          fontSize: 'var(--w14-schrift-text)',
          fontWeight: 600,
        }}
      >
        <IconPower size={18} />
        Abmelden
      </button>
    </div>
  );
}

/**
 * TextScaleControl — Schriftgröße-Wahl (Normal / Groß / Sehr groß), die den
 * Wurzel-Zoomhebel `<html data-text-scale>` setzt. Die zugehörigen
 * CSS-Regeln ([data-text-scale='lg'|'xl']) liegen in tokens.css und skalieren
 * jede rem-basierte Größe app-weit. Persistiert unter 'w14-text-scale' und wird
 * beim Laden wiederhergestellt.
 */
// 19.08.2026: Schluessel und Anwendung wohnen in state/text-scale.ts —
// der Start wendet die Wahl seither selbst an (Begruendung dort).

function TextScaleControl(): JSX.Element {
  const [scale, setScale] = useState<TextScale>('');

  // Beim Mount aus localStorage wiederherstellen.
  useEffect(() => {
    setScale(storedTextScale());
  }, []);

  const choose = (next: TextScale): void => {
    setScale(next);
    applyTextScale(next);
    if (next === '') localStorage.removeItem(TEXT_SCALE_KEY);
    else localStorage.setItem(TEXT_SCALE_KEY, next);
  };

  const options: Array<{ value: TextScale; label: string }> = [
    { value: '', label: 'Normal' },
    { value: 'lg', label: 'Groß' },
    { value: 'xl', label: 'Sehr groß' },
  ];

  return (
    <fieldset style={{ marginTop: 14, padding: 'var(--w14-abstand-4) var(--w14-abstand-8)', border: 'none' }}>
      <legend style={{ ...labelStyle, display: 'block', marginBottom: 6, padding: 0 }}>
        Schriftgröße
      </legend>
      <div
        style={{
          display: 'flex',
          gap: 'var(--w14-abstand-4)',
          padding: 'var(--w14-abstand-2)',
          border: '1px solid var(--w14-rule)',
          borderRadius: 'var(--w14-radius-button)',
          background: 'var(--w14-parchment)',
        }}
      >
        {options.map((o) => {
          const active = o.value === scale;
          return (
            <button
              key={o.value || 'normal'}
              type="button"
              aria-pressed={active}
              onClick={() => choose(o.value)}
              style={{
                flex: 1,
                padding: 'var(--w14-abstand-6) var(--w14-abstand-6)',
                border: 'none',
                borderRadius: 'var(--w14-radius-button)',
                cursor: 'pointer',
                fontSize: 'var(--w14-schrift-zeile)',
                fontWeight: active ? 600 : 500,
                background: active ? 'var(--w14-parchment-3)' : 'transparent',
                color: active ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Sections
// ════════════════════════════════════════════════════════════════════════

/**
 * Darstellung — was der Tresen sehen WILL, nicht was das Haus vorschreibt.
 *
 * ⚠️ Basel, 05.08.2026: „المارجة بدل منتها حاطها فوق جنب الدارك مود حطها بس
 * بل اعادتدات وبداخلها اشغل واطفي الشريط" — nicht oben neben den dunklen
 * Modus, sondern HIER in die Einstellungen, und dort ein- und ausschalten.
 *
 * Er hat recht: die Kopfleiste ist der Arbeitsplatz, kein Schaltpult. Was man
 * einmal im Jahr entscheidet, gehoert nicht neben das, was man staendig
 * braucht. Der Knopf oben ist deshalb verschwunden.
 */
function DarstellungSection(): JSX.Element {
  const kurse = useKursstreifenStore((s) => s.sichtbar);
  const setzeKurse = useKursstreifenStore((s) => s.setzen);
  return (
    <div style={pad}>
      <SectionTitle
        title="Darstellung"
        subtitle="Was auf dem Bildschirm dieses Geräts steht. Gilt nur hier, nicht für die Zweitkasse."
      />
      <div style={card}>
        <Toggle
          on={kurse}
          onChange={setzeKurse}
          title="Metallkurse im Kopf anzeigen"
          desc="Der Kursstreifen unter der Kopfleiste. Wer nicht täglich ankauft, blendet ihn aus."
        />
      </div>
    </div>
  );
}

function ServerSection(): JSX.Element {
  const api = useApiClient();
  const addToast = useToastStore((s) => s.addToast);
  const [checking, setChecking] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);
  // ⚠️ 30.07.2026. Hier stand `?? 'https://api.warehouse14.de'`. Der Klient
  // hat IMMER eine Anschrift — die des Motors —, der Rückfall war also nie
  // nötig und trotzdem gefährlich: er backt die fremde Anschrift ins Bündel.
  // Genau daran ist der Freigabe-Wächter rot geworden.
  const baseUrl = (api as { baseUrl?: string }).baseUrl ?? '';

  const test = async (): Promise<void> => {
    setChecking(true);
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, { credentials: 'include' });
      const ok = res.ok;
      setReachable(ok);
      addToast({
        tone: ok ? 'success' : 'alert',
        title: ok ? 'Server erreichbar' : 'Server nicht erreichbar',
        body: baseUrl,
      });
    } catch {
      setReachable(false);
      addToast({ tone: 'alert', title: 'Server nicht erreichbar', body: baseUrl });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div style={pad}>
      <SectionTitle
        title="Server & Verbindung"
        subtitle="Der Backend-Server bündelt Daten, Edelmetallkurse und Hintergrunddienste."
      />
      <div style={card}>
        <Field title="API-Adresse" value={baseUrl} onChange={() => {}} mono readOnly />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-14)' }}>
          <Button variant="ghost" size="md" disabled={checking} onClick={() => void test()}>
            {checking ? 'Prüft…' : 'Verbindung testen'}
          </Button>
          {reachable !== null && (
            <StatusDot ok={reachable} label={reachable ? 'Verbunden' : 'Keine Verbindung'} />
          )}
        </div>
      </div>
    </div>
  );
}

// ⚠️ 01.08.2026 — die Karte „Google-Kalender-Status" ist RAUS. Sie fragte
// `GET /api/calendar/status` und meldete dem Händler, ob die Anbindung an ein
// Google-Service-Konto steht. Norns POS läuft ohne Netz: sie konnte nur ewig
// „nicht verbunden" sagen. Die Terminverwaltung dieser Kasse steht unter
// „Termine" und gehört ihr selbst.


/**
 * ── HILFE & NORNS (19.08.2026, Basels Auftrag: Links komplett) ────────────
 *
 * Drei staendige Hausadressen ueber den Hilfeweiser (`/h/<kennung>`), nie
 * als rohe Pfade: die Kennung bleibt fuer immer, das Ziel darf umziehen
 * (Begruendung: einrichtungs-schritte.ts, HILFE_WURZEL). Dazu die laufende
 * Fassung der Kasse, zum Vorlesen am Telefon.
 */
function HilfeSection(): JSX.Element {
  const [fassung, setFassung] = useState<string>('');
  useEffect(() => {
    let lebt = true;
    void import('@tauri-apps/api/app')
      .then((m) => m.getVersion())
      .then((v) => {
        if (lebt) setFassung(v);
      })
      .catch(() => {
        /* Browser-Vorschau ohne Tauri: die Zeile bleibt leer, kein Fehler. */
      });
    return () => {
      lebt = false;
    };
  }, []);

  const zeilen: { etikett: string; satz: string; ziel: string }[] = [
    {
      etikett: 'Anleitung',
      satz: 'Die Handbuchseiten zu Einrichtung, Steuer und Betrieb.',
      ziel: hilfeFuer('norns.anleitung'),
    },
    {
      etikett: 'Support',
      satz: 'Der Weg zu uns, wenn etwas klemmt.',
      ziel: hilfeFuer('norns.support'),
    },
    {
      etikett: 'Preise',
      satz: 'Was Norns kostet, ohne Kleingedrucktes.',
      ziel: hilfeFuer('norns.preise'),
    },
  ];

  return (
    <div style={{ padding: 'var(--w14-abstand-24)', display: 'grid', gap: 'var(--w14-abstand-16)', maxWidth: 560 }}>
      <SectionTitle title="Hilfe & Norns" subtitle="Anleitung, Support und Preise, immer die heute richtige Seite." />
      {zeilen.map((z) => (
        <a
          key={z.etikett}
          href={z.ziel}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'block',
            padding: 'var(--w14-abstand-12) var(--w14-abstand-16)',
            border: '1px solid var(--w14-tabellenlinie)',
            borderRadius: 'var(--w14-radius-button)',
            textDecoration: 'none',
            color: 'var(--w14-ink)',
            background: 'var(--w14-parchment-1, var(--w14-parchment))',
          }}
        >
          <strong style={{ fontSize: 'var(--w14-schrift-betont)' }}>{z.etikett}</strong>
          <span style={{ display: 'block', marginTop: 2, color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-feld)' }}>
            {z.satz}
          </span>
        </a>
      ))}
      <p style={{ margin: 0, color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)' }}>
        {fassung ? `Norns POS, Fassung ${fassung}.` : 'Norns POS.'}
      </p>
    </div>
  );
}

function BelegSection(): JSX.Element {
  return (
    <div style={{ padding: 'var(--w14-abstand-24)' }}>
      <Belegdesigner />
    </div>
  );
}

/**
 * surface-registry — the SINGLE declarative source of every screen the
 * operator can navigate to. Locked by memory.md §11.
 *
 * The Karteikasten rail, the Spotlight palette, and the router all read
 * from this module. Adding a screen is exactly one append.
 *
 * Hard rules (compile-time + runtime):
 *   1. Tier 1 (`tier === 'primary'`) count NEVER exceeds 8 (§11.3).
 *   2. Every path starts with `/` and is unique (§11.3).
 *   3. Every surface has a German label + a German description.
 *   4. Tier 2 (`tier === 'secondary'`) reachable ONLY via Spotlight.
 *
 * The `assertSurfaceRegistry()` invariant runs at module-load and fails
 * the bundle if any rule is violated.
 */

import { type ComponentType, lazy } from 'react';

import type { LucideIcon } from '@norns/ui-kit';
import {
  Activity,
  Banknote,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileText,
  Gem,
  HandCoins,
  LayoutDashboard,
  Landmark,
  ListChecks,
  MailWarning,
  PenLine,
  PiggyBank,
  ReceiptText,
  Settings,
  ShieldAlert,
  ShoppingCart,
  Target,
  TrendingUp,
  UserCog,
  Users,
  Warehouse,
} from '@norns/ui-kit';

export type SurfaceTier = 'primary' | 'secondary';

export interface SurfaceDescriptor {
  /**
   * Stable URL anchor — the router consumes this verbatim and the deep
   * links from notifications / toasts use it. Never rename without a
   * compatibility shim.
   */
  path: string;

  /** German label that appears in chips, Spotlight, breadcrumbs. */
  label: string;

  /**
   * Mid-text German description for tooltips + Spotlight secondary line.
   * One short sentence. No exclamation marks.
   */
  description: string;

  /**
   * 1..8 for primary tier, undefined for secondary tier.
   * The Karteikasten rail sorts primary surfaces by this digit.
   */
  digit?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

  tier: SurfaceTier;

  /**
   * Das EINE, allgemein bekannte Zeichen der Fläche (27.07.2026, Basels
   * Befund: „das Zeichen spricht für sich"). Die obere Reiterleiste, die
   * Einstellungs-Spalte und Spotlight lesen es von hier — EINE Zuordnung,
   * keine verstreuten Bildchen.
   */
  icon: LucideIcon;

  /**
   * Lazy-loadable React component for the route. The router renders
   * this inside the AppShell <Outlet>. Day 4 ships placeholders; later
   * days swap them out one-by-one without touching the registry.
   */
  component: ComponentType;

  /**
   * Optional second-tier keywords that the Spotlight matches against
   * for fuzzy search. Useful for synonyms (e.g. "Z-Bon" finds Kasse).
   */
  searchAliases?: readonly string[];

  /**
   * When true, the surface is visible ONLY to the Owner — hidden from the rail,
   * the digit-nav, and Spotlight for every other role. The backing route still
   * enforces its own guard; this is the UI half so a non-owner never sees a
   * chip they cannot use. Used by the owner Leitstand.
   */
  ownerOnly?: boolean;

  // 14.08.2026: hier stand `onlineKanal?: boolean` (Basels Stilllegung vom
  // 02.08.). Der Kundenshop ist mit der Trennung von warehouse14 GELOESCHT,
  // nicht mehr stillgelegt; es gibt keine Online-Fläche mehr zu kennzeichnen.
}

// ── Tier 1 frontline surfaces — LAZY mit sofortigem VORLADEN (19.08.2026).
//
//    ⚠️ Hier standen acht statische Importe, begruendet mit „code-splitting
//    them would only add a needless network round trip". Die Begruendung war
//    fuer die AUSGELIEFERTE Kasse falsch: Tauri laedt seine Teile von der
//    lokalen Platte (tauri://), es gibt keine Netzreise. Was es gab, war der
//    Preis: der Hauptteil mass 1.073 kB (gemessen, vite build 19.08.), und
//    JEDER Start — auch der zur Anmeldemaske — parste erst die komplette
//    Verkaufs-, Ankaufs- und Lagerflaeche, bevor ein Pixel stand.
//
//    Jetzt: jede Flaeche ein eigener Teil, und `tier1Vorladen()` (App.tsx,
//    direkt nach der ersten Zeichnung) holt alle acht SOFORT nach — nicht
//    erst bei Bedarf. Der Kassierer wechselt die Reiter wie vorher ohne
//    Wartebild; nur die allererste Zeichnung traegt den Ballast nicht mehr.
const Ankauf = lazy(() =>
  import('../../screens/ankauf/Ankauf.js').then((m) => ({ default: m.Ankauf })),
);
const Kasse = lazy(() =>
  import('../../screens/kasse/Kasse.js').then((m) => ({ default: m.Kasse })),
);
const Kunden = lazy(() =>
  import('../../screens/kunden/Kunden.js').then((m) => ({ default: m.Kunden })),
);
const Inventur = lazy(() =>
  import('../../screens/secondary/Inventur.js').then((m) => ({ default: m.Inventur })),
);
const Lager = lazy(() =>
  import('../../screens/lager/Lager.js').then((m) => ({ default: m.Lager })),
);
const Schreiben = lazy(() =>
  import('../../screens/secondary/Schreiben.js').then((m) => ({ default: m.Schreiben })),
);
const Verkauf = lazy(() =>
  import('../../screens/verkauf/Verkauf.js').then((m) => ({ default: m.Verkauf })),
);
const Werkstatt = lazy(() =>
  import('../../screens/werkstatt/Werkstatt.js').then((m) => ({ default: m.Werkstatt })),
);

/**
 * Alle Tier-1-Flaechen SOFORT nachladen — App.tsx ruft das einmal nach der
 * ersten Zeichnung. Bewusst kein requestIdleCallback: am Tresen ist der
 * naechste Reiterwechsel Sekunden entfernt, nicht Minuten; die Teile sollen
 * da sein, BEVOR der Finger sie braucht. Fehler schluckt der Aufruf nicht —
 * eine Flaeche, die hier nicht laedt, wuerde auch beim Navigieren scheitern,
 * und dann faengt sie die Suspense-Grenze des Routers ehrlich auf.
 */
export function tier1Vorladen(): void {
  void import('../../screens/ankauf/Ankauf.js');
  void import('../../screens/kasse/Kasse.js');
  void import('../../screens/kunden/Kunden.js');
  void import('../../screens/secondary/Inventur.js');
  void import('../../screens/lager/Lager.js');
  void import('../../screens/secondary/Schreiben.js');
  void import('../../screens/verkauf/Verkauf.js');
  void import('../../screens/werkstatt/Werkstatt.js');
}

// ── Tier 2 secondary surfaces — LAZY (React.lazy + dynamic import). Each becomes
//    its own bundle chunk, fetched only when the operator first navigates there
//    via Spotlight. This keeps the heavy modules (e.g. the @fullcalendar suite in
//    Aufgaben, the trading terminal in Kurse) off the first-paint critical path.
//    The router wraps the <Outlet> in <Suspense> with a German fallback.
//    Every module exports a NAMED component, so map it onto `default` for lazy().
const Aufgaben = lazy(() =>
  import('../../screens/aufgaben/Aufgaben.js').then((m) => ({ default: m.Aufgaben })),
);
const Bewertung = lazy(() =>
  import('../../screens/bewertung/Bewertung.js').then((m) => ({ default: m.Bewertung })),
);
const Belegtexte = lazy(() =>
  import('../../screens/secondary/Belegtexte.js').then((m) => ({ default: m.Belegtexte })),
);
const Dokumente = lazy(() =>
  import('../../screens/secondary/Dokumente.js').then((m) => ({ default: m.Dokumente })),
);
const Finanzen = lazy(() =>
  import('../../screens/secondary/Finanzen.js').then((m) => ({ default: m.Finanzen })),
);
const Einstellungen = lazy(() =>
  import('../../screens/secondary/Einstellungen.js').then((m) => ({ default: m.Einstellungen })),
);
const Kurse = lazy(() =>
  import('../../screens/secondary/Kurse.js').then((m) => ({ default: m.Kurse })),
);
const SteuerExport = lazy(() =>
  import('../../screens/secondary/SteuerExport.js').then((m) => ({ default: m.SteuerExport })),
);
const Tagebuch = lazy(() =>
  import('../../screens/secondary/Tagebuch.js').then((m) => ({ default: m.Tagebuch })),
);
const Termine = lazy(() =>
  import('../../screens/termine/Termine.js').then((m) => ({ default: m.Termine })),
);
const Konfliktpostfach = lazy(() =>
  import('../../screens/secondary/Konfliktpostfach.js').then((m) => ({
    default: m.Konfliktpostfach,
  })),
);
const Zielkarte = lazy(() =>
  import('../../screens/zielkarte/Zielkarte.js').then((m) => ({ default: m.Zielkarte })),
);
const Uebersicht = lazy(() =>
  import('../../screens/secondary/Uebersicht.js').then((m) => ({ default: m.Uebersicht })),
);
const Risikoanalyse = lazy(() =>
  import('../../screens/risiko/Risikoanalyse.js').then((m) => ({ default: m.Risikoanalyse })),
);
const Team = lazy(() => import('../../screens/team/Team.js').then((m) => ({ default: m.Team })));
const Leitstand = lazy(() =>
  import('../../screens/leitstand/Leitstand.js').then((m) => ({ default: m.Leitstand })),
);

export const SURFACES: readonly SurfaceDescriptor[] = [
  // ── Tier 1 — 6 frontline chips, action-frequency order (ADR Option B) ─
  // Verkauf → Ankauf → Kasse lead; Lager/Kunden/Werkstatt follow. Aufgaben +
  // Bewertung are demoted to Spotlight (Bewertung now lives inside the Ankauf
  // buy-flow — an appraisal is just a draft purchase).
  {
    path: '/verkauf',
    label: 'Verkauf',
    icon: ShoppingCart,
    description: 'Verkauf an Kunden. Beleg, Zahlung, Kasse.',
    digit: 1,
    tier: 'primary',
    component: Verkauf,
    searchAliases: ['sale', 'rechnung', 'belegnummer', 'pos'],
  },
  {
    path: '/ankauf',
    label: 'Ankauf',
    icon: HandCoins,
    description: 'Ankauf & Bewertung. Ausweis, AML, Ankaufbeleg.',
    digit: 2,
    tier: 'primary',
    component: Ankauf,
    searchAliases: ['kauf', 'erwerb', 'einkauf', 'aml', 'bewertung', 'konvolut'],
  },
  // 14.08.2026: hier stand die Fläche /bestellungen (Ziffer 3, Abholung aus
  // dem Kundenshop). Der Shop ist mit der Trennung von warehouse14 gefallen;
  // eine Fläche, deren Tabelle niemand mehr füllt, wäre Dauer-Leere mit
  // einladender Kachel. Die Ziffern der übrigen Flächen bleiben unverändert,
  // damit kein Muskelgedächtnis bricht.
  {
    path: '/kasse',
    label: 'Tageskasse',
    icon: Banknote,
    description: 'Die Bargeld-Schublade des Tages: öffnen, Bargeld im Blick, Z-Bon.',
    digit: 4,
    tier: 'primary',
    component: Kasse,
    // Keep the old term searchable so muscle memory still lands here.
    searchAliases: [
      'kasse',
      'z-bon',
      'schicht',
      'shift',
      'kassensturz',
      'tagesabschluss',
      'startgeld',
    ],
  },
  {
    path: '/lager',
    label: 'Lager',
    icon: Warehouse,
    description: 'Bestand mit Lagerort und Schmelzwert.',
    digit: 5,
    tier: 'primary',
    component: Lager,
    searchAliases: ['inventar', 'bestand', 'tresor', 'fach', 'inventory'],
  },
  {
    path: '/kunden',
    label: 'Kunden',
    icon: Users,
    description: 'Kundenakte, KYC-Stempel, Vertrauen.',
    digit: 6,
    tier: 'primary',
    component: Kunden,
    searchAliases: ['customer', 'kunde', 'kundenakte', 'crm'],
  },
  {
    path: '/werkstatt',
    label: 'Werkstatt',
    icon: LayoutDashboard,
    description: 'Übersicht, Tagebuch und Edelmetallkurs.',
    digit: 7,
    tier: 'primary',
    component: Werkstatt,
    searchAliases: ['home', 'dashboard', 'übersicht', 'startseite'],
  },
  // ── Tier 2 — Spotlight-only (demoted from the frontline rail) ─────────
  {
    path: '/inventur',
    label: 'Inventur',
    icon: ClipboardList,
    description: 'Stichtagsinventur: jedes Stück scannen, Schwund feststellen.',
    tier: 'secondary',
    component: Inventur,
    searchAliases: ['inventur', 'bestandsaufnahme', 'zaehlen', 'schwund', 'stichtag'],
  },
  {
    path: '/aufgaben',
    label: 'Aufgaben',
    icon: ListChecks,
    description: 'Tagesliste der offenen Posten.',
    tier: 'secondary',
    component: Aufgaben,
    searchAliases: ['tasks', 'todo', 'erinnerungen'],
  },
  {
    path: '/bewertung',
    label: 'Konvolut-Bewertung',
    icon: Gem,
    description: 'Konvolut-Bewertung mit Pro-rata-Verteilung. Teil des Ankaufs.',
    tier: 'secondary',
    component: Bewertung,
    searchAliases: ['appraisal', 'expertise', 'gutachten', 'konvolut', 'ankauf', 'bewertung'],
  },

  // ── Tier 2 — Edelmetall trading terminal (UX P2: DEMOTED off the rail). The
  //    daily glance now lives in the always-visible chrome ticker; the deep
  //    candlestick charts AND the ADMIN "Manueller Override" stay here, reached
  //    via Spotlight or the ticker popover's "Details / Verlauf" link. ─────────
  {
    path: '/finanzen',
    label: 'Finanzen',
    icon: PiggyBank,
    description: 'Gewinnrechnung, Lagerwert und die gebuchten Ausgaben.',
    tier: 'secondary',
    component: Finanzen,
    searchAliases: ['gewinn', 'verlust', 'ausgaben', 'fixkosten', 'lagerwert', 'profit', 'guv'],
  },

  {
    path: '/kurse',
    label: 'Kurse',
    icon: TrendingUp,
    description: 'Live-Kurse für Gold, Silber, Platin, Palladium. Handelsterminal.',
    tier: 'secondary',
    component: Kurse,
    searchAliases: [
      'kurs',
      'gold',
      'silber',
      'platin',
      'palladium',
      'metallpreis',
      'lbma',
      'chart',
      'börse',
      'edelmetall',
      'terminal',
    ],
  },
  // ── Tier 1 (#7) — A4 document studio (contracts / invoices / letters) ─
  {
    path: '/schreiben',
    label: 'Schreiben',
    icon: PenLine,
    description: 'Verträge, Rechnungen und Briefe auf A4 erstellen und drucken.',
    digit: 8,
    tier: 'primary',
    component: Schreiben,
    searchAliases: [
      'brief',
      'vertrag',
      'ankaufvertrag',
      'rechnung',
      'dokument',
      'a4',
      'schreiben',
    ],
  },
  /*
   * ── 19.08.2026: die Foto-Werkstatt ist AUSGEBAUT (Basels Frage) ─────────
   *
   * „Warum brauchen wir das Foto in den Einstellungen?" — brauchen wir
   * nicht. Der fuenf-stufige Foto-Kanban war die Glamour-Strecke des
   * Warehouse14-WEBSHOPS (Fotograf → freistellen → veroeffentlichen); diese
   * Kasse hat keinen Webshop (Dekret vom 14.08.: NUR die schlanke Kasse),
   * und das Foto eines Stuecks entsteht dort, wo das Stueck ist — im Lager
   * (NeuesProduktDialog, Stufe „Foto · Etikett · Freigabe") und im Ankauf.
   *
   * Die Datei Fotos.tsx lag zunaechst noch da („eine Zeile stellt sie
   * wieder her"). Basels Pruefliste vom 19.08. (Abend) nannte sie als
   * toten Ballast, und sie hatte recht: 1605 Zeilen ohne einen einzigen
   * erreichbaren Weg. GELOESCHT; die Git-Geschichte traegt sie, wer sie
   * je zurueckholt, holt sie von dort. Uebersicht.tsx wurde beim Ausbau
   * mitgezogen — der Waechter haelt beide Listen zusammen.
   */
  {
    path: '/belegtexte',
    label: 'Belegtext-Editor',
    icon: ReceiptText,
    description: 'Versionierte Rechtstexte für Rechnungen und Z-Bons.',
    tier: 'secondary',
    component: Belegtexte,
    searchAliases: ['rechnung', 'text', '§25a', 'differenzbesteuerung'],
  },
  {
    path: '/tagebuch',
    label: 'Tagebuch',
    icon: BookOpen,
    description: 'Vollständige Ereignis-Chronik der Hash-Kette.',
    tier: 'secondary',
    component: Tagebuch,
    searchAliases: ['ledger', 'history', 'historie', 'chain', 'audit'],
  },
  {
    path: '/compliance-inbox',
    label: 'Konfliktpostfach',
    icon: MailWarning,
    description: 'Offline-Vorgänge, die vom Server abweichen und geprüft werden müssen.',
    tier: 'secondary',
    component: Konfliktpostfach,
    searchAliases: ['konflikt', 'sync', 'compliance', 'warteschlange', 'outbox'],
  },
  {
    path: '/dokumente',
    label: 'Dokumente',
    icon: FileText,
    description: 'Belege, Ausweise, Expertisen, verknüpft pro Entität.',
    tier: 'secondary',
    component: Dokumente,
    searchAliases: ['ausweis', 'rechnung', 'expertise', 'zertifikat', 'r2'],
  },
  {
    path: '/einstellungen',
    label: 'Einstellungen',
    icon: Settings,
    description: 'Operator-Profile, Drucker, Geräte.',
    tier: 'secondary',
    component: Einstellungen,
    searchAliases: ['settings', 'preferences', 'drucker', 'gerät'],
  },
  {
    path: '/termine',
    label: 'Termine',
    icon: CalendarDays,
    description: 'Terminkalender. Besichtigung, Ankauf-Bewertung, Beratung, Abholung.',
    tier: 'secondary',
    component: Termine,
    searchAliases: [
      'termin',
      'kalender',
      'calendar',
      'besichtigung',
      'beratung',
      'abholung',
      'ankauf-termin',
      'ics',
      'appointment',
    ],
  },
  // ⚠️ 01.08.2026 — die Fläche „/kalender" ist RAUS. Sie zeigte den Google
  // Kalender des Geschäfts, ganzseitig. Norns POS läuft ohne Netz; die Fläche
  // konnte hier nie etwas zeigen. Die Terminverwaltung dieser Kasse steht
  // unter „/termine" und gehört ihr selbst.
  {
    path: '/steuer-export',
    label: 'Steuer-Export',
    icon: Landmark,
    description: 'Tagesabschlüsse herunterladen: DATEV und Kassenbericht für das Finanzamt.',
    tier: 'secondary',
    component: SteuerExport,
    searchAliases: [
      'steuer',
      'export',
      'datev',
      'kassenbericht',
      'dsfinvk',
      'finanzamt',
      'steuerberater',
      'gobd',
      'abschluss',
    ],
  },
  // ── New management additions (Tier-2, Spotlight-reachable) ────────────
  {
    path: '/zielkarte',
    label: 'Zielkarte',
    icon: Target,
    description: 'Lebendige Instrumententafel der Hausziele: Umsatz, Bestand, Metalle, Gewinn.',
    tier: 'secondary',
    component: Zielkarte,
    ownerOnly: true,
    searchAliases: ['ziel', 'ziele', 'zielkarte', 'instrumente', 'kennzahlen', 'gauges', 'dashboard'],
  },
  // ── Der sichtbare Weg zu allem, was nicht auf der Schiene liegt ──────────
  //
  // Bis zum 25.07.2026 war eine sekundäre Fläche NUR über die Spotlight-Suche
  // erreichbar. Wer das richtige Wort nicht kannte, fand sie nie — Basel hat
  // genau danach gefragt („ماشوفها؟"), und Risikoanalyse, Leitstand und
  // Schaufenster waren die ganze Zeit da.
  //
  // Bewusst NICHT ownerOnly: die Fläche zeigt jedem nur, was er ohnehin sehen
  // darf (`visibleSurfaces`), und ein Kassierer braucht den Weg zu seinen
  // eigenen Flächen genauso.
  {
    path: '/uebersicht',
    label: 'Alle Flächen',
    icon: Settings,
    description: 'Jede Fläche des Hauses auf einen Blick, nach Tätigkeit geordnet.',
    tier: 'secondary',
    component: Uebersicht,
    searchAliases: ['alle', 'übersicht', 'uebersicht', 'menü', 'menue', 'flächen', 'mehr', 'index'],
  },
  {
    path: '/risiko',
    label: 'Risikoanalyse',
    icon: ShieldAlert,
    description: 'Warnungen und Kunden-Beobachtungsliste aus den Geldwäsche-Meldern.',
    tier: 'secondary',
    component: Risikoanalyse,
    ownerOnly: true,
    searchAliases: ['risiko', 'aml', 'gwg', 'sanktionen', 'pep', 'warnung', 'watchlist', 'compliance'],
  },
  // ⚠️ 01.08.2026 — die Fläche „Schaufenster" ist RAUS. Sie zeigte den
  // Besucherstrom von warehouse14.de, wie Cloudflare ihn am Rand zählt.
  // Anders als bei Leitstand und Risikoanalyse gab es hier NICHTS, was man
  // durch eigene Zahlen der Kasse hätte ersetzen können: die Fläche IST die
  // Reichweite einer Webseite, und ein Händler mit einer Kasse auf dem Tresen
  // hat weder Webseite noch Cloudflare-Zone.
  {
    path: '/team',
    label: 'Team & Rollen',
    icon: UserCog,
    description: 'Mitarbeiter freischalten, Rolle setzen, Zugang entziehen (Inhaber).',
    tier: 'secondary',
    component: Team,
    ownerOnly: true,
    searchAliases: ['team', 'mitarbeiter', 'rollen', 'personal', 'staff', 'benutzer', 'zugang'],
  },
  // ── Der Owner-Leitstand: Systemzustand, offene Probleme, Zugang zu Risiko +
  //    Edge-Schutz. Am 23.07.2026 von Tier 1 (#8) auf secondary gesenkt, damit
  //    „Bestellungen" die Ziffer 8 an der Kartei-Schiene bekommt. Grund: der
  //    Leitstand ist eine Blick-Fläche, keine Transaktions-Fläche, und der
  //    Inhaber trägt denselben Leitstand ohnehin in der Telefon-App. Er bleibt
  //    hier über Suche und Spotlight jederzeit erreichbar. ──
  {
    path: '/leitstand',
    label: 'Leitstand',
    icon: Activity,
    description: 'Systemzustand, offene Probleme und der Zugang zu Risiko und Edge-Schutz.',
    tier: 'secondary',
    component: Leitstand,
    ownerOnly: true,
    searchAliases: [
      'leitstand',
      'system',
      'systemzustand',
      'status',
      'gesundheit',
      'probleme',
      'überwachung',
      'monitoring',
      'betrieb',
    ],
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────
// Selectors + helpers
// ─────────────────────────────────────────────────────────────────────────

export const PRIMARY_SURFACES: readonly SurfaceDescriptor[] = SURFACES.filter(
  (s) => s.tier === 'primary',
);

export const SECONDARY_SURFACES: readonly SurfaceDescriptor[] = SURFACES.filter(
  (s) => s.tier === 'secondary',
);

/** Find a surface by URL path. Returns undefined for unknown routes. */
export function findSurfaceByPath(path: string): SurfaceDescriptor | undefined {
  return SURFACES.find((s) => s.path === path);
}

/**
 * Die Ziffer einer Fläche, als Zeichen für das Siegel in ihrer Überschrift.
 *
 * ── WARUM ES DAS GIBT (25.07.2026) ─────────────────────────────────────────
 * Die Siegel trugen ihre Ziffer als festen Text im Bildschirm. Als die
 * Reihenfolge der Schiene sich änderte, wanderte das Register mit — die Siegel
 * nicht. Vier von sechs logen danach: „◇6 Lager" stand über einer Fläche, die
 * auf der 5 liegt, und wer sich die 6 merkte, landete in den Kunden.
 *
 * Eine Ziffer, die zweimal gepflegt wird, driftet. Deshalb kommt sie jetzt aus
 * derselben Quelle wie die Tastenbelegung, und eine Fläche ohne Ziffer bekommt
 * `null` — Bewertung zum Beispiel hat gar keine, und dort darf keine stehen.
 */
export function zifferFuerFlaeche(path: string): string | null {
  const d = findSurfaceByPath(path)?.digit;
  return d === undefined ? null : String(d);
}

/**
 * True when this viewer may see the surface. `ownerOnly` surfaces are visible
 * only to the Owner. The rail, the digit-nav and Spotlight all funnel through
 * this so an owner-only chip can never leak into a non-owner's UI.
 */
export function isSurfaceVisible(s: SurfaceDescriptor, isOwner: boolean): boolean {
  return !s.ownerOnly || isOwner;
}

/** Filter a surface list to what this viewer may see (preserves order). */
export function visibleSurfaces(
  surfaces: readonly SurfaceDescriptor[],
  isOwner: boolean,
): SurfaceDescriptor[] {
  return surfaces.filter((s) => isSurfaceVisible(s, isOwner));
}

/** The route that opens by default after login. */
export const HOME_PATH = '/werkstatt';

// ─────────────────────────────────────────────────────────────────────────
// Invariants — fail-fast at module load. The bundler runs this once.
// ─────────────────────────────────────────────────────────────────────────

(function assertSurfaceRegistry(): void {
  // Rule 1 — Tier 1 budget.
  if (PRIMARY_SURFACES.length > 8) {
    throw new Error(
      `[surface-registry] tier-1 count is ${PRIMARY_SURFACES.length}; memory.md §11.3 caps it at 8. Move one surface to tier 2 or replace.`,
    );
  }
  // Rule 2 — unique paths.
  const paths = new Set<string>();
  for (const s of SURFACES) {
    if (!s.path.startsWith('/')) {
      throw new Error(`[surface-registry] path "${s.path}" must start with "/"`);
    }
    if (paths.has(s.path)) {
      throw new Error(`[surface-registry] duplicate path "${s.path}"`);
    }
    paths.add(s.path);
  }
  // Rule 3 — primary surfaces have digits 1..8, secondary have none.
  const digitsSeen = new Set<number>();
  for (const s of PRIMARY_SURFACES) {
    if (s.digit === undefined) {
      throw new Error(`[surface-registry] primary surface "${s.path}" missing digit`);
    }
    if (digitsSeen.has(s.digit)) {
      throw new Error(`[surface-registry] duplicate digit ${s.digit}`);
    }
    digitsSeen.add(s.digit);
  }
  for (const s of SECONDARY_SURFACES) {
    if (s.digit !== undefined) {
      throw new Error(`[surface-registry] secondary surface "${s.path}" must not carry a digit`);
    }
  }
})();

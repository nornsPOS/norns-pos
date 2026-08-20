/**
 * AppShell — the authenticated layout wrapper.
 *
 *   ┌────────────────────────────────────────────────────┐
 *   │ AppShellHeader (Karteikasten + magnifier + ⏻)       │
 *   ├────────────────────────────────────────────────────┤
 *   │ SubBreadcrumb (only on Tier-2 surfaces)             │
 *   ├────────────────────────────────────────────────────┤
 *   │                                                    │
 *   │   <ErrorBoundary><Outlet/></ErrorBoundary>          │
 *   │                                                    │
 *   └────────────────────────────────────────────────────┘
 *   + Spotlight modal       (Cmd+K)
 *   + StepUpModal           (interceptor-driven, memory.md #76 ⑦)
 *   + ToastContainer        (alerts + success + info, top-right portal)
 *
 * Owns:
 *   • the global Cmd+K binding (opens Spotlight)
 *   • the recents-store push on every route change
 *   • the Cmd+Shift+D dark-mode toggle (mirrors html[data-theme])
 *   • the sign-out cascade (session + ledger + recents + cart + toasts)
 *   • the alert-toast subscription (SSE → toast queue)
 *
 * Does NOT own SSE — that lives inside <Werkstatt /> so it tears down
 * on sign-out via React's natural unmount.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { ErrorBoundary, ToastContainer } from '@norns/ui-kit';

import { useAlertSubscription } from '../../hooks/useAlertSubscription.js';
import { useApiClient } from '../../lib/api-context.js';
import { useRecents } from '../../state/recents-store.js';
import { useSessionStore } from '../../state/session-store.js';
import { registerSignOut } from '../../lib/session-actions.js';
import { fuehreAbmeldungAus } from '../../lib/sign-out.js';
import { useTheme } from '../../state/theme-store.js';
import { useToastStore } from '../../state/toast-store.js';

// Die Liste der personengebundenen localStorage-Schluessel liegt jetzt bei der
// Kaskade selbst: `lib/sign-out.ts` → `PER_OPERATOR_STORAGE_KEYS`.

import { AppShellHeader } from './AppShellHeader.js';
import { ErprobungsStreifen } from './ErprobungsStreifen.js';
import { MetalTicker } from './MetalTicker.js';
import { useKursstreifenSichtbar } from '../../state/kursstreifen-store.js';
import { Spotlight } from './Spotlight.js';
import { StepUpModal } from './StepUpModal.js';
import { SubBreadcrumb } from './SubBreadcrumb.js';
import { rueckwegFuer } from './rueckweg.js';
import { erstelleZifferSchleuse, isAnyDialogOpen, isTextEntryElement } from './digit-nav.js';
import {
  PRIMARY_SURFACES,
  SECONDARY_SURFACES,
  findSurfaceByPath,
  visibleSurfaces,
} from './surface-registry.js';

export function AppShell(): JSX.Element {
  const location = useLocation();
  /** Stehen die Metallkurse? Basels Schalter vom 05.08.2026. */
  const kursstreifenSichtbar = useKursstreifenSichtbar();
  const navigate = useNavigate();
  const api = useApiClient();
  const qc = useQueryClient();

  const isOwner = useSessionStore((s) => s.actor?.isOwner ?? false);
  const pushRecent = useRecents((s) => s.push);

  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);

  const toasts = useToastStore((s) => s.toasts);
  const toastPaths = useToastStore((s) => s.paths);
  const dismissToast = useToastStore((s) => s.dismiss);

  const [spotlightOpen, setSpotlightOpen] = useState(false);

  // <main> owns the scroll now (see the shell height note below). Reset it to the
  // top on every route change so a new surface never opens mid-scroll.
  const mainRef = useRef<HTMLElement>(null);

  // Subscribe SSE alerts → toast queue (memory.md #76 ⑦).
  useAlertSubscription();

  // ⚠️ 01.08.2026: hier wurde beim Start still das Mikrofonrecht erfragt, für
  // den Sprachassistenten. Der ist ausgezogen — er konnte auf einer Norns-Kasse
  // nie verbinden, weil der Rumpf den Schlüssel seines externen Dienstes nicht
  // durchreicht (geschlossene Viererliste in `src-tauri/src/tresor.rs:57`).
  // Eine Kasse, die beim ersten Start nach dem Mikrofon fragt und es nie
  // benutzt, ist eine Frage ohne Grund; die Begründung steht in
  // `SupportButton.tsx`.

  // Reflect the theme onto <html data-theme>.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Track surface visits for the Spotlight "Zuletzt" group.
  useEffect(() => {
    const s = findSurfaceByPath(location.pathname);
    if (s) pushRecent(s.path);
  }, [location.pathname, pushRecent]);

  /*
   * ── DIE FLÄCHE DAVOR — für den Weg zurück (20.08.2026) ─────────────────
   *
   * Ein eigener Halt, NICHT der Spotlight-Speicher „Zuletzt": der sortiert
   * die zuletzt besuchten Flächen um und wirft Doppelte weg, damit seine
   * Liste kurz bleibt. Für die Frage „wo kam ich gerade her" ist das die
   * falsche Auskunft — sie stimmt meistens und manchmal nicht, und ein
   * Rückweg, der manchmal woandershin führt, ist schlimmer als keiner.
   *
   * `useRef`, nicht `useState`: der Wert wird nur beim Wechsel gelesen, und
   * ein zweiter Durchlauf je Flächenwechsel wäre umsonst.
   */
  const vorherigerPfad = useRef<string | null>(null);
  const pfadJetzt = location.pathname;
  const rueckweg = rueckwegFuer(pfadJetzt, vorherigerPfad.current);
  useEffect(() => {
    return () => {
      vorherigerPfad.current = pfadJetzt;
    };
  }, [pfadJetzt]);

  // <main> owns the scroll — reset it to the top on each route change so a new
  // surface never opens already scrolled down (the body used to do this for free).
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Owner-only surfaces (Leitstand) fall out for non-owners, damit ihre Ziffer
  // wirkungslos bleibt statt einen gesperrten Bildschirm zu oeffnen.
  const schleuse = useMemo(
    () =>
      erstelleZifferSchleuse({
        primarySurfaces: visibleSurfaces(PRIMARY_SURFACES, isOwner),
        navigate,
      }),
    [isOwner, navigate],
  );

  // Global key bindings — Cmd+K opens Spotlight; Cmd+Shift+D toggles theme;
  // bare 1–8 jump to the primary surfaces the rail labels (UX P0).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      const isMod = ev.metaKey || ev.ctrlKey;
      if (isMod && !ev.shiftKey && (ev.key === 'k' || ev.key === 'K')) {
        ev.preventDefault();
        setSpotlightOpen((open) => !open);
        return;
      }
      if (isMod && ev.shiftKey && (ev.key === 'd' || ev.key === 'D')) {
        ev.preventDefault();
        toggleTheme();
        return;
      }
      // Ziffernnavigation. Die Wachen (Zusatztaste gedrueckt, ein Textfeld im
      // Fokus, ein Dialog offen) liegen im reinen Entscheider, damit eine „3"
      // im Preisfeld oder in einem Dialog nie springt.
      //
      // Die Schleuse haelt den Sprung kurz zurueck: folgt sofort eine zweite
      // Taste, war es der Handscanner und nicht die Hand am Tresen.
      const springt = schleuse.taste({
        key: ev.key,
        hasModifier: ev.metaKey || ev.ctrlKey || ev.altKey,
        isTextEntry: isTextEntryElement(document.activeElement),
        isDialogOpen: isAnyDialogOpen(),
      });
      if (springt) ev.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      schleuse.abbrechen();
    };
  }, [toggleTheme, navigate, isOwner, schleuse]);

  // Die Abmelde-Kaskade liegt in `lib/sign-out.ts` — als gewoehnliche Funktion,
  // damit JEDER Abmelde-Knopf dieselbe ausfuehrt. Vorher lag sie nur hier, und
  // die beiden anderen Knoepfe (Medaillon, Sperrbild) raeumten nicht auf.
  const handleSignOut = useCallback(() => fuehreAbmeldungAus({ api, qc }), [api, qc]);

  // Expose sign-out to routed surfaces (Einstellungen → "Abmelden"); the lock
  // icon was removed from the header.
  useEffect(() => registerSignOut(() => void handleSignOut()), [handleSignOut]);

  // Tier-2 surfaces render the SubBreadcrumb (memory.md §11.5).
  const secondarySurface = SECONDARY_SURFACES.find((s) => location.pathname.startsWith(s.path));

  // Toast click → navigate to the stored path.
  const onToastActivate = useCallback(
    (id: string) => {
      const path = toastPaths.get(id);
      if (path) navigate(path);
      dismissToast(id);
    },
    [toastPaths, navigate, dismissToast],
  );

  return (
    <div
      className="w14-paper-noise"
      style={{
        // A BOUNDED viewport height (not min-height) is what makes the app-shell
        // model work: the header + ticker stay fixed and the routed surface owns
        // its own scroll below. With min-height the page grew with content and the
        // body scrolled, so a long Verkauf cart pushed the pinned „Bezahlen" footer
        // off-screen. height + overflow:hidden freezes the frame; <main> scrolls.
        height: '100dvh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--w14-parchment)',
      }}
    >
      {/*
        ⚠️ GANZ OBEN, ueber allem anderen. Eine Kasse, die gegen die
        Erprobungsumgebung signiert, muss das in jeder Sekunde sagen — der
        Streifen ist im Regelfall unsichtbar und kostet nichts.
      */}
      <ErprobungsStreifen />
      <AppShellHeader
        onOpenSpotlight={() => setSpotlightOpen(true)}
        onSignOut={() => {
          void handleSignOut();
        }}
      />

      {secondarySurface && (
        <SubBreadcrumb
          label={secondarySurface.label}
          zurueck={rueckweg}
          onZurueck={(pfad) => navigate(pfad)}
        />
      )}

      {/* Der Metallkurs-Streifen, unter dem Kopf und ueber der Flaeche.
          ⚠️ Seit 05.08.2026 nicht mehr „immer sichtbar": Basel wollte ihn
          ein- und ausschaltbar, weil er optional ist. Der Schalter sitzt im
          Kopf neben der Darstellung; die Wahl liegt im Geraet, nicht in der
          Datenbank, und die Vorgabe bleibt SICHTBAR. */}
      {kursstreifenSichtbar && <MetalTicker />}

      <main
        ref={mainRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          // Long surfaces (forms, lists) scroll HERE, not the body. A surface that
          // fills the height (Verkauf) instead scrolls inside its own panels, so
          // its „Bezahlen" footer never leaves the frame.
          overflowY: 'auto',
        }}
      >
        {/* Flaechenwechsel-Blende. Der Schluessel liegt auf DIESEM Rahmen (vorher
            auf der Fehlergrenze, die er umschliesst — ihr Neuaufbau je Fläche
            bleibt also erhalten): jeder Wechsel baut den Rahmen neu auf, und die
            Einblendung laeuft einmal, sofort, ohne auf eine Klasse zu warten.

            Eine ECHTE Kreuzblende (alte Fläche blendet aus, neue ein) braeuchte
            beide Flaechen gleichzeitig im Baum. Schwere Flaechen (Verkauf,
            Lager) doppelt zu mounten ist Layout-Arbeit fuer nichts — deshalb
            bewusst nur der Eingang der neuen Flaeche, opacity, eine Karte die
            aufgelegt wird. reduced-motion: Sofortwechsel (siehe style unten).

            Der Rahmen spiegelt den Flex-Kontext von <main> (flex 1, minHeight 0,
            Spalte), damit Verkaufs „Bezahlen"-Fuss und alle inneren Rollbereiche
            exakt so rechnen wie ohne ihn. */}
        <div
          key={location.pathname}
          className="w14-flaeche-blende"
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Per-route error boundary: a crash in one surface must not take
              down the Karteikasten + Spotlight. The boundary remounts via
              its `Erneut versuchen` button or by switching surfaces. */}
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>

      {/* Die Blende gehoert der Anwendungshuelle, nicht dem Baukasten: sie ist
          eine Eigenschaft des WEGLENKERS. Nur opacity (Bewegungsregel), Dauer
          und Kurve sind Haus-Marken, kein roher Zahlenwert. */}
      <style>{`
        @keyframes w14-flaeche-in { from { opacity: 0; } to { opacity: 1; } }
        .w14-flaeche-blende {
          animation: w14-flaeche-in var(--w14-dur-fast) var(--w14-ease-out) both;
        }
        @media (prefers-reduced-motion: reduce) {
          /* Sofortwechsel — nicht nur „Dauer 0": gar keine Animation. */
          .w14-flaeche-blende { animation: none; }
        }
      `}</style>

      {/* Overlays — order matters: Spotlight under StepUpModal under Toasts */}
      <Spotlight open={spotlightOpen} onClose={() => setSpotlightOpen(false)} />
      <StepUpModal />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} onActivate={onToastActivate} />
      {/* The auto-update surface is now the single <UpdateCenter/> modal,
          opened from the header ↻ (UpdateButton) and driven by the
          useAppUpdate singleton — the old floating UpdateBanner is gone. */}
    </div>
  );
}

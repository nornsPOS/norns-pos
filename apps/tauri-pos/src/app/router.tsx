/**
 * router — react-router-dom v6 derived from the surface-registry.
 *
 * Single source: surface-registry.SURFACES. Adding a screen is one
 * append; the router picks it up automatically.
 *
 *   /            → redirect to HOME_PATH (/werkstatt)
 *   /werkstatt   → AppShell > Werkstatt
 *   /verkauf     → AppShell > Verkauf
 *   …            (all 15 surfaces)
 *   *            → fallback to home
 *
 * Uses BrowserRouter because Tauri's webview supports the history API.
 */

import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from './chrome/AppShell.js';
import { HOME_PATH, SURFACES } from './chrome/surface-registry.js';

/**
 * Fallback shown while a lazily-loaded secondary surface chunk is fetched.
 * Tier-2 screens (Spotlight-only) are code-split via React.lazy in the
 * surface-registry; this Suspense boundary catches their load.
 */
function SurfaceLadeAnzeige(): JSX.Element {
  return (
    <output
      aria-live="polite"
      className="w14-lade-blende"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '40vh',
        color: 'var(--w14-ink-faded)',
        fontSize: 'var(--w14-schrift-betont)',
      }}
    >
      {/* Die Anzeige wartet einen kurzen Takt, bevor sie sich zeigt: laedt der
          Baustein schnell (der Normalfall nach dem ersten Besuch), blitzt so
          NIE ein Satz auf, der sofort wieder verschwindet. Das ist bewusst
          KEIN unsichtbarer Inhalt im Sinne der Bewegungsregel — es ist eine
          Wartemeldung, deren frueheres Aufblitzen selbst die Stoerung war.
          reduced-motion: sofort sichtbar, ohne Blende. */}
      <style>{`
        @keyframes w14-lade-in { from { opacity: 0; } to { opacity: 1; } }
        .w14-lade-blende {
          animation: w14-lade-in var(--w14-dur-fast) var(--w14-ease-out) var(--w14-dur-fast) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .w14-lade-blende { animation: none; }
        }
      `}</style>
      Wird geladen…
    </output>
  );
}

export function AppRouter(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to={HOME_PATH} replace />} />
          {SURFACES.map((s) => {
            const Component = s.component;
            return (
              <Route
                key={s.path}
                path={s.path}
                element={
                  <Suspense fallback={<SurfaceLadeAnzeige />}>
                    <Component />
                  </Suspense>
                }
              />
            );
          })}
          <Route path="*" element={<Navigate to={HOME_PATH} replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

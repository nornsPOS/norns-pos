/**
 * ToastContainer — the brand top-right toast portal + queue.
 *
 * Owns the queue's lifecycle:
 *   • renders each active toast as <Toast/>
 *   • auto-dismisses non-sticky toasts after their `autoDismissMs`
 *   • allows manual dismiss + onClick navigation
 *
 * Consumed via the `useToast()` hook (separate file). Mounted once at the
 * AppShell level — never duplicate in a screen.
 *
 * ─── FUND 2026-07-26: die Meldungen lagen UNTER jedem Fenster ───────────
 * Der Kasten stand auf der nackten Zahl 900 und wurde als gewöhnliches Kind
 * der Anwendungshülle gezeichnet. Jedes Fenster (Dialog, Schublade) liegt auf
 * 1050 und hängt sich per Portal direkt an den Seitenkörper. Zwei Fehler
 * zugleich, jeder für sich schon tödlich:
 *   • 900 < 1050 — die Meldung lag hinter dem abdunkelnden Schleier;
 *   • als Kind der Hülle bildete die Hülle einen eigenen Stapelzusammenhang,
 *     sodass die 900 nicht einmal mit der 1050 des Portals verglichen wurde.
 * Am Tresen hiess das: „Druck fehlgeschlagen", „Terminal nicht konfiguriert",
 * „Beleg ausgegeben, aber der Gutschein wurde nicht verbucht" erschienen und
 * verschwanden wieder, ohne dass irgendjemand sie je zu sehen bekam — mitten
 * im Bezahlvorgang, dem einzigen Moment, in dem sie zählen. Die Absicht war
 * sogar notiert (AppShell: „Spotlight under StepUpModal under Toasts") und
 * still nie umgesetzt.
 * Behoben durch beides zusammen: eigenes Portal an den Seitenkörper UND die
 * benannte Sprosse `--w14-z-meldung`, die über allem liegt, was die Kasse
 * sonst noch zeichnet.
 *
 * ─── Bewegung (2026-07-27) ───────────────────────────────────────────────
 * Die Blase war die einzige Fläche des Hauses, die schlagartig erschien und
 * verschwand — ausgerechnet die, mit der die Kasse dem Menschen etwas sagt.
 * Jetzt: Eintritt von oben (w14-toast-in, curator), Abgang nach rechts
 * (w14-toast-out, dur-exit + ease-out-quart), und beim Abräumen rücken die
 * verbliebenen Blasen SANFT nach (FLIP: erst zurückversetzen per transform,
 * dann zur Ruhelage gleiten — kein Layout wird animiert, das Layout ist
 * längst fertig). prefers-reduced-motion: alles Sofortwechsel.
 *
 * Der Abgang verzögert das ECHTE Entfernen: erst spielt die Blase ihren
 * Abgang, dann erst wird `onDismiss` gerufen. Für den Zustand des Ladens ist
 * die Blase in dieser Zeit noch da — sie ist nur schon aria-hidden und ohne
 * Zeiger, für Leser und Finger also bereits weg.
 */

import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { Toast, type ToastShape } from './Toast.js';

/** Siehe Dialog.tsx: die globale reduced-motion-Regel kürzt nur Dauern. */
function reduzierteBewegung(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Notausgang, falls `animationend` nie feuert: 160ms Abgang + Reserve. */
const ABGANG_NOTAUSGANG_MS = 320;

export interface ToastContainerProps {
  toasts: readonly ToastShape[];
  onDismiss: (id: string) => void;
  /** Optional per-toast click handler (e.g. navigate to the related screen). */
  onActivate?: (id: string) => void;
}

export function ToastContainer({
  toasts,
  onDismiss,
  onActivate,
}: ToastContainerProps): JSX.Element {
  // Blasen, die gerade ihren Abgang spielen. Sie stehen noch in `toasts`
  // (onDismiss ist ja noch nicht gerufen), zeichnen sich aber im Abgangsbild.
  const [abgehende, setAbgehende] = useState<readonly string[]>([]);

  const beginneAbgang = useCallback(
    (id: string): void => {
      if (reduzierteBewegung()) {
        onDismiss(id);
        return;
      }
      setAbgehende((alt) => (alt.includes(id) ? alt : [...alt, id]));
    },
    [onDismiss],
  );

  const schliesseAbgangAb = useCallback(
    (id: string): void => {
      setAbgehende((alt) => (alt.includes(id) ? alt.filter((x) => x !== id) : alt));
      onDismiss(id);
    },
    [onDismiss],
  );

  // Wird eine abgehende Blase von aussen entfernt (der Speicher deckelt die
  // Liste), darf ihr Eintrag hier nicht liegen bleiben.
  useEffect(() => {
    const lebende = new Set(toasts.map((t) => t.id));
    setAbgehende((alt) => {
      const gefiltert = alt.filter((id) => lebende.has(id));
      return gefiltert.length === alt.length ? alt : gefiltert;
    });
  }, [toasts]);

  // Auto-dismiss timers. Sticky toasts (autoDismissMs === null) are skipped,
  // ebenso Blasen, die schon im Abgang sind (sonst begänne er doppelt).
  useEffect(() => {
    const timers: number[] = [];
    for (const t of toasts) {
      if (t.autoDismissMs == null) continue;
      if (abgehende.includes(t.id)) continue;
      const id = t.id;
      const ms = t.autoDismissMs;
      const timer = window.setTimeout(() => beginneAbgang(id), ms);
      timers.push(timer);
    }
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [toasts, abgehende, beginneAbgang]);

  // Notausgang je abgehender Blase. Der reguläre Ausgang ist `animationend`;
  // dieser Timer greift nur, wenn das Ereignis ausbleibt.
  useEffect(() => {
    if (abgehende.length === 0) return;
    const timers = abgehende.map((id) =>
      window.setTimeout(() => schliesseAbgangAb(id), ABGANG_NOTAUSGANG_MS),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [abgehende, schliesseAbgangAb]);

  // ── Sanftes Nachrücken (FLIP) ────────────────────────────────────────────
  // Verschwindet eine Blase, springen die darunter liegenden an ihren neuen
  // Platz — das Layout selbst wird NIE animiert. Stattdessen: neuen Platz
  // messen, die Blase per transform auf den alten zurückversetzen, und im
  // nächsten Bild zur Ruhelage gleiten lassen. Reiner transform, im Einklang
  // mit der Bewegungsregel.
  const zeilenRefs = useRef(new Map<string, HTMLDivElement>());
  const vorherigeLage = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const neueLage = new Map<string, number>();
    for (const [id, el] of zeilenRefs.current) neueLage.set(id, el.offsetTop);
    if (!reduzierteBewegung()) {
      for (const [id, el] of zeilenRefs.current) {
        const alt = vorherigeLage.current.get(id);
        const neu = neueLage.get(id);
        if (alt === undefined || neu === undefined || alt === neu) continue;
        el.style.transition = 'none';
        el.style.transform = `translateY(${alt - neu}px)`;
        requestAnimationFrame(() => {
          el.style.transition = 'transform var(--w14-dur-fast) var(--w14-ease-out)';
          el.style.transform = '';
        });
      }
    }
    vorherigeLage.current = neueLage;
  });

  const containerStyle: CSSProperties = useMemo(
    () => ({
      position: 'fixed',
      top: 76, // below the 56-px header
      right: 16,
      zIndex: 'var(--w14-z-meldung)',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      // Der Kasten selbst fängt keine Zeiger ab — sonst läge ein unsichtbares
      // Feld über dem Bezahldialog. Nur die einzelne Meldung ist anfassbar.
      pointerEvents: 'none',
      // Umbruchschutz. Eine Fehlermeldung vom Terminal oder vom Drucker bringt
      // gern eine lange ungebrochene Kette mit (Gerätekennung, Pfad, Kennnummer).
      // `anywhere` ist hier absichtlich gewählt und nicht `break-word`: nur
      // `anywhere` senkt auch die Mindestbreite des Inhalts, sonst drückt die
      // Kette die Spalte über den Rahmen hinaus. Die Eigenschaft wird vererbt
      // und erreicht damit den Text in `Toast`, ohne dass diese Datei ihn kennt.
      overflowWrap: 'anywhere',
      // Am schmalen Tresenschirm darf der Kasten nicht über den linken Rand
      // hinauswachsen; 32 = die 16 Randabstand auf jeder Seite.
      maxWidth: 'calc(100vw - 32px)',
    }),
    [],
  );

  // Ohne `document` (Serverlauf, oder ein Testlauf ohne DOM) gibt es kein Ziel
  // für das Portal. Dann nichts zeichnen statt abstürzen.
  if (typeof document === 'undefined') return <></>;

  return createPortal(
    // Eigenes Portal an den Seitenkörper: als Kind der Anwendungshülle wäre der
    // Kasten in deren Stapelzusammenhang eingesperrt und keine noch so hohe
    // Zahl käme über ein Fenster, das selbst am Seitenkörper hängt.
    <div style={containerStyle} aria-live="polite">
      {toasts.map((t) => {
        const geht = abgehende.includes(t.id);
        return (
          <div
            key={t.id}
            ref={(el) => {
              if (el) zeilenRefs.current.set(t.id, el);
              else zeilenRefs.current.delete(t.id);
            }}
            // Eine abgehende Blase ist für Leser und Finger bereits weg —
            // nur das Auge sieht sie noch gehen.
            aria-hidden={geht ? true : undefined}
            onAnimationEnd={(ev) => {
              if (ev.animationName === 'w14-toast-out') schliesseAbgangAb(t.id);
            }}
            style={{
              pointerEvents: geht ? 'none' : 'auto',
              // `forwards` auf dem Abgang: zwischen Animationsende und dem
              // echten Entfernen liegt ein Bild — ohne fill blitzte die Blase
              // für genau dieses Bild zurück.
              animation: geht
                ? 'w14-toast-out var(--w14-dur-exit) var(--w14-ease-exit) forwards'
                : 'w14-toast-in var(--w14-dur-medium) var(--w14-ease-curator)',
            }}
          >
            <Toast
              toast={t}
              onDismiss={() => beginneAbgang(t.id)}
              {...(onActivate ? { onClick: () => onActivate(t.id) } : {})}
            />
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

/**
 * Sichtprüfungs-Blatt „Kartenleser (Stripe)" — Einstieg für
 * vorschau-kartenleser.html, NUR im Vite-Entwicklungslauf erreichbar
 * (der Produktionsbau bündelt allein index.html).
 *
 * ── WARUM ES DIESES BLATT GIBT ──────────────────────────────────────────────
 * Die echte Kasse steht hinter der lokalen Schnellcode-Sperre; die Sperre zu
 * lösen ist Basels Sache, nicht meine. Damit die Fläche trotzdem MIT AUGEN
 * geprüft werden kann, mountet dieses Blatt die ECHTE Sektion (denselben
 * Quelltext, der im Gerätemanager steht) hinter einer protokolltreuen
 * fetch-Attrappe: die Antworten tragen exakt die Formen der Server-Schemata
 * aus apps/api-cloud/src/routes/stripe-terminal.ts und stripe-connect.ts,
 * einschliesslich der Fehler-Hülle { error: { code, message, requestId } }.
 * Keine schmeichelnde Attrappe: auch 403, Störung und die Kassiererin-Sicht
 * sind Fälle.
 *
 * Fälle über die Adresszeile (?fall=…):
 *   a        — Server ohne Stripe-Konto (ruhige Erklärung, kein Rot)
 *   b        — Konto da, kein Leser (Registrierung)
 *   bremse   — Konto verbunden, aber nicht abbuchungsbereit (Hinweis)
 *   c        — zwei Leser (Liste + Registrierung)   [Vorgabe]
 *   kasse    — Kassiererin ohne Leser (NUR_INHABER)
 *   stoerung — Leser-Liste nicht abrufbar (ehrlicher Störungssatz)
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@norns/ui-kit/styles.css';

import { ApiClientProvider } from '../lib/api-context.js';
import { KartenleserStripeSection } from '../screens/secondary/KartenleserStripe.js';
import { useSessionStore } from '../state/session-store.js';

type Fall = 'a' | 'b' | 'bremse' | 'c' | 'kasse' | 'stoerung';

const FAELLE: ReadonlyArray<{ id: Fall; label: string }> = [
  { id: 'a', label: '(a) ohne Konto' },
  { id: 'b', label: '(b) Konto, kein Leser' },
  { id: 'bremse', label: '(b) Konto gebremst' },
  { id: 'c', label: '(c) Leser vorhanden' },
  { id: 'kasse', label: 'Kassiererin' },
  { id: 'stoerung', label: 'Liste gestört' },
];

const params = new URLSearchParams(window.location.search);
const fallParam = params.get('fall');
const fall: Fall = (FAELLE.find((f) => f.id === fallParam)?.id ?? 'c') as Fall;

// ── Die protokolltreue fetch-Attrappe ──────────────────────────────────────

interface AttrappenLeser {
  id: string;
  providerReaderId: string;
  bezeichnung: string;
  geraetetyp: string | null;
  seriennummer: string | null;
  status: string | null;
  registriertAm: string;
}

/** In-Speicher-Bestand, damit Registrieren/Entfernen die Liste wirklich bewegt. */
const bestand: AttrappenLeser[] =
  fall === 'c' || fall === 'stoerung'
    ? [
        {
          id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb01',
          providerReaderId: 'tmr_vorschau_1',
          bezeichnung: 'Tresen links',
          geraetetyp: 'bbpos_wisepos_e',
          seriennummer: 'WSC-4711',
          status: 'online',
          registriertAm: '2026-07-20T09:00:00.000Z',
        },
        {
          id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb02',
          providerReaderId: 'tmr_vorschau_2',
          bezeichnung: 'Vitrine hinten',
          geraetetyp: 'bbpos_wisepos_e',
          seriennummer: 'WSC-4712',
          status: 'offline',
          registriertAm: '2026-07-22T14:30:00.000Z',
        },
      ]
    : [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fehler(status: number, code: string, message: string): Response {
  // Exakt die Fehler-Hülle des Servers (plugins/error-handler.ts).
  return json(status, { error: { code, message, requestId: 'req_vorschau' } });
}

const echterFetch = window.fetch.bind(window);
window.fetch = async (eingabe: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof eingabe === 'string' ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe.url;
  const methode = (init?.method ?? (eingabe instanceof Request ? eingabe.method : 'GET')).toUpperCase();
  const pfad = new URL(url, window.location.origin).pathname;

  if (pfad === '/api/stripe/terminal/readers' && methode === 'GET') {
    if (fall === 'stoerung') throw new TypeError('Failed to fetch');
    return json(200, { leser: bestand });
  }
  if (pfad === '/api/stripe/terminal/readers' && methode === 'POST') {
    const body = JSON.parse(String(init?.body ?? '{}')) as { label?: string };
    const neu: AttrappenLeser = {
      id: crypto.randomUUID(),
      providerReaderId: `tmr_vorschau_${bestand.length + 1}`,
      bezeichnung: body.label ?? 'Leser',
      geraetetyp: 'bbpos_wisepos_e',
      seriennummer: null,
      status: 'online',
      registriertAm: new Date().toISOString(),
    };
    bestand.push(neu);
    return json(200, neu);
  }
  if (pfad.startsWith('/api/stripe/terminal/readers/') && methode === 'DELETE') {
    const id = pfad.split('/').pop() ?? '';
    const i = bestand.findIndex((z) => z.id === id);
    if (i === -1) return fehler(404, 'NOT_FOUND', 'Diesen Leser gibt es nicht.');
    bestand.splice(i, 1);
    return json(200, { geloescht: true });
  }
  if (pfad === '/api/stripe/connect/status' && methode === 'GET') {
    if (fall === 'kasse') return fehler(403, 'FORBIDDEN', 'Owner-only operation');
    if (fall === 'a') {
      return json(200, {
        connected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        readyToCharge: false,
        hint: 'Es ist noch kein Stripe-Konto verknüpft. Kartenzahlung ist nicht möglich.',
        applicationFeeBps: 100,
        lastSyncedAt: null,
      });
    }
    return json(200, {
      connected: true,
      stripeAccountId: 'acct_vorschau',
      chargesEnabled: fall !== 'bremse',
      payoutsEnabled: fall !== 'bremse',
      detailsSubmitted: fall !== 'bremse',
      readyToCharge: fall !== 'bremse',
      hint:
        fall === 'bremse'
          ? 'Die Einrichtung bei Stripe ist noch nicht abgeschlossen. Der Leser kann noch nicht kassieren.'
          : '',
      applicationFeeBps: 100,
      requirements: {},
      lastSyncedAt: new Date().toISOString(),
    });
  }
  if (pfad === '/api/shop-info' && methode === 'GET') {
    return json(200, {
      name: 'WAREHOUSE 14',
      tagline: 'Antiquitäten · Briefmarken · Münzen',
      addressLine1: 'Rosenstraße 40',
      addressLine2: '73614 Schorndorf',
      vatId: '',
      taxNumber: '',
      phone: '',
    });
  }
  return echterFetch(eingabe as RequestInfo, init);
};

// ── Sitzung der Vorschau: Rolle je Fall ────────────────────────────────────

useSessionStore.setState({
  status: 'authenticated',
  actor: {
    id: '00000000-0000-0000-0000-00000000dead',
    role: fall === 'kasse' ? 'CASHIER' : 'ADMIN',
    isOwner: fall !== 'kasse',
  },
});

// ── Mount ──────────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } },
});

function Blatt(): JSX.Element {
  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'var(--w14-parchment)',
        padding: 'var(--w14-abstand-24)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w14-abstand-16)',
      }}
    >
      <nav aria-label="Fälle" style={{ display: 'flex', gap: 'var(--w14-abstand-8)', flexWrap: 'wrap' }}>
        {FAELLE.map((f) => (
          <a
            key={f.id}
            href={`?fall=${f.id}`}
            aria-current={f.id === fall ? 'page' : undefined}
            style={{
              padding: 'var(--w14-abstand-10) var(--w14-abstand-14)',
              minHeight: 44,
              display: 'inline-flex',
              alignItems: 'center',
              border: '1px solid var(--w14-rule)',
              borderRadius: 'var(--w14-radius-fein)',
              textDecoration: 'none',
              color: 'var(--w14-ink)',
              background: f.id === fall ? 'var(--w14-parchment-3)' : 'var(--w14-parchment-1)',
              fontFamily: 'var(--w14-font-display)',
              fontSize: 'var(--w14-schrift-text)',
            }}
          >
            {f.label}
          </a>
        ))}
      </nav>
      <div style={{ maxWidth: 860 }}>
        <KartenleserStripeSection />
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root fehlt im Sichtprüfungs-Blatt');

createRoot(root).render(
  <StrictMode>
    <ApiClientProvider baseUrl={window.location.origin}>
      <QueryClientProvider client={queryClient}>
        <Blatt />
      </QueryClientProvider>
    </ApiClientProvider>
  </StrictMode>,
);

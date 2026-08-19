/**
 * Sichtprüfungs-Blatt „Die eine Geste" — Einstieg für vorschau-bezahlen.html,
 * NUR im Vite-Entwicklungslauf erreichbar (der Produktionsbau bündelt allein
 * index.html).
 *
 * ── WARUM ES DIESES BLATT GIBT ──────────────────────────────────────────────
 * Die echte Kasse steht hinter der lokalen Schnellcode-Sperre; die Sperre zu
 * lösen ist Basels Sache, nicht meine. Hier wird der ECHTE BezahlenDialog
 * (derselbe Quelltext wie im Verkauf) hinter einer protokolltreuen
 * fetch-Attrappe durch die ganze Geste gefahren: Trockenlauf → Start →
 * Warten → Buchen, mit den Server-Formen aus
 * apps/api-cloud/src/routes/stripe-terminal.ts (einschliesslich der
 * Fehler-Hülle { error: { code, message, requestId } }). Keine schmeichelnde
 * Attrappe: abgelehnte Karte, Zeitüberschreitung, Leser offline, Riegel im
 * Trockenlauf und die gescheiterte Erstattung sind eigene Fälle.
 *
 * Fälle über die Adresszeile (?fall=…):
 *   erfolg       — Karte kommt beim dritten Takt, Buchung, Siegel   [Vorgabe]
 *   weich        — weiche girocard-Ablehnung, DANN Erfolg (Hinweis sichtbar)
 *   abgelehnt    — Bank sagt NEIN (endgültig, Weg zurück offen)
 *   zeit         — keine Karte kam (Zeitüberschreitung)
 *   geraet       — am Leser abgebrochen
 *   leseroffline — der Start selbst meldet den Leser offline
 *   riegel       — der TROCKENLAUF fällt durch, keine Karte belastet
 *   keinleser    — Leser-Liste leer: die Zahlart erscheint GAR NICHT
 *   erstattfehl  — Storno gebucht, Erstattung scheitert erst (Wiederholen)
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

import '@norns/ui-kit/styles.css';

import { ToastContainer } from '@norns/ui-kit';

import { ApiClientProvider } from '../lib/api-context.js';
import { computeLineMath, sumHeader } from '../lib/cart-math.js';
import { BezahlenDialog } from '../screens/verkauf/BezahlenDialog.js';
import { type CartLine } from '../state/cart-store.js';
import { useSessionStore } from '../state/session-store.js';
import { useToastStore } from '../state/toast-store.js';

type Fall =
  | 'erfolg'
  | 'weich'
  | 'abgelehnt'
  | 'zeit'
  | 'geraet'
  | 'leseroffline'
  | 'riegel'
  | 'keinleser'
  | 'erstattfehl';

const FAELLE: ReadonlyArray<{ id: Fall; label: string }> = [
  { id: 'erfolg', label: 'Erfolg' },
  { id: 'weich', label: 'weiche Ablehnung' },
  { id: 'abgelehnt', label: 'Karte abgelehnt' },
  { id: 'zeit', label: 'Zeitüberschreitung' },
  { id: 'geraet', label: 'Abbruch am Gerät' },
  { id: 'leseroffline', label: 'Leser offline' },
  { id: 'riegel', label: 'Riegel im Trockenlauf' },
  { id: 'keinleser', label: 'kein Leser (unsichtbar)' },
  { id: 'erstattfehl', label: 'Erstattung scheitert' },
];

const params = new URLSearchParams(window.location.search);
const fall: Fall = (FAELLE.find((f) => f.id === params.get('fall'))?.id ?? 'erfolg') as Fall;

// ── Die protokolltreue fetch-Attrappe ──────────────────────────────────────

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

/** Der Zahlungs-Speicher der Attrappe: eine Zeile je Gesten-Kennung. */
interface AttrappenZahlung {
  zahlungId: string;
  providerIntentId: string;
  status: 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  fehlerbild: string | null;
  fehlerMeldung: string | null;
  weicheAblehnungen: number;
  takte: number;
  abgebrochen: boolean;
}
const zahlungen = new Map<string, AttrappenZahlung>();
let erstattungsVersuche = 0;

/** Der Webhook der Attrappe: je Stand-Abfrage rückt die Wahrheit einen Takt vor. */
function ruecke(z: AttrappenZahlung): void {
  z.takte += 1;
  if (z.status !== 'PROCESSING') return;
  if (z.abgebrochen) {
    z.status = 'CANCELED';
    return;
  }
  switch (fall) {
    case 'weich':
      if (z.takte === 2) z.weicheAblehnungen = 1;
      if (z.takte >= 5) z.status = 'SUCCEEDED';
      break;
    case 'abgelehnt':
      if (z.takte >= 2) {
        z.status = 'FAILED';
        z.fehlerbild = 'KARTE_ABGELEHNT';
      }
      break;
    case 'zeit':
      if (z.takte >= 3) {
        z.status = 'FAILED';
        z.fehlerbild = 'ZEITUEBERSCHREITUNG';
      }
      break;
    case 'geraet':
      if (z.takte >= 2) {
        z.status = 'FAILED';
        z.fehlerbild = 'ABBRUCH_AM_GERAET';
      }
      break;
    default:
      if (z.takte >= 3) z.status = 'SUCCEEDED';
  }
}

function alsView(z: AttrappenZahlung): unknown {
  return {
    zahlungId: z.zahlungId,
    providerIntentId: z.providerIntentId,
    status: z.status,
    fehlerbild: z.fehlerbild,
    fehlerMeldung: z.fehlerMeldung,
    gebuehrCents: 33,
  };
}

const echterFetch = window.fetch.bind(window);
window.fetch = async (eingabe: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url =
    typeof eingabe === 'string' ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe.url;
  const methode = (
    init?.method ?? (eingabe instanceof Request ? eingabe.method : 'GET')
  ).toUpperCase();
  const pfad = new URL(url, window.location.origin).pathname;

  // ── Leser-Liste: die Sichtbarkeits-Quelle der Zahlart ──
  if (pfad === '/api/stripe/terminal/readers' && methode === 'GET') {
    if (fall === 'keinleser') return json(200, { leser: [] });
    return json(200, {
      leser: [
        {
          id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb01',
          providerReaderId: 'tmr_vorschau_1',
          bezeichnung: 'Tresen links',
          geraetetyp: 'bbpos_wisepos_e',
          seriennummer: 'WSC-4711',
          status: 'online',
          registriertAm: '2026-07-20T09:00:00.000Z',
        },
      ],
    });
  }

  // ── Zahlung starten (idempotent auf der Gesten-Kennung) ──
  if (pfad === '/api/stripe/terminal/payments' && methode === 'POST') {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      idempotencyKey?: string;
      amountCents?: number;
      positionen?: unknown[];
    };
    const schluessel = body.idempotencyKey ?? 'ohne';
    const bestehend = zahlungen.get(schluessel);
    if (bestehend) return json(200, alsView(bestehend));
    const neu: AttrappenZahlung = {
      zahlungId: crypto.randomUUID(),
      providerIntentId: `pi_vorschau_${zahlungen.size + 1}`,
      status: fall === 'leseroffline' ? 'FAILED' : 'PROCESSING',
      fehlerbild: fall === 'leseroffline' ? 'LESER_OFFLINE' : null,
      fehlerMeldung: null,
      weicheAblehnungen: 0,
      takte: 0,
      abgebrochen: false,
    };
    zahlungen.set(schluessel, neu);
    return json(200, alsView(neu));
  }

  // ── Stand / Abbrechen / Erstatten ──
  const zahlungsTreffer = /^\/api\/stripe\/terminal\/payments\/([0-9a-f-]+)(\/cancel|\/refund)?$/.exec(
    pfad,
  );
  if (zahlungsTreffer) {
    const z = [...zahlungen.values()].find((k) => k.zahlungId === zahlungsTreffer[1]);
    if (!z) return fehler(404, 'NOT_FOUND', 'Diese Zahlung gibt es nicht.');
    if (zahlungsTreffer[2] === '/cancel' && methode === 'POST') {
      z.abgebrochen = true;
      return json(200, { status: z.status });
    }
    if (zahlungsTreffer[2] === '/refund' && methode === 'POST') {
      if (z.status !== 'SUCCEEDED') {
        return fehler(
          409,
          'CONFLICT',
          `Nur eine erfolgreiche Zahlung kann erstattet werden (Stand: ${z.status}).`,
        );
      }
      erstattungsVersuche += 1;
      if (fall === 'erstattfehl' && erstattungsVersuche === 1) {
        return fehler(502, 'EXTERNAL_SERVICE_FAILED', 'Stripe hat die Anfrage abgewiesen.');
      }
      return json(200, {
        refundId: 're_vorschau_1',
        refundStatus: 'pending',
        weg: 'SEPA_UEBERWEISUNG',
        hinweis:
          'girocard-Zahlung: die Erstattung geht per SEPA-Überweisung und erreicht das Konto des Kunden in ein bis zwei Werktagen.',
      });
    }
    if (methode === 'GET') {
      ruecke(z);
      return json(200, {
        zahlungId: z.zahlungId,
        providerIntentId: z.providerIntentId,
        status: z.status,
        fehlerbild: z.fehlerbild,
        fehlerMeldung: z.fehlerMeldung,
        weicheAblehnungen: z.weicheAblehnungen,
      });
    }
  }

  // ── Der fiskalische Weg ──
  if (pfad === '/api/transactions/finalize' && methode === 'POST') {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      dryRun?: boolean;
      totalEur?: string;
    };
    if (fall === 'riegel') {
      // Ein echter Riegel-Satz, wie ihn der Server (409) formuliert.
      return fehler(
        409,
        'CONFLICT',
        'Barzahlungen ab 2.000 € verlangen einen per Ausweis geprüften Käufer (§ 10 GwG).',
      );
    }
    if (body.dryRun === true) return json(200, { ok: true, dryRun: true });
    return json(200, {
      id: crypto.randomUUID(),
      receiptLocator: 'W14-2026-000123',
      finalizedAt: new Date().toISOString(),
      ledgerEventId: 4711,
      direction: 'VERKAUF',
      totalEur: body.totalEur ?? '328.50',
      storno: false,
    });
  }
  if (pfad === '/api/transactions/storno' && methode === 'POST') {
    return json(200, { id: crypto.randomUUID(), storno: true });
  }

  // ── Rahmen der Kasse ──
  if (pfad === '/api/shifts/current' && methode === 'GET') {
    return json(200, {
      id: '11111111-2222-3333-4444-555555555555',
      openedAt: new Date().toISOString(),
      openingFloatEur: '150.00',
      status: 'OPEN',
    });
  }
  if (pfad === '/api/shop-info' && methode === 'GET') {
    return json(200, {
      name: 'WAREHOUSE 14',
      tagline: 'Antiquitäten · Briefmarken · Münzen',
      addressLine1: 'Rosenstraße 40',
      addressLine2: '73614 Schorndorf',
      vatId: 'DE000000000',
      taxNumber: '',
      phone: '',
    });
  }
  if (pfad.startsWith('/api/')) {
    // Alles Übrige ehrlich ablehnen statt still ins Netz zu greifen — die
    // Vorschau spricht NUR mit der Attrappe.
    return fehler(404, 'NOT_FOUND', `Vorschau-Attrappe kennt ${pfad} nicht.`);
  }
  return echterFetch(eingabe as RequestInfo, init);
};

// ── Sitzung + Warenkorb der Vorschau ───────────────────────────────────────

useSessionStore.setState({
  status: 'authenticated',
  actor: {
    id: '00000000-0000-0000-0000-00000000dead',
    role: 'ADMIN',
    isOwner: true,
  },
});

const LINES: CartLine[] = [
  {
    productId: '00000000-0000-0000-0000-000000000101',
    reservationSessionId: '00000000-0000-0000-0000-000000000201',
    sku: 'W14-0101',
    name: 'Goldring 585, Granat',
    listPriceEur: '249.00',
    acquisitionCostEur: '90.00',
    taxTreatmentCode: 'MARGIN_25A',
    addedAt: new Date().toISOString(),
  },
  {
    productId: '00000000-0000-0000-0000-000000000102',
    reservationSessionId: '00000000-0000-0000-0000-000000000202',
    sku: 'W14-0102',
    name: 'Silberkette 925',
    listPriceEur: '79.50',
    acquisitionCostEur: '20.00',
    taxTreatmentCode: 'MARGIN_25A',
    addedAt: new Date().toISOString(),
  },
];

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 0, refetchOnWindowFocus: false } },
});

function Blatt(): JSX.Element {
  // 27.07.2026 (Tast-Auskünfte): der gesperrte Karten-Chip nennt seinen Grund
  // jetzt in der Meldungsblase. Ohne diesen Behälter wäre der Druck-Weg im
  // Sichtblatt unsichtbar und die Sichtprüfung eine Attrappe der Attrappe.
  const toasts = useToastStore((s) => s.toasts);
  const dismissToast = useToastStore((s) => s.dismiss);
  const perLineMath = useMemo(
    () =>
      LINES.map((line) =>
        computeLineMath({
          taxTreatmentCode: line.taxTreatmentCode,
          listPriceEur: line.listPriceEur,
          acquisitionCostEur: line.acquisitionCostEur,
          discountEur: line.discountEur,
        }),
      ),
    [],
  );
  const totals = useMemo(() => sumHeader(perLineMath), [perLineMath]);
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--w14-parchment)' }}>
      <nav
        aria-label="Fälle"
        style={{
          position: 'fixed',
          top: 8,
          left: 8,
          right: 8,
          // Aus der Ebenen-Leiter (oberflaechen-wache): die Fall-Leiste des
          // Sichtblatts muss über dem Bezahldialog-Fenster liegen.
          zIndex: 'var(--w14-z-hinweis)',
          display: 'flex',
          gap: 'var(--w14-abstand-8)',
          flexWrap: 'wrap',
        }}
      >
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
      <BezahlenDialog
        open
        lines={LINES}
        perLineMath={perLineMath}
        totals={totals}
        onClose={() => window.location.reload()}
      />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} onActivate={() => {}} />
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

/**
 * CustomerListPanel — left column of Kunden (Day 10).
 *
 * Status filter chips at top (Alle / KYC ✓ / VIP / Verdächtig / Gesperrt).
 * Result rows render as compact cards with KYC chip + cumulative Ankauf.
 * Clicking a row updates the URL search-param (via parent's `onSelect`) which
 * drives the detail panel.
 *
 * Suchfeld, Entprellung, Vertrauenszeichen und die Fehlertafel kommen aus dem
 * gemeinsamen Bauteil `KundenSucher.tsx`. Die ABFRAGE führt diese Fläche
 * weiterhin selbst, und das ist Absicht: sie liest über `useCachedQuery`, damit
 * sie beim Netzausfall den letzten guten Stand mit Altersstempel zeigen kann.
 * Für eine Auswahlmaske im Ankauf oder Verkauf wäre genau das falsch — dort
 * dürfen keine zwischengespeicherten Sperrvermerke über den heutigen Stand
 * entscheiden.
 *
 * Row component is memoised on `(row, selected)` — re-renders only when
 * the row itself changes or selection moves. Filter toggles do NOT
 * re-render unrelated rows.
 */

import { StaleBadge, useCachedQuery } from '../../offline/index.js';
import { type CSSProperties, memo, useMemo, useState } from 'react';

import { type CustomerListRow, customersApi } from '@norns/api-client';
import { Button, Zwischentitel, MoneyAmount, ParchmentCard } from '@norns/ui-kit';

import { kundensucheZustand } from '../../lib/kundensuche-zustand.js';
import { Eintreffen, SkelettBalken } from '../_shared/SanfteMomente.js';
import { CustomerCreateDialog } from './CustomerCreateDialog.js';
import {
  AnlegenGesperrtHinweis,
  KundenSuchfeld,
  SucheNichtErreichbar,
  VertrauensZeichen,
  kundenSuchAbfrage,
  kundenSucherAnsicht,
  useEntprelltesSuchfeld,
} from './KundenSucher.js';
import { useApiClient } from '../../lib/api-context.js';

type FilterTab = 'ALL' | 'KYC_VERIFIED' | 'VIP' | 'WATCHLIST' | 'BLOCKED';

const FILTER_CHIPS: Array<{ value: FilterTab; label: string }> = [
  { value: 'ALL', label: 'Alle' },
  { value: 'KYC_VERIFIED', label: 'KYC ✓' },
  { value: 'VIP', label: 'VIP' },
  { value: 'WATCHLIST', label: 'Verdächtig' },
  { value: 'BLOCKED', label: 'Gesperrt' },
];

/** Compact `TT.MM.JJ` for the per-row last-activity line. */
function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(new Date(iso));
}

export interface CustomerListPanelProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function CustomerListPanel({ selectedId, onSelect }: CustomerListPanelProps): JSX.Element {
  const api = useApiClient();
  const feld = useEntprelltesSuchfeld();
  const [filter, setFilter] = useState<FilterTab>('ALL');
  const [createOpen, setCreateOpen] = useState<boolean>(false);

  const queryArgs = useMemo(
    () =>
      // Gelöschte Konten gehören in die Kundenliste — durchgestrichen, statt
      // spurlos zu fehlen. Der Käuferpicker im Verkauf setzt die Flagge NICHT
      // und bekommt sie deshalb weiterhin nicht zur Auswahl angeboten.
      kundenSuchAbfrage(
        {
          limit: 30,
          includeErased: true,
          // Gesperrte und beobachtete Akten holt nur der Inhaber ausdrücklich
          // hervor, damit er handeln kann. Die übrigen Reiter lassen die
          // Server-Vorgabe stehen — das war schon so und bleibt so.
          ...(filter === 'BLOCKED' || filter === 'WATCHLIST' ? { excludeBlocked: false } : {}),
          // Der Server kennt keinen Filter auf die Vertrauensstufe; VIP wird
          // unten in der Fläche nachgefiltert.
          ...(filter === 'KYC_VERIFIED' || filter === 'VIP' ? { kycVerifiedOnly: true } : {}),
        },
        feld.suchtext,
      ),
    [feld.suchtext, filter],
  );

  // Offline-resilient read: seeds from the last-good snapshot on remount so the
  // Kundenakte paints real names instantly when the LAN drops, and marks the
  // data with a StaleBadge while it's the cached seed (Phase 2.5).
  const q = useCachedQuery({
    queryKey: ['customers', 'list', queryArgs],
    queryFn: () => customersApi.list(api, queryArgs),
    cacheKey: `customers:list:${JSON.stringify(queryArgs)}`,
    staleTime: 30_000,
    // Sanftheit der Verbindung: Filter- und Suchwechsel halten die alten
    // Zeilen fest, bis die neuen eintreffen — kein Blitzen auf Leere. Das
    // „sucht…" in der Kopfzeile sagt derweil, dass gearbeitet wird.
    keepPreviousData: true,
  });

  // Client-side post-filter for the three trust-based tabs (the backend's
  // /api/customers/q exposes excludeBlocked but not a trust filter directly).
  const items = useMemo(() => {
    const raw = q.data?.items ?? [];
    switch (filter) {
      case 'VIP':
        return raw.filter((c) => c.trustLevel === 'VIP');
      case 'WATCHLIST':
        return raw.filter((c) => c.trustLevel === 'SUSPICIOUS');
      case 'BLOCKED':
        return raw.filter((c) => c.trustLevel === 'BANNED' || c.sanctionsMatch);
      default:
        return raw;
    }
  }, [q.data, filter]);

  // FUND, der hier zum ersten Mal auffiel: die Kundenakte hatte den
  // Fehlerzweig zwar (ein flacher roter Streifen ohne Wiederholung), aber der
  // Knopf „+ Neuer Kunde" darüber blieb scharf. Genau das ist der Fall, den
  // `kundensuche-zustand.ts` verhindern soll: die Kasse weiss nichts über die
  // Kundendatei und lädt trotzdem zum Anlegen ein. Eine zweite Akte hebt
  // Sperrvermerk, Sanktionstreffer und PEP-Fahne der bestehenden auf.
  //
  // Der Sonderfall dieser Fläche: sie fragt AUCH mit leerem Suchfeld, sie
  // blättert die ganze Datei. `anlegenErlaubt` allein gäbe hier grünes Licht,
  // weil bei leerem Feld nichts gefragt wurde — deshalb prüft
  // `kundenSucherAnsicht` zusätzlich den Fehler selbst.
  const ansicht = kundenSucherAnsicht({
    zustand: kundensucheZustand({
      suchtext: feld.suchtext,
      isFetching: q.isFetching,
      isError: q.isError,
      trefferzahl: items.length,
    }),
    istFehler: q.isError,
    anlegenMoeglich: true,
  });

  return (
    <section
      aria-label="Kundenliste"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--space-4)',
        gap: 'var(--space-3)',
        borderRight: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-1)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-kopf)',
          }}
        >
          Kundenakte
        </h2>
        <span
          className="w14-smallcaps"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            color: 'var(--w14-ink-faded)',
            fontSize: 'var(--w14-schrift-zeile)',
            letterSpacing: '0.08em',
          }}
        >
          {/* Honest last-good marker: only while showing the cached seed offline. */}
          {q.fromCache && <StaleBadge cachedAt={q.cachedAt} stale={q.isStale} />}
          {q.isFetching
            ? 'sucht…'
            : filter === 'ALL' && feld.suchtext.length === 0 && q.data?.total != null
              ? `${q.data.total} Kunden`
              : `${items.length}`}
        </span>
      </header>

      {/* Die Kundenakte meldet „sucht…" oben in der Kopfzeile neben der Anzahl.
          Ein zweites Mal im Feld wäre dieselbe Auskunft doppelt, darum hier
          `laeuft={false}`. */}
      <KundenSuchfeld
        suche={feld}
        laeuft={false}
        // Gemessen (27.07.2026): die lange Fassung brauchte 432 Punkte, das
        // Feld traegt 326, der Schnitt fiel mitten in "E-Mail". Ein
        // Platzhalter, der selbst abgeschnitten ist, wirbt schlecht fuer
        // eine Suche. "Nummer" deckt Kunden- wie Bestellnummer.
        platzhalter="Name · Nummer · E-Mail · Telefon"
      />

      {ansicht.anlegenSichtbar ? (
        <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
          + Neuer Kunde
        </Button>
      ) : (
        <AnlegenGesperrtHinweis />
      )}

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {FILTER_CHIPS.map((chip) => (
          <FilterChip
            key={chip.value}
            label={chip.label}
            active={filter === chip.value}
            onClick={() => setFilter(chip.value)}
          />
        ))}
      </div>

      {/* Results */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}
      >
        {ansicht.tafel === 'fehler' ? (
          // Vorher stand hier ein flacher roter Streifen ohne Ausweg. Jetzt
          // dieselbe ehrliche Tafel wie in Ankauf, Verkauf und Bewertung, mit
          // dem Knopf „Erneut versuchen".
          <SucheNichtErreichbar
            rolle="Kunde"
            onErneutVersuchen={q.refetch}
            laeuft={q.isFetching}
          />
        ) : q.isLoading && items.length === 0 ? (
          // Erstes Laden ohne Vorrat aus dem Lesecache: ruhige Skelett-Karten
          // in der Geometrie der echten Kundenzeile, damit beim Eintreffen
          // nichts springt. „Keine Treffer" wäre hier eine Lüge.
          <KundenSkelett />
        ) : items.length === 0 ? (
          <EmptyHint hasQuery={feld.suchtext.length > 0} />
        ) : (
          <Eintreffen
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
          >
            {items.map((row) => (
              <CustomerRow
                key={row.id}
                row={row}
                selected={row.id === selectedId}
                onClick={() => onSelect(row.id)}
              />
            ))}
          </Eintreffen>
        )}
      </div>

      {selectedId && (
        <Button variant="ghost" size="md" onClick={() => onSelect(null)}>
          Auswahl aufheben
        </Button>
      )}

      <CustomerCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => onSelect(id)}
      />
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Row — memoised
// ────────────────────────────────────────────────────────────────────────

interface CustomerRowProps {
  row: CustomerListRow;
  selected: boolean;
  onClick: () => void;
}

const CustomerRow = memo(
  function CustomerRow({ row, selected, onClick }: CustomerRowProps): JSX.Element {
    const blocked = row.sanctionsMatch || row.trustLevel === 'BANNED';
    const verified = row.kycVerifiedAt !== null;
    // Ein gelöschtes Konto bleibt in der Liste stehen, durchgestrichen. Die
    // Löschung ist eine Anonymisierung: Kundennummer und Umsätze müssen
    // erhalten bleiben (§147 AO). Wer gelöscht hat, gehört sichtbar dazu —
    // hat der Mensch selbst gekündigt, war das seine Entscheidung.
    const erased = row.deletedAt !== null;
    const erasedNote =
      row.erasureInitiatedBy === 'CUSTOMER'
        ? 'Vom Kunden selbst gelöscht'
        : row.erasureInitiatedBy === 'STAFF'
          ? 'Von uns gelöscht'
          : 'Gelöscht';

    const cardStyle: CSSProperties = {
      cursor: 'pointer',
      border: selected
        ? '1px solid var(--w14-gold)'
        : blocked
          ? '1px solid var(--w14-wax-red)'
          : '1px solid transparent',
      background: selected ? 'var(--w14-parchment-3)' : 'var(--w14-parchment-2)',
      opacity: erased ? 0.6 : blocked ? 0.7 : 1,
      transition:
        'background-color var(--w14-dur-short) var(--w14-ease-curator), border-color var(--w14-dur-short) var(--w14-ease-curator)',
    };

    return (
      <ParchmentCard padding="sm" onClick={onClick} style={cardStyle}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 'var(--space-3)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--w14-font-display)',
                fontWeight: 500,
                fontSize: 'var(--w14-schrift-grund)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                ...(erased
                  ? {
                      textDecoration: 'line-through',
                      color: 'var(--w14-ink-faded)',
                    }
                  : null),
              }}
            >
              {/* Beim Löschen setzt der Server einen verschlüsselten Platzhalter
                  als Namen. Der wird NICHT roh gezeigt — die Zeile sagt in
                  Worten, was geschehen ist. */}
              {erased ? erasedNote : row.fullName}
            </div>
            <div
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {row.customerNumber}
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 'var(--space-1)',
            }}
          >
            {erased ? (
              <span
                style={{
                  fontFamily: 'var(--w14-font-inter)',
                  fontSize: 'var(--w14-schrift-zeile)',
                  color: 'var(--w14-ink-faded)',
                  border: '1px solid var(--w14-rule)',
                  // ⚠️ 01.08.2026: hier stand `var(--radius-sm)`. Diese Marke
                  // gibt es im Haus nicht, und ohne Rückfall verwirft der
                  // Browser die GANZE Deklaration — die Plakette „Konto
                  // gelöscht" stand als einzige mit scharfen Ecken in einer
                  // Liste voller runder. Der Marken-Wächter sah es nicht: er
                  // suchte nur nach Namen mit dem Vorsatz `--w14-`.
                  borderRadius: 'var(--w14-radius-button)',
                  padding: 'var(--w14-abstand-2) var(--w14-abstand-6)',
                }}
              >
                Konto gelöscht
              </span>
            ) : (
              <VertrauensZeichen
                kycGeprueft={verified}
                stufe={row.trustLevel}
                sanktion={row.sanctionsMatch}
                pep={row.pepMatch}
              />
            )}
            <span
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-faded)',
              }}
            >
              Ank. <MoneyAmount valueEur={row.cumulativeAnkaufEur} />
            </span>
            <span
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: 'var(--w14-schrift-kuerzel)',
                color: 'var(--w14-ink-faded)',
              }}
              title="Letzter Vorgang (Verkauf oder Ankauf)"
            >
              {/* 27.07.2026: „zuletzt 12.05." sagte nicht, was zuletzt WAR —
                  die Auflösung stand nur im title=. Jetzt trägt die Zeile
                  selbst das Wort. */}
              {row.lastOrderAt ? `letzter Vorgang ${formatDay(row.lastOrderAt)}` : 'kein Vorgang'}
            </span>
          </div>
        </div>
      </ParchmentCard>
    );
  },
  (prev, next) => prev.selected === next.selected && prev.row === next.row,
);

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w14-smallcaps"
      style={{
        background: active ? 'var(--w14-parchment-3)' : 'transparent',
        border: `1px solid ${active ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
        color: active ? 'var(--w14-ink-aged)' : 'var(--w14-ink-faded)',
        fontFamily: 'var(--w14-font-display)',
        fontSize: 'var(--w14-schrift-zeile)',
        letterSpacing: '0.08em',
        padding: 'var(--space-1) var(--space-3)',
        borderRadius: 'var(--w14-radius-button)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

/**
 * Skelett-Karten in der Geometrie der echten Kundenzeile: links Name über
 * Kundennummer, rechts Zeichen über Ankaufsumme. Deckkraft nimmt nach unten
 * ab (das Vorbild sind die Skelettzeilen im Lager).
 */
function KundenSkelett(): JSX.Element {
  return (
    <div
      aria-hidden="true"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
    >
      {Array.from({ length: 6 }, (_, i) => (
        <ParchmentCard
          // biome-ignore lint/suspicious/noArrayIndexKey: statische Platzhalterliste, wird nie umsortiert
          key={i}
          padding="sm"
          style={{ opacity: 1 - i * 0.12 }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 'var(--space-3)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-6)', flex: 1 }}>
              <SkelettBalken breite="60%" hoehe={13} />
              <SkelettBalken breite={72} hoehe={10} />
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 'var(--w14-abstand-6)',
              }}
            >
              <SkelettBalken breite={56} hoehe={10} />
              <SkelettBalken breite={84} hoehe={10} />
            </div>
          </div>
        </ParchmentCard>
      ))}
    </div>
  );
}

function EmptyHint({ hasQuery }: { hasQuery: boolean }): JSX.Element {
  return (
    <ParchmentCard padding="md" style={{ textAlign: 'center' }}>
      <Zwischentitel />
      <p
        style={{
          margin: 'var(--space-2) 0 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: 'var(--w14-schrift-betont)',
        }}
      >
        {hasQuery
          ? 'Keine Treffer für diese Suche.'
          : 'Geben Sie Name oder Kontakt ein,\num einen Kunden zu finden.'}
      </p>
    </ParchmentCard>
  );
}

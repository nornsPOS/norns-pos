/**
 * Spotlight — the Cmd+K palette. The only chord shortcut Warehouse14 ships.
 *
 * Two kinds of result, in this order:
 *   • Entities — customers and products matching the query, fetched live from
 *     the shared api-client and deep-linked to their surface (`/kunden?id=…`,
 *     `/lager?produkt=…`). This is the one box that spans domains from anywhere.
 *   • Surfaces — the Tier-1 Karteikasten and Tier-2 screens, fuzzy-matched on
 *     label / description / path / aliases, plus the last-visited list when the
 *     input is empty.
 *
 * Entity search covers customers + products because those are the domains with
 * a real detail surface to land on. Transactions have no standalone detail
 * route (recent sales live inside a shift's Kassenbuch), so a transaction hit
 * would deep-link nowhere useful; it is deliberately left out rather than
 * offered as a dead end.
 *
 * ↑ / ↓ + Enter navigate; Esc dismisses; hover syncs with keyboard focus.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { customersApi, productsApi } from '@norns/api-client';
import {
  Fensterboden,
  Zwischentitel,
  Gem,
  Icon,
  type LucideIcon,
  MagnifierIcon,
  ParchmentCard,
  Users,
} from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { formatEur } from '../../lib/decimal.js';
import { useRecents } from '../../state/recents-store.js';
import { useSessionStore } from '../../state/session-store.js';
import {
  PRIMARY_SURFACES,
  SECONDARY_SURFACES,
  type SurfaceDescriptor,
  findSurfaceByPath,
  isSurfaceVisible,
  visibleSurfaces,
} from './surface-registry.js';

export interface SpotlightProps {
  open: boolean;
  onClose: () => void;
}

type SpotGroup = 'zuletzt' | 'kunden' | 'artikel' | 'karteikasten' | 'weitere';

/** One normalized palette row — a surface or a live entity, rendered the same. */
interface SpotItem {
  key: string;
  group: SpotGroup;
  /** Path (with query) to navigate to on activation. */
  navigate: string;
  /**
   * Seit dem 28.07.2026 spricht die Palette dieselbe Zeichensprache wie die
   * Karteikasten-Schiene: jede Zeile traegt das Lucide-Zeichen ihrer Flaeche
   * bzw. ihrer Gattung (Kunde, Artikel). Der alte Text-Glyph (Ziffer, ◆, ☞)
   * fiel — die Ziffer wandert als „Taste N" in die rechte Spalte, und ☞
   * renderte je nach Windows-Schrift uneinheitlich (Dekret „Symbole statt
   * Emoji", 26.07.2026); ein SVG-Zeichen ist auf jeder Plattform dasselbe.
   */
  icon: LucideIcon;
  iconGold: boolean;
  primary: string;
  secondary: string;
  trailing: string;
}

function surfaceMatches(s: SurfaceDescriptor, q: string): boolean {
  if (q.length === 0) return true;
  if (s.label.toLowerCase().includes(q)) return true;
  if (s.description.toLowerCase().includes(q)) return true;
  if (s.path.toLowerCase().includes(q)) return true;
  if (s.searchAliases?.some((a) => a.toLowerCase().includes(q))) return true;
  if (s.digit !== undefined && String(s.digit) === q) return true;
  return false;
}

function surfaceToItem(s: SurfaceDescriptor, group: SpotGroup): SpotItem {
  return {
    key: `surface-${s.path}`,
    group,
    navigate: s.path,
    icon: s.icon,
    iconGold: s.digit !== undefined,
    primary: s.label,
    secondary: s.description,
    // „Taste 2" statt „/verkauf": der rohe Pfad ist Entwicklerjargon und
    // sagt der Bedienung nichts — die Ziffer dagegen IST bedienbar.
    trailing: s.digit !== undefined ? `Taste ${s.digit}` : '',
  };
}

export function Spotlight({ open, onClose }: SpotlightProps): JSX.Element | null {
  const navigate = useNavigate();
  const api = useApiClient();
  const recents = useRecents((s) => s.paths);
  const isOwner = useSessionStore((s) => s.actor?.isOwner ?? false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState<string>('');
  const [debounced, setDebounced] = useState<string>('');
  /**
   * Die MARKIERTE ZEILE, an ihrer Kennung festgemacht — nicht an ihrer Nummer.
   *
   * ── DER FUND (25.07.2026) ────────────────────────────────────────────────
   * Die Treffer kommen in drei Wellen: Flächen sofort, Kunden und Artikel nach
   * 180 ms Entprellung und einem Netzweg — und die beiden Letzteren werden
   * OBEN eingefügt. Wer „kur" tippte, sah sofort die Fläche „Kurse" auf Platz
   * eins und drückte Enter. Traf in derselben Sekunde ein Artikel
   * „Kurbelgehäuse-Uhr" ein, sass der jetzt auf Platz eins — und Enter öffnete
   * ihn statt des Handelsterminals.
   *
   * Eine Nummer beschreibt eine Stelle in einer Liste, die sich unter dem
   * Finger bewegt. Eine Kennung beschreibt die Zeile selbst. Deshalb wandert
   * die Markierung jetzt MIT ihrer Zeile nach unten, wenn oben etwas
   * dazukommt.
   */
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Reset state every time the modal opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setDebounced('');
      setActiveKey(null);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounce the query that reaches the network (surface filtering stays instant).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(t);
  }, [query]);

  const entityEnabled = open && debounced.length >= 2;

  const customersQ = useQuery({
    queryKey: ['spotlight', 'customers', debounced],
    queryFn: () => customersApi.list(api, { q: debounced, limit: 5 }),
    enabled: entityEnabled,
    staleTime: 15_000,
  });

  const productsQ = useQuery({
    queryKey: ['spotlight', 'products', debounced],
    queryFn: () => productsApi.list(api, { q: debounced, limit: 5 }),
    enabled: entityEnabled,
    staleTime: 15_000,
  });

  const items: SpotItem[] = useMemo(() => {
    const q = query.toLowerCase().trim();
    const acc: SpotItem[] = [];

    // Live entities first — they are the answer to a typed name/SKU.
    for (const c of customersQ.data?.items ?? []) {
      acc.push({
        key: `kunde-${c.id}`,
        group: 'kunden',
        navigate: `/kunden?id=${encodeURIComponent(c.id)}`,
        icon: Users,
        iconGold: true,
        primary: c.fullName,
        secondary: `Kunde · ${c.customerNumber}`,
        trailing: 'Kundenakte',
      });
    }
    /*
     * ⚠️ 13.08.2026 — DIE SUCHE ZEIGT FUENF UND SAGT NICHT, WIEVIELE ES GIBT.
     *
     * Beide Abfragen holen `limit: 5`. Wer nach „Ring" sucht und dreiundzwanzig
     * Ringe hat, sah fuenf — und keinen Hinweis darauf, dass es mehr sind.
     * Aus „nicht unter den ersten fuenf" wurde am Tresen „gibt es nicht".
     *
     * Der Server liefert `total` mit. Ist es groesser als die Zeilenzahl,
     * steht das jetzt als eigene Zeile in der Gruppe und fuehrt auf die volle
     * Liste. Bekannte Hausklasse: eine Liste mit fester Obergrenze OHNE
     * Gesamtzahl kann „steht nicht auf dieser Seite" nicht von „gibt es nicht"
     * unterscheiden.
     */
    if ((customersQ.data?.total ?? 0) > (customersQ.data?.items.length ?? 0)) {
      acc.push({
        key: 'kunden-mehr',
        group: 'kunden',
        navigate: `/kunden?q=${encodeURIComponent(debounced)}`,
        icon: Users,
        iconGold: false,
        primary: `Alle ${customersQ.data?.total} Kunden zu „${debounced}" zeigen`,
        secondary: `Hier stehen nur die ersten ${customersQ.data?.items.length}.`,
        trailing: 'Kundenakte',
      });
    }
    for (const p of productsQ.data?.items ?? []) {
      acc.push({
        key: `artikel-${p.id}`,
        group: 'artikel',
        navigate: `/lager?produkt=${encodeURIComponent(p.id)}`,
        icon: Gem,
        iconGold: true,
        primary: p.name,
        secondary: `${p.sku} · ${formatEur(p.listPriceEur)} €`,
        trailing: 'Artikel',
      });
    }
    if ((productsQ.data?.total ?? 0) > (productsQ.data?.items.length ?? 0)) {
      acc.push({
        key: 'artikel-mehr',
        group: 'artikel',
        navigate: `/lager?q=${encodeURIComponent(debounced)}`,
        icon: Gem,
        iconGold: false,
        primary: `Alle ${productsQ.data?.total} Stücke zu „${debounced}" zeigen`,
        secondary: `Hier stehen nur die ersten ${productsQ.data?.items.length}.`,
        trailing: 'Lager',
      });
    }

    // Zuletzt — only when the input is empty (otherwise it is noise).
    if (q.length === 0) {
      for (const path of recents) {
        const s = findSurfaceByPath(path);
        if (s && isSurfaceVisible(s, isOwner)) acc.push(surfaceToItem(s, 'zuletzt'));
      }
    }
    for (const s of visibleSurfaces(PRIMARY_SURFACES, isOwner)) {
      if (surfaceMatches(s, q)) acc.push(surfaceToItem(s, 'karteikasten'));
    }
    for (const s of visibleSurfaces(SECONDARY_SURFACES, isOwner)) {
      if (surfaceMatches(s, q)) acc.push(surfaceToItem(s, 'weitere'));
    }
    return acc;
  }, [query, recents, customersQ.data, productsQ.data, isOwner]);

  const activeIdx = items.findIndex((i) => i.key === activeKey);

  // Verschwindet die markierte Zeile (neue Suche, Treffer weg), faellt die
  // Markierung auf die erste — und heftet sich SOFORT wieder an eine Kennung,
  // damit die naechste eintreffende Welle sie nicht doch noch verschiebt.
  useEffect(() => {
    if (items.length === 0) {
      if (activeKey !== null) setActiveKey(null);
      return;
    }
    if (!items.some((i) => i.key === activeKey)) setActiveKey(items[0]?.key ?? null);
  }, [items, activeKey]);

  const activate = (item: SpotItem | undefined): void => {
    if (!item) return;
    navigate(item.navigate);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose();
        return;
      }
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        const naechste = items[Math.min(items.length - 1, activeIdx + 1)];
        if (naechste) setActiveKey(naechste.key);
        return;
      }
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        const vorige = items[Math.max(0, activeIdx - 1)];
        if (vorige) setActiveKey(vorige.key);
        return;
      }
      if (ev.key === 'Tab') {
        // Ein Fenster, das sich modal NENNT, muss die Tastatur auch halten.
        // Ohne diesen Riegel wanderte der Fokus in die Karteikasten-Schiene
        // HINTER dem Vorhang, wo man ihn nicht sieht und trotzdem ausloest.
        ev.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        activate(items[activeIdx]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Depend on items + activeIdx so Enter sees fresh state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items, activeIdx, onClose]);

  if (!open) return null;

  const entitiesLoading = entityEnabled && (customersQ.isFetching || productsQ.isFetching);

  return (
    // 19.08.2026: auf den Fensterboden portalt wie jedes Fenster — ein
    // Stapelkontext im Flaechenbaum (isolation der Pergamentkarten) darf die
    // Suche nie unter eine spaetere Karte legen.
    <Fensterboden>
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'var(--w14-z-schleier)',
        display: 'grid',
        placeItems: 'start center',
        paddingTop: '12vh', // abstandsleiter-frei: Palettenposition relativ zur Fensterhoehe, kein Flaechenabstand
      }}
    >
      <button
        type="button"
        aria-label="Suche schließen"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          border: 'none',
          padding: 0,
          margin: 0,
          cursor: 'default',
          backgroundColor: 'var(--w14-overlay)',
        }}
      />
      <ParchmentCard
        role="dialog"
        aria-modal="true"
        aria-label="Suchen"
        padding="none"
        onClick={(ev) => ev.stopPropagation()}
        style={{
          position: 'relative',
          width: 'min(560px, 92vw)',
          boxShadow: 'var(--w14-shadow-modal)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--w14-abstand-12)',
            padding: 'var(--w14-abstand-16) var(--w14-abstand-16)',
            borderBottom: '1px solid var(--w14-rule)',
          }}
        >
          <MagnifierIcon size={22} tone="ink" />
          <input
            ref={inputRef}
            value={query}
            onChange={(ev) => {
              setQuery(ev.target.value);
              // Eine neue Suche beginnt oben; die Wirkung setzt die Markierung
              // gleich wieder auf eine Kennung.
              setActiveKey(null);
            }}
            placeholder="Suchen: Kunde, Artikel oder Bereich…"
            spellCheck={false}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-grund)',
              color: 'var(--w14-ink)',
              borderBottom: '1px solid transparent',
              padding: 'var(--w14-abstand-4) 0',
              transition: 'border-color var(--w14-dur-exit) var(--w14-ease-curator)',
            }}
            onFocus={(ev) => {
              (ev.currentTarget as HTMLInputElement).style.borderBottom =
                '1px solid var(--w14-gold)';
            }}
            onBlur={(ev) => {
              (ev.currentTarget as HTMLInputElement).style.borderBottom = '1px solid transparent';
            }}
          />
          <span
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-zeile)',
              color: entitiesLoading ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
              border: '1px solid var(--w14-rule)',
              borderRadius: 'var(--w14-radius-fein)',
              padding: 'var(--w14-abstand-2) var(--w14-abstand-6)',
            }}
          >
            {entitiesLoading ? 'sucht…' : 'Esc'}
          </span>
        </div>

        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {items.length === 0 ? (
            <EmptyState />
          ) : (
            <ResultList
              items={items}
              activeIdx={activeIdx}
              onHover={(i) => setActiveKey(items[i]?.key ?? null)}
              onActivate={activate}
            />
          )}
        </div>
      </ParchmentCard>
    </div>
    </Fensterboden>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div style={{ padding: 'var(--w14-abstand-32) var(--w14-abstand-24)', textAlign: 'center' }}>
      <p
        style={{
          margin: 0,
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: 'var(--w14-schrift-grund)',
        }}
      >
        Was lange ruht, spricht leise.
      </p>
      <p style={{ margin: '8px 0 0', color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)' }}>
        Nichts gefunden.
      </p>
    </div>
  );
}

function ResultList({
  items,
  activeIdx,
  onHover,
  onActivate,
}: {
  items: SpotItem[];
  activeIdx: number;
  onHover: (i: number) => void;
  onActivate: (item: SpotItem) => void;
}): JSX.Element {
  const groupBoundaries: number[] = [];
  let lastGroup: string | null = null;
  items.forEach((item, i) => {
    if (item.group !== lastGroup) {
      groupBoundaries.push(i);
      lastGroup = item.group;
    }
  });

  return (
    <ul style={{ listStyle: 'none', padding: 'var(--w14-abstand-8) 0', margin: 0 }}>
      {items.map((item, i) => {
        const startsGroup = groupBoundaries.includes(i);
        return (
          <li key={item.key} style={{ listStyle: 'none' }}>
            {startsGroup && (
              <div style={{ padding: 'var(--w14-abstand-8) var(--w14-abstand-16) var(--w14-abstand-2)' }}>
                <GroupLabel group={item.group} />
              </div>
            )}
            <ResultRowItem
              item={item}
              active={i === activeIdx}
              onMouseEnter={() => onHover(i)}
              onClick={() => onActivate(item)}
            />
          </li>
        );
      })}
    </ul>
  );
}

const GROUP_LABELS: Readonly<Record<SpotGroup, string>> = {
  zuletzt: 'Zuletzt',
  kunden: 'Kunden',
  artikel: 'Artikel',
  karteikasten: 'Karteikasten',
  weitere: 'Weitere',
};

function GroupLabel({ group }: { group: SpotGroup }): JSX.Element {
  return (
    <div style={{ padding: 'var(--w14-abstand-6) 0' }}>
      <Zwischentitel label={GROUP_LABELS[group]} />
    </div>
  );
}

function ResultRowItem({
  item,
  active,
  onMouseEnter,
  onClick,
}: {
  item: SpotItem;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        border: 'none',
        background: active ? 'var(--w14-parchment-3)' : 'transparent',
        cursor: 'pointer',
        padding: 'var(--w14-abstand-10) var(--w14-abstand-16)',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 'var(--w14-abstand-14)',
        alignItems: 'baseline',
        color: 'var(--w14-ink)',
        transition: 'background-color var(--w14-dur-press) var(--w14-ease-curator)',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignSelf: 'center',
          color: item.iconGold ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
          minWidth: 16,
        }}
      >
        <Icon icon={item.icon} size={16} />
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-2)', minWidth: 0 }}>
        <span
          style={{
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-betont)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {item.primary}
        </span>
        <span style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)' }}>{item.secondary}</span>
      </div>
      <span
        style={{
          fontFamily: 'var(--w14-font-mono)',
          fontSize: 'var(--w14-schrift-zeile)',
          color: 'var(--w14-ink-faded)',
        }}
      >
        {item.trailing}
      </span>
    </button>
  );
}

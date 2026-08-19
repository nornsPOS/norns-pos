/**
 * Dokumente — Tier-2 document archive (Phase 2 Day 8).
 *
 * Card grid of documents (file icon + title + category badge + linked
 * entity short id + actions). Top: filter by category + entity-table.
 *
 * "Hochladen" opens a dialog that asks for:
 *   • file (drag-drop or picker)
 *   • category (DOCUMENT_CATEGORY)
 *   • linked entity (one of customer / product / transaction / appraisal)
 *
 * Upload flow:
 *   1. `photosApi.requestUploadUrl({ contentType, contentLength, intent: 'orphan' })`
 *   2. PUT the bytes to the returned signed URL
 *   3. POST metadata to `/api/documents` (returned by `documentsApi.create`)
 *
 * ── OBEN STEHT DER NACHDRUCK (13.08.2026) ──────────────────────────────────
 *
 * Diese Fläche heisst in der Suchleiste „Belege, Ausweise, Expertisen" und ist
 * damit der Ort, an dem ein Mensch einen Beleg SUCHT. Bis heute fand er hier
 * nur hochgeladene Dateien; die gedruckten Belege der Kasse lebten in einem
 * Speicher, der genau EINEN hielt und ihn beim nächsten Verkauf verwarf.
 * `BelegeDieserKasse` schliesst das: je Zeile ein Weg zum Nachdruck.
 */

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  type CreateDocumentBody,
  DOCUMENT_CATEGORY_LABELS,
  type DocumentCategory,
  type DocumentRow,
  type ListDocumentsQuery,
  type PhotoUploadIntent,
  type PhotoUploadUrlBody,
  documentsApi,
  photosApi,
} from '@norns/api-client';
import { Fensterboden, Button, Zwischentitel, FileText, Icon, Image, ParchmentCard } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError, shortHash } from '@norns/i18n-de';

import { BelegeDieserKasse } from './BelegeDieserKasse.js';
import { eingereihtHinweis, istSicherEingereiht, ohneApiFehlerSatz } from '../../lib/eingereiht.js';

const CATEGORY_ORDER: readonly DocumentCategory[] = [
  'AUSWEIS',
  'ANKAUFBELEG',
  'RECHNUNG',
  'EXPERTISE',
  'ZERTIFIKAT',
  'VERSANDBELEG',
];

/** Eine Bildschirmseite Dokumente. Der Server paginiert, also paginieren wir. */
const PAGE_SIZE = 48;

type EntityLinkKind = 'customer' | 'product' | 'transaction' | 'appraisal';

export function Dokumente(): JSX.Element {
  const api = useApiClient();
  const [category, setCategory] = useState<DocumentCategory | 'ALL'>('ALL');
  const [linkKind, setLinkKind] = useState<EntityLinkKind | ''>('');
  const [linkId, setLinkId] = useState<string>('');
  const [includeArchived, setIncludeArchived] = useState<boolean>(false);
  const [offset, setOffset] = useState<number>(0);
  const [uploadOpen, setUploadOpen] = useState<boolean>(false);

  const query: ListDocumentsQuery = {
    limit: PAGE_SIZE,
    offset,
    ...(includeArchived ? { includeArchived: true } : {}),
    ...(category !== 'ALL' ? { category } : {}),
    ...(linkKind === 'customer' && linkId.trim() ? { customerId: linkId.trim() } : {}),
    ...(linkKind === 'product' && linkId.trim() ? { productId: linkId.trim() } : {}),
    ...(linkKind === 'transaction' && linkId.trim() ? { transactionId: linkId.trim() } : {}),
    ...(linkKind === 'appraisal' && linkId.trim() ? { appraisalId: linkId.trim() } : {}),
  };

  const listQ = useQuery({
    queryKey: ['documents', 'list', query],
    queryFn: () => documentsApi.list(api, query),
    staleTime: 15_000,
  });

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;
  const hasMore = listQ.data?.hasMore ?? false;

  // Echte Pro-Kategorie-Zählungen: je Kategorie EIN winziger Request, der nur
  // das `total` des Servers liest (limit 1). Keine erfundene Zahl aus der
  // aktuellen Seite. Nur ohne Entitäts-Filter sichtbar (dort wäre die
  // Kategorie-Verteilung eines einzelnen Vorgangs bedeutungslos), 5 min gecacht.
  const showCounts = linkKind === '';
  const countQs = useQueries({
    queries: CATEGORY_ORDER.map((c) => ({
      queryKey: ['documents', 'count', { category: c, includeArchived }],
      queryFn: () =>
        documentsApi.list(api, {
          category: c,
          limit: 1,
          ...(includeArchived ? { includeArchived: true } : {}),
        }),
      staleTime: 300_000,
      enabled: showCounts,
    })),
  });
  const categoryCounts = useMemo(
    () => CATEGORY_ORDER.map((c, i) => ({ category: c, count: countQs[i]?.data?.total ?? null })),
    [countQs],
  );

  /** Jeder Filterwechsel beginnt die Blätterung von vorn. */
  function resetPaging(): void {
    setOffset(0);
  }

  return (
    <section
      aria-label="Dokumente"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--w14-abstand-20)',
        gap: 'var(--w14-abstand-14)',
        overflow: 'hidden',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-flaeche)',
          }}
        >
          Dokumente
        </h1>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--w14-abstand-14)' }}>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)', letterSpacing: '0.08em' }}
          >
            {listQ.isFetching ? 'lädt…' : `${total} ${total === 1 ? 'Dokument' : 'Dokumente'}`}
          </span>
          <Button variant="primary" onClick={() => setUploadOpen(true)}>
            Hochladen
          </Button>
        </div>
      </header>

      {/*
        Der Nachdruck steht ÜBER den Filtern: wer diese Fläche öffnet, weil ein
        Kunde mit seinem Bon am Tresen steht, soll nicht erst an einer
        Kategorieauswahl für hochgeladene Dateien vorbei.
      */}
      <BelegeDieserKasse />

      {/* Filters */}
      <div style={{ display: 'flex', gap: 'var(--w14-abstand-10)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <FilterField label="Kategorie">
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as DocumentCategory | 'ALL');
              resetPaging();
            }}
            style={inputStyle}
          >
            <option value="ALL">alle</option>
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>
                {DOCUMENT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Verknüpft mit">
          <select
            value={linkKind}
            onChange={(e) => {
              setLinkKind(e.target.value as EntityLinkKind | '');
              resetPaging();
            }}
            style={inputStyle}
          >
            <option value="">egal</option>
            <option value="customer">Kunde</option>
            <option value="product">Artikel</option>
            <option value="transaction">Transaktion</option>
            <option value="appraisal">Bewertung</option>
          </select>
        </FilterField>
        <FilterField label="Verknüpfte Kennung">
          <input
            type="text"
            value={linkId}
            onChange={(e) => {
              setLinkId(e.target.value);
              resetPaging();
            }}
            placeholder="Kennung einfügen"
            spellCheck={false}
            disabled={linkKind === ''}
            style={{ ...inputStyle, fontFamily: 'var(--w14-font-mono)', minWidth: 240 }}
          />
        </FilterField>
        <label
          className="w14-smallcaps"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--w14-abstand-6)',
            paddingBottom: 'var(--w14-abstand-8)',
            fontSize: 'var(--w14-schrift-zeile)',
            letterSpacing: '0.08em',
            color: includeArchived ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => {
              setIncludeArchived(e.target.checked);
              resetPaging();
            }}
            style={{ accentColor: 'var(--w14-gold)' }}
          />
          Archivierte einschließen
        </label>
      </div>

      {/* Pro-Kategorie-Register: echte Server-Zählungen, zugleich Schnellfilter. */}
      {showCounts && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--w14-abstand-6)' }}>
          {categoryCounts.map(({ category: c, count }) => {
            const active = category === c;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setCategory(active ? 'ALL' : c);
                  resetPaging();
                }}
                className="w14-smallcaps"
                style={{
                  fontSize: 'var(--w14-schrift-kuerzel)',
                  letterSpacing: '0.06em',
                  padding: 'var(--w14-abstand-2) var(--w14-abstand-10)',
                  cursor: 'pointer',
                  borderRadius: 'var(--w14-radius-button)',
                  border: `1px solid ${active ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
                  background: active ? 'var(--w14-parchment-3)' : 'transparent',
                  color: active ? 'var(--w14-gold)' : 'var(--w14-ink-aged)',
                }}
              >
                {DOCUMENT_CATEGORY_LABELS[c]}
                <span
                  className="w14-tabular"
                  style={{ marginLeft: 6, fontFamily: 'var(--w14-font-mono)', opacity: 0.8 }}
                >
                  {count == null ? '·' : count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Zwischentitel />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {listQ.isLoading ? (
          <GridSkeleton />
        ) : listQ.isError ? (
          <ParchmentCard padding="md" style={{ border: '1px solid var(--w14-wax-red)' }}>
            <p role="alert" style={{ margin: 0, color: 'var(--w14-wax-red)' }}>
              Dokumente konnten nicht geladen werden.
            </p>
          </ParchmentCard>
        ) : items.length === 0 ? (
          <ParchmentCard padding="md" style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontStyle: 'italic', color: 'var(--w14-ink-faded)' }}>
              {offset > 0
                ? 'Auf dieser Seite stehen keine Dokumente mehr.'
                : includeArchived
                  ? 'Noch keine Dokumente.'
                  : 'Noch keine aktiven Dokumente. Archivierte sind ausgeblendet.'}
            </p>
            {/*
              Eine leere Folgeseite darf keine Sackgasse sein: ohne diesen Weg
              zurück bliebe der Kassierer auf offset > 0 stehen, weil die
              Blätterung nur unter einer gefüllten Liste steht.
            */}
            {offset > 0 && (
              <div style={{ marginTop: 12 }}>
                <Button variant="ghost" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                  Zurück
                </Button>
              </div>
            )}
          </ParchmentCard>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 'var(--w14-abstand-12)',
              }}
            >
              {items.map((row) => (
                <DocumentCard key={row.id} row={row} />
              ))}
            </div>

            {(offset > 0 || hasMore) && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'var(--w14-abstand-12)',
                  marginTop: 16,
                  paddingTop: 'var(--w14-abstand-12)',
                  borderTop: '1px solid var(--w14-rule)',
                }}
              >
                <Button
                  variant="ghost"
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  disabled={offset === 0 || listQ.isFetching}
                >
                  Zurück
                </Button>
                <span
                  className="w14-tabular"
                  style={{
                    fontFamily: 'var(--w14-font-mono)',
                    fontSize: 'var(--w14-schrift-zeile)',
                    color: 'var(--w14-ink-faded)',
                  }}
                >
                  {offset + 1} bis {offset + items.length} von {total}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  disabled={!hasMore || listQ.isFetching}
                >
                  Weiter
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {uploadOpen && (
        <UploadDialog
          onClose={() => setUploadOpen(false)}
          defaultCategory={category !== 'ALL' ? category : 'EXPERTISE'}
        />
      )}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Card
// ════════════════════════════════════════════════════════════════════════

function DocumentCard({ row }: { row: DocumentRow }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const archive = useMutation({
    mutationFn: () => documentsApi.archive(api, row.id),
    onSuccess: async () => {
      addToast({ tone: 'success', title: 'Dokument archiviert', body: row.fileName });
      await qc.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Archivieren fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });

  const link = describeLink(row);
  const isArchived = row.archivedAt != null;
  const digest = shortHash(row.sha256Hex);

  return (
    <ParchmentCard
      padding="md"
      style={
        isArchived
          ? { opacity: 0.72, borderStyle: 'dashed', background: 'var(--w14-parchment-1)' }
          : undefined
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-10)' }}>
        <FileIcon mime={row.mimeType} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontWeight: 500,
              fontSize: 'var(--w14-schrift-betont)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={row.fileName}
          >
            {row.fileName}
          </div>
          <div
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-kuerzel)',
              color: 'var(--w14-ink-faded)',
            }}
          >
            {formatBytes(row.sizeBytes)} · {row.mimeType}
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 10,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 'var(--w14-abstand-10)',
        }}
      >
        <div style={{ display: 'flex', gap: 'var(--w14-abstand-6)', alignItems: 'center', flexWrap: 'wrap' }}>
          <CategoryBadge category={row.category} />
          {isArchived && <ArchivedBadge />}
        </div>
        <span
          className="w14-tabular"
          style={{
            fontFamily: 'var(--w14-font-mono)',
            fontSize: 'var(--w14-schrift-kuerzel)',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {new Date(row.createdAt).toLocaleDateString('de-DE')}
        </span>
      </div>
      {link && (
        <p
          className="w14-tabular"
          style={{
            margin: '8px 0 0',
            fontFamily: 'var(--w14-font-mono)',
            fontSize: 'var(--w14-schrift-zeile)',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {link}
        </p>
      )}

      {/*
        GoBD §147: der Beleg muss unveränderbar nachweisbar sein. Die Prüfsumme
        ist dieser Nachweis. Fehlt sie, sagen wir das, statt Integrität zu
        suggerieren, die wir nicht belegen können.
      */}
      <p
        style={{
          margin: '6px 0 0',
          fontSize: 'var(--w14-schrift-kuerzel)',
          color: 'var(--w14-ink-faded)',
        }}
        title={row.sha256Hex ?? undefined}
      >
        {digest ? (
          <>
            Prüfsumme <span style={{ fontFamily: 'var(--w14-font-mono)' }}>{digest}</span>
          </>
        ) : (
          <span style={{ fontStyle: 'italic' }}>Ohne Prüfsumme gespeichert</span>
        )}
      </p>

      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        {row.archivedAt ? (
          <span
            className="w14-smallcaps"
            style={{
              fontSize: 'var(--w14-schrift-kuerzel)',
              letterSpacing: '0.08em',
              color: 'var(--w14-ink-faded)',
            }}
          >
            Archiviert am {new Date(row.archivedAt).toLocaleDateString('de-DE')}
          </span>
        ) : (
          <Button
            variant="ghost"
            size="md"
            onClick={() => {
              if (window.confirm(`Dokument "${row.fileName}" archivieren?`)) archive.mutate();
            }}
            disabled={archive.isPending}
          >
            Archivieren
          </Button>
        )}
      </div>
    </ParchmentCard>
  );
}

function ArchivedBadge(): JSX.Element {
  return (
    <span
      className="w14-smallcaps"
      style={{
        fontSize: 'var(--w14-schrift-kuerzel)',
        letterSpacing: '0.08em',
        padding: 'var(--w14-abstand-2) var(--w14-abstand-8)',
        border: '1px dashed var(--w14-ink-faded)',
        borderRadius: 'var(--w14-radius-button)',
        color: 'var(--w14-ink-faded)',
      }}
    >
      Archiviert
    </span>
  );
}

function describeLink(row: DocumentRow): string | null {
  if (row.customerId) return `Kunde · ${row.customerId.slice(0, 8)}`;
  if (row.productId) return `Artikel · ${row.productId.slice(0, 8)}`;
  if (row.transactionId) return `Transaktion · ${row.transactionId.slice(0, 8)}`;
  if (row.appraisalId) return `Bewertung · ${row.appraisalId.slice(0, 8)}`;
  return null;
}

function CategoryBadge({ category }: { category: DocumentCategory }): JSX.Element {
  return (
    <span
      className="w14-smallcaps"
      style={{
        fontSize: 'var(--w14-schrift-kuerzel)',
        letterSpacing: '0.08em',
        padding: 'var(--w14-abstand-2) var(--w14-abstand-8)',
        border: '1px solid var(--w14-gold)',
        borderRadius: 'var(--w14-radius-button)',
        color: 'var(--w14-gold)',
      }}
    >
      {DOCUMENT_CATEGORY_LABELS[category]}
    </span>
  );
}

function FileIcon({ mime }: { mime: string }): JSX.Element {
  const isImage = mime.startsWith('image/');
  return (
    <span
      aria-hidden
      style={{
        width: 36,
        height: 36,
        borderRadius: 'var(--w14-radius-fein)',
        background: 'var(--w14-parchment-3)',
        border: '1px solid var(--w14-rule)',
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'var(--w14-font-display)',
        fontSize: 'var(--w14-schrift-zeile)',
        color: 'var(--w14-ink-aged)',
        flexShrink: 0,
      }}
    >
      {/* Strich-Icons statt ◫/◈ — die Glyphen fallen je nach Windows-Schrift
          verschieden aus (Dekret „Symbole statt Emoji", 26.07.2026). */}
      {isImage ? (
        <Icon icon={Image} size={16} />
      ) : mime.includes('pdf') ? (
        'PDF'
      ) : (
        <Icon icon={FileText} size={16} />
      )}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Upload dialog
// ════════════════════════════════════════════════════════════════════════

function UploadDialog({
  onClose,
  defaultCategory,
}: {
  onClose: () => void;
  defaultCategory: DocumentCategory;
}): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<DocumentCategory>(defaultCategory);
  const [linkKind, setLinkKind] = useState<EntityLinkKind>('customer');
  const [linkId, setLinkId] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isDraggingOver, setDraggingOver] = useState<boolean>(false);
  const [stage, setStage] = useState<'idle' | 'signing' | 'putting' | 'registering'>('idle');

  const upload = useMutation({
    mutationFn: async () => {
      if (!file)
        throw new ApiError({
          code: 'VALIDATION_ERROR',
          message: 'Bitte Datei wählen.',
          httpStatus: 400,
        });
      if (linkId.trim().length === 0) {
        throw new ApiError({
          code: 'VALIDATION_ERROR',
          message: 'Bitte die verknüpfte Kennung eingeben.',
          httpStatus: 400,
        });
      }

      setStage('signing');
      const contentType = (file.type ||
        'application/octet-stream') as PhotoUploadUrlBody['contentType'];
      // The signed-URL endpoint enforces a small allowlist for `contentType`;
      // for non-image attachments we fall back to PDF-image content type so the
      // operator gets a friendly error if the backend rejects it.
      const signed = await photosApi.requestUploadUrl(api, {
        contentType,
        contentLength: file.size,
        intent: 'orphan' as PhotoUploadIntent,
      });

      setStage('putting');
      const put = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: signed.requiredHeaders,
        body: file,
      });
      if (!put.ok) {
        throw new ApiError({
          code: 'INTERNAL_ERROR',
          message: `Die Datei konnte nicht gespeichert werden (Code ${put.status}).`,
          httpStatus: put.status,
        });
      }

      setStage('registering');
      const body: CreateDocumentBody = {
        category,
        r2Key: signed.r2Key,
        fileName: file.name,
        mimeType: contentType,
        sizeBytes: file.size,
        ...(linkKind === 'customer' ? { customerId: linkId.trim() } : {}),
        ...(linkKind === 'product' ? { productId: linkId.trim() } : {}),
        ...(linkKind === 'transaction' ? { transactionId: linkId.trim() } : {}),
        ...(linkKind === 'appraisal' ? { appraisalId: linkId.trim() } : {}),
        ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
      };
      return documentsApi.create(api, body);
    },
    onSuccess: async (row) => {
      addToast({ tone: 'success', title: 'Dokument gespeichert', body: row.fileName });
      await qc.invalidateQueries({ queryKey: ['documents'] });
      onClose();
    },
    onError: (err: unknown) => {
      setStage('idle');
      // Eingereiht ist ein ERFOLG: das Dokument liegt im Ausgangskorb. „Bitte
      // erneut versuchen." führte zu zwei Ablagen derselben Datei, und in
      // einem Bestand nach GoBD ist ein Doppel kein Schönheitsfehler.
      if (istSicherEingereiht(err)) {
        addToast(eingereihtHinweis('Dokument'));
        onClose();
        return;
      }
      addToast({
        tone: 'alert',
        title: 'Upload fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : ohneApiFehlerSatz(err),
      });
    },
  });

  const busy = upload.isPending || stage !== 'idle';
  const stageLabel = useMemo(() => {
    switch (stage) {
      case 'signing':
        return 'Signiere…';
      case 'putting':
        return 'Lade hoch…';
      case 'registering':
        return 'Registriere…';
      default:
        return null;
    }
  }, [stage]);

  // Escape schliesst. Jeder vergleichbare Dialog der Kasse kann das
  // (BezahlenDialog, ZBonDialog, AcceptanceDialog, CustomerCreateDialog);
  // dieser eine nicht — er liess sich nur über den Hintergrund schliessen.
  // Ein Fenster, das sich `aria-modal` NENNT, muss die Tastatur bedienen.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Fensterboden><div
      role="dialog"
      aria-modal="true"
      aria-label="Dokument hochladen"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 16, 10, 0.55)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--w14-abstand-24)',
        // Ebene: Fenster, nicht klebend (27.07.2026) — dieser Schleier lag auf der
        // nackten 100 und damit UNTER jedem Spotlight-Schleier (1000): der Dialog
        // waere verschluckt worden. Dieselbe Fehlerklasse wie der Meldungskasten
        // vom 26.07., siehe Ebenen-Kommentar in tokens.css.
        zIndex: 'var(--w14-z-fenster)',
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(520px, 100%)' }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-titel)',
          }}
        >
          Dokument hochladen
        </h2>
        <Zwischentitel />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDraggingOver(true);
          }}
          onDragLeave={() => setDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDraggingOver(false);
            const f = e.dataTransfer.files[0];
            if (f) setFile(f);
          }}
          style={{
            border: `2px dashed ${isDraggingOver ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
            borderRadius: 'var(--w14-radius-card)',
            padding: 'var(--w14-abstand-24)',
            textAlign: 'center',
            background: isDraggingOver ? 'var(--w14-parchment-3)' : 'var(--w14-parchment-2)',
            transition: 'background 0.18s, border-color 0.18s',
          }}
        >
          {file ? (
            <div>
              <strong style={{ fontFamily: 'var(--w14-font-display)' }}>{file.name}</strong>
              <div
                className="w14-tabular"
                style={{
                  marginTop: 4,
                  fontFamily: 'var(--w14-font-mono)',
                  fontSize: 'var(--w14-schrift-zeile)',
                  color: 'var(--w14-ink-faded)',
                }}
              >
                {formatBytes(file.size.toString())} · {file.type || 'unbekannt'}
              </div>
            </div>
          ) : (
            <p
              style={{
                margin: 0,
                fontFamily: 'var(--w14-font-display)',
                color: 'var(--w14-ink-faded)',
              }}
            >
              Datei hierher ziehen oder unten auswählen
            </p>
          )}
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ display: 'block', margin: '12px auto 0' }}
          />
        </div>

        <label
          className="w14-smallcaps"
          style={{
            display: 'block',
            marginTop: 12,
            color: 'var(--w14-ink-aged)',
            letterSpacing: '0.08em',
            fontSize: 'var(--w14-schrift-zeile)',
          }}
        >
          Kategorie
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as DocumentCategory)}
          style={inputStyle}
        >
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {DOCUMENT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>

        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 'var(--w14-abstand-8)', marginTop: 12 }}>
          <div>
            <label
              className="w14-smallcaps"
              style={{
                display: 'block',
                color: 'var(--w14-ink-aged)',
                letterSpacing: '0.08em',
                fontSize: 'var(--w14-schrift-zeile)',
              }}
            >
              Verknüpft mit
            </label>
            <select
              value={linkKind}
              onChange={(e) => setLinkKind(e.target.value as EntityLinkKind)}
              style={inputStyle}
            >
              <option value="customer">Kunde</option>
              <option value="product">Artikel</option>
              <option value="transaction">Transaktion</option>
              <option value="appraisal">Bewertung</option>
            </select>
          </div>
          <div>
            <label
              className="w14-smallcaps"
              style={{
                display: 'block',
                color: 'var(--w14-ink-aged)',
                letterSpacing: '0.08em',
                fontSize: 'var(--w14-schrift-zeile)',
              }}
            >
              Kennung
            </label>
            <input
              type="text"
              value={linkId}
              onChange={(e) => setLinkId(e.target.value)}
              placeholder="Kennung einfügen"
              spellCheck={false}
              style={{ ...inputStyle, fontFamily: 'var(--w14-font-mono)' }}
            />
          </div>
        </div>

        <label
          className="w14-smallcaps"
          style={{
            display: 'block',
            marginTop: 12,
            color: 'var(--w14-ink-aged)',
            letterSpacing: '0.08em',
            fontSize: 'var(--w14-schrift-zeile)',
          }}
        >
          Notiz (optional)
        </label>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          style={inputStyle}
        />

        <div style={{ display: 'flex', gap: 'var(--w14-abstand-10)', justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button variant="primary" disabled={!file || busy} onClick={() => upload.mutate()}>
            {stageLabel ?? 'Hochladen'}
          </Button>
        </div>
      </ParchmentCard>
    </div></Fensterboden>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════

function formatBytes(s: string): string {
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)' }}>
      <span
        className="w14-smallcaps"
        style={{
          fontSize: 'var(--w14-schrift-kuerzel)',
          letterSpacing: '0.08em',
          color: 'var(--w14-ink-aged)',
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function GridSkeleton(): JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 'var(--w14-abstand-12)',
      }}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          style={{
            height: 130,
            borderRadius: 'var(--w14-radius-card)',
            background:
              'linear-gradient(90deg, var(--w14-parchment-2), var(--w14-parchment-3), var(--w14-parchment-2))',
            backgroundSize: '200% 100%',
            animation: 'w14-skel 1.6s ease-in-out infinite',
            opacity: 1 - i * 0.08,
          }}
        />
      ))}
      <style>{`@keyframes w14-skel { 0%,100%{background-position:0% 50%;} 50%{background-position:100% 50%;} }`}</style>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 'var(--w14-abstand-6) var(--w14-abstand-10)',
  border: '1px solid var(--w14-feldlinie)',
  borderRadius: 'var(--w14-radius-fein)',
  backgroundColor: 'var(--w14-parchment)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: 'var(--w14-schrift-text)',
  color: 'var(--w14-ink)',
  outline: 'none',
};

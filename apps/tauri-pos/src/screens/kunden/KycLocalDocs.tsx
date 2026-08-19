/**
 * KycLocalDocs (Epic C Part 2) — list + offline preview of a customer's local
 * encrypted ID documents.
 *
 * Reads the `customer_kyc` SQLite index (no network), and for each row offers a
 * "Vorschau" that decrypts the vault file in Rust, wraps the plaintext bytes in
 * a Blob URL, and shows it in a modal. The Blob URL is revoked when the preview
 * closes / the component unmounts, so decrypted PII never lingers.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { Fensterboden, Button } from '@norns/ui-kit';

import {
  decryptAndLoadKycDocument,
  deleteKycDocument,
  describeHardwareError,
  isHardwareError,
} from '../../lib/hardware-client.js';
import { deleteKycRecord, type KycRecord, listKycForCustomer } from '../../lib/kyc-store.js';
import { useToastStore } from '../../state/toast-store.js';

const DOC_LABEL: Record<string, string> = {
  AUSWEIS: 'Personalausweis',
  REISEPASS: 'Reisepass',
  AUFENTHALTSTITEL: 'Aufenthaltstitel',
  SONSTIGES: 'Sonstiges',
};

export const kycLocalQueryKey = (customerId: string): readonly unknown[] => [
  'kyc-local',
  customerId,
];

interface PreviewState {
  url: string;
  mime: string;
  sha256: string;
}

/** Sniff a content type from magic bytes (we don't persist the MIME). */
function sniffMime(bytes: Uint8Array): string {
  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  const b3 = bytes[3];
  if (b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46) return 'application/pdf'; // %PDF
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'image/jpeg';
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return 'image/png';
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) return 'image/webp'; // RIFF…WEBP
  return 'application/octet-stream';
}

export function KycLocalDocs({
  customerId,
  onPromoteTrust,
}: {
  customerId: string;
  onPromoteTrust?: () => void;
}): JSX.Element | null {
  const addToast = useToastStore((s) => s.addToast);
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const recordsQ = useQuery({
    queryKey: kycLocalQueryKey(customerId),
    queryFn: () => listKycForCustomer(customerId),
    staleTime: 30_000,
    retry: false, // outside Tauri the SQL plugin rejects — don't hammer it
  });

  // Revoke the Blob URL whenever the preview changes or the panel unmounts.
  useEffect(() => {
    if (!preview) return;
    const { url } = preview;
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  const openPreview = useCallback(
    async (rec: KycRecord) => {
      setBusyId(rec.id);
      try {
        const bytes = await decryptAndLoadKycDocument(rec.filePath);
        const mime = sniffMime(bytes);
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setPreview({ url, mime, sha256: rec.sha256 });
      } catch (err) {
        addToast({
          tone: 'alert',
          title: 'Vorschau fehlgeschlagen',
          body: isHardwareError(err)
            ? describeHardwareError(err)
            : 'Die Vorschau konnte nicht geladen werden. Bitte erneut versuchen.',
        });
      } finally {
        setBusyId(null);
      }
    },
    [addToast],
  );

  // DSGVO Art. 17 erasure. The ciphertext is the actual PII, so it is destroyed
  // first (the Rust command is idempotent — an already-gone file still resolves);
  // only then is the local index row removed so the document leaves the Akte.
  const deleteDoc = useCallback(
    async (rec: KycRecord) => {
      setBusyId(rec.id);
      try {
        await deleteKycDocument(rec.filePath);
        await deleteKycRecord(rec.id);
        setConfirmId(null);
        addToast({
          tone: 'success',
          title: 'Dokument gelöscht',
          body: 'Der verschlüsselte Ausweis wurde dauerhaft entfernt.',
        });
        await queryClient.invalidateQueries({ queryKey: kycLocalQueryKey(customerId) });
      } catch (err) {
        addToast({
          tone: 'alert',
          title: 'Löschen fehlgeschlagen',
          body: isHardwareError(err)
            ? describeHardwareError(err)
            : 'Der Ausweis konnte nicht entfernt werden. Bitte erneut versuchen.',
        });
      } finally {
        setBusyId(null);
      }
    },
    [addToast, customerId, queryClient],
  );

  const records = recordsQ.data ?? [];
  if (records.length === 0) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <span
          className="w14-smallcaps"
          style={{ letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}
        >
          Lokale Ausweisdokumente (verschlüsselt)
        </span>
        {onPromoteTrust && (
          <Button variant="ghost" size="sm" onClick={onPromoteTrust}>
            Trust aktualisieren
          </Button>
        )}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--w14-abstand-6)' }}>
        {records.map((rec) => (
          <li
            key={rec.id}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-10)', fontSize: 'var(--w14-schrift-feld)' }}
          >
            <span style={{ minWidth: 120 }}>{DOC_LABEL[rec.docType] ?? 'Dokument'}</span>
            <span style={{ color: 'var(--w14-ink-faded)' }}>
              {new Date(rec.createdAt).toLocaleString('de-DE')}
            </span>
            <span
              className="w14-tabular"
              style={{
                flex: 1,
                fontFamily: 'var(--w14-font-mono)',
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-faded)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={rec.sha256}
            >
              {rec.sha256.slice(0, 16)}…
            </span>
            {confirmId === rec.id ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-6)' }}>
                <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
                  Endgültig löschen?
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busyId === rec.id}
                  onClick={() => void deleteDoc(rec)}
                >
                  {busyId === rec.id ? 'Löscht…' : 'Ja, löschen'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId === rec.id}
                  onClick={() => setConfirmId(null)}
                >
                  Abbrechen
                </Button>
              </span>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId === rec.id}
                  onClick={() => void openPreview(rec)}
                >
                  {busyId === rec.id ? 'Entschlüsselt…' : 'Vorschau'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId !== null}
                  onClick={() => setConfirmId(rec.id)}
                >
                  Löschen
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>

      {preview && <KycPreviewModal preview={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function KycPreviewModal({
  preview,
  onClose,
}: {
  preview: PreviewState;
  onClose: () => void;
}): JSX.Element {
  return (
    // biome-ignore lint/a11y/useSemanticElements: backdrop overlay uses role="dialog" to match the existing modal pattern in this app
    <Fensterboden><div
      role="dialog"
      aria-modal="true"
      aria-label="Ausweis-Vorschau"
      tabIndex={-1}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--w14-overlay)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--w14-abstand-24)',
        // Ebene: Fenster (27.07.2026) — die Ausweis-Vorschau ist ein echtes Fenster
        // mit Schleier und lag auf der nackten 120: unter jedem Spotlight (1000)
        // und jedem anderen Fenster. Gleiche Fehlerklasse wie am 26.07.
        zIndex: 'var(--w14-z-fenster)',
      }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="document"
        style={{
          width: 'min(640px, 100%)',
          maxHeight: '90vh',
          background: 'var(--w14-parchment)',
          borderRadius: 6,
          padding: 'var(--w14-abstand-12)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--w14-abstand-8)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span
            className="w14-tabular"
            style={{
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-zeile)',
              color: 'var(--w14-ink-faded)',
            }}
            title={preview.sha256}
          >
            SHA-256 {preview.sha256.slice(0, 16)}…
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Schließen
          </Button>
        </div>
        {preview.mime === 'application/pdf' ? (
          <iframe
            title="Ausweis-Vorschau"
            src={preview.url}
            style={{ width: '100%', height: '72vh', border: '1px solid var(--w14-rule)' }}
          />
        ) : preview.mime.startsWith('image/') ? (
          <img
            src={preview.url}
            alt="Ausweis-Vorschau"
            style={{
              maxWidth: '100%',
              maxHeight: '76vh',
              objectFit: 'contain',
              alignSelf: 'center',
            }}
          />
        ) : (
          <p style={{ color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>
            Vorschau für diesen Dateityp nicht verfügbar.
          </p>
        )}
      </div>
    </div></Fensterboden>
  );
}

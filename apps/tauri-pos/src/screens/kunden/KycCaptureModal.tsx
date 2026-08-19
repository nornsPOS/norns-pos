/**
 * KycCaptureModal — capture/upload an identity document and store it in the
 * encrypted local KYC vault (Epic C, GwG/GDPR).
 *
 * The raw bytes are handed to the Rust bridge (`encrypt_and_save_kyc_document`)
 * which AES-256-GCM-encrypts them under the OS-keyring master key and writes
 * the ciphertext to `$APP_DATA/kyc_vault/`. Only the opaque vault path + the
 * SHA-256 integrity hash come back — the plaintext never touches JS storage.
 *
 * `<input type="file" capture>` opens the device camera on capable hardware
 * and a file picker otherwise, covering both "scan now" and "attach existing".
 */

import { useState } from 'react';

import { Fensterboden, Button, Zwischentitel, ParchmentCard } from '@norns/ui-kit';

import {
  type KycDocType,
  type KycEncryptResult,
  deleteKycDocument,
  describeHardwareError,
  encryptAndSaveKycDocument,
  isHardwareError,
} from '../../lib/hardware-client.js';
import { FENSTER_ROLLRAHMEN, useFensterRahmen } from '../../lib/fenster-rahmen.js';
import { insertKycRecord } from '../../lib/kyc-store.js';
import { useToastStore } from '../../state/toast-store.js';

const DOC_TYPES: { value: KycDocType; label: string }[] = [
  { value: 'AUSWEIS', label: 'Personalausweis' },
  { value: 'REISEPASS', label: 'Reisepass' },
  { value: 'AUFENTHALTSTITEL', label: 'Aufenthaltstitel' },
  { value: 'SONSTIGES', label: 'Sonstiges' },
];

export function KycCaptureModal({
  customerId,
  onClose,
  onSaved,
}: {
  customerId: string;
  onClose: () => void;
  onSaved?: (result: KycEncryptResult) => void;
}): JSX.Element {
  const addToast = useToastStore((s) => s.addToast);
  const [docType, setDocType] = useState<KycDocType>('AUSWEIS');
  const [busy, setBusy] = useState(false);

  // Dieses Fenster wird vom Elternteil nur dann überhaupt gebaut, wenn es
  // sichtbar sein soll — es kennt also kein eigenes „offen", und der Rahmen
  // bekommt fest `true`.
  //
  // Zwei Funde hier, beide schlimmer als beim Rest der Gruppe:
  //
  // Erstens hing Escape an einem `onKeyDown` auf dem Feld selbst. Ein Feld
  // nimmt Tastendrücke aber nur an, wenn der Fokus darin steht, und genau den
  // hat nie jemand hineingesetzt. Escape tat also schlicht nichts. Jetzt hängt
  // der Lauscher am Fenster der Anwendung und wirkt.
  //
  // Zweitens stand dieses Fenster auf der Ebene 100. Das ist im Baukasten die
  // Stufe für klebende Kopfzeilen INNERHALB einer Fläche, nicht die für
  // Fenster. Eine klebende Kopfzeile konnte sich also über das Ausweisfenster
  // legen. Es gehört auf die Fensterebene wie jedes andere auch.
  //
  // Nebenbei: der Schleier war hier als feste Farbe eingetragen und wurde
  // deshalb im dunklen Erscheinungsbild nie mitgedunkelt. Er nimmt jetzt
  // dieselbe Marke wie jedes andere Fenster der Kasse.
  const rahmenRef = useFensterRahmen({ offen: true, aufSchliessen: onClose, gesperrt: busy });

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await encryptAndSaveKycDocument(bytes, customerId, docType);

      // Index the encrypted file locally so it's listable/previewable offline.
      // If the index write fails, the ciphertext on disk becomes an ORPHAN:
      // invisible to the Akte, un-previewable, and — worst — un-eraseable, i.e.
      // exactly the at-rest PII sink that Art.17 must never leave behind. So we
      // unlink the just-written vault file and ask the operator to re-capture,
      // rather than reporting a save that cannot be governed or deleted.
      let inserted: boolean;
      try {
        inserted = await insertKycRecord({
          customerId,
          docType,
          filePath: result.path,
          sha256: result.sha256,
          createdAt: Date.now(),
        });
      } catch (dbErr) {
        try {
          await deleteKycDocument(result.path);
        } catch {
          // Best-effort orphan cleanup — the file could not be indexed AND could
          // not be removed; nothing further to do from here.
        }
        addToast({
          tone: 'alert',
          title: 'Ausweis nicht gespeichert',
          body: isHardwareError(dbErr)
            ? describeHardwareError(dbErr)
            : 'Der lokale Index konnte nicht aktualisiert werden. Bitte erneut erfassen.',
        });
        return;
      }

      if (!inserted) {
        // The exact bytes are ALREADY in the vault (UNIQUE sha256, so the index
        // INSERT was a no-op). The file we just wrote is a redundant duplicate —
        // unlink it so it can never become an un-indexed, un-eraseable orphan
        // (Art.17). The existing indexed copy stays authoritative, and we tell
        // the operator the truth instead of claiming a fresh save.
        try {
          await deleteKycDocument(result.path);
        } catch {
          // Best-effort — nothing else to do from here.
        }
        addToast({
          tone: 'info',
          title: 'Bereits hinterlegt',
          body: 'Dieser Ausweis ist für den Kunden bereits gespeichert.',
        });
        onSaved?.(result);
        onClose();
        return;
      }

      addToast({
        tone: 'success',
        title: 'Ausweis verschlüsselt gespeichert',
        body: `SHA-256 ${result.sha256.slice(0, 12)}…`,
      });
      onSaved?.(result);
      onClose();
    } catch (err) {
      addToast({
        tone: 'alert',
        title: 'Verschlüsseln fehlgeschlagen',
        body: isHardwareError(err) ? describeHardwareError(err) : 'Bitte erneut versuchen.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: backdrop overlay uses role="dialog" to match the existing modal pattern in this app
    <Fensterboden><div
      ref={rahmenRef}
      role="dialog"
      aria-modal="true"
      aria-label="Ausweis erfassen"
      tabIndex={-1}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--w14-overlay)',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--w14-abstand-24)',
        zIndex: 'var(--w14-z-fenster)',
      }}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <ParchmentCard
        padding="lg"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(460px, 100%)', ...FENSTER_ROLLRAHMEN }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-titel)',
          }}
        >
          Ausweis erfassen
        </h2>
        <Zwischentitel />

        <p style={{ margin: '8px 0 0', fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-aged)' }}>
          Das Dokument wird lokal AES-256-GCM-verschlüsselt im Tresor abgelegt. Der Schlüssel
          verbleibt im OS-Schlüsselbund; unverschlüsselte Daten werden nie gespeichert.
        </p>

        <label
          htmlFor="w14-kyc-doctype"
          className="w14-smallcaps"
          style={{
            display: 'block',
            color: 'var(--w14-ink-aged)',
            fontSize: 'var(--w14-schrift-zeile)',
            letterSpacing: '0.08em',
            marginTop: 12,
          }}
        >
          Dokumenttyp
        </label>
        <select
          id="w14-kyc-doctype"
          value={docType}
          onChange={(e) => setDocType(e.target.value as KycDocType)}
          style={selectStyle}
        >
          {DOC_TYPES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>

        <label
          htmlFor="w14-kyc-file"
          className="w14-smallcaps"
          style={{
            display: 'block',
            color: 'var(--w14-ink-aged)',
            fontSize: 'var(--w14-schrift-zeile)',
            letterSpacing: '0.08em',
            marginTop: 12,
          }}
        >
          Aufnahme / Datei
        </label>
        <input
          id="w14-kyc-file"
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          disabled={busy}
          onChange={(e) => void handleFile(e.target.files?.[0])}
          style={{ marginTop: 6, fontFamily: 'var(--w14-font-body)', fontSize: 'var(--w14-schrift-text)' }}
        />

        <div style={{ display: 'flex', gap: 'var(--w14-abstand-10)', justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {busy ? 'Verschlüsselt…' : 'Schließen'}
          </Button>
        </div>
      </ParchmentCard>
    </div></Fensterboden>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: 'var(--w14-abstand-8) var(--w14-abstand-10)',
  // Zielfläche: die Auswahl war rund 34 Pixel hoch, also unter der Grenze
  // von 44. Am Tresen wird sie mit dem Finger getroffen, nicht mit der Maus.
  minHeight: 'var(--w14-touch-min)',
  border: '1px solid var(--w14-feldlinie)',
  borderRadius: 'var(--w14-radius-fein)',
  backgroundColor: 'var(--w14-parchment-1, var(--w14-parchment))',
  fontFamily: 'var(--w14-font-body)',
  fontSize: 'var(--w14-schrift-betont)',
  color: 'var(--w14-ink)',
  outline: 'none',
  marginTop: 6,
};

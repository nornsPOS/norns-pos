/**
 * OfflineNotice — the inline, in-context note above cached data telling the
 * operator these are the last-good numbers and what the app will do on its own.
 *
 * By default it shows itself only while the browser reports offline (a reactive
 * `navigator.onLine` listener); a surface may force it via `show` (e.g. while a
 * specific source is locked). Honest + calm — never alarmist.
 */
import { useEffect, useState } from 'react';

export interface OfflineNoticeProps {
  /** Force-show regardless of connectivity. Default: shown only while offline. */
  show?: boolean;
  /** The lead line. Default: a calm offline explanation. */
  message?: string;
  /** What the app will do on reconnect (e.g. from `useSafeRetry.retryHint`). */
  retryHint?: string;
}

function useIsOffline(): boolean {
  const [offline, setOffline] = useState<boolean>(
    typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  useEffect(() => {
    const on = (): void => setOffline(false);
    const off = (): void => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return offline;
}

export function OfflineNotice({ show, message, retryHint }: OfflineNoticeProps): JSX.Element | null {
  const offline = useIsOffline();
  const visible = show ?? offline;
  if (!visible) return null;
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w14-abstand-2)',
        padding: 'var(--w14-abstand-8) var(--w14-abstand-12)',
        borderRadius: 6,
        border: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-2)',
        color: 'var(--w14-ink-aged)',
        fontSize: 'var(--w14-schrift-feld)',
      }}
    >
      <span>{message ?? 'Keine Verbindung. Es werden die zuletzt geladenen Daten angezeigt.'}</span>
      {retryHint && (
        <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>{retryHint}</span>
      )}
    </div>
  );
}

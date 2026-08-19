/**
 * VoucherField — Gutschein lookup + apply inside the Bezahlen dialog (Phase C2).
 *
 * Self-contained: the operator types a code and presses "Einlösen"; this looks
 * it up via GET /api/vouchers/:code, validates it's ACTIVE with a positive
 * balance, and calls `onApplied({ code, balanceEur })`. The parent computes the
 * voucher/cash split (computeTender) and, after finalize, posts the redemption.
 *
 * Applied state shows the code + remaining balance and an "Entfernen" action.
 */

import { useState } from 'react';

import { ApiError, type ApiClient } from '@norns/api-client';
import { Button } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { describeError, gutscheinZustandSatz } from '@norns/i18n-de';

export interface AppliedVoucher {
  code: string;
  /** current_balance_eur at lookup time (decimal string). */
  balanceEur: string;
}

interface VoucherView {
  code: string;
  currentBalanceEur: string;
  status: string;
}

export function VoucherField({
  applied,
  onApplied,
  disabled,
}: {
  applied: AppliedVoucher | null;
  onApplied: (v: AppliedVoucher | null) => void;
  disabled: boolean;
}): JSX.Element {
  const client = useApiClient() as ApiClient;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup(): Promise<void> {
    const clean = code.trim().toUpperCase();
    if (clean.length < 8 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const v = await client.request<VoucherView>(
        'GET',
        `/api/vouchers/${encodeURIComponent(clean)}`,
      );
      if (v.status !== 'ACTIVE') {
        // ⚠️ 12.08.2026: hier stand `v.status` ROH im Satz. Nur REDEEMED war
        // von Hand übersetzt; bei EXPIRED und REVOKED las der Kassierer vor
        // dem Kunden wörtlich „Gutschein ist EXPIRED." Das Vokabular steht
        // jetzt in `i18n-de` bei den übrigen Aufzählungen.
        setError(gutscheinZustandSatz(v.status));
        return;
      }
      if (Number(v.currentBalanceEur) <= 0) {
        setError('Gutschein hat kein Guthaben mehr.');
        return;
      }
      onApplied({ code: v.code, balanceEur: v.currentBalanceEur });
      setCode('');
    } catch (err) {
      /**
       * ⚠️ 12.08.2026: DIE WEICHE PRÜFTE DIE DEUTSCHE MELDUNG AUF ENGLISCHE
       * WÖRTER.
       *
       * Hier stand `/not found|404/i.test(describeError(err))`. `describeError`
       * liefert für NOT_FOUND aber den deutschen Satz „Datensatz nicht
       * gefunden." — darin kommt weder „not found" noch „404" vor. Der Zweig
       * traf also NIE, und jeder vertippte Code ergab „Prüfung
       * fehlgeschlagen.", was nach Netz- oder Systemstörung klingt. Der
       * Kassierer drückte folgerichtig noch einmal, statt den Code zu
       * korrigieren.
       *
       * Jetzt entscheidet der CODE des Fehlers, nicht seine Übersetzung.
       */
      if (err instanceof ApiError && err.code === 'NOT_FOUND') {
        setError('Gutschein nicht gefunden. Bitte den Code prüfen.');
      } else {
        setError(describeError(err));
      }
    } finally {
      setBusy(false);
    }
  }

  if (applied) {
    return (
      <div
        style={{
          marginTop: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--w14-abstand-10)',
          padding: 'var(--w14-abstand-8) var(--w14-abstand-12)',
          border: '1px solid var(--w14-gold)',
          borderRadius: 'var(--w14-radius-card)',
          background: 'var(--w14-parchment-3)',
        }}
      >
        <span style={{ fontSize: 'var(--w14-schrift-text)', color: 'var(--w14-ink)' }}>
          <span
            className="w14-smallcaps"
            style={{ color: 'var(--w14-gold)', letterSpacing: '0.06em' }}
          >
            Gutschein
          </span>{' '}
          {applied.code} · Guthaben {applied.balanceEur} €
        </span>
        <Button variant="ghost" size="sm" onClick={() => onApplied(null)} disabled={disabled}>
          Entfernen
        </Button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 'var(--w14-abstand-8)' }}>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void lookup();
            }
          }}
          placeholder="Gutschein-Code"
          disabled={disabled}
          style={{
            flex: 1,
            padding: 'var(--w14-abstand-8) var(--w14-abstand-10)',
            border: '1px solid var(--w14-feldlinie)',
            borderRadius: 'var(--w14-radius-button)',
            background: 'var(--w14-parchment)',
            color: 'var(--w14-ink)',
            fontFamily: 'var(--w14-font-mono)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        />
        <Button
          variant="ghost"
          size="md"
          onClick={() => void lookup()}
          disabled={disabled || busy || code.trim().length < 8}
        >
          {busy ? 'Prüft…' : 'Einlösen'}
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          style={{ color: 'var(--w14-wax-red)', fontSize: 'var(--w14-schrift-feld)', margin: '6px 0 0' }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

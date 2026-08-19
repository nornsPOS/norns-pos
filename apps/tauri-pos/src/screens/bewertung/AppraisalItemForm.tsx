/**
 * AppraisalItemForm — right column "evaluator" form for adding items
 * to a DRAFT appraisal. High-speed data entry — operator types weight,
 * fineness, condition, individual offer; the live Schmelzwert hint
 * computes client-side from the current metal price (no roundtrip).
 *
 * On submit: POST /api/appraisals/:id/items → server returns the full
 * appraisal view → TanStack cache is patched → form clears.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import {
  type AnkaufCondition,
  type AnkaufItemType,
  type AnkaufMetal,
  ApiError,
  type AppraisalItemBody,
  type MetalRatesResponse,
  appraisalsApi,
  metalPricesApi,
} from '@norns/api-client';
import { Button, Zwischentitel, MoneyAmount, ParchmentCard } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { computeSchmelzwertEur } from '../../lib/bewertung-math.js';
import { germanMoneyToDot } from '../../lib/decimal.js';
import { describeHardwareError, isHardwareError } from '../../lib/hardware-client.js';
import { CONDITION_OPTIONS, ITEM_TYPE_OPTIONS } from '../../lib/item-type-label.js';
import { useScaleWeight } from '../../hooks/useScaleWeight.js';
import { useHardwareStore } from '../../state/hardware-store.js';
import { describeError } from '@norns/i18n-de';

export interface AppraisalItemFormProps {
  appraisalId: string;
}

export function AppraisalItemForm({ appraisalId }: AppraisalItemFormProps): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();

  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [itemType, setItemType] = useState<AnkaufItemType>('gold_coin');
  const [metal, setMetal] = useState<AnkaufMetal | ''>('gold');
  const [karatCode, setKaratCode] = useState<string>('');
  const [finenessDecimal, setFinenessDecimal] = useState<string>('');
  const [weightGrams, setWeightGrams] = useState<string>('');
  const [condition, setCondition] = useState<AnkaufCondition>('USED_GOOD');
  // 0143: Seriennummer und Gravur, bei der Bewertung abgelesen — sie wandern
  // beim Annehmen unveraendert aufs Kindprodukt (eine Erfassung, ein Pfad).
  const [seriennummer, setSeriennummer] = useState<string>('');
  const [gravur, setGravur] = useState<string>('');
  const [individualEur, setIndividualEur] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // USB-scale weigh-in (Phase 4.1): pull a stable weight straight into the field.
  const scalePortPath = useHardwareStore((s) => s.config.scale.portPath);
  const scaleBaud = useHardwareStore((s) => s.config.scale.baudRate);
  const { readWeight, loading: weighing } = useScaleWeight();

  const weighIn = async (): Promise<void> => {
    if (!scalePortPath) {
      setError('Keine Waage eingerichtet. Bitte im Gerätemanager verbinden.');
      return;
    }
    try {
      const w = await readWeight(scalePortPath, scaleBaud);
      setWeightGrams(w.grams);
      setError(null);
    } catch (err) {
      setError(isHardwareError(err) ? describeHardwareError(err) : describeError(err));
    }
  };

  // Live metal RATES. Ankauf is asymmetric (Decision #69): the buy hint uses the
  // safe 10-day time-weighted buy rate (`ankaufRatePerGramEur`), NOT current spot.
  const ratesQ = useQuery<MetalRatesResponse>({
    queryKey: ['metal-prices', 'rates'],
    queryFn: () => metalPricesApi.rates(api),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const ankaufRateForSelectedMetal = useMemo<string | null>(() => {
    if (metal === '' || metal === null) return null;
    const found = ratesQ.data?.rates.find((r) => r.metal === metal);
    return found?.ankaufRatePerGramEur ?? null;
  }, [metal, ratesQ.data]);

  const schmelzwertEur = useMemo(
    () =>
      computeSchmelzwertEur({
        metal: metal === '' ? null : metal,
        weightGrams,
        finenessDecimal,
        pricePerGramEur: ankaufRateForSelectedMetal,
      }),
    [metal, weightGrams, finenessDecimal, ankaufRateForSelectedMetal],
  );

  const reset = (): void => {
    setName('');
    setDescription('');
    setKaratCode('');
    setFinenessDecimal('');
    setWeightGrams('');
    setSeriennummer('');
    setGravur('');
    setIndividualEur('');
  };

  const canSubmit =
    name.trim().length > 0 &&
    /^\d+(\.\d{1,2})?$/.test(germanMoneyToDot(individualEur)) &&
    Number(germanMoneyToDot(individualEur)) > 0 &&
    !submitting;

  const submit = useCallback(async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const body: AppraisalItemBody = {
      name: name.trim(),
      itemType,
      individualAppraisedEur: germanMoneyToDot(individualEur.trim()),
    };
    if (description.trim().length > 0) body.description = description.trim();
    if (metal !== '') body.metal = metal;
    if (karatCode.trim().length > 0) body.karatCode = karatCode.trim();
    if (finenessDecimal.trim().length > 0) body.finenessDecimal = finenessDecimal.trim();
    if (weightGrams.trim().length > 0) body.weightGrams = weightGrams.trim();
    if (seriennummer.trim().length > 0) body.seriennummer = seriennummer.trim();
    if (gravur.trim().length > 0) body.gravur = gravur.trim();
    body.condition = condition;

    try {
      const next = await appraisalsApi.addItem(api, appraisalId, body);
      qc.setQueryData(['appraisals', appraisalId], next);
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? describeError(err) : 'Netzwerk prüfen.');
    } finally {
      setSubmitting(false);
    }
  }, [
    api,
    appraisalId,
    canSubmit,
    condition,
    description,
    finenessDecimal,
    individualEur,
    itemType,
    karatCode,
    metal,
    name,
    qc,
    weightGrams,
  ]);

  return (
    <ParchmentCard padding="lg">
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: 'var(--w14-schrift-titel)',
        }}
      >
        Stück bewerten
      </h2>
      <p
        style={{
          margin: '4px 0 0',
          color: 'var(--w14-ink-faded)',
          fontFamily: 'var(--w14-font-display)',
          fontStyle: 'italic',
          fontSize: 'var(--w14-schrift-text)',
        }}
      >
        Eingaben werden sofort dem Konvolut hinzugefügt.
      </p>
      <Zwischentitel />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--w14-abstand-12)' }}>
        <Field label="Bezeichnung" value={name} onChange={setName} required colSpan={2} />
        <Select<AnkaufItemType>
          label="Typ"
          value={itemType}
          onChange={setItemType}
          options={ITEM_TYPE_OPTIONS}
        />
        <Select<AnkaufCondition>
          label="Zustand"
          value={condition}
          onChange={setCondition}
          options={CONDITION_OPTIONS}
        />
        <Select<AnkaufMetal | ''>
          label="Metall"
          value={metal}
          onChange={setMetal}
          options={[
            { value: '', label: '-' },
            { value: 'gold', label: 'Gold' },
            { value: 'silver', label: 'Silber' },
            { value: 'platinum', label: 'Platin' },
            { value: 'palladium', label: 'Palladium' },
          ]}
        />
        <Field label="Karat (z. B. K585)" value={karatCode} onChange={setKaratCode} mono />
        <Field
          label="Feingehalt (0…1)"
          value={finenessDecimal}
          onChange={setFinenessDecimal}
          mono
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)' }}>
          <Field label="Gewicht (g)" value={weightGrams} onChange={setWeightGrams} mono />
          {/* 0143: kein Pflichtfeld; NULL ist die Regel. Sichtbar fuer alle
              Typen — auch Schmuck traegt Gravuren. */}
          <Field label="Seriennummer (Uhr, Werk)" value={seriennummer} onChange={setSeriennummer} mono />
          <Field label="Gravur (wörtlich)" value={gravur} onChange={setGravur} />
          <Button variant="ghost" size="sm" onClick={() => void weighIn()} disabled={weighing}>
            {weighing ? 'Wägt…' : 'Von Waage übernehmen'}
          </Button>
        </div>
        <Field
          label="Beschreibung"
          value={description}
          onChange={setDescription}
          multiline
          colSpan={2}
        />
      </div>

      {/* Schmelzwert hint */}
      <SchmelzwertHint
        eur={schmelzwertEur}
        priceEur={ankaufRateForSelectedMetal}
        metal={metal === '' ? null : metal}
        loading={ratesQ.isLoading}
      />

      <Zwischentitel label="Individuelle Schätzung" />
      <Field
        label="Wert dieses Stücks (€)"
        value={individualEur}
        onChange={setIndividualEur}
        mono
        required
        colSpan={2}
      />

      {error && (
        <p
          role="alert"
          style={{
            color: 'var(--w14-wax-red)',
            margin: '14px 0 0',
            fontSize: 'var(--w14-schrift-betont)',
            textAlign: 'center',
          }}
        >
          {error}
        </p>
      )}

      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 'var(--w14-abstand-10)' }}>
        <Button variant="ghost" onClick={reset} disabled={submitting}>
          Zurücksetzen
        </Button>
        <Button variant="primary" size="lg" onClick={() => void submit()} disabled={!canSubmit}>
          {submitting ? 'Wird hinzugefügt…' : '+ Zum Konvolut hinzufügen'}
        </Button>
      </div>
    </ParchmentCard>
  );
}

function SchmelzwertHint({
  eur,
  priceEur,
  metal,
  loading,
}: {
  eur: string | null;
  priceEur: string | null;
  metal: AnkaufMetal | null;
  loading: boolean;
}): JSX.Element | null {
  if (loading) return null;
  if (eur === null) return null;
  return (
    <div
      style={{
        marginTop: 14,
        padding: 'var(--w14-abstand-10) var(--w14-abstand-14)',
        background: 'var(--w14-parchment-2)',
        border: '1px solid var(--w14-rule)',
        borderRadius: 'var(--w14-radius-card)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
      }}
    >
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)', letterSpacing: '0.08em' }}
      >
        Schmelzwert (Ankauf)
        {metal && priceEur && (
          <span style={{ marginLeft: 8, fontFamily: 'var(--w14-font-mono)', fontSize: 'var(--w14-schrift-zeile)' }}>
            {metal} @ {priceEur} €/g
          </span>
        )}
      </span>
      <MoneyAmount valueEur={eur} emphasis />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  required = false,
  mono = false,
  multiline = false,
  colSpan,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  mono?: boolean;
  multiline?: boolean;
  colSpan?: number;
}): JSX.Element {
  const style: React.CSSProperties = colSpan ? { gridColumn: `span ${colSpan}` } : {};
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)', ...style }}>
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-zeile)', letterSpacing: '0.08em' }}
      >
        {label}
        {required && <span style={{ color: 'var(--w14-wax-red)' }}> *</span>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(ev) => onChange(ev.target.value)}
          rows={2}
          style={{
            border: 'none',
            outline: 'none',
            borderBottom: '1px solid var(--w14-feldlinie)',
            background: 'transparent',
            padding: 'var(--w14-abstand-4)',
            resize: 'vertical',
            fontFamily: 'var(--w14-font-body)',
            fontSize: 'var(--w14-schrift-betont)',
            color: 'var(--w14-ink)',
          }}
        />
      ) : (
        <input
          type="text"
          value={value}
          spellCheck={false}
          onChange={(ev) => onChange(ev.target.value)}
          style={{
            border: 'none',
            outline: 'none',
            borderBottom: '1px solid var(--w14-feldlinie)',
            background: 'transparent',
            padding: 'var(--w14-abstand-4)',
            fontFamily: mono ? 'var(--w14-font-mono)' : 'var(--w14-font-body)',
            fontSize: 'var(--w14-schrift-betont)',
            color: 'var(--w14-ink)',
          }}
        />
      )}
    </label>
  );
}

function Select<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)' }}>
      <span
        className="w14-smallcaps"
        style={{ color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-zeile)', letterSpacing: '0.08em' }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(ev) => onChange(ev.target.value as T)}
        style={{
          border: 'none',
          outline: 'none',
          borderBottom: '1px solid var(--w14-feldlinie)',
          background: 'transparent',
          padding: 'var(--w14-abstand-4)',
          fontFamily: 'var(--w14-font-body)',
          fontSize: 'var(--w14-schrift-betont)',
          color: 'var(--w14-ink)',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

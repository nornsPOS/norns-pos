/**
 * Finanzen — Tier-2 Gewinnrechnung, Lagerwert und Ausgaben.
 *
 * Vier Endpunkte, die es im api-client seit langem gibt und die im Kassen-
 * programm bisher niemand gelesen hat: `/api/finance/profit`,
 * `/api/inventory/value`, `/api/inventory/metal-weights` und `/api/expenses`
 * (samt `/api/fixed-costs`).
 *
 * Zwei Regeln tragen diesen Bildschirm:
 *
 *   1. Der Server rechnet, nicht wir. Das Ergebnis der Gewinnrechnung steht so,
 *      wie es geliefert wurde. Wir summieren die Posten nicht nach und tun auch
 *      nicht so, als hätten wir sie geprüft.
 *   2. Ein fehlgeschlagener Aufruf zeigt einen Fehler, keine Null. Eine Null
 *      bedeutet „kein Umsatz", und das ist etwas völlig anderes als „nicht
 *      geladen".
 *
 * Alle Beträge kommen als ganze Cent vom Server und werden erst bei der Anzeige
 * geteilt. Das Anlegen von Ausgaben und Fixkosten verlangt ADMIN und eine
 * PIN-Bestätigung und ist noch nicht Teil dieses Bildschirms; die Liste ist es.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  ApiError,
  AUSGABE_ZAHLWEGE_WAEHLBAR,
  type AusgabeZahlwegWaehlbar,
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type FinancePeriod,
  closingsApi,
  expensesApi,
  financeApi,
  fixedCostsApi,
} from '@norns/api-client';
import {
  ausgabeZahlwegLabel,
  FINANCE_PERIOD_LABELS,
  type TrendDay,
  centsToDecimalString,
  closingsTrend,
  describeError,
  expenseCategoryLabel,
  formatCents,
  formatGrams,
  profitSteps,
} from '@norns/i18n-de';
import { Fensterboden, Button, Zwischentitel, MoneyAmount, ParchmentCard } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { isMoneyInput, normalizeDecimal } from '../../lib/decimal.js';
import { toCents } from '../../lib/money-core.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { eingereihtHinweis, istSicherEingereiht, ohneApiFehlerSatz } from '../../lib/eingereiht.js';

const PERIODS: readonly FinancePeriod[] = ['day', 'month'];

/**
 * Wie weit der Geschäftsverlauf zurückschaut. Die Zahl steht HIER, weil sie
 * sonst nirgends stünde: bis zum 13.08.2026 holte diese Fläche die Abschlüsse
 * mit `closingsApi.list(api)` ohne Zeitraum, und der Server gab dann still
 * seine eigene Vorgabe her. Ein Ausschnitt, den niemand gewählt hat, wird auf
 * dem Schirm zur Aussage über den ganzen Betrieb — genau die Verwechslung,
 * die der Leersatz darunter jetzt vermeidet.
 *
 * Neunzig Tage sind reichlich für die vierzehn Balken, die `closingsTrend`
 * zeichnet, auch wenn der Laden an Sonn- und Feiertagen zu hat.
 */
const VERLAUF_TAGE = 90;

/** Ein Datum als `JJJJ-MM-TT` in ORTSZEIT — `toISOString` verschöbe den Tag. */
function isoTag(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const t = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${t}`;
}

/** Der Zeitraum des Verlaufs, ausgesprochen statt dem Server überlassen. */
export function verlaufsZeitraum(jetzt: Date = new Date()): { von: string; bis: string } {
  const von = new Date(jetzt);
  von.setDate(von.getDate() - (VERLAUF_TAGE - 1));
  return { von: isoTag(von), bis: isoTag(jetzt) };
}

export function Finanzen(): JSX.Element {
  const api = useApiClient();
  const [period, setPeriod] = useState<FinancePeriod>('day');
  // Ausgaben und Fixkosten buchen verlangt die Ladenleitung; der Server erzwingt
  // ADMIN plus PIN-Bestätigung, die der api-client abfängt.
  const darfBuchen = useSessionStore((s) => s.actor?.role === 'ADMIN');
  const [expenseOpen, setExpenseOpen] = useState<boolean>(false);
  const [fixedOpen, setFixedOpen] = useState<boolean>(false);

  const profitQ = useQuery({
    queryKey: ['finance', 'profit', period],
    queryFn: () => financeApi.profit(api, { period }),
    staleTime: 30_000,
  });

  const inventoryQ = useQuery({
    queryKey: ['finance', 'inventory-value'],
    queryFn: () => financeApi.inventoryValue(api),
    staleTime: 60_000,
  });

  const metalsQ = useQuery({
    queryKey: ['finance', 'metal-weights'],
    queryFn: () => financeApi.metalWeights(api),
    staleTime: 60_000,
  });

  const expensesQ = useQuery({
    queryKey: ['finance', 'expenses', { limit: 25 }],
    queryFn: () => expensesApi.list(api, { limit: 25 }),
    staleTime: 30_000,
  });

  const fixedQ = useQuery({
    queryKey: ['finance', 'fixed-costs'],
    queryFn: () => fixedCostsApi.list(api, { activeOnly: true, limit: 25 }),
    staleTime: 60_000,
  });

  const verlauf = verlaufsZeitraum();
  const closingsQ = useQuery({
    // Der Zeitraum gehört in den Schlüssel, sonst klebt über Mitternacht die
    // Liste von gestern an einem Verlauf, der heute meint.
    queryKey: ['finance', 'closings-trend', verlauf.von, verlauf.bis],
    queryFn: () =>
      closingsApi.list(api, { from: verlauf.von, to: verlauf.bis, limit: VERLAUF_TAGE }),
    staleTime: 60_000,
  });
  const trend = closingsTrend(closingsQ.data?.items ?? []);

  return (
    <section
      aria-label="Finanzen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--w14-abstand-20)',
        gap: 'var(--w14-abstand-14)',
        overflowY: 'auto',
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
          Finanzen
        </h1>
        <div style={{ display: 'flex', gap: 'var(--w14-abstand-6)' }}>
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className="w14-smallcaps"
              style={{
                fontSize: 'var(--w14-schrift-zeile)',
                letterSpacing: '0.08em',
                padding: 'var(--w14-abstand-4) var(--w14-abstand-12)',
                cursor: 'pointer',
                borderRadius: 'var(--w14-radius-button)',
                border: `1px solid ${period === p ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
                background: period === p ? 'var(--w14-parchment-3)' : 'transparent',
                color: period === p ? 'var(--w14-gold)' : 'var(--w14-ink-aged)',
              }}
            >
              {FINANCE_PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </header>

      <Zwischentitel />

      {/* ── Gewinnrechnung ─────────────────────────────────────────────── */}
      <ParchmentCard padding="md">
        <Zwischentitel label={`Gewinnrechnung · ${FINANCE_PERIOD_LABELS[period]}`} />
        {profitQ.isLoading ? (
          <Lade />
        ) : profitQ.isError || !profitQ.data ? (
          <Fehler was="Die Gewinnrechnung" />
        ) : (
          <div style={{ display: 'grid', gap: 'var(--w14-abstand-2)', marginTop: 8 }}>
            {profitSteps(profitQ.data).map((step) => (
              <div
                key={step.label}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  alignItems: 'baseline',
                  gap: 'var(--w14-abstand-12)',
                  padding: 'var(--w14-abstand-8) 0',
                  borderTop: step.isResult ? '1px solid var(--w14-rule)' : undefined,
                  marginTop: step.isResult ? 6 : 0,
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: 'var(--w14-font-display)',
                      fontSize: step.isResult ? 'var(--w14-schrift-grund)' : 'var(--w14-schrift-betont)',
                      fontWeight: step.isResult ? 600 : 500,
                    }}
                  >
                    {step.label}
                  </div>
                  <div
                    style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)', lineHeight: 1.4 }}
                  >
                    {step.hint}
                  </div>
                </div>
                <MoneyAmount
                  valueEur={centsToDecimalString(step.cents)}
                  signed
                  {...(step.isResult ? { emphasis: true } : {})}
                />
              </div>
            ))}
          </div>
        )}
      </ParchmentCard>

      {/* ── Geschäftsverlauf (abgeschlossene Tage) ─────────────────────── */}
      <ParchmentCard padding="md">
        <Zwischentitel label={`Geschäftsverlauf · abgeschlossene Tage · ${VERLAUF_TAGE} Tage`} />
        {closingsQ.isLoading ? (
          <Lade />
        ) : closingsQ.isError ? (
          <Fehler was="Der Geschäftsverlauf" />
        ) : trend.length === 0 ? (
          // Der Satz spricht nur über den Zeitraum, den die Fläche wirklich
          // abgefragt hat. „Noch kein abgeschlossener Geschäftstag" wäre eine
          // Aussage über den ganzen Betrieb, gemessen an einem Ausschnitt.
          <Leer
            text={`In den letzten ${VERLAUF_TAGE} Tagen wurde kein Geschäftstag abgeschlossen. Der Verlauf zeigt nur finalisierte Tage.`}
          />
        ) : (
          <ClosingsTrendChart trend={trend} />
        )}
      </ParchmentCard>

      {/* ── Lagerwert + Metallgewichte ─────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--w14-abstand-12)',
        }}
      >
        <ParchmentCard padding="md">
          <Zwischentitel label="Lagerwert" />
          {inventoryQ.isLoading ? (
            <Lade />
          ) : inventoryQ.isError || !inventoryQ.data ? (
            <Fehler was="Der Lagerwert" />
          ) : (
            <div style={{ display: 'grid', gap: 'var(--w14-abstand-6)', marginTop: 8 }}>
              <Zeile
                label="Verkaufswert"
                wert={formatCents(inventoryQ.data.listValueCents)}
                hinweis="Summe der Verkaufspreise verfügbarer Artikel."
              />
              <Zeile
                label="Einkaufswert"
                wert={formatCents(inventoryQ.data.acquisitionValueCents)}
                hinweis="Was diese Artikel im Einkauf gekostet haben."
              />
              <Zeile
                label="Artikel verfügbar"
                wert={inventoryQ.data.availableCount.toLocaleString('de-DE')}
                hinweis="Nur verkaufsbereite Stücke, ohne Entwürfe."
              />
              <div style={{ borderTop: '1px solid var(--w14-rule)', marginTop: 6, paddingTop: 'var(--w14-abstand-6)' }}>
                <Zeile
                  label="Unrealisierte Marge"
                  wert={formatCents(
                    inventoryQ.data.listValueCents - inventoryQ.data.acquisitionValueCents,
                  )}
                  hinweis="Verkaufswert minus Einkaufswert. Erst beim Verkauf realisiert."
                />
              </div>
            </div>
          )}
        </ParchmentCard>

        <ParchmentCard padding="md">
          <Zwischentitel label="Edelmetall im Lager" />
          {metalsQ.isLoading ? (
            <Lade />
          ) : metalsQ.isError || !metalsQ.data ? (
            <Fehler was="Die Metallgewichte" />
          ) : (
            <div style={{ display: 'grid', gap: 'var(--w14-abstand-6)', marginTop: 8 }}>
              <Zeile label="Gold" wert={formatGrams(metalsQ.data.goldGrams)} />
              <Zeile label="Silber" wert={formatGrams(metalsQ.data.silverGrams)} />
              <Zeile label="Platin" wert={formatGrams(metalsQ.data.platinumGrams)} />
              <Zeile label="Palladium" wert={formatGrams(metalsQ.data.palladiumGrams)} />
            </div>
          )}
        </ParchmentCard>
      </div>

      {/* ── Ausgaben ───────────────────────────────────────────────────── */}
      <ParchmentCard padding="md">
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--w14-abstand-10)' }}
        >
          <div style={{ flex: 1 }}>
            <Zwischentitel label="Letzte Ausgaben" />
          </div>
          {darfBuchen && (
            <Button variant="ghost" size="sm" onClick={() => setExpenseOpen(true)}>
              + Ausgabe buchen
            </Button>
          )}
        </div>
        {expensesQ.isLoading ? (
          <Lade />
        ) : expensesQ.isError || !expensesQ.data ? (
          <Fehler was="Die Ausgaben" />
        ) : expensesQ.data.items.length === 0 ? (
          <Leer text="Für diesen Zeitraum ist keine Ausgabe gebucht." />
        ) : (
          <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 'var(--w14-abstand-2)' }}>
            {expensesQ.data.items.map((row) => (
              <li
                key={row.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '110px 1fr auto',
                  gap: 'var(--w14-abstand-12)',
                  alignItems: 'baseline',
                  padding: 'var(--w14-abstand-6) 0',
                  borderBottom: '1px solid var(--w14-rule)',
                }}
              >
                <span
                  className="w14-tabular"
                  style={{
                    fontFamily: 'var(--w14-font-mono)',
                    fontSize: 'var(--w14-schrift-zeile)',
                    color: 'var(--w14-ink-faded)',
                  }}
                >
                  {new Date(row.date).toLocaleDateString('de-DE')}
                </span>
                <span style={{ fontSize: 'var(--w14-schrift-text)' }}>
                  {expenseCategoryLabel(row.category)}
                  <span style={{ color: 'var(--w14-ink-faded)' }}>
                    {' '}
                    · {ausgabeZahlwegLabel(row.zahlweg)}
                  </span>
                  {row.note && (
                    <span style={{ color: 'var(--w14-ink-faded)' }}> · {row.note}</span>
                  )}
                </span>
                <MoneyAmount valueEur={centsToDecimalString(-row.amountCents)} signed />
              </li>
            ))}
          </ul>
        )}
        {!darfBuchen && (
          <p style={{ margin: '10px 0 0', fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
            Ausgaben bucht die Ladenleitung. Dieser Bildschirm zeigt sie nur.
          </p>
        )}
      </ParchmentCard>

      {/* ── Fixkosten ──────────────────────────────────────────────────── */}
      <ParchmentCard padding="md">
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--w14-abstand-10)' }}
        >
          <div style={{ flex: 1 }}>
            {/*
              ⚠️ 13.08.2026 — DIE UEBERSCHRIFT NENNT DIE ZAHL, WENN DIE SEITE
              NICHT ALLE TRAEGT.
              „Laufende Fixkosten" liest sich wie eine vollstaendige Liste. Sie
              holt aber hoechstens 25 Zeilen. Ein Betrieb mit mehr sah die
              ersten 25 und hielt sie fuer alle — und eine fehlende Fixkosten-
              zeile faellt erst auf, wenn die Monatsrechnung nicht aufgeht.
            */}
            <Zwischentitel
              label={
                fixedQ.data?.hasMore
                  ? `Laufende Fixkosten · ${fixedQ.data.items.length} von ${fixedQ.data.total}`
                  : 'Laufende Fixkosten'
              }
            />
          </div>
          {darfBuchen && (
            <Button variant="ghost" size="sm" onClick={() => setFixedOpen(true)}>
              + Fixkosten erfassen
            </Button>
          )}
        </div>
        {fixedQ.isLoading ? (
          <Lade />
        ) : fixedQ.isError || !fixedQ.data ? (
          <Fehler was="Die Fixkosten" />
        ) : fixedQ.data.items.length === 0 ? (
          <Leer text="Es sind keine laufenden Fixkosten hinterlegt." />
        ) : (
          <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 'var(--w14-abstand-2)' }}>
            {fixedQ.data.items.map((row) => (
              <li
                key={row.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 'var(--w14-abstand-12)',
                  alignItems: 'baseline',
                  padding: 'var(--w14-abstand-6) 0',
                  borderBottom: '1px solid var(--w14-rule)',
                }}
              >
                <span style={{ fontSize: 'var(--w14-schrift-text)' }}>
                  {row.label}
                  <span style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-zeile)' }}>
                    {' '}
                    · seit {new Date(row.activeFrom).toLocaleDateString('de-DE')}
                  </span>
                </span>
                <span className="w14-tabular" style={{ fontFamily: 'var(--w14-font-mono)' }}>
                  {formatCents(row.monthlyAmountCents)} / Monat
                </span>
              </li>
            ))}
          </ul>
        )}
      </ParchmentCard>

      {expenseOpen && <ExpenseDialog onClose={() => setExpenseOpen(false)} />}
      {fixedOpen && <FixedCostDialog onClose={() => setFixedOpen(false)} />}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Buch-Dialoge (ADMIN + Step-up über den api-client-Interceptor)
// ════════════════════════════════════════════════════════════════════════

/** Der heutige Tag als JJJJ-MM-TT (lokal), der Vorgabewert für eine Ausgabe. */
function heuteLokal(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Euro-Eingabe zu ganzen Cent. Der Server nimmt eine ganze Zahl Cent. */
function eurToCents(raw: string): number {
  return Number(toCents(normalizeDecimal(raw)));
}

function ExpenseDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [date, setDate] = useState<string>(heuteLokal());
  const [category, setCategory] = useState<ExpenseCategory>('WARENEINKAUF');
  const [amount, setAmount] = useState<string>('');
  // Kein Vorgabewert: der Zahlweg ist beim Anlegen Pflicht (migration 0133) —
  // eine stille Vorgabe würde die Lücke von vor dem 06.08.2026 von vorne
  // wieder aufmachen. Wer heute bucht, weiss, womit er bezahlt hat.
  const [zahlweg, setZahlweg] = useState<AusgabeZahlwegWaehlbar | ''>('');
  const [note, setNote] = useState<string>('');

  const amountValid = isMoneyInput(amount) && eurToCents(amount) > 0;
  const zahlwegValid = zahlweg !== '';

  const create = useMutation({
    mutationFn: () => {
      // `BuchAktionen` hält den Knopf gesperrt, bis ein Zahlweg gewählt ist;
      // das hier ist die defensive zweite Prüfung, nicht der erste Riegel.
      if (zahlweg === '') throw new Error('Zahlweg fehlt');
      return expensesApi.create(api, {
        date,
        category,
        amountCents: eurToCents(amount),
        zahlweg,
        ...(note.trim().length > 0 ? { note: note.trim() } : {}),
      });
    },
    onSuccess: async (row) => {
      addToast({
        tone: 'success',
        title: 'Ausgabe gebucht',
        body: `${expenseCategoryLabel(row.category)} · ${formatCents(row.amountCents)}`,
      });
      await qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    },
    onError: (err: unknown) => {
      // ⚠️ Eine Ausgabe ist eine BUCHUNG. Eingereiht heisst: sie liegt sicher
      // im Ausgangskorb. „Bitte erneut versuchen." erzeugte eine zweite
      // Buchung über denselben Betrag — und die fällt erst dem Steuerberater
      // auf, Monate später.
      if (istSicherEingereiht(err)) {
        addToast(eingereihtHinweis('Ausgabe'));
        onClose();
        return;
      }
      addToast({
        tone: 'alert',
        title: 'Buchung fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : ohneApiFehlerSatz(err),
      });
    },
  });

  return (
    <BuchDialog title="Ausgabe buchen" onClose={onClose}>
      <FeldLabel>Datum</FeldLabel>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={buchInput} />

      <FeldLabel>Kategorie</FeldLabel>
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
        style={buchInput}
      >
        {EXPENSE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {expenseCategoryLabel(c)}
          </option>
        ))}
      </select>

      <FeldLabel>Betrag (€)</FeldLabel>
      <input
        value={amount}
        inputMode="decimal"
        onChange={(e) => setAmount(e.target.value)}
        placeholder="z. B. 149,90"
        style={{ ...buchInput, fontFamily: 'var(--w14-font-mono)' }}
      />

      <FeldLabel>Zahlweg</FeldLabel>
      <select
        value={zahlweg}
        onChange={(e) => setZahlweg(e.target.value as AusgabeZahlwegWaehlbar)}
        style={buchInput}
      >
        <option value="" disabled>
          — bitte wählen —
        </option>
        {AUSGABE_ZAHLWEGE_WAEHLBAR.map((z) => (
          <option key={z} value={z}>
            {ausgabeZahlwegLabel(z)}
          </option>
        ))}
      </select>

      <FeldLabel>Notiz (optional)</FeldLabel>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        style={buchInput}
      />

      <BuchAktionen
        onClose={onClose}
        busy={create.isPending}
        disabled={!amountValid || !zahlwegValid || create.isPending}
        onSave={() => create.mutate()}
      />
    </BuchDialog>
  );
}

function FixedCostDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [label, setLabel] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [activeFrom, setActiveFrom] = useState<string>(heuteLokal());

  const labelValid = label.trim().length >= 2;
  const amountValid = isMoneyInput(amount) && eurToCents(amount) > 0;

  const create = useMutation({
    mutationFn: () =>
      fixedCostsApi.create(api, {
        label: label.trim(),
        monthlyAmountCents: eurToCents(amount),
        activeFrom,
      }),
    onSuccess: async (row) => {
      addToast({
        tone: 'success',
        title: 'Fixkosten erfasst',
        body: `${row.label} · ${formatCents(row.monthlyAmountCents)} / Monat`,
      });
      await qc.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    },
    onError: (err: unknown) => {
      // Dieselbe Lage wie bei der Ausgabe: doppelt erfasste Fixkosten
      // verfälschen jede Monatsrechnung, bis jemand sie von Hand findet.
      if (istSicherEingereiht(err)) {
        addToast(eingereihtHinweis('Fixkosten'));
        onClose();
        return;
      }
      addToast({
        tone: 'alert',
        title: 'Erfassen fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : ohneApiFehlerSatz(err),
      });
    },
  });

  return (
    <BuchDialog title="Fixkosten erfassen" onClose={onClose}>
      <FeldLabel>Bezeichnung</FeldLabel>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="z. B. Ladenmiete"
        maxLength={120}
        style={buchInput}
      />

      <FeldLabel>Monatlicher Betrag (€)</FeldLabel>
      <input
        value={amount}
        inputMode="decimal"
        onChange={(e) => setAmount(e.target.value)}
        placeholder="z. B. 1.200,00"
        style={{ ...buchInput, fontFamily: 'var(--w14-font-mono)' }}
      />

      <FeldLabel>Läuft seit</FeldLabel>
      <input
        type="date"
        value={activeFrom}
        onChange={(e) => setActiveFrom(e.target.value)}
        style={buchInput}
      />

      <BuchAktionen
        onClose={onClose}
        busy={create.isPending}
        disabled={!labelValid || !amountValid || create.isPending}
        onSave={() => create.mutate()}
      />
    </BuchDialog>
  );
}

function BuchDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Fensterboden><div
      role="dialog"
      aria-modal="true"
      aria-label={title}
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
        style={{ width: 'min(440px, 100%)' }}
      >
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-titel)',
          }}
        >
          {title}
        </h2>
        <Zwischentitel />
        {children}
      </ParchmentCard>
    </div></Fensterboden>
  );
}

function FeldLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
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
      {children}
    </label>
  );
}

function BuchAktionen({
  onClose,
  onSave,
  busy,
  disabled,
}: {
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
  disabled: boolean;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 'var(--w14-abstand-10)', justifyContent: 'flex-end', marginTop: 18 }}>
      <Button variant="ghost" onClick={onClose} disabled={busy}>
        Abbrechen
      </Button>
      <Button variant="primary" onClick={onSave} disabled={disabled}>
        {busy ? 'Bucht…' : 'Buchen'}
      </Button>
    </div>
  );
}

const buchInput: React.CSSProperties = {
  width: '100%',
  marginTop: 4,
  padding: 'var(--w14-abstand-8) var(--w14-abstand-10)',
  border: '1px solid var(--w14-feldlinie)',
  borderRadius: 'var(--w14-radius-fein)',
  backgroundColor: 'var(--w14-parchment)',
  fontFamily: 'var(--w14-font-body)',
  fontSize: 'var(--w14-schrift-text)',
  color: 'var(--w14-ink)',
  outline: 'none',
};

// ════════════════════════════════════════════════════════════════════════
// Kleinteile
// ════════════════════════════════════════════════════════════════════════

/**
 * ClosingsTrendChart — ehrliche vertikale Balken je abgeschlossenem Tag.
 * Verkauf (verdigris) und Ankauf (Messing) stehen nebeneinander, skaliert auf
 * den größten Wert im Fenster. Keine SVG-Abhängigkeit, keine erfundenen Punkte.
 */
function ClosingsTrendChart({ trend }: { trend: TrendDay[] }): JSX.Element {
  const max = Math.max(1, ...trend.map((d) => Math.max(d.verkauf, d.ankauf)));
  const gesamtFluss = trend.reduce((s, d) => s + d.fluss, 0);

  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 'var(--w14-abstand-6)',
          height: 120,
          overflowX: 'auto',
          paddingBottom: 'var(--w14-abstand-4)',
        }}
      >
        {trend.map((d) => (
          <div
            key={d.businessDay}
            title={`${new Date(d.businessDay).toLocaleDateString('de-DE')} · Verkauf ${d.verkauf.toLocaleString('de-DE', { minimumFractionDigits: 2 })} € · Ankauf ${d.ankauf.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--w14-abstand-2)',
              minWidth: 26,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--w14-abstand-2)', height: 96 }}>
              <div
                aria-hidden
                style={{
                  width: 9,
                  height: `${Math.round((d.verkauf / max) * 96)}px`,
                  background: 'var(--w14-verdigris)',
                  borderRadius: '2px 2px 0 0',
                }}
              />
              <div
                aria-hidden
                style={{
                  width: 9,
                  height: `${Math.round((d.ankauf / max) * 96)}px`,
                  background: 'var(--w14-gold)',
                  borderRadius: '2px 2px 0 0',
                }}
              />
            </div>
            <span
              className="w14-tabular"
              style={{
                fontFamily: 'var(--w14-font-mono)',
                fontSize: 'var(--w14-schrift-marke)',
                color: 'var(--w14-ink-faded)',
              }}
            >
              {d.businessDay.slice(5)}
            </span>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginTop: 10,
          gap: 'var(--w14-abstand-12)',
        }}
      >
        <div style={{ display: 'flex', gap: 'var(--w14-abstand-14)', fontSize: 'var(--w14-schrift-zeile)' }}>
          <LegendeDot farbe="var(--w14-verdigris)" text="Verkauf" />
          <LegendeDot farbe="var(--w14-gold)" text="Ankauf" />
        </div>
        <span style={{ fontSize: 'var(--w14-schrift-feld)', color: 'var(--w14-ink-aged)' }}>
          Nettozufluss im Zeitraum:{' '}
          <strong>
            {gesamtFluss.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
            €
          </strong>
        </span>
      </div>
    </div>
  );
}

function LegendeDot({ farbe, text }: { farbe: string; text: string }): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--w14-abstand-4)' }}>
      <span
        aria-hidden
        style={{ width: 9, height: 9, borderRadius: 2, background: farbe, display: 'inline-block' }}
      />
      <span style={{ color: 'var(--w14-ink-faded)' }}>{text}</span>
    </span>
  );
}

function Zeile({
  label,
  wert,
  hinweis,
}: {
  label: string;
  wert: string;
  hinweis?: string;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 'var(--w14-abstand-12)',
        alignItems: 'baseline',
        padding: 'var(--w14-abstand-4) 0',
      }}
    >
      <div>
        <div style={{ fontSize: 'var(--w14-schrift-text)' }}>{label}</div>
        {hinweis && (
          <div style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)', lineHeight: 1.4 }}>
            {hinweis}
          </div>
        )}
      </div>
      <span className="w14-tabular" style={{ fontFamily: 'var(--w14-font-mono)' }}>
        {wert}
      </span>
    </div>
  );
}

function Lade(): JSX.Element {
  return (
    <p style={{ margin: '8px 0 0', color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>Lädt…</p>
  );
}

/**
 * Ein gescheiterter Aufruf zeigt nie eine Null. „0,00 €" hieße „kein Umsatz",
 * und das wäre gelogen, solange wir die Zahl gar nicht kennen.
 */
function Fehler({ was }: { was: string }): JSX.Element {
  return (
    <p role="alert" style={{ margin: '8px 0 0', color: 'var(--w14-wax-red)', fontSize: 'var(--w14-schrift-text)' }}>
      {was} konnte nicht geladen werden. Die Zahl ist unbekannt, nicht null.
    </p>
  );
}

function Leer({ text }: { text: string }): JSX.Element {
  return (
    <p style={{ margin: '8px 0 0', color: 'var(--w14-ink-faded)', fontStyle: 'italic' }}>{text}</p>
  );
}

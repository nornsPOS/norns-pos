/**
 * KartenleserStripe — die Gruppe „Kartenleser (Stripe)" im Gerätemanager.
 *
 * Anders als die Nachbarn (Drucker, ZVT, TSE) wohnt hier KEINE lokale
 * Gerätekonfiguration: die Leser hängen am Stripe-Konto des Ladens, der
 * Server verwaltet sie (`/api/stripe/terminal/readers`). Die Kasse zeigt
 * nur ehrlich, was der Server weiss.
 *
 * Die Zustände (Ableitung in lib/kartenleser-zustand.ts, getestet):
 *   (a) kein Stripe-Konto  → ruhige Erklärung, kein Fehlerrot, kein Formular.
 *   (b) Konto, kein Leser  → Registrierung anbieten (Code vom Leser-Display).
 *   (c) Leser vorhanden    → Liste mit zuletzt gesehenem Stand.
 *   (d) 27.07.2026: antwortet Registrieren oder Entfernen mit 503, trägt der
 *       Server keinen Stripe-Schlüssel; eine alte Kontozeile in der Datenbank
 *       hatte dann veraltet „verbunden" gemeldet. Die Gruppe fällt in den
 *       ruhigen Nicht-eingerichtet-Zustand mit dem ehrlichen Satz dazu.
 *
 * Registrieren und Entfernen sind serverseitig ADMIN + Stufenanhebung —
 * die PIN-Abfrage öffnet die Stufen-Middleware von selbst, hier wird nur
 * der Abbruch erkannt (Muster ApiKeysSection). Die Anschrift des
 * Stripe-Standorts kommt aus der Ladenidentität (shop-info), nie erfunden.
 */

import { useCallback, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { ApiError, stripeTerminalApi, type TerminalLeser } from '@norns/api-client';
import { Button, Zwischentitel, Input, ParchmentCard } from '@norns/ui-kit';

import { HardwareStatusBadge } from '../../components/hardware/HardwareStatusBadge.js';
import { useApiClient } from '../../lib/api-context.js';
import { LESER_ZIEL } from '../../lib/bedienziele.js';
import {
  anschriftAusLaden,
  beschreibeLeserAktionsFehler,
  geraeteTypText,
  istStripeNichtEingerichtet,
  kontoAuskunftAusFehler,
  kontoAuskunftAusStatus,
  leiteLeserGruppeAb,
  leserStandText,
  leserStandTon,
  pruefeRegistrierung,
  type KontoAuskunft,
  type KontoStatusPayload,
} from '../../lib/kartenleser-zustand.js';
import { resolveShopInfo, type ShopInfoApi } from '../../lib/shop-info.js';
import { isStepUpCancelled } from '../../state/step-up-store.js';
import { useSessionStore } from '../../state/session-store.js';
import { useToastStore } from '../../state/toast-store.js';

export function KartenleserStripeSection(): JSX.Element {
  const api = useApiClient();
  const istAdmin = useSessionStore((s) => s.actor?.role === 'ADMIN');

  // 27.07.2026: eine alte Kontozeile in der Datenbank kann connected=true
  // behaupten, obwohl der Server keinen Stripe-Schlüssel trägt; der Status-Weg
  // liefert dann nur den zuletzt bekannten, VERALTETEN Stand. Erst der 503
  // beim Registrieren oder Entfernen sagt die Wahrheit. Ab dieser Antwort
  // fällt die Gruppe hier in den ruhigen Nicht-eingerichtet-Zustand, statt
  // weiter das Formular über einem toten Konto zu zeigen. Bewusst nur
  // Sitzungs-Zustand: beim nächsten Öffnen wird frisch gefragt.
  const [schluesselFehlt, setSchluesselFehlt] = useState(false);
  const meldeSchluesselFehlt = useCallback(() => setSchluesselFehlt(true), []);

  // Die Liste — jeder Angemeldete darf sie lesen; der Server frischt den
  // zuletzt gesehenen Gerätestand dabei selbst auf.
  const leserQuery = useQuery({
    queryKey: ['stripe-terminal', 'leser'],
    queryFn: () => stripeTerminalApi.leserListe(api),
    staleTime: 30_000,
  });

  // Der Kontostand — NUR der Inhaber darf ihn abfragen; darum wird der
  // Fehler INNERHALB der queryFn in eine ehrliche Auskunft übersetzt
  // (403 → NUR_INHABER, Netz → GESTOERT) statt als React-Query-Fehler
  // zu landen, der wie ein kaputtes System aussähe.
  const kontoQuery = useQuery<KontoAuskunft>({
    queryKey: ['stripe-terminal', 'konto'],
    enabled: istAdmin,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        return kontoAuskunftAusStatus(
          await api.request<KontoStatusPayload>('GET', '/api/stripe/connect/status'),
        );
      } catch (err) {
        return kontoAuskunftAusFehler(err);
      }
    },
  });

  // Die Ladenanschrift für den Stripe-Standort. Scheitert der Abruf, trägt
  // die gebündelte Identität (resolveShopInfo(undefined)) — nie ein Platzhalter.
  const shopQuery = useQuery({
    queryKey: ['shop-info'],
    staleTime: 300_000,
    queryFn: async () => {
      try {
        return await api.request<ShopInfoApi>('GET', '/api/shop-info');
      } catch {
        return undefined;
      }
    },
  });

  const konto: KontoAuskunft = schluesselFehlt
    ? { art: 'SCHLUESSEL_FEHLT' }
    : istAdmin
      ? (kontoQuery.data ?? { art: 'LAEDT' })
      : { art: 'LAEDT' };
  const leser = leserQuery.data ? leserQuery.data.leser : null;
  const gruppe = leiteLeserGruppeAb({ istAdmin, konto, leser });
  const anschrift = anschriftAusLaden(resolveShopInfo(shopQuery.data));

  const aktualisieren = useCallback(async (): Promise<void> => {
    await Promise.all([leserQuery.refetch(), istAdmin ? kontoQuery.refetch() : Promise.resolve()]);
  }, [leserQuery, kontoQuery, istAdmin]);

  return (
    <ParchmentCard padding="md" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-10)' }}>
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--w14-font-display)',
          fontWeight: 500,
          fontSize: 'var(--w14-schrift-grund)',
        }}
      >
        Kartenleser (Stripe)
      </h2>
      <Zwischentitel />

      {leserQuery.isError ? (
        // Die Liste selbst ist nicht abrufbar (Netz/Server). Das ist ein
        // anderer Zustand als „keine Leser" — er wird nicht so genannt.
        <Zeile>
          <Hinweis>
            Die Leser-Liste ist gerade nicht abrufbar. Bestehende Leser bleiben bei Stripe
            registriert. Bitte später erneut öffnen.
          </Hinweis>
          <Button variant="ghost" onClick={() => void aktualisieren()}>
            Erneut versuchen
          </Button>
        </Zeile>
      ) : gruppe.art === 'LAEDT' ? (
        <Zeile>
          <Hinweis>Der Stand der Kartenleser wird geladen…</Hinweis>
        </Zeile>
      ) : gruppe.art === 'OHNE_KONTO' ? (
        // (a) Ruhig, kein Fehlerrot: der Weg erscheint erst mit dem Konto.
        <Zeile>
          <Hinweis>{gruppe.erklaerung}</Hinweis>
          <span style={{ flex: 1 }} />
          <HardwareStatusBadge tone="pending" label="Nicht eingerichtet" />
        </Zeile>
      ) : gruppe.art === 'NUR_INHABER' ? (
        <Zeile>
          <Hinweis>{gruppe.erklaerung}</Hinweis>
        </Zeile>
      ) : gruppe.art === 'AUSKUNFT_GESTOERT' ? (
        <Zeile>
          <Hinweis>{gruppe.erklaerung}</Hinweis>
          <Button variant="ghost" onClick={() => void aktualisieren()}>
            Erneut versuchen
          </Button>
        </Zeile>
      ) : (
        <>
          {gruppe.art === 'LISTE' && (
            <LeserListe
              leser={leser ?? []}
              entfernenErlaubt={gruppe.registrierenErlaubt}
              onEntfernt={() => void leserQuery.refetch()}
              onNichtEingerichtet={meldeSchluesselFehlt}
            />
          )}
          {gruppe.kontoHinweis !== null && (
            <Zeile>
              <Hinweis>{gruppe.kontoHinweis}</Hinweis>
            </Zeile>
          )}
          {(gruppe.art === 'REGISTRIERUNG' || gruppe.registrierenErlaubt) && (
            <LeserRegistrieren
              anschrift={anschrift}
              onRegistriert={() => void leserQuery.refetch()}
              onNichtEingerichtet={meldeSchluesselFehlt}
            />
          )}
        </>
      )}
    </ParchmentCard>
  );
}

// ── (c) Die Liste ──────────────────────────────────────────────────────────

function LeserListe({
  leser,
  entfernenErlaubt,
  onEntfernt,
  onNichtEingerichtet,
}: {
  leser: readonly TerminalLeser[];
  entfernenErlaubt: boolean;
  onEntfernt: () => void;
  /** 27.07.2026: ein 503 der Aktion meldet den fehlenden Server-Schlüssel nach oben. */
  onNichtEingerichtet: () => void;
}): JSX.Element {
  const api = useApiClient();
  const addToast = useToastStore((s) => s.addToast);
  const [entferne, setEntferne] = useState<string | null>(null);

  const entfernen = useCallback(
    async (zeile: TerminalLeser): Promise<void> => {
      // Bestätigung im Haus-Stil (SignOutFooter): entfernen wirkt bei Stripe
      // UND hier — das sagt der Satz, bevor etwas geschieht.
      const sicher = window.confirm(
        `Leser „${zeile.bezeichnung}" wirklich entfernen?\n` +
          'Er wird auch bei Stripe abgemeldet und kann danach keine Zahlungen mehr annehmen.',
      );
      if (!sicher) return;
      setEntferne(zeile.id);
      try {
        await stripeTerminalApi.leserEntfernen(api, zeile.id);
        addToast({
          tone: 'success',
          title: 'Leser entfernt',
          body: `„${zeile.bezeichnung}" ist bei Stripe abgemeldet.`,
        });
        onEntfernt();
      } catch (err) {
        if (isStepUpCancelled(err) || (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED')) {
          addToast({
            tone: 'alert',
            title: 'Abgebrochen',
            body: 'Die PIN-Bestätigung wurde abgebrochen.',
          });
        } else {
          // Der 503 sagt: kein Stripe-Schlüssel auf dem Server. Neben dem
          // ruhigen Hinweis kippt die Gruppe in den Nicht-eingerichtet-Zustand.
          if (istStripeNichtEingerichtet(err)) onNichtEingerichtet();
          const b = beschreibeLeserAktionsFehler(err);
          addToast({ tone: 'alert', title: b.titel, body: b.text });
        }
      } finally {
        setEntferne(null);
      }
    },
    [api, addToast, onEntfernt, onNichtEingerichtet],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-8)' }}>
      {leser.map((zeile) => (
        <div
          key={zeile.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--w14-abstand-12)',
            flexWrap: 'wrap',
            padding: 'var(--w14-abstand-8) var(--w14-abstand-10)',
            border: '1px solid var(--w14-rule)',
            borderRadius: 'var(--w14-radius-fein)',
            background: 'var(--w14-parchment-1)',
          }}
        >
          <span style={{ display: 'grid', gap: 'var(--w14-abstand-2)', minWidth: 180 }}>
            <span style={{ fontFamily: 'var(--w14-font-display)', fontWeight: 500 }}>
              {zeile.bezeichnung}
            </span>
            <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
              {[geraeteTypText(zeile.geraetetyp), zeile.seriennummer].filter(Boolean).join(' · ') ||
                zeile.providerReaderId}
            </span>
          </span>
          <span style={{ flex: 1 }} />
          <HardwareStatusBadge
            tone={leserStandTon(zeile.status)}
            label={leserStandText(zeile.status)}
          />
          <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
            registriert am {formatiereDatum(zeile.registriertAm)}
          </span>
          {entfernenErlaubt && (
            <Button
              variant="ghost"
              style={{ minHeight: LESER_ZIEL }}
              disabled={entferne !== null}
              onClick={() => void entfernen(zeile)}
            >
              {entferne === zeile.id ? 'Entfernt…' : 'Entfernen'}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── (b) Die Registrierung ──────────────────────────────────────────────────

function LeserRegistrieren({
  anschrift,
  onRegistriert,
  onNichtEingerichtet,
}: {
  anschrift: ReturnType<typeof anschriftAusLaden>;
  onRegistriert: () => void;
  /** 27.07.2026: ein 503 der Aktion meldet den fehlenden Server-Schlüssel nach oben. */
  onNichtEingerichtet: () => void;
}): JSX.Element {
  const api = useApiClient();
  const addToast = useToastStore((s) => s.addToast);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const registrieren = useCallback(async (): Promise<void> => {
    const pruefung = pruefeRegistrierung({ code, name });
    if (!pruefung.gueltig) {
      addToast({ tone: 'alert', title: 'Angaben unvollständig', body: pruefung.grund });
      return;
    }
    if (anschrift === null) {
      // Der Stripe-Standort braucht die echte Ladenanschrift; erfinden ist
      // tabu (dieselbe Doktrin wie beim Beleg).
      addToast({
        tone: 'alert',
        title: 'Ladenanschrift unvollständig',
        body: 'Für den Stripe-Standort fehlt eine vollständige Anschrift (Straße, PLZ Ort). Bitte zuerst unter „Beleg & Shop" ergänzen.',
      });
      return;
    }
    setBusy(true);
    try {
      const zeile = await stripeTerminalApi.leserRegistrieren(api, {
        registrationCode: code.trim(),
        label: name.trim(),
        anschrift,
      });
      addToast({
        tone: 'success',
        title: 'Leser registriert',
        body: `„${zeile.bezeichnung}" ist jetzt mit dem Stripe-Konto verbunden.`,
      });
      setCode('');
      setName('');
      onRegistriert();
    } catch (err) {
      if (isStepUpCancelled(err) || (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED')) {
        addToast({
          tone: 'alert',
          title: 'Abgebrochen',
          body: 'Die PIN-Bestätigung wurde abgebrochen.',
        });
      } else {
        // Der 503 sagt: kein Stripe-Schlüssel auf dem Server. Die alte
        // Kontozeile hat also gelogen; die Gruppe fällt in den ruhigen
        // Nicht-eingerichtet-Zustand statt das Formular stehen zu lassen.
        if (istStripeNichtEingerichtet(err)) onNichtEingerichtet();
        const b = beschreibeLeserAktionsFehler(err);
        addToast({ tone: 'alert', title: b.titel, body: b.text });
      }
    } finally {
      setBusy(false);
    }
  }, [api, addToast, anschrift, code, name, onRegistriert, onNichtEingerichtet]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-8)' }}>
      <Hinweis>
        Neuen Leser verbinden: am Gerät die Registrierung öffnen, den angezeigten Code hier
        abtippen und dem Leser einen Namen geben.
      </Hinweis>
      <Zeile>
        <label
          htmlFor="stripe-leser-code"
          className="w14-smallcaps"
          style={{ letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)', minWidth: 110 }}
        >
          Registrierungscode
        </label>
        {/* Das Code-Feld ist das grösste Ziel der Gruppe: es wird am
            Touchbildschirm abgetippt, während man aufs Leser-Display schaut. */}
        <Input
          id="stripe-leser-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Code vom Display des Lesers"
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: '1 1 240px',
            minHeight: LESER_ZIEL,
            fontFamily: 'var(--w14-font-mono)',
            fontSize: 'var(--w14-schrift-lead)',
          }}
        />
      </Zeile>
      <Zeile>
        <label
          htmlFor="stripe-leser-name"
          className="w14-smallcaps"
          style={{ letterSpacing: '0.08em', fontSize: 'var(--w14-schrift-zeile)', minWidth: 110 }}
        >
          Name
        </label>
        <Input
          id="stripe-leser-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z. B. Tresen links"
          autoComplete="off"
          style={{
            width: 240,
            minHeight: LESER_ZIEL,
            fontFamily: 'var(--w14-font-display)',
            fontSize: 'var(--w14-schrift-betont)',
          }}
        />
        <Button
          variant="primary"
          style={{ minHeight: LESER_ZIEL }}
          disabled={busy}
          onClick={() => void registrieren()}
        >
          {busy ? 'Registriert…' : 'Leser registrieren'}
        </Button>
      </Zeile>
    </div>
  );
}

// ── Kleinteile im Idiom des Gerätemanagers ─────────────────────────────────

function Zeile({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-10)', flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}

function Hinweis({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-feld)', maxWidth: 640 }}>
      {children}
    </span>
  );
}

function formatiereDatum(iso: string): string {
  try {
    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

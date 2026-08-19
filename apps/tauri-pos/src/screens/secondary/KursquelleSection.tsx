/**
 * Woher der Metallkurs kommt. Eine Frage, drei Antworten, ein Klick.
 *
 * ── BASELS ANWEISUNG VOM 02.08.2026 ────────────────────────────────────────
 *
 * Wörtlich: der Inhaber soll die Quelle wählen und zwischen mehreren
 * vertrauenswürdigen Quellen wechseln können, in den Einstellungen. Und wenn
 * kein Netz da ist, soll er den Kurs von Hand eintragen können. Die Bedienung
 * einfach, die Maschinerie dahinter gewaltig.
 *
 * ── WAS VORHER WAR ─────────────────────────────────────────────────────────
 *
 * ⚠️ Der Schalter für die Herkunft des Dollarkurses EXISTIERTE schon, seit dem
 * 31.07.2026, im Kursdienst gelesen und befolgt. Nur konnte ihn niemand
 * stellen: es gab kein Feld, keinen Weg, keine Erwähnung. Ein Schalter, den
 * kein Mensch erreicht, ist kein Schalter. Das ist in diesem Haus die
 * häufigste Klasse, „Sperre ohne Ausgang", und dies ist ihr Ausgang.
 *
 * ── WARUM DIE WAHL ÜBERHAUPT ZÄHLT ─────────────────────────────────────────
 *
 * Am Metallkurs hängt der ANKAUFPREIS. Eine einzige Quelle ist ein einzelner
 * Ausfallpunkt: fällt sie aus, altert der Kurs still, und der Händler kauft
 * Gold zum Kurs von vorgestern, ohne dass ihm jemand etwas sagt. Zwei
 * unabhängige Häuser sind zwei unabhängige Ausfälle.
 *
 * Und die Umrechnung selbst ist eine Fehlerquelle: der Anbieterkurs statt des
 * amtlichen kostete gemessen 253,50 Euro je Kilogramm Feingold, immer in
 * dieselbe Richtung. Bei Swissquote kommen Gold und Silber direkt in Euro,
 * dann entfällt die Umrechnung ganz.
 *
 * ── WARUM „NUR VON HAND" GLEICHBERECHTIGT DASTEHT ──────────────────────────
 *
 * Nicht als Notbehelf im Kleingedruckten, sondern als dritte Karte in
 * derselben Reihe. Wer einen festen Tageskurs mit seiner Scheideanstalt
 * vereinbart hat, will genau das. Und ein Laden ohne Netz ist kein Sonderfall,
 * sondern Basels ausdrückliche Betriebsart.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@norns/api-client';
import { describeError } from '@norns/i18n-de';
import { Button, Zwischentitel, InfoPunkt, ParchmentCard } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';
import {
  dollarkursSpieltEineRolle,
  FXQUELLE_VORGABE,
  FXQUELLEN,
  METALLQUELLE_VORGABE,
  METALLQUELLEN,
  type QuellenEintrag,
  SCHLUESSEL_FXQUELLE,
  SCHLUESSEL_METALLQUELLE,
} from './kursquellen-vokabular.js';

interface SettingsAntwort {
  settings: Array<{ key: string; value: string }>;
}

/** Der Server liefert jsonb als Text; die Anführungszeichen gehören nicht ins Feld. */
function auspacken(roh: string): string {
  const s = (roh ?? '').trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try {
      return String(JSON.parse(s));
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

/**
 * Eine Wahlkarte.
 *
 * Bewusst kein Auswahlfeld: bei drei Möglichkeiten, von denen jede eine
 * Erklärung braucht, versteckt ein zugeklapptes Feld genau die Erklärung, die
 * die Entscheidung trägt. Nebeneinander steht alles gleichzeitig da.
 */
function Wahlkarte({
  eintrag,
  gewaehlt,
  onWaehlen,
  name,
}: {
  eintrag: QuellenEintrag;
  gewaehlt: boolean;
  onWaehlen: () => void;
  name: string;
}): JSX.Element {
  return (
    <label
      style={{
        display: 'grid',
        gap: 'var(--w14-abstand-4)',
        padding: 'var(--w14-abstand-12) var(--w14-abstand-14)',
        minHeight: 48,
        cursor: 'pointer',
        borderRadius: 'var(--w14-radius-card)',
        border: gewaehlt ? '1px solid var(--w14-gold)' : '1px solid var(--w14-rule)',
        background: gewaehlt ? 'var(--w14-parchment-2)' : 'var(--w14-parchment-3)',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--w14-abstand-10)' }}>
        <input
          type="radio"
          name={name}
          checked={gewaehlt}
          onChange={onWaehlen}
          style={{ width: 18, height: 18, accentColor: 'var(--w14-gold)' }}
        />
        <strong style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink)' }}>
          {eintrag.name}
        </strong>
      </span>
      <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink)' }}>
        {eintrag.was}
      </span>
      {eintrag.fussnote === '' ? null : (
        <span style={{ fontSize: 'var(--w14-schrift-fussnote)', color: 'var(--w14-ink-faded)' }}>
          {eintrag.fussnote}
        </span>
      )}
    </label>
  );
}

export function KursquelleSection(): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const abfrage = useQuery({
    queryKey: ['settings', 'kursquelle'],
    queryFn: () => api.request<SettingsAntwort>('GET', '/api/settings'),
  });

  const [metall, setMetall] = useState<string>(METALLQUELLE_VORGABE);
  const [fx, setFx] = useState<string>(FXQUELLE_VORGABE);
  const [basis, setBasis] = useState<{ metall: string; fx: string } | null>(null);

  useEffect(() => {
    if (abfrage.data === undefined || basis !== null) return;
    const lies = (schluessel: string, vorgabe: string): string => {
      const roh = abfrage.data.settings.find((z) => z.key === schluessel)?.value;
      const wert = auspacken(roh ?? '');
      return wert === '' ? vorgabe : wert;
    };
    const naechst = {
      metall: lies(SCHLUESSEL_METALLQUELLE, METALLQUELLE_VORGABE),
      fx: lies(SCHLUESSEL_FXQUELLE, FXQUELLE_VORGABE),
    };
    setMetall(naechst.metall);
    setFx(naechst.fx);
    setBasis(naechst);
  }, [abfrage.data, basis]);

  const geaendert = basis !== null && (basis.metall !== metall || basis.fx !== fx);
  const fxZaehlt = dollarkursSpieltEineRolle(metall);

  /** Was die Kasse nach dem Speichern TUT. Ein Satz, keine Liste. */
  const folge = useMemo(() => {
    if (metall === 'HAND') {
      return (
        'Die Kasse ruft keinen Kursdienst mehr auf. Es gilt der zuletzt eingetragene ' +
        'Kurs, unverändert, bis Sie ihn unter Kurse neu eintragen.'
      );
    }
    const q = METALLQUELLEN.find((e) => e.kennung === metall);
    return (
      `Die Kasse holt den Kurs alle fünf Minuten bei ${q?.name ?? metall}. ` +
      'Ohne Netz ist das kein Fehler: der letzte Kurs bleibt stehen und die Kursfläche ' +
      'zeigt sein Alter. Von Hand eintragen können Sie jederzeit.'
    );
  }, [metall]);

  const speichern = useMutation({
    mutationFn: async () => {
      if (basis === null) return;
      if (basis.metall !== metall) {
        await api.request('PATCH', `/api/settings/${SCHLUESSEL_METALLQUELLE}`, { value: metall });
      }
      if (basis.fx !== fx) {
        await api.request('PATCH', `/api/settings/${SCHLUESSEL_FXQUELLE}`, { value: fx });
      }
    },
    onSuccess: async () => {
      addToast({
        tone: 'success',
        title: 'Kursquelle gespeichert',
        body: folge,
      });
      setBasis(null);
      await qc.invalidateQueries({ queryKey: ['settings', 'kursquelle'] });
      await qc.invalidateQueries({ queryKey: ['metal-prices'] });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Speichern fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });

  return (
    <ParchmentCard>
      <div style={{ display: 'grid', gap: 'var(--w14-abstand-12)' }}>
        <div style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
          <strong
            style={{
              fontFamily: 'var(--w14-font-display)',
              fontSize: 'var(--w14-schrift-titel)',
              color: 'var(--w14-ink)',
            }}
          >
            Woher die Metallkurse kommen
          </strong>
          <p
            style={{
              margin: 0,
              fontSize: 'var(--w14-schrift-zeile)',
              color: 'var(--w14-ink-faded)',
            }}
          >
            An diesem Kurs hängt jeder Ankaufpreis. Sie entscheiden, wem die Kasse dabei
            glaubt. Wechseln können Sie jederzeit, und von Hand eintragen ebenfalls.
          </p>
        </div>

        <Zwischentitel />

        <div style={{ display: 'grid', gap: 'var(--w14-abstand-10)' }}>
          {METALLQUELLEN.map((e) => (
            <Wahlkarte
              key={e.kennung}
              eintrag={e}
              name="kurs-metallquelle"
              gewaehlt={metall === e.kennung}
              onWaehlen={() => setMetall(e.kennung)}
            />
          ))}
        </div>

        {fxZaehlt ? (
          <>
            <Zwischentitel />
            <div style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
              <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink)' }}>
                Und woher der Dollarkurs für die Umrechnung
                <InfoPunkt text="Kurse in Dollar müssen in Euro umgerechnet werden. Welchen Umrechnungskurs die Kasse dafür nimmt, ist eine eigene Entscheidung: der amtliche Kurs der Zentralbank ist derselbe, den auch das Finanzamt ansetzt. Der Kurs des Kursanbieters ist frischer, wich aber gemessen um 253,50 Euro je Kilogramm Feingold ab, immer in dieselbe Richtung." />
              </span>
              <div style={{ display: 'grid', gap: 'var(--w14-abstand-10)' }}>
                {FXQUELLEN.map((e) => (
                  <Wahlkarte
                    key={e.kennung}
                    eintrag={e}
                    name="kurs-fxquelle"
                    gewaehlt={fx === e.kennung}
                    onWaehlen={() => setFx(e.kennung)}
                  />
                ))}
              </div>
            </div>
          </>
        ) : null}

        <p
          style={{
            margin: 0,
            fontSize: 'var(--w14-schrift-fussnote)',
            color: 'var(--w14-ink-faded)',
          }}
        >
          {folge}
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="primary"
            size="md"
            disabled={!geaendert || speichern.isPending}
            onClick={() => speichern.mutate()}
          >
            {speichern.isPending ? 'Wird gespeichert' : 'Kursquelle speichern'}
          </Button>
        </div>
      </div>
    </ParchmentCard>
  );
}

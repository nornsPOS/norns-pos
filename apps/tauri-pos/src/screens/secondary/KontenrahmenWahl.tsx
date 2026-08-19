/**
 * Die Wahl des Kontenrahmens beim DATEV-Export — SKR03 oder SKR04.
 *
 * Seit dem 26.07.2026 nimmt `GET /api/closings/:id/export/datev` den Parameter
 * `?kontenrahmen=` entgegen. Diese Datei ist die eine Stelle, an der die Kasse
 * ihn erhebt; beide Export-Knöpfe (Steuer-Export und die Einstellungs-Sektion)
 * greifen darauf zu, damit sie nicht auseinanderlaufen.
 *
 * ── WARUM „Gespeicherte Einstellung" EIN EIGENER EINTRAG IST ───────────────
 * Der naheliegende Bau wäre gewesen: die gespeicherte Einstellung lesen, sie in
 * die Auswahl setzen und beim Export IMMER einen Rahmen mitschicken. Das ist
 * hier falsch, aus zwei Gründen.
 *
 *   1. `GET /api/settings/datev` verlangt ADMIN. Der Steuerberater arbeitet als
 *      READONLY und bekommt 403 — er könnte die gespeicherte Einstellung also
 *      gar nicht lesen. Eine Oberfläche, die dann vorsichtshalber „SKR03"
 *      einsetzt, ÜBERSTIMMT eine Einstellung, die sie nie gesehen hat.
 *   2. Ohne Parameter entscheidet der Server anhand von
 *      `datev.sachkontenrahmen`. Das ist die einzige Antwort, die auch dann
 *      stimmt, wenn wir nichts wissen.
 *
 * Deshalb: der leere Wert bedeutet „kein Parameter". Die gespeicherte Zahl
 * steht nur dann in der Beschriftung, wenn wir sie WIRKLICH gelesen haben.
 *
 * Die einzelnen Kontonummern werden hier NICHT geändert. Sie liegen in den
 * Einstellungen (`PATCH /api/settings/datev/:key`); darauf weist der Hinweis
 * unter der Auswahl hin.
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import {
  ApiError,
  type DatevKontenrahmen,
  type DatevSettings,
  settingsDatevApi,
} from '@norns/api-client';
import { Select } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';

/** Leerer Wert = kein Parameter = der Server nimmt die gespeicherte Einstellung. */
export type RahmenWahl = '' | DatevKontenrahmen;

/**
 * Aus der Auswahl den Wert für die api-client-Methoden machen.
 * `''` → `undefined`, also KEIN Parameter im Pfad.
 */
export function rahmenParameter(wahl: RahmenWahl): DatevKontenrahmen | undefined {
  return wahl === '' ? undefined : wahl;
}

export interface KontenrahmenStand {
  wahl: RahmenWahl;
  setWahl: (w: RahmenWahl) => void;
  /** Der gespeicherte Rahmen — nur gesetzt, wenn wir ihn gelesen haben. */
  gespeichert: string | null;
  /** Beschriftungen der Rahmen, wie der SERVER sie nennt. Leer, wenn ungelesen. */
  optionen: DatevSettings['verfuegbareRahmen'];
  /** Wahr, solange der Leseversuch läuft. */
  laedt: boolean;
  /** Warum wir die Einstellung nicht kennen — oder `null`, wenn wir sie kennen. */
  ungelesenGrund: string | null;
}

/**
 * Liest die gespeicherte Einstellung, wenn die Rolle es erlaubt, und hält die
 * getroffene Wahl. Ein 403 ist hier KEIN Fehler, sondern die Rechtelage: der
 * Steuerberater darf exportieren, aber nicht die Einstellungen sehen.
 */
export function useKontenrahmenWahl(): KontenrahmenStand {
  const api = useApiClient();
  const [wahl, setWahl] = useState<RahmenWahl>('');

  const q = useQuery({
    queryKey: ['settings', 'datev', 'rahmen'],
    queryFn: () => settingsDatevApi.lesen(api),
    // Die Rechtelage ändert sich nicht durch Wiederholen.
    retry: false,
    staleTime: 5 * 60_000,
  });

  const fehler = q.error;
  const verboten =
    fehler instanceof ApiError && (fehler.httpStatus === 403 || fehler.httpStatus === 401);

  return {
    wahl,
    setWahl,
    gespeichert: q.data?.rahmen ?? null,
    optionen: q.data?.verfuegbareRahmen ?? [],
    laedt: q.isLoading,
    ungelesenGrund:
      q.data != null
        ? null
        : q.isLoading
          ? 'Die gespeicherte Einstellung wird gelesen.'
          : verboten
            ? 'Die gespeicherte Einstellung ist nur für den Inhaber sichtbar. Ohne eigene Wahl gilt sie trotzdem, der Server setzt sie ein.'
            : 'Die gespeicherte Einstellung konnte nicht gelesen werden. Ohne eigene Wahl gilt sie trotzdem, der Server setzt sie ein.',
  };
}

/**
 * Die Auswahl plus der ruhige Hinweis darunter.
 *
 * `hinweisZeigen={false}` für Stellen, die den Hinweis schon selbst tragen.
 */
export function KontenrahmenWahl({
  stand,
  disabled,
  hinweisZeigen = true,
  id = 'datev-kontenrahmen',
}: {
  stand: KontenrahmenStand;
  disabled?: boolean;
  hinweisZeigen?: boolean;
  id?: string;
}): JSX.Element {
  const { wahl, setWahl, gespeichert, optionen, ungelesenGrund } = stand;

  // Die Beschriftung des gespeicherten Rahmens kommt vom Server, wenn sie da
  // ist. Ist sie es nicht, steht dort nur die Kennung — erfunden wird nichts.
  const gespeichertText = gespeichert != null ? `Gespeicherte Einstellung (${gespeichert})` : 'Gespeicherte Einstellung';

  return (
    <div style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
      <label htmlFor={id} style={LABEL}>
        Kontenrahmen
      </label>
      <Select
        id={id}
        value={wahl}
        disabled={disabled}
        onChange={(e) => setWahl(e.target.value as RahmenWahl)}
        style={{ minWidth: 260, minHeight: 48 }}
      >
        <option value="">{gespeichertText}</option>
        {(optionen.length > 0
          ? optionen.map((o) => ({ id: o.id, label: o.label }))
          : // Ohne Leserecht kennen wir die Langbeschriftung nicht. Dann steht
            // dort die blosse Kennung, statt eine Beschreibung zu erfinden.
            [
              { id: 'SKR03', label: 'SKR03' },
              { id: 'SKR04', label: 'SKR04' },
            ]
        ).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
      {hinweisZeigen ? (
        <p style={HINWEIS}>
          {wahl === ''
            ? (ungelesenGrund ??
              `Der Export nutzt den gespeicherten Rahmen ${gespeichert ?? ''}.`.trim())
            : `Dieser Export wird in ${wahl} gezogen. Die gespeicherte Einstellung bleibt unverändert.`}{' '}
          Die einzelnen Kontonummern liegen in den Einstellungen unter DATEV.
        </p>
      ) : null}
    </div>
  );
}

const LABEL = {
  fontSize: 'var(--w14-schrift-zeile)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--w14-ink-faded)',
} as const;

const HINWEIS = {
  margin: 0,
  fontSize: 'var(--w14-schrift-feld)',
  lineHeight: 1.5,
  color: 'var(--w14-ink-faded)',
  maxWidth: '62ch',
} as const;

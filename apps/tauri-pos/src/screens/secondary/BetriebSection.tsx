/**
 * BetriebSection — die Stammdaten des Steuerpflichtigen.
 *
 * ── WARUM ES DIESE FLÄCHE GIBT (KOORDINATION §11.5, 28.07.2026) ─────────────
 * Die DSFinV-K verlangt die Angaben zum Steuerpflichtigen EINZELN: Firmenname,
 * Straße, Postleitzahl, Ort, Länderkennzeichen, steuerliche Kennung. Auf der
 * Produktion standen sie als zwei freie Textzeilen — ein Prüfer könnte das
 * Paket keinem Steuerpflichtigen zuordnen. Wanderung 0126 legte die Fächer an,
 * BEWUSST LEER: die Werte trägt der Inhaber ein, ein Platzhalter ergäbe eine
 * Datei, die vollständig aussieht und falsch ist.
 *
 * ── WAS DIESE FLÄCHE NICHT TUT ──────────────────────────────────────────────
 * Sie prüft NICHT, ob die Angaben genügen. Die verbindliche Prüfung wohnt im
 * Server (`lib/haendler-stammdaten.ts`) und greift beim Export — dort nennt
 * `StammdatenUnvollstaendigError` jedes fehlende Feld einzeln. Hier wird nur
 * gezeigt, was LEER ist (getrimmt: Leerzeichen zählen als leer), damit Roman
 * sieht, wo noch etwas fehlt, bevor der Export ihn darauf stößt.
 *
 * Die zwei DATEV-Ordnungsnummern werden hier nur ANGEZEIGT: ihr Zuhause mit
 * Prüfung (nur Ziffern, 4–7 bzw. 1–5 Stellen) ist die DATEV-Einrichtung im
 * Bereich Steuer-Export — ein Wert, ein Redakteur.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@norns/api-client';
import { describeError } from '@norns/i18n-de';
import { Button, Zwischentitel, InfoPunkt, ParchmentCard } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';

// ── Die Fächer, die diese Maske füllt ───────────────────────────────────────

const FELDER = [
  'shop.legal_name',
  'shop.street',
  'shop.postal_code',
  'shop.city',
  'shop.country_code',
  'shop.tax_number',
  'shop.vat_id',
  'kasse.seriennummer',
  'steuer.modus',
  'steuer.modus_gilt_ab',
  // Fuehrt dieser Betrieb Online-Wege? Siehe den Block weiter unten.
] as const;
type FeldKey = (typeof FELDER)[number];

/** Nur gelesen, nie geschrieben — gepflegt in der DATEV-Einrichtung. */
const DATEV_FELDER = ['datev.beraternummer', 'datev.mandantennummer'] as const;

/**
 * ISO 3166-1 alpha-3, als Auswahl statt Freitext (KOORDINATION §11.5): ein
 * getipptes `DE` statt `DEU` fiele sonst erst beim Prüfer auf. Deutschland
 * zuerst (der Regelfall), danach die Nachbarn und die EU alphabetisch.
 */
const LAENDER: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'DEU', label: 'Deutschland (DEU)' },
  { value: 'AUT', label: 'Österreich (AUT)' },
  { value: 'CHE', label: 'Schweiz (CHE)' },
  { value: 'BEL', label: 'Belgien (BEL)' },
  { value: 'BGR', label: 'Bulgarien (BGR)' },
  { value: 'DNK', label: 'Dänemark (DNK)' },
  { value: 'EST', label: 'Estland (EST)' },
  { value: 'FIN', label: 'Finnland (FIN)' },
  { value: 'FRA', label: 'Frankreich (FRA)' },
  { value: 'GRC', label: 'Griechenland (GRC)' },
  { value: 'IRL', label: 'Irland (IRL)' },
  { value: 'ITA', label: 'Italien (ITA)' },
  { value: 'HRV', label: 'Kroatien (HRV)' },
  { value: 'LVA', label: 'Lettland (LVA)' },
  { value: 'LIE', label: 'Liechtenstein (LIE)' },
  { value: 'LTU', label: 'Litauen (LTU)' },
  { value: 'LUX', label: 'Luxemburg (LUX)' },
  { value: 'MLT', label: 'Malta (MLT)' },
  { value: 'NLD', label: 'Niederlande (NLD)' },
  { value: 'NOR', label: 'Norwegen (NOR)' },
  { value: 'POL', label: 'Polen (POL)' },
  { value: 'PRT', label: 'Portugal (PRT)' },
  { value: 'ROU', label: 'Rumänien (ROU)' },
  { value: 'SWE', label: 'Schweden (SWE)' },
  { value: 'SVK', label: 'Slowakei (SVK)' },
  { value: 'SVN', label: 'Slowenien (SVN)' },
  { value: 'ESP', label: 'Spanien (ESP)' },
  { value: 'CZE', label: 'Tschechien (CZE)' },
  { value: 'HUN', label: 'Ungarn (HUN)' },
  { value: 'CYP', label: 'Zypern (CYP)' },
];

/**
 * `GET /api/settings` liefert `value::text` der jsonb-Spalte — ein
 * gespeicherter String kommt also MIT Anführungszeichen an ("WAREHOUSE 14").
 * Auspacken, tolerant: was kein JSON ist, bleibt wie es ist.
 */
function auspacken(roh: string): string {
  try {
    const geparst: unknown = JSON.parse(roh);
    return typeof geparst === 'string' ? geparst : roh;
  } catch {
    return roh;
  }
}

type Entwurf = Record<FeldKey, string>;

const LEERER_ENTWURF: Entwurf = {
  'shop.legal_name': '',
  'shop.street': '',
  'shop.postal_code': '',
  'shop.city': '',
  'shop.country_code': '',
  'shop.tax_number': '',
  'shop.vat_id': '',
  'kasse.seriennummer': '',
  'steuer.modus': '',
  'steuer.modus_gilt_ab': '',
  // Vorgabe AUS: eine frisch aufgestellte Kasse ist eine Ladenkasse.
};

/**
 * Der Umsatzsteuer-Status. Zwei Werte, keine dritte Möglichkeit, und beide
 * müssen Zeichen für Zeichen zu `api-cloud/src/lib/steuermodus.ts` passen —
 * ein Wächter dort hält Riegel und Positivliste zusammen.
 *
 * ⚠️ Diese Auswahl ist der Ausweg aus einer Sackgasse. Die Erstsaat lieferte
 * bis zum 01.08.2026 den Wert eines bestimmten Betriebs mit, und jeder neue
 * Händler erbte ihn. Seit die Saat mandantenneutral ist, steht der Wert leer,
 * und `finalize` verweigert dann JEDEN Verkauf. Das ist richtig: eine Kasse,
 * die nicht weiss, ob ihr Betreiber Kleinunternehmer nach § 19 UStG ist, darf
 * keine Umsatzsteuer ausweisen. Aber ohne dieses Feld käme der Händler aus dem
 * Zustand nie heraus.
 */
const STEUERMODI: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'REGELBESTEUERUNG', label: 'Regelbesteuerung (Umsatzsteuer wird ausgewiesen)' },
  {
    value: 'KLEINUNTERNEHMER_19',
    label: 'Kleinunternehmer nach § 19 UStG (Umsätze steuerfrei)',
  },
];

interface SettingsAntwort {
  settings: Array<{ key: string; value: string }>;
}

export function BetriebSection(props: { onOpenSteuer: () => void }): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const abfrage = useQuery({
    queryKey: ['settings', 'betrieb'],
    queryFn: () => api.request<SettingsAntwort>('GET', '/api/settings'),
  });

  const [entwurf, setEntwurf] = useState<Entwurf>(LEERER_ENTWURF);
  const [basis, setBasis] = useState<Entwurf | null>(null);

  const datevWerte = useMemo(() => {
    const werte = new Map<string, string>();
    for (const zeile of abfrage.data?.settings ?? []) {
      if ((DATEV_FELDER as readonly string[]).includes(zeile.key)) {
        werte.set(zeile.key, auspacken(zeile.value).trim());
      }
    }
    return werte;
  }, [abfrage.data]);

  // Den Entwurf EINMAL aus den Live-Werten setzen, danach gehört er der Hand.
  useEffect(() => {
    if (abfrage.data === undefined || basis !== null) return;
    const naechster: Entwurf = { ...LEERER_ENTWURF };
    for (const zeile of abfrage.data.settings) {
      if ((FELDER as readonly string[]).includes(zeile.key)) {
        naechster[zeile.key as FeldKey] = auspacken(zeile.value);
      }
    }
    setEntwurf(naechster);
    setBasis(naechster);
  }, [abfrage.data, basis]);

  const geaendert =
    basis !== null && FELDER.some((k) => entwurf[k].trim() !== basis[k].trim());

  /**
   * Nur die ANZEIGE der Lücken. Die eine Regel, die hier sichtbar wird —
   * Steuernummer ODER USt-IdNr. genügt (§ 14 Abs. 4 Nr. 2 UStG) — steht als
   * Struktur im Formular (eine Gruppe, zwei Felder); entschieden wird sie
   * beim Export vom Server.
   */
  const luecken = useMemo(() => {
    const fehlt: string[] = [];
    if (entwurf['shop.legal_name'].trim() === '') fehlt.push('Firmenname');
    if (entwurf['shop.street'].trim() === '') fehlt.push('Straße');
    if (entwurf['shop.postal_code'].trim() === '') fehlt.push('Postleitzahl');
    if (entwurf['shop.city'].trim() === '') fehlt.push('Ort');
    if (entwurf['shop.country_code'].trim() === '') fehlt.push('Land');
    if (entwurf['shop.tax_number'].trim() === '' && entwurf['shop.vat_id'].trim() === '')
      fehlt.push('steuerliche Kennung');
    if (entwurf['kasse.seriennummer'].trim() === '') fehlt.push('Seriennummer der Kasse');
    if ((datevWerte.get('datev.beraternummer') ?? '') === '') fehlt.push('Beraternummer');
    if ((datevWerte.get('datev.mandantennummer') ?? '') === '') fehlt.push('Mandantennummer');
    return fehlt;
  }, [entwurf, datevWerte]);

  const speichern = useMutation({
    mutationFn: async () => {
      if (basis === null) return;
      // Nur geänderte Schlüssel, GETRIMMT — Leerzeichen zählen als leer, ein
      // versehentlicher Tastendruck darf den Export-Riegel nicht öffnen. Der
      // erste PATCH holt die Step-up-Bestätigung, der Rest reitet auf ihr.
      for (const k of FELDER) {
        if (entwurf[k].trim() !== basis[k].trim()) {
          await api.request('PATCH', `/api/settings/${k}`, { value: entwurf[k].trim() });
        }
      }
    },
    onSuccess: async () => {
      addToast({
        tone: 'success',
        title: 'Stammdaten gespeichert',
        body: 'Prüferpaket und DATEV lesen ab jetzt diese Angaben.',
      });
      setBasis(null); // erzwingt das Neu-Seeden aus den Live-Werten
      await qc.invalidateQueries({ queryKey: ['settings', 'betrieb'] });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Speichern fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });

  const setzen = (k: FeldKey) => (v: string) => setEntwurf((e) => ({ ...e, [k]: v }));

  if (abfrage.isPending) {
    return (
      <div style={{ padding: 'var(--w14-abstand-24)', color: 'var(--w14-ink-faded)' }}>
        Stammdaten werden geladen …
      </div>
    );
  }
  if (abfrage.isError) {
    return (
      <div style={{ padding: 'var(--w14-abstand-24)', color: 'var(--w14-wax-red)' }}>
        Stammdaten nicht erreichbar:{' '}
        {abfrage.error instanceof ApiError
          ? describeError(abfrage.error)
          : 'Verbindung prüfen und neu laden.'}
      </div>
    );
  }

  const landUnbekannt =
    entwurf['shop.country_code'] !== '' &&
    !LAENDER.some((l) => l.value === entwurf['shop.country_code']);
  const steuermodusUnbekannt =
    entwurf['steuer.modus'].trim() !== '' &&
    !STEUERMODI.some((m) => m.value === entwurf['steuer.modus']);

  return (
    <div
      style={{
        padding: 'var(--w14-abstand-24)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w14-abstand-16)',
        maxWidth: 720,
      }}
    >
      <ParchmentCard padding="md">
        <Zwischentitel label="Betrieb" />
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--w14-abstand-8)',
            marginBottom: 'var(--w14-abstand-12)',
          }}
        >
          <span style={{ color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-text)' }}>
            Der Steuerpflichtige, wie ihn Prüferpaket und DATEV benennen.
          </span>
          <InfoPunkt
            ariaLabel="Wozu diese Angaben?"
            text={
              'Das amtliche Prüferpaket (DSFinV-K) verlangt Firmenname, Anschrift und ' +
              'steuerliche Kennung als einzelne Felder. Solange etwas fehlt, erzeugt der ' +
              'Export bewusst nichts. Ein Platzhalter ergäbe eine Datei, die vollständig ' +
              'aussieht und falsch ist. Verbindlich geprüft wird beim Export.'
            }
          />
        </div>

        {luecken.length > 0 ? (
          <p
            style={{
              margin: '0 0 var(--w14-abstand-16)',
              padding: 'var(--w14-abstand-8) var(--w14-abstand-12)',
              border: '1px solid var(--w14-rule)',
              borderRadius: 'var(--w14-radius-button)',
              background: 'var(--w14-parchment-2)',
              color: 'var(--w14-ink-aged)',
              fontSize: 'var(--w14-schrift-zeile)',
            }}
          >
            Noch leer: {luecken.join(', ')}. Ohne diese Angaben erzeugt das Prüferpaket nichts.
          </p>
        ) : (
          <p
            style={{
              margin: '0 0 var(--w14-abstand-16)',
              color: 'var(--w14-verdigris)',
              fontSize: 'var(--w14-schrift-zeile)',
            }}
          >
            Alle Fächer gefüllt. Die verbindliche Prüfung führt der Server beim Export.
          </p>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'var(--w14-abstand-12) var(--w14-abstand-16)',
          }}
        >
          <Feld
            label="Firmenname, rechtlich"
            value={entwurf['shop.legal_name']}
            onChange={setzen('shop.legal_name')}
            colSpan={2}
            leer={entwurf['shop.legal_name'].trim() === ''}
          />
          <Feld
            label="Straße und Hausnummer"
            value={entwurf['shop.street']}
            onChange={setzen('shop.street')}
            colSpan={2}
            leer={entwurf['shop.street'].trim() === ''}
          />
          <Feld
            label="Postleitzahl"
            value={entwurf['shop.postal_code']}
            onChange={setzen('shop.postal_code')}
            leer={entwurf['shop.postal_code'].trim() === ''}
          />
          <Feld
            label="Ort"
            value={entwurf['shop.city']}
            onChange={setzen('shop.city')}
            leer={entwurf['shop.city'].trim() === ''}
          />
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--w14-abstand-4)',
              gridColumn: 'span 2',
            }}
          >
            <span
              className="w14-smallcaps"
              style={{
                color: 'var(--w14-ink-faded)',
                fontSize: 'var(--w14-schrift-zeile)',
                letterSpacing: '0.08em',
              }}
            >
              Land
              {entwurf['shop.country_code'].trim() === '' && <LeerMarke />}
            </span>
            <select
              value={entwurf['shop.country_code']}
              onChange={(ev) => setzen('shop.country_code')(ev.target.value)}
              style={{
                border: 'none',
                outline: 'none',
                borderBottom: '1px solid var(--w14-feldlinie)',
                background: 'transparent',
                padding: 'var(--w14-abstand-4)',
                fontFamily: 'var(--w14-font-body)',
                fontSize: 'var(--w14-schrift-text)',
                color: 'var(--w14-ink)',
              }}
            >
              <option value="">(noch nicht gewählt)</option>
              {/* Ein gespeicherter Wert außerhalb der Liste bleibt sichtbar,
                  statt still auf leer zurückzuspringen. */}
              {landUnbekannt && (
                <option value={entwurf['shop.country_code']}>
                  {entwurf['shop.country_code']}
                </option>
              )}
              {LAENDER.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </ParchmentCard>

      <ParchmentCard padding="md">
        <Zwischentitel label="Steuerliche Kennung" />
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--w14-abstand-8)',
            marginBottom: 'var(--w14-abstand-12)',
          }}
        >
          <span style={{ color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-zeile)' }}>
            Eines von beiden genügt.
          </span>
          <InfoPunkt
            ariaLabel="Warum genügt eines?"
            text={
              '§ 14 Abs. 4 Nr. 2 UStG lässt Steuernummer ODER USt-IdNr. zu. Beide zu ' +
              'verlangen wäre strenger als das Gesetz. Steht beides, druckt der Beleg ' +
              'bevorzugt die USt-IdNr.'
            }
          />
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'var(--w14-abstand-12) var(--w14-abstand-16)',
          }}
        >
          <Feld
            label="Steuernummer"
            value={entwurf['shop.tax_number']}
            onChange={setzen('shop.tax_number')}
            mono
            leer={
              entwurf['shop.tax_number'].trim() === '' && entwurf['shop.vat_id'].trim() === ''
            }
          />
          <Feld
            label="USt-IdNr."
            value={entwurf['shop.vat_id']}
            onChange={setzen('shop.vat_id')}
            mono
            leer={
              entwurf['shop.tax_number'].trim() === '' && entwurf['shop.vat_id'].trim() === ''
            }
          />
          <Feld
            label="Seriennummer der Kasse"
            value={entwurf['kasse.seriennummer']}
            onChange={setzen('kasse.seriennummer')}
            mono
            colSpan={2}
            leer={entwurf['kasse.seriennummer'].trim() === ''}
          />
        </div>
      </ParchmentCard>

      {/* ── DER UMSATZSTEUER-STATUS ──────────────────────────────────────
          Steht ABSICHTLICH direkt hinter der steuerlichen Kennung: beide
          entscheiden zusammen, was auf jedem Beleg steht. */}
      <ParchmentCard padding="md">
        <Zwischentitel label="Umsatzsteuer" />
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 'var(--w14-abstand-8)',
            marginBottom: 'var(--w14-abstand-12)',
          }}
        >
          <span style={{ color: 'var(--w14-ink-aged)', fontSize: 'var(--w14-schrift-zeile)' }}>
            Ohne diese Angabe verkauft die Kasse nicht.
          </span>
          <InfoPunkt
            ariaLabel="Warum verweigert die Kasse den Verkauf?"
            text={
              'Ob auf Ihrem Beleg Umsatzsteuer steht, hängt allein hieran. Eine Kasse, ' +
              'die es nicht weiss, darf nicht raten: wer als Kleinunternehmer nach ' +
              '§ 19 UStG still Umsatzsteuer ausweist, schuldet sie danach nach § 14c ' +
              'UStG tatsächlich. Deshalb bleibt der Verkauf gesperrt, bis Sie ' +
              'geantwortet haben. Die Angabe lässt sich später ändern; das Datum sagt, ' +
              'ab wann der neue Status gilt.'
            }
          />
        </div>
        <div style={{ display: 'grid', gap: 'var(--w14-abstand-16)' }}>
          <label style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
            <span
              className="w14-smallcaps"
              style={{
                fontSize: 'var(--w14-schrift-kuerzel)',
                letterSpacing: '0.08em',
                color: 'var(--w14-ink-faded)',
              }}
            >
              Status
            </span>
            <select
              value={entwurf['steuer.modus']}
              onChange={(ev) => setzen('steuer.modus')(ev.target.value)}
              style={{
                border: 'none',
                outline: 'none',
                borderBottom: '1px solid var(--w14-feldlinie)',
                background: 'transparent',
                padding: 'var(--w14-abstand-4)',
                fontFamily: 'var(--w14-font-body)',
                fontSize: 'var(--w14-schrift-text)',
                color: 'var(--w14-ink)',
              }}
            >
              <option value="">(noch nicht beantwortet)</option>
              {/* Ein gespeicherter Wert ausserhalb der Liste bleibt sichtbar,
                  statt still auf leer zurueckzuspringen. */}
              {steuermodusUnbekannt && (
                <option value={entwurf['steuer.modus']}>{entwurf['steuer.modus']}</option>
              )}
              {STEUERMODI.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <Feld
            label="Gilt ab (JJJJ-MM-TT)"
            value={entwurf['steuer.modus_gilt_ab']}
            onChange={setzen('steuer.modus_gilt_ab')}
            mono
            leer={entwurf['steuer.modus_gilt_ab'].trim() === ''}
          />
        </div>
      </ParchmentCard>

      {/*
        ⚠️ DER SCHALTER, DEN ES OHNE DIESES FELD NICHT GAEBE.
        Am 02.08.2026 kam der Riegel: die Online-Wege sind per Vorgabe AUS, und
        der Motor weist sie mit 409 ab. Richtig so, eine frisch ausgelieferte
        Kasse ist eine Kasse. Nur konnte ihn niemand einschalten: der
        Schluessel stand in der Positivliste des Servers und auf KEINER
        Flaeche. Ein Laden MIT Kundenshop haette ihn tot vorgefunden, ohne Weg.

        Das ist die Klasse „Sperre ohne Ausgang", diesmal von mir selbst
        gebaut, am selben Tag, an dem ich sie dreimal woanders gefunden habe.
      */}
      {/*
        ⚰️ 19.08.2026: hier stand die Karte „Online-Wege" mit dem Schalter
        `betrieb.online_kanaele`. Der Server hat den Schluessel am 14.08. aus
        den erlaubten Einstellungen genommen (settings.ts:257, der Kundenshop
        fiel mit der Trennung von warehouse14) — die Karte schrieb seither in
        eine abgewiesene Adresse und BLOCKIERTE damit das Speichern des ganzen
        Bereichs. Gemessen von der Vermessung vom 19.08.
      */}

      <ParchmentCard padding="md">
        <Zwischentitel label="Steuerberater" />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--w14-abstand-16)',
            flexWrap: 'wrap',
          }}
        >
          <DatevWert
            label="Beraternummer"
            wert={datevWerte.get('datev.beraternummer') ?? ''}
          />
          <DatevWert
            label="Mandantennummer"
            wert={datevWerte.get('datev.mandantennummer') ?? ''}
          />
          {/* Ein Wert, ein Redakteur: die Nummern wohnen mit ihrer
              Ziffern-Prüfung in der DATEV-Einrichtung. */}
          <Button variant="ghost" size="sm" onClick={props.onOpenSteuer}>
            In der DATEV-Einrichtung eintragen
          </Button>
        </div>
      </ParchmentCard>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="primary"
          size="md"
          disabled={!geaendert || speichern.isPending}
          onClick={() => speichern.mutate()}
        >
          {speichern.isPending ? 'Wird gespeichert …' : 'Stammdaten speichern'}
        </Button>
      </div>
    </div>
  );
}

// ── Bausteine ───────────────────────────────────────────────────────────────

function LeerMarke(): JSX.Element {
  return (
    <span
      style={{ color: 'var(--w14-wax-red)', marginLeft: 'var(--w14-abstand-4)' }}
      title="Noch leer. Das Prüferpaket braucht diese Angabe."
    >
      ·
    </span>
  );
}

function Feld({
  label,
  value,
  onChange,
  mono = false,
  colSpan,
  leer = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  colSpan?: number;
  leer?: boolean;
}): JSX.Element {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: das <label> umschließt sein <input> direkt darunter.
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--w14-abstand-4)',
        ...(colSpan ? { gridColumn: `span ${colSpan}` } : {}),
      }}
    >
      <span
        className="w14-smallcaps"
        style={{
          color: 'var(--w14-ink-faded)',
          fontSize: 'var(--w14-schrift-zeile)',
          letterSpacing: '0.08em',
        }}
      >
        {label}
        {leer && <LeerMarke />}
      </span>
      <input
        type="text"
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        style={{
          border: 'none',
          outline: 'none',
          borderBottom: '1px solid var(--w14-feldlinie)',
          background: 'transparent',
          padding: 'var(--w14-abstand-4)',
          fontFamily: mono ? 'var(--w14-font-zahl)' : 'var(--w14-font-body)',
          fontSize: 'var(--w14-schrift-text)',
          color: 'var(--w14-ink)',
        }}
      />
    </label>
  );
}

function DatevWert({ label, wert }: { label: string; wert: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-4)' }}>
      <span
        className="w14-smallcaps"
        style={{
          color: 'var(--w14-ink-faded)',
          fontSize: 'var(--w14-schrift-zeile)',
          letterSpacing: '0.08em',
        }}
      >
        {label}
        {wert === '' && <LeerMarke />}
      </span>
      <span
        style={{
          fontFamily: 'var(--w14-font-zahl)',
          fontSize: 'var(--w14-schrift-text)',
          color: wert === '' ? 'var(--w14-ink-faded)' : 'var(--w14-ink)',
        }}
      >
        {wert === '' ? 'noch leer' : wert}
      </span>
    </div>
  );
}

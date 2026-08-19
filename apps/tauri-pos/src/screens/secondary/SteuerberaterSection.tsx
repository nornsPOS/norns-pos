/**
 * Die drei Fragen, die nur der Steuerberater beantworten kann.
 *
 * ── WARUM ES DIESE FLÄCHE GEBEN MUSS ───────────────────────────────────────
 *
 * Drei Einstellungen entscheiden, ob ein Prüferpaket überhaupt entsteht. Bis
 * zum 02.08.2026 gab es für KEINE davon ein Eingabefeld, während der Server
 * sie las und den Export ohne sie abbrach:
 *
 *   dsfinvk.gv_typ.ankauf                  ohne ihn bricht das Paket beim
 *                                          ERSTEN Ankaufbeleg ab
 *   dsfinvk.ust_schluessel.margin_25a      ohne ihn bricht es bei der ersten
 *                                          Differenzbesteuerung ab
 *   dsfinvk.ust_schluessel.reverse_charge_13b  ohne ihn bei § 13b
 *
 * Für einen Edelmetallhändler sind § 25a und der Ankauf von Privat der
 * REGELFALL. Der Prüferknopf war damit dauerhaft zu, und die Absage nannte
 * einen Ort, den es nicht gab: „bitte unter Einstellungen, Steuer eintragen".
 *
 * Das ist die Klasse „Sperre ohne Ausgang", und sie ist hier am teuersten:
 * der Prüfer steht im Laden, wenn sie sich zeigt.
 *
 * ── VORSCHLAG JA, STILLE VORGABE NEIN (Stand 12.08.2026) ───────────────────
 *
 * ⚠️ Kein Feld hat einen stillen Vorgabewert in der Datenbank. Seit der
 * Recherche vom 12.08.2026 (amtliche DSFinV-K 2.4 samt Anlage 2, per
 * Prüfsumme verifiziert) gibt es aber einen belegten HAUSSTANDARD, und die
 * Fläche bietet ihn per Knopf als ENTWURF an: der Mensch sieht jeden Wert,
 * kann ihn ändern und speichert selbst. Belegt ist:
 *
 *   - Der Umsatzsteuerschlüssel ist KEINE Kontonummer (so stand es hier bis
 *     heute), sondern die ID des Feldes UST-SCHLUESSEL: bis 999 gehört der
 *     Norm, ab 1000 legt das Haus eigene Nummern an (Tz. 3.2.6 nennt § 25a
 *     und § 13b wörtlich). Hausstandard: 1001 und 1002.
 *   - Für den Ankauf von Privat ist Auszahlung der amtliche Auffangtyp
 *     (Seite 59; Anhang I ordnet sogar einen Warenkauf gegen Bargeld der
 *     Auszahlung zu). Ein Typ „Ausgabe" existiert im Normtext NICHT.
 *   - UST-BESCHR fasst amtlich 55 Zeichen (index.xml der Norm).
 *
 * Die Kanzlei zeichnet gegen (Brief in docs/fiskal), aber der Laden kann ab
 * dem ersten Tag exportieren, statt an einer leeren Frage zu stehen.
 */

import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@norns/api-client';
import { describeError } from '@norns/i18n-de';
import { Button, Zwischentitel, InfoPunkt, Input, ParchmentCard } from '@norns/ui-kit';

import { useApiClient } from '../../lib/api-context.js';
import { downloadBytesFile } from '../../lib/download-file.js';
import { describeHardwareError, isHardwareError } from '../../lib/hardware-client.js';
import { HAUSSTANDARD_DSFINVK } from '../../lib/hausstandard-dsfinvk.js';
import { baueSteuerberaterFragen } from '../../lib/steuerberater-fragen.js';
import { zeitpunktText } from '../../hooks/useVerfahrensdokuPdf.js';
import { useToastStore } from '../../state/toast-store.js';

/** Die Schlüssel, die diese Fläche besitzt. Genau diese und keine anderen. */
const FELDER = [
  'dsfinvk.gv_typ.ankauf',
  'dsfinvk.ust_schluessel.margin_25a',
  'dsfinvk.ust_schluessel.reverse_charge_13b',
  'dsfinvk.ust_satz.margin_25a',
  'dsfinvk.ust_satz.reverse_charge_13b',
  'dsfinvk.ust_beschreibung.margin_25a',
  'dsfinvk.ust_beschreibung.reverse_charge_13b',
] as const;
type FeldKey = (typeof FELDER)[number];
type Entwurf = Record<FeldKey, string>;

const LEERER_ENTWURF: Entwurf = {
  'dsfinvk.gv_typ.ankauf': '',
  'dsfinvk.ust_schluessel.margin_25a': '',
  'dsfinvk.ust_schluessel.reverse_charge_13b': '',
  'dsfinvk.ust_satz.margin_25a': '',
  'dsfinvk.ust_satz.reverse_charge_13b': '',
  'dsfinvk.ust_beschreibung.margin_25a': '',
  'dsfinvk.ust_beschreibung.reverse_charge_13b': '',
};

/**
 * ⚠️ 18.08.2026: der Hausstandard wohnt in `lib/hausstandard-dsfinvk.ts` —
 * die Erstinbetriebnahme bietet DIESELBEN Werte als Vorschlag an, und zwei
 * Kopien liefen auseinander. Begruendung und Kuerzungsregeln stehen dort.
 */
const HAUSSTANDARD: Entwurf = { ...HAUSSTANDARD_DSFINVK };

/**
 * Die amtlichen Werte aus DSFinV-K Anhang C.
 *
 * ⚠️ „Einkauf" steht ABSICHTLICH nicht dabei: das Wort kommt im ganzen
 * Normtext null Mal vor. Der alte Erzeuger schrieb es trotzdem.
 */
const GV_TYPEN: ReadonlyArray<{ wert: string; wie: string }> = [
  { wert: '', wie: 'Noch nicht beantwortet' },
  { wert: 'Auszahlung', wie: 'Auszahlung' },
  { wert: 'Privatentnahme', wie: 'Privatentnahme' },
  { wert: 'Umsatz', wie: 'Umsatz' },
];

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

export function SteuerberaterSection(): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const abfrage = useQuery({
    queryKey: ['settings', 'steuerberater'],
    queryFn: () => api.request<SettingsAntwort>('GET', '/api/settings'),
  });

  const [entwurf, setEntwurf] = useState<Entwurf>(LEERER_ENTWURF);
  const [basis, setBasis] = useState<Entwurf | null>(null);

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

  const geaendert = basis !== null && FELDER.some((k) => entwurf[k].trim() !== basis[k].trim());

  /** Was den Export HEUTE noch anhält. Ein Punkt ohne Weg wäre ein Vorwurf. */
  const luecken = useMemo(() => {
    const fehlt: string[] = [];
    if (entwurf['dsfinvk.gv_typ.ankauf'].trim() === '') {
      fehlt.push('Geschäftsvorfall beim Ankauf von Privat');
    }
    if (entwurf['dsfinvk.ust_schluessel.margin_25a'].trim() === '') {
      fehlt.push('Umsatzsteuerschlüssel für § 25a');
    }
    return fehlt;
  }, [entwurf]);

  const speichern = useMutation({
    mutationFn: async () => {
      if (basis === null) return;
      for (const k of FELDER) {
        if (entwurf[k].trim() !== basis[k].trim()) {
          await api.request('PATCH', `/api/settings/${k}`, { value: entwurf[k].trim() });
        }
      }
    },
    onSuccess: async () => {
      addToast({
        tone: 'success',
        title: 'Angaben gespeichert',
        body: 'Das Prüferpaket und der DATEV-Export rechnen ab jetzt damit.',
      });
      setBasis(null);
      await qc.invalidateQueries({ queryKey: ['settings', 'steuerberater'] });
      await qc.invalidateQueries({ queryKey: ['einrichtung'] });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Speichern fehlgeschlagen',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });

  /**
   * Der Brief für die Kanzlei, als PDF mit dem Zeichen des Hauses.
   *
   * Basels Auftrag vom 12.08.2026: viele Händler kennen die Antworten nicht.
   * Sie drucken dieses Blatt, die Kanzlei füllt es mit dem Stift aus, und die
   * Werte wandern danach hierher. Schon eingetragene Angaben stehen mit
   * Prüfhinweis auf dem Blatt — aus ALLEN Einstellungen, nicht nur aus den
   * Feldern dieser Fläche.
   */
  const briefDrucken = useMutation({
    mutationFn: async () => {
      const antwort = await api.request<SettingsAntwort>('GET', '/api/settings');
      const werte: Record<string, string> = {};
      for (const zeile of antwort.settings) werte[zeile.key] = auspacken(zeile.value);
      const daten = baueSteuerberaterFragen(werte, zeitpunktText(new Date().toISOString()));
      const bytes = await invoke<number[]>('generate_steuerberater_fragen_pdf', { daten });
      downloadBytesFile('Fragen-an-den-Steuerberater.pdf', new Uint8Array(bytes), 'application/pdf');
    },
    onSuccess: () => {
      addToast({
        tone: 'success',
        title: 'Brief erzeugt',
        body:
          'Fragen-an-den-Steuerberater.pdf gespeichert. Ausdrucken, von der Kanzlei ' +
          'ausfüllen lassen, und die Antworten hier eintragen.',
      });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Brief nicht erzeugt',
        body: isHardwareError(err)
          ? describeHardwareError(err)
          : err instanceof ApiError
            ? describeError(err)
            : 'Bitte erneut versuchen.',
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
            Angaben des Steuerberaters
          </strong>
          <p style={{ margin: 0, fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
            Die Angaben für das Prüferpaket. Ohne die Schlüssel hält der Export an, sobald
            ein Tag einen Ankauf von Privat oder eine Differenzbesteuerung enthält. Nichts
            wird geraten: der Knopf unten trägt den amtlich gegengeprüften Hausstandard als
            Entwurf ein, Ihre Kanzlei zeichnet ihn gegen, gespeichert wird von Hand.
          </p>
        </div>

        {luecken.length > 0 ? (
          <div
            style={{
              border: '1px solid var(--w14-danger)',
              background: 'var(--w14-card)',
              borderRadius: 'var(--w14-radius-card)',
              padding: 'var(--w14-abstand-12)',
              fontSize: 'var(--w14-schrift-zeile)',
              color: 'var(--w14-ink)',
            }}
          >
            <strong>Der Export hält noch an.</strong> Offen:{' '}
            {luecken.join(' · ')}. Bei einer Kassennachschau ist das der Knopf, der dann
            nicht läuft.
          </div>
        ) : null}

        <Zwischentitel />

        <label style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
          <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink)' }}>
            Geschäftsvorfall beim Ankauf von Privat
            <InfoPunkt text="Welcher amtliche Typ aus DSFinV-K Anhang C für einen Ankauf von einer Privatperson gilt, ist eine Auslegung. Ihre Kanzlei entscheidet das. Solange die Antwort fehlt, bricht jeder Export ab, sobald der Tag einen Ankaufbeleg enthält." />
          </span>
          <select
            value={entwurf['dsfinvk.gv_typ.ankauf']}
            onChange={(e) =>
              setEntwurf((v) => ({ ...v, 'dsfinvk.gv_typ.ankauf': e.target.value }))
            }
            style={{
              width: '100%',
              minHeight: 48,
              padding: 'var(--w14-abstand-12) var(--w14-abstand-14)',
              background: 'var(--w14-parchment-3)',
              color: 'var(--w14-ink)',
              border: '1px solid var(--w14-rule)',
              borderRadius: 'var(--w14-radius-button)',
              fontFamily: 'var(--w14-font-body)',
              fontSize: 'var(--w14-schrift-text)',
            }}
          >
            {GV_TYPEN.map((t) => (
              <option key={t.wert} value={t.wert}>
                {t.wie}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
          <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink)' }}>
            Umsatzsteuerschlüssel für § 25a (Differenzbesteuerung)
            <InfoPunkt text="Die Kennnummer im amtlichen Prüferpaket, keine Kontonummer. Die Norm reserviert die Nummern bis 999 für sich; ab 1000 vergibt das Haus eigene, genau für Fälle wie § 25a. Hausstandard ist 1001, festgehalten in der Verfahrensdokumentation. Bei Gold und Schmuck ist § 25a der Regelfall, ohne diesen Schlüssel hält fast jeder Export an." />
          </span>
          <Input
            mono
            inputMode="numeric"
            value={entwurf['dsfinvk.ust_schluessel.margin_25a']}
            onChange={(e) =>
              setEntwurf((v) => ({
                ...v,
                'dsfinvk.ust_schluessel.margin_25a': e.target.value,
              }))
            }
            placeholder="zum Beispiel 1001"
          />
        </label>

        <label style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
          <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink)' }}>
            Rechensatz für § 25a
            <InfoPunkt text="Der Prozentsatz, mit dem die Steuer AUF DIE MARGE gerechnet wird, als Rechengrösse des Prüferpakets. Er erscheint nie offen auf dem Beleg, das verbietet das Gesetz bei der Differenzbesteuerung. Regelfall 19.00." />
          </span>
          <Input
            mono
            inputMode="decimal"
            value={entwurf['dsfinvk.ust_satz.margin_25a']}
            onChange={(e) =>
              setEntwurf((v) => ({ ...v, 'dsfinvk.ust_satz.margin_25a': e.target.value }))
            }
            placeholder="zum Beispiel 19.00"
          />
        </label>

        <label style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
          <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink)' }}>
            Beschriftung für § 25a im Prüferpaket
            <InfoPunkt text="Der Text, den das Finanzamt neben dem Schlüssel liest. Das amtliche Feld fasst höchstens 55 Zeichen. Bleibt er leer, steht der Schlüssel unbeschriftet in der Datei, das Paket entsteht trotzdem." />
          </span>
          <Input
            value={entwurf['dsfinvk.ust_beschreibung.margin_25a']}
            maxLength={55}
            onChange={(e) =>
              setEntwurf((v) => ({
                ...v,
                'dsfinvk.ust_beschreibung.margin_25a': e.target.value,
              }))
            }
            placeholder="Differenzbesteuerung § 25a UStG, Basis ist die Marge"
          />
        </label>

        <label style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
          <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink)' }}>
            Umsatzsteuerschlüssel für § 13b (Reverse-Charge)
            <InfoPunkt text="Nur nötig, wenn Sie an Unternehmer mit geprüfter USt-IdNr. verkaufen und die Steuerschuld übergeht. Bleibt das Feld leer, hält nur der Export eines Tages an, der wirklich einen solchen Beleg enthält." />
          </span>
          <Input
            mono
            inputMode="numeric"
            value={entwurf['dsfinvk.ust_schluessel.reverse_charge_13b']}
            onChange={(e) =>
              setEntwurf((v) => ({
                ...v,
                'dsfinvk.ust_schluessel.reverse_charge_13b': e.target.value,
              }))
            }
            placeholder="leer lassen, wenn nicht einschlägig"
          />
        </label>

        <label style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
          <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink)' }}>
            Rechensatz für § 13b
            <InfoPunkt text="Bei § 13b schuldet der Leistungsempfänger die Steuer, die Kasse rechnet 0.00. Nur nötig, wenn der Schlüssel darüber gefüllt ist." />
          </span>
          <Input
            mono
            inputMode="decimal"
            value={entwurf['dsfinvk.ust_satz.reverse_charge_13b']}
            onChange={(e) =>
              setEntwurf((v) => ({ ...v, 'dsfinvk.ust_satz.reverse_charge_13b': e.target.value }))
            }
            placeholder="zum Beispiel 0.00"
          />
        </label>

        <label style={{ display: 'grid', gap: 'var(--w14-abstand-4)' }}>
          <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink)' }}>
            Beschriftung für § 13b im Prüferpaket
            <InfoPunkt text="Der Text neben dem Schlüssel im Prüferpaket, höchstens 55 Zeichen. Der gesetzliche Wortlaut ist die sichere Wahl." />
          </span>
          <Input
            value={entwurf['dsfinvk.ust_beschreibung.reverse_charge_13b']}
            maxLength={55}
            onChange={(e) =>
              setEntwurf((v) => ({
                ...v,
                'dsfinvk.ust_beschreibung.reverse_charge_13b': e.target.value,
              }))
            }
            placeholder="Steuerschuldnerschaft des Leistungsempfängers"
          />
        </label>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--w14-abstand-12)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: 'var(--w14-abstand-8)', flexWrap: 'wrap' }}>
            <Button
              variant="zweit"
              size="md"
              disabled={speichern.isPending || FELDER.every((k) => entwurf[k].trim() !== '')}
              onClick={() =>
                setEntwurf((v) => {
                  const naechster = { ...v };
                  for (const k of FELDER) {
                    if (naechster[k].trim() === '') naechster[k] = HAUSSTANDARD[k];
                  }
                  return naechster;
                })
              }
              title="Trägt den amtlich gegengeprüften Hausstandard vom 12.08.2026 in die noch leeren Felder ein. Gespeichert wird erst mit dem Knopf rechts."
            >
              Hausstandard einsetzen
            </Button>
            <Button
              variant="ghost"
              size="md"
              disabled={briefDrucken.isPending}
              onClick={() => briefDrucken.mutate()}
              title="Erzeugt ein PDF mit allen Fragen und Schreiblinien. Ausdrucken, der Kanzlei geben, die Antworten hier eintragen."
            >
              {briefDrucken.isPending ? 'Erzeugt …' : 'Fragen für den Steuerberater (PDF)'}
            </Button>
          </div>
          <Button
            variant="primary"
            size="md"
            disabled={!geaendert || speichern.isPending}
            onClick={() => speichern.mutate()}
          >
            {speichern.isPending ? 'Speichert…' : 'Angaben speichern'}
          </Button>
        </div>
      </div>
    </ParchmentCard>
  );
}

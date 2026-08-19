/**
 * Belegdesigner — the live receipt designer (Einstellungen → Beleg & Shop).
 *
 * Left:  an editor for the shop identity (name, tagline, address, USt-IdNr,
 *        phone) + a free list of footer lines (greeting, notes, symbols,
 *        opening hours, promo codes …).
 * Right: a LIVE thermal-paper preview with the engraved logo and sample
 *        products — every keystroke updates it instantly, exactly as it will
 *        print.
 *
 * Persistence (no server change — uses the existing allow-listed endpoints):
 *   • Identity  → PATCH /api/settings/shop.*   (ADMIN + step-up, auto modal)
 *   • Footer    → POST  /api/belegtext-templates (kind GENERIC_FOOTER)
 *
 * The printed sale receipt (BezahlenDialog) reads the same GENERIC_FOOTER and
 * prepends the tagline to the address block, so what you design here is what
 * the customer actually gets.
 *
 * "Testdruck" sends a clearly-marked sample to the thermal printer.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, belegtextApi } from '@norns/api-client';
import { Button, Zwischentitel } from '@norns/ui-kit';

import { useBelegLogo, belegLogoQueryKey } from '../../hooks/useBelegLogo.js';
import { useReceiptPrinter } from '../../hooks/useReceiptPrinter.js';
import { resolveShopInfo, shopInfoQueryKey, useShopInfo } from '../../hooks/useShopInfo.js';
import { useApiClient } from '../../lib/api-context.js';
import { BonPapierVorschau } from '../../components/BonPapierVorschau.js';
import { QrBild } from '../../components/QrBild.js';
import type { ThermalReceiptData } from '../../lib/hardware-client.js';
import {
  istAlterServer,
  logoHochladen,
  logoLoeschen,
  logoStufeSetzen,
} from '../../lib/logo-dienst.js';
import {
  LOGO_STUFEN,
  type LogoFormat,
  type LogoStufe,
  logoMime,
  pruefeLogoDatei,
} from '../../lib/logo-werk.js';
import { useToastStore } from '../../state/toast-store.js';
import { describeError } from '@norns/i18n-de';

// Physical thermal-paper cream — kept as a literal (not a theme token) so the
// printed-preview stays paper-white regardless of light/dark. Aligned to the
// parchment-2 cream (#faf8f2) so it no longer drifts off the palette.
const PAPER = '#faf8f2';
const INK = '#1c1814';
const FADED = '#6b6354';

const DEFAULT_FOOTER = ['Vielen Dank für Ihren Besuch.', 'Beleg auf Wunsch elektronisch.'];

// Sample basket shown in the preview + test print.
const SAMPLE_ITEMS = [
  { q: 1, name: 'Krügerrand 1 oz', total: '2.150,00' },
  { q: 1, name: 'Antike Taschenuhr', total: '480,00' },
  { q: 1, name: 'Silbermünze 1 oz', total: '34,50' },
];
const SAMPLE_SUBTOTAL = '2.664,50';
const SAMPLE_TOTAL = '2.664,50';
const SAMPLE_CASH = '2.700,00';
const SAMPLE_CHANGE = '35,50';

interface Identity {
  name: string;
  tagline: string;
  addressLine1: string;
  addressLine2: string;
  vatId: string;
  taxNumber: string;
  phone: string;
}
interface FooterLine {
  id: number;
  text: string;
}
/**
 * Eine gewaehlte, noch NICHT gespeicherte Logodatei. Die Originalbytes gehen
 * beim Speichern zum Server UND — schon vorher — in die Byte-Vorschau: die
 * Rust-Seite rastert selbst (resvg/image), es braucht kein Zwischen-PNG.
 */
interface LogoEntwurf {
  dateiBase64: string;
  format: LogoFormat;
  dateiname: string;
}

// Setting key for each identity field (matches the server allow-list).
const KEY_OF: Record<keyof Identity, string> = {
  name: 'shop.name',
  tagline: 'shop.tagline',
  addressLine1: 'shop.address_line1',
  addressLine2: 'shop.address_line2',
  vatId: 'shop.vat_id',
  taxNumber: 'shop.tax_number',
  phone: 'shop.phone',
};

const QUICK_CHIPS: { label: string; line: string }[] = [
  { label: '★ Dankestext', line: 'Vielen Dank für Ihren Besuch.' },
  { label: 'Öffnungszeiten', line: 'Mo bis Fr 10 bis 18 Uhr · Sa 10 bis 14 Uhr' },
  { label: 'Rückgaberecht', line: 'Umtausch innerhalb 14 Tagen mit Beleg.' },
  { label: 'Web/Social', line: '' },
  { label: 'Aktionscode', line: 'Aktion: 5% mit Code GOLD5' },
  { label: 'Beleg-Hinweis', line: 'Beleg auf Wunsch elektronisch.' },
];

export function Belegdesigner(): JSX.Element {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const printer = useReceiptPrinter();

  const { data: shopApi, fertig } = useShopInfo();
  const footerQ = useQuery({
    queryKey: ['belegtext', 'current', 'GENERIC_FOOTER'],
    queryFn: () => belegtextApi.current(api, { kind: 'GENERIC_FOOTER' }),
    staleTime: 30_000,
  });

  const idCounter = useRef(1);
  // Leer starten, nicht mit einer fremden Identität: bis der Server antwortet
  // steht hier nichts. Vorher stand „WAREHOUSE 14, Rosenstraße 40" im
  // Formular JEDES Mandanten, und wer nichts anfasste, hielt es für seinen
  // eigenen Eintrag (Basels Befund 30.07.2026).
  const [identity, setIdentity] = useState<Identity>(() => ({
    name: '',
    tagline: '',
    addressLine1: '',
    addressLine2: '',
    vatId: '',
    taxNumber: '',
    phone: '',
  }));
  const [footer, setFooter] = useState<FooterLine[]>([]);
  const [baseIdentity, setBaseIdentity] = useState<Identity | null>(null);
  const [baseFooter, setBaseFooter] = useState<string>('');

  // ── Beleg & Logo (Basels Dekret 26.07.2026) ──────────────────────────────
  const { abruf } = useBelegLogo();
  const gespeichertesLogo = abruf?.logo ?? null;
  const [logoEntwurf, setLogoEntwurf] = useState<LogoEntwurf | null>(null);
  /** Der Inhaber hat „entfernen" gewaehlt, aber noch nicht gespeichert. */
  const [logoEntfernt, setLogoEntfernt] = useState(false);
  const [stufe, setStufe] = useState<LogoStufe>('mittel');
  const [stufeAngefasst, setStufeAngefasst] = useState(false);
  const [logoFehler, setLogoFehler] = useState<string | null>(null);

  // Die gespeicherte Stufe uebernehmen, solange der Inhaber selbst noch
  // keine gewaehlt hat — sonst wuerde das Nachladen seine Wahl ueberschreiben.
  useEffect(() => {
    if (!stufeAngefasst && gespeichertesLogo) setStufe(gespeichertesLogo.stufe);
  }, [gespeichertesLogo, stufeAngefasst]);

  /**
   * Was die Vorschau (und der Testdruck) zeigt: Entwurf vor Gespeichertem.
   * Memoisiert, damit nicht jeder Render ein neues Objekt erzeugt und die
   * Byte-Vorschau grundlos einen IPC-Rundgang faehrt.
   */
  const vorschauLogo = useMemo<{ datenBase64: string; format: LogoFormat } | null>(() => {
    if (logoEntfernt) return null;
    if (logoEntwurf !== null) {
      return { datenBase64: logoEntwurf.dateiBase64, format: logoEntwurf.format };
    }
    if (gespeichertesLogo !== null) {
      return { datenBase64: gespeichertesLogo.datenBase64, format: gespeichertesLogo.format };
    }
    return null;
  }, [logoEntfernt, logoEntwurf, gespeichertesLogo]);

  const dirtyLogo =
    logoEntwurf !== null ||
    (logoEntfernt && gespeichertesLogo !== null) ||
    (gespeichertesLogo !== null && stufe !== gespeichertesLogo.stufe);

  const onLogoDatei = async (liste: FileList | null): Promise<void> => {
    const datei = liste?.[0];
    if (!datei) return;
    const pruefung = pruefeLogoDatei(datei.name, datei.type, datei.size);
    if (!pruefung.ok) {
      setLogoFehler(pruefung.grund);
      return;
    }
    setLogoFehler(null);
    try {
      const original = await dateiAlsBase64(datei);
      setLogoEntwurf({
        dateiBase64: original,
        format: pruefung.format,
        dateiname: datei.name,
      });
      setLogoEntfernt(false);
    } catch {
      setLogoFehler('Die Datei konnte nicht gelesen werden.');
    }
  };

  const logoSichern = useMutation({
    mutationFn: async (): Promise<string[]> => {
      if (logoEntfernt) {
        await logoLoeschen(api);
        return [];
      }
      if (logoEntwurf !== null) {
        const ergebnis = await logoHochladen(api, {
          dateiBase64: logoEntwurf.dateiBase64,
          format: logoEntwurf.format,
          stufe,
        });
        return ergebnis.entfernt;
      }
      // Nur die Groesse hat sich geaendert. Sie lebt LOKAL (die Tabelle
      // `beleg_logo` traegt keine Stufe) — kein Serverweg, kein Step-up.
      logoStufeSetzen(stufe);
      return [];
    },
    onSuccess: async (entfernt) => {
      const war = logoEntfernt;
      setLogoEntwurf(null);
      setLogoEntfernt(false);
      setStufeAngefasst(false);
      addToast({
        tone: 'success',
        title: war ? 'Logo entfernt' : 'Logo gespeichert',
        body:
          entfernt.length > 0
            ? // Ehrlichkeit der SVG-Waesche: der Inhaber erfaehrt, dass sein
              // Bild bereinigt wurde — nicht still ein anderes gespeichert.
              `Aus dem SVG bereinigt: ${entfernt.join(', ')}. Gilt fuer jeden Bon ab jetzt.`
            : 'Gilt fuer jeden Bon ab jetzt.',
      });
      await qc.invalidateQueries({ queryKey: belegLogoQueryKey });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Logo nicht gespeichert',
        body: istAlterServer(err)
          ? 'Der Server kennt den Logo-Weg noch nicht. Verfuegbar nach dem naechsten Server-Update.'
          : err instanceof ApiError
            ? describeError(err)
            : 'Bitte erneut versuchen.',
      });
    },
  });

  // ── DER AUSGANGSSTAND MUSS IMMER STEHEN (30.07.2026, Basels Befund) ───────
  //
  // Vorher: `if (!shopApi) return;`. Antwortete der Server nicht mit Daten
  // (bei leerem Ladennamen warf er einen 409, also bei JEDEM frischen
  // Mandanten), blieb `baseIdentity` null. Der Schmutz-Vergleich unten
  // verlangt aber `baseIdentity !== null` — er meldete also ewig
  // „unverändert", der Speichern-Lauf sprang über die Identität hinweg, und
  // die Meldung sagte trotzdem „gespeichert", weil die Fußzeile daneben
  // durchging. Der Inhaber tippte, sah „gespeichert", startete neu und fand
  // alles beim Alten.
  //
  // Jetzt wird gesetzt, sobald die Frage BEANTWORTET ist — notfalls auf
  // leer. Aus einem leeren Stand heraus ist jede Eingabe eine Änderung, und
  // genau so füllt ein neuer Laden seine Felder zum ersten Mal.
  useEffect(() => {
    if (!fertig || baseIdentity !== null) return;
    const resolved = resolveShopInfo(shopApi);
    const next: Identity = {
      name: resolved.name,
      tagline: resolved.tagline,
      addressLine1: shopApi?.addressLine1 ?? resolved.address[0] ?? '',
      addressLine2: shopApi?.addressLine2 ?? resolved.address[1] ?? '',
      vatId: resolved.vatId,
      taxNumber: resolved.taxNumber,
      phone: resolved.phone ?? '',
    };
    setIdentity(next);
    setBaseIdentity(next);
  }, [shopApi, fertig, baseIdentity]);

  useEffect(() => {
    if (footerQ.data === undefined) return;
    const body = footerQ.data.bodyText ?? '';
    const lines = body.length > 0 ? body.split('\n') : DEFAULT_FOOTER;
    setFooter(lines.map((text) => ({ id: idCounter.current++, text })));
    setBaseFooter(lines.join('\n'));
  }, [footerQ.data]);

  // Memoisiert aus demselben Grund wie `vorschauLogo`: die Byte-Vorschau
  // haengt an der Identitaet dieses Arrays.
  const footerLines = useMemo(
    () => footer.map((f) => f.text).filter((t) => t.trim().length > 0),
    [footer],
  );
  const dirtyIdentity =
    baseIdentity !== null &&
    (Object.keys(KEY_OF) as (keyof Identity)[]).some(
      (k) => identity[k].trim() !== baseIdentity[k].trim(),
    );
  const dirtyFooter = footer.map((f) => f.text).join('\n') !== baseFooter;
  const dirty = dirtyIdentity || dirtyFooter;

  const save = useMutation({
    mutationFn: async () => {
      // 1) identity — PATCH only changed keys (first call triggers the step-up
      //    modal; the elevated session covers the rest of the burst).
      if (baseIdentity) {
        for (const k of Object.keys(KEY_OF) as (keyof Identity)[]) {
          if (identity[k].trim() !== baseIdentity[k].trim()) {
            await api.request('PATCH', `/api/settings/${KEY_OF[k]}`, { value: identity[k].trim() });
          }
        }
      }
      // 2) footer — publish a new GENERIC_FOOTER version when changed.
      if (dirtyFooter) {
        await belegtextApi.publish(api, {
          kind: 'GENERIC_FOOTER',
          bodyText: footer.map((f) => f.text).join('\n'),
        });
      }
    },
    onSuccess: async () => {
      addToast({
        tone: 'success',
        title: 'Beleg gespeichert',
        body: 'Übernommen für neue Belege.',
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: shopInfoQueryKey }),
        qc.invalidateQueries({ queryKey: ['belegtext'] }),
      ]);
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
   * Der Probebon fuer Vorschau UND Testdruck — mit dem Logo, das GERADE zu
   * sehen ist (auch ein ungespeicherter Entwurf), explizit gesetzt, damit der
   * zentrale Logo-Anhang in `thermalClient.print` nicht den alten Stand aus
   * dem Lager darueberlegt. Was er sieht, ist was gedruckt wuerde.
   */
  const belegDaten = useMemo(
    () => buildSampleReceipt(identity, footerLines, vorschauLogo, stufe),
    [identity, footerLines, vorschauLogo, stufe],
  );

  const onTestPrint = async (): Promise<void> => {
    const ok = await printer.print(belegDaten);
    if (ok)
      addToast({
        tone: 'success',
        title: 'Testdruck gesendet',
        /*
         * ⚠️ BEFUND 18.08.2026 (Basels Fotos): der Testdruck druckt das Logo,
         * das GERADE ZU SEHEN ist — auch einen ungespeicherten Entwurf. Der
         * Inhaber sah sein Logo auf dem Probebon, hielt die Sache fuer
         * erledigt, verliess die Flaeche, und der Entwurf war weg. Auf jedem
         * echten Bon fehlte das Logo. Der Satz hier schliesst die Luecke
         * zwischen „gedruckt" und „gespeichert".
         */
        ...(dirtyLogo
          ? { body: 'Mit dem ENTWURF gedruckt. Auf echten Belegen erscheint das Logo erst nach „Logo speichern".' }
          : {}),
      });
  };

  const reset = (): void => {
    if (baseIdentity) setIdentity(baseIdentity);
    const lines = baseFooter.length > 0 ? baseFooter.split('\n') : DEFAULT_FOOTER;
    setFooter(lines.map((text) => ({ id: idCounter.current++, text })));
  };

  // ── footer line ops ───────────────────────────────────────────────────────
  const setLine = (id: number, text: string): void =>
    setFooter((f) => f.map((l) => (l.id === id ? { ...l, text } : l)));
  const removeLine = (id: number): void => setFooter((f) => f.filter((l) => l.id !== id));
  const addLine = (text = ''): void => setFooter((f) => [...f, { id: idCounter.current++, text }]);
  const moveLine = (id: number, dir: -1 | 1): void =>
    setFooter((f) => {
      const i = f.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= f.length) return f;
      const copy = [...f];
      const a = copy[i];
      const b = copy[j];
      if (!a || !b) return f;
      copy[i] = b;
      copy[j] = a;
      return copy;
    });

  return (
    <div>
      <header style={{ marginBottom: 6 }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--w14-font-display)',
            fontWeight: 500,
            fontSize: 'var(--w14-schrift-titel)',
          }}
        >
          Beleg gestalten
        </h2>
        <p style={{ margin: '4px 0 0', color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-text)' }}>
          Geschäftsdaten, Logo und Fußzeile bearbeiten. Die Vorschau rechts druckt genau so.
        </p>
      </header>
      <Zwischentitel />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 360px)',
          gap: 'var(--w14-abstand-24)',
          alignItems: 'start',
          marginTop: 12,
        }}
      >
        {/* ── Editor ───────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-16)', minWidth: 0 }}>
          <fieldset style={fieldsetStyle}>
            <legend style={legendStyle}>Geschäftsdaten</legend>
            <Field
              label="Geschäftsname"
              platzhalter="z. B. Stampscoins Schorndorf"
              value={identity.name}
              onChange={(v) => setIdentity((s) => ({ ...s, name: v }))}
            />
            <Field
              label="Slogan / Linie"
              platzhalter="z. B. Münzen · Briefmarken"
              value={identity.tagline}
              onChange={(v) => setIdentity((s) => ({ ...s, tagline: v }))}
            />
            <Field
              label="Adresse (Straße)"
              platzhalter="z. B. Hauptstraße 1"
              value={identity.addressLine1}
              onChange={(v) => setIdentity((s) => ({ ...s, addressLine1: v }))}
            />
            <Field
              label="Adresse (PLZ Ort)"
              value={identity.addressLine2}
              onChange={(v) => setIdentity((s) => ({ ...s, addressLine2: v }))}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--w14-abstand-12)' }}>
              <Field
                label="USt-IdNr."
                mono
                value={identity.vatId}
                onChange={(v) => setIdentity((s) => ({ ...s, vatId: v }))}
              />
              <Field
                label="Telefon"
                mono
                value={identity.phone}
                onChange={(v) => setIdentity((s) => ({ ...s, phone: v }))}
              />
            </div>
          </fieldset>

          <fieldset style={fieldsetStyle}>
            <legend style={legendStyle}>Beleg & Logo</legend>
            {abruf === undefined ? (
              <p style={logoHinweisStyle}>Wird geladen…</p>
            ) : abruf.status === 'alterServer' ? (
              <p style={logoHinweisStyle}>
                Verfügbar nach dem nächsten Server-Update. Die Kasse kann das Logo dann hier
                verwalten; bis dahin bleibt der Bon ohne eigenes Logo.
              </p>
            ) : (
              <>
                {abruf.status === 'offline' && (
                  <p style={logoHinweisStyle}>
                    Server gerade nicht erreichbar. Gezeigt und gedruckt wird das zuletzt
                    gespeicherte Logo. Speichern geht, sobald der Server wieder da ist.
                  </p>
                )}
                {abruf.status === 'keinName' && (
                  <p style={logoHinweisStyle}>
                    Der Ladenname ist noch nicht gepflegt. Erst die Geschäftsdaten oben
                    speichern, dann das Logo.
                  </p>
                )}
                <p style={{ ...logoHinweisStyle, fontStyle: 'normal' }}>
                  {logoEntwurf
                    ? `Gewählt: ${logoEntwurf.dateiname}, noch nicht gespeichert.`
                    : logoEntfernt && gespeichertesLogo
                      ? 'Wird beim Speichern entfernt. Oben auf dem Bon steht dann die norns.de-Zeile und der Ladenname.'
                      : gespeichertesLogo
                        ? `Gespeichert am ${formatiereDatum(gespeichertesLogo.hochgeladenAm)} (${gespeichertesLogo.format.toUpperCase()}).`
                        : 'Kein Logo gesetzt. Oben auf dem Bon steht die norns.de-Zeile und der Ladenname. Ein hochgeladenes Logo trägt auch den Briefkopf der Schreiben.'}
                </p>

                <div style={{ display: 'flex', gap: 'var(--w14-abstand-10)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <label style={logoWaehlenStyle}>
                    Logo wählen…
                    <input
                      type="file"
                      accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        void onLogoDatei(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {(gespeichertesLogo !== null || logoEntwurf !== null) && !logoEntfernt && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setLogoEntwurf(null);
                        setLogoEntfernt(true);
                        setLogoFehler(null);
                      }}
                    >
                      Logo entfernen
                    </Button>
                  )}
                </div>
                {logoFehler !== null && (
                  <p style={{ margin: 0, fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-gold)' }}>
                    {logoFehler}
                  </p>
                )}

                <div>
                  <span
                    className="w14-smallcaps"
                    style={{
                      display: 'block',
                      color: 'var(--w14-ink-aged)',
                      fontSize: 'var(--w14-schrift-zeile)',
                      letterSpacing: '0.06em',
                      marginBottom: 6,
                    }}
                  >
                    Größe auf dem Bon
                  </span>
                  <div role="radiogroup" aria-label="Logogröße" style={{ display: 'flex', gap: 'var(--w14-abstand-8)' }}>
                    {LOGO_STUFEN.map((s) => (
                      <button
                        key={s.stufe}
                        type="button"
                        role="radio"
                        aria-checked={stufe === s.stufe}
                        onClick={() => {
                          setStufe(s.stufe);
                          setStufeAngefasst(true);
                        }}
                        style={{
                          minHeight: 44,
                          minWidth: 88,
                          padding: 'var(--w14-abstand-8) var(--w14-abstand-16)',
                          borderRadius: 'var(--w14-radius-button)',
                          border:
                            stufe === s.stufe
                              ? '1px solid var(--w14-gold)'
                              : '1px solid var(--w14-rule)',
                          background:
                            stufe === s.stufe ? 'var(--w14-parchment-2)' : 'transparent',
                          color: stufe === s.stufe ? 'var(--w14-ink)' : 'var(--w14-ink-aged)',
                          fontSize: 'var(--w14-schrift-text)',
                          cursor: 'pointer',
                        }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--w14-abstand-10)', alignItems: 'center' }}>
                  <Button
                    variant="primary"
                    disabled={!dirtyLogo || logoSichern.isPending}
                    onClick={() => logoSichern.mutate()}
                  >
                    {logoSichern.isPending ? 'Speichert…' : 'Logo speichern'}
                  </Button>
                  <span style={{ fontSize: 'var(--w14-schrift-zeile)', color: 'var(--w14-ink-faded)' }}>
                    SVG (am präzisesten), PNG oder JPEG · bis 256 KB
                  </span>
                </div>
              </>
            )}
          </fieldset>

          <fieldset style={fieldsetStyle}>
            <legend style={legendStyle}>Fußzeile · Hinweise & Symbole</legend>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--w14-abstand-8)' }}>
              {footer.map((line, i) => (
                <div key={line.id} style={{ display: 'flex', gap: 'var(--w14-abstand-6)', alignItems: 'center' }}>
                  <input
                    value={line.text}
                    onChange={(e) => setLine(line.id, e.target.value)}
                    placeholder="Freier Text, Hinweis oder Symbol…"
                    maxLength={120}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <IconBtn
                    label="nach oben"
                    disabled={i === 0}
                    onClick={() => moveLine(line.id, -1)}
                  >
                    ↑
                  </IconBtn>
                  <IconBtn
                    label="nach unten"
                    disabled={i === footer.length - 1}
                    onClick={() => moveLine(line.id, 1)}
                  >
                    ↓
                  </IconBtn>
                  <IconBtn label="entfernen" onClick={() => removeLine(line.id)}>
                    ✕
                  </IconBtn>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => addLine()} style={addLineStyle}>
              + Zeile hinzufügen
            </button>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--w14-abstand-6)', marginTop: 10 }}>
              {QUICK_CHIPS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => addLine(c.line)}
                  style={chipStyle}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div style={{ display: 'flex', gap: 'var(--w14-abstand-10)', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              variant="primary"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Speichert…' : 'Speichern'}
            </Button>
            <Button variant="ghost" disabled={!dirty || save.isPending} onClick={reset}>
              Verwerfen
            </Button>
            <Button variant="ghost" disabled={printer.printing} onClick={onTestPrint}>
              {printer.printing ? 'Druckt…' : 'Testdruck'}
            </Button>
            <span
              className="w14-smallcaps"
              style={{
                marginLeft: 'auto',
                fontSize: 'var(--w14-schrift-zeile)',
                letterSpacing: '0.06em',
                color: dirty ? 'var(--w14-gold)' : 'var(--w14-ink-faded)',
              }}
            >
              {dirty ? 'ungespeichert' : 'gespeichert'}
            </span>
          </div>
          {!printer.canPrint && (
            <p
              style={{
                margin: 0,
                fontSize: 'var(--w14-schrift-zeile)',
                color: 'var(--w14-ink-faded)',
                fontStyle: 'italic',
              }}
            >
              Testdruck benötigt einen eingerichteten Drucker (Einstellungen → Geräte).
            </p>
          )}
        </div>

        {/* ── Live preview ─────────────────────────────────────────────── */}
        <div style={{ position: 'sticky', top: 12 }}>
          <div
            className="w14-smallcaps"
            style={{
              fontSize: 'var(--w14-schrift-zeile)',
              letterSpacing: '0.1em',
              color: 'var(--w14-ink-faded)',
              marginBottom: 8,
              textAlign: 'center',
            }}
          >
            Live-Vorschau
          </div>
          {dirtyLogo && (
            /*
             * Wachsrot ueber der Vorschau, nicht daneben: genau HIER sieht
             * der Inhaber sein neues Logo und glaubt, es sei erledigt.
             */
            <div
              role="alert"
              style={{
                background: 'var(--w14-wax-red)',
                color: 'var(--w14-parchment)',
                borderRadius: 'var(--w14-radius-fein)',
                padding: 'var(--w14-abstand-8) var(--w14-abstand-12)',
                fontSize: 'var(--w14-schrift-text)',
                fontWeight: 600,
                marginBottom: 'var(--w14-abstand-8)',
              }}
            >
              Noch nicht gespeichert. Dieses Logo erscheint erst nach „Logo speichern" auf Ihren Belegen —
              wer die Fläche vorher verlässt, verwirft es.
            </div>
          )}
          {/* ⭐ Aus ECHTEN Bytes (Basels Kernwunsch): derselbe Rust-Erzeuger,
              der drucken wuerde, plus Papiersimulator. Die React-Seitenansicht
              bleibt nur als ehrlicher Rueckfall, wo es keine Bytes geben kann
              (reiner Browser, alte Kassen-Version). */}
          <BonPapierVorschau
            daten={belegDaten}
            fallback={
              <ReceiptPaper
                identity={identity}
                footerLines={footerLines}
                logo={vorschauLogo}
                logoStufe={stufe}
              />
            }
          />
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Live thermal-paper preview
// ════════════════════════════════════════════════════════════════════════

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 'var(--w14-abstand-12)',
  fontFamily: 'var(--w14-font-mono, monospace)',
  fontSize: 'var(--w14-schrift-zeile)',
  color: INK,
};

function PaperRule(): JSX.Element {
  return (
    <div aria-hidden style={{ borderTop: '1px dashed #b9ad97', margin: '8px 0', height: 0 }} />
  );
}

function ReceiptPaper({
  identity,
  footerLines,
  logo,
  logoStufe,
}: {
  identity: Identity;
  footerLines: string[];
  logo: { datenBase64: string; format: LogoFormat } | null;
  logoStufe: LogoStufe;
}): JSX.Element {
  const addr = [identity.addressLine1, identity.addressLine2].filter((l) => l.trim().length > 0);
  const logoProzent = LOGO_STUFEN.find((s) => s.stufe === logoStufe)?.prozent ?? 60;
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 360,
        margin: '0 auto',
        maxHeight: '74vh',
        overflowY: 'auto',
        background: PAPER,
        color: INK,
        borderRadius: 6,
        boxShadow: 'var(--w14-shadow-modal, 0 12px 40px rgba(0,0,0,0.25))',
        padding: 'var(--w14-abstand-20) var(--w14-abstand-20) var(--w14-abstand-24)',
      }}
    >
      <div style={{ display: 'grid', placeItems: 'center', gap: 'var(--w14-abstand-8)', textAlign: 'center' }}>
        {/* BASELS DEKRET (26.07.2026): das eingebrannte Warehouse-14-Zeichen ist
            vom Bon verschwunden. Ganz oben steht klein und dezent die
            norns.de-Systemzeile, darunter das HOCHGELADENE Logo des Haendlers
            (wenn es eines gibt) und der Ladenname als Text. Kein fremdes Logo
            als Vorgabe — mandantenneutral. */}
        <div
          style={{
            fontFamily: 'var(--w14-font-mono, monospace)',
            fontSize: '0.58rem', // schriftleiter-frei: Papiervorschau des Bons, nicht Bildschirm-Typo
            letterSpacing: '0.18em',
            color: FADED,
          }}
        >
          norns.de
        </div>
        {logo !== null && (
          <img
            src={`data:${logoMime(logo.format)};base64,${logo.datenBase64}`}
            alt={`Logo ${identity.name}`}
            style={{
              width: `${logoProzent}%`,
              maxWidth: '100%',
              height: 'auto',
              filter: 'grayscale(1) contrast(1.6)',
            }}
          />
        )}
        <div
          style={{
            fontFamily: 'var(--w14-font-mono, monospace)',
            fontWeight: 700,
            fontSize: 'var(--w14-schrift-betont)',
            letterSpacing: '0.04em',
            color: INK,
          }}
        >
          {identity.name}
        </div>
        {identity.tagline.trim() && (
          <div
            style={{
              fontFamily: 'var(--w14-font-mono, monospace)',
              fontSize: 'var(--w14-schrift-kuerzel)',
              color: FADED,
            }}
          >
            {identity.tagline}
          </div>
        )}
        <div style={{ fontFamily: 'var(--w14-font-mono, monospace)', fontSize: 'var(--w14-schrift-zeile)' }}>
          {addr.map((line) => (
            <div key={line}>{line}</div>
          ))}
          {identity.phone.trim() && <div>Tel.: {identity.phone}</div>}
          {identity.vatId.trim() && <div>USt-IdNr.: {identity.vatId}</div>}
        </div>
      </div>

      <PaperRule />
      <div style={{ display: 'grid', gap: 'var(--w14-abstand-2)' }}>
        <div style={rowStyle}>
          <span>Beleg-Nr.</span>
          <span>2026-0042</span>
        </div>
        <div style={rowStyle}>
          <span>Datum</span>
          <span>04.06.2026 14:21</span>
        </div>
        <div style={rowStyle}>
          <span>Kassierer</span>
          <span>Inhaber</span>
        </div>
      </div>

      <PaperRule />
      <div style={{ display: 'grid', gap: 'var(--w14-abstand-6)' }}>
        {SAMPLE_ITEMS.map((it) => (
          <div key={it.name} style={{ ...rowStyle, fontSize: 'var(--w14-schrift-feld)' }}>
            <span style={{ maxWidth: 210 }}>
              {it.q} × {it.name}
            </span>
            <span>{it.total} €</span>
          </div>
        ))}
      </div>

      <PaperRule />
      <div style={{ display: 'grid', gap: 'var(--w14-abstand-2)' }}>
        <div style={rowStyle}>
          <span>Zwischensumme</span>
          <span>{SAMPLE_SUBTOTAL} €</span>
        </div>
        <div style={rowStyle}>
          <span>MwSt. (§25a)</span>
          <span>enthalten</span>
        </div>
        <div style={{ ...rowStyle, fontWeight: 700, fontSize: 'var(--w14-schrift-betont)' }}>
          <span>SUMME</span>
          <span>{SAMPLE_TOTAL} €</span>
        </div>
      </div>

      <PaperRule />
      <div style={{ display: 'grid', gap: 'var(--w14-abstand-2)' }}>
        <div style={rowStyle}>
          <span>Zahlung</span>
          <span>Bar</span>
        </div>
        <div style={rowStyle}>
          <span>Bar erhalten</span>
          <span>{SAMPLE_CASH} €</span>
        </div>
        <div style={rowStyle}>
          <span>Wechselgeld</span>
          <span>{SAMPLE_CHANGE} €</span>
        </div>
      </div>

      <PaperRule />
      <div
        style={{
          display: 'grid',
          gap: 'var(--w14-abstand-2)',
          fontFamily: 'var(--w14-font-mono, monospace)',
          fontSize: 'var(--w14-schrift-marke)',
          color: INK,
        }}
      >
        <div style={{ color: FADED, letterSpacing: '0.08em' }}>TSE-SIGNATUR</div>
        <div style={{ wordBreak: 'break-all' }}>BEISPIEL, wird beim echten Verkauf signiert</div>
        {/*
         * DAS MUSTER (25.07.2026, Basels Wunsch: „توليد QR كود وهمي للتجربة
         * لبين ما نشبك TSE حقيقي").
         *
         * Hier stand ein leerer Kasten mit „QR-Code (wird gedruckt)". Solange
         * keine TSE angeschlossen ist, konnte niemand beurteilen, ob der Code
         * an dieser Stelle überhaupt Platz hat, wie gross er wirkt und ob der
         * Fuss darunter noch atmet.
         *
         * Jetzt steht ein ECHT gerechneter Code da — mit einem Inhalt, der
         * selbst sagt, dass er keine Signatur ist, und einem roten Querbalken,
         * der ihn UNLESBAR macht. Er dient der Gestalt und kann nie mit einer
         * fiskalischen Signatur verwechselt oder abfotografiert werden. Auf
         * einem echten Verkaufsbeleg erscheint er NIEMALS: dort zeichnet die
         * Vorschau nur, was die TSE wirklich geliefert hat.
         */}
        <div style={{ marginTop: 8, alignSelf: 'center', display: 'grid', gap: 'var(--w14-abstand-4)', justifyItems: 'center' }}>
          <QrBild inhalt="" muster groesse={88} />
          <div style={{ fontSize: 'var(--w14-schrift-fussnote)', color: FADED, letterSpacing: '0.06em' }}>
            Muster für die Gestalt, keine Signatur
          </div>
        </div>
      </div>

      {footerLines.length > 0 && <PaperRule />}
      <div style={{ display: 'grid', gap: 'var(--w14-abstand-2)', textAlign: 'center' }}>
        {footerLines.map((line, i) => (
          <div
            key={`${i}-${line}`}
            style={{
              fontFamily: 'var(--w14-font-mono, monospace)',
              fontSize: 'var(--w14-schrift-kuerzel)',
              color: FADED,
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

function buildSampleReceipt(
  identity: Identity,
  footerLines: string[],
  logo: { datenBase64: string; format: LogoFormat } | null,
  logoStufe: LogoStufe,
): ThermalReceiptData {
  const addr = [identity.tagline, identity.addressLine1, identity.addressLine2].filter(
    (l) => l.trim().length > 0,
  );
  return {
    // EXPLIZIT gesetzt (auch das null): der zentrale Anhang in
    // `thermalClient` laesst Gesetztes stehen, und genau das erlaubt der
    // Vorschau, einen ungespeicherten Entwurf zu zeigen — oder ein bewusst
    // entferntes Logo schon vor dem Speichern wegzulassen.
    logoBytesBase64: logo?.datenBase64 ?? null,
    logoFormat: logo?.format ?? null,
    logoSize: logoStufe,
    shopName: identity.name,
    shopAddress: addr,
    shopVatId: identity.vatId,
    shopTaxNumber: identity.taxNumber,
    shopPhone: identity.phone.trim() ? identity.phone : null,
    receiptLocator: 'TESTDRUCK',
    printedAt: new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }),
    cashierName: 'Testdruck',
    shiftId: null,
    items: SAMPLE_ITEMS.map((it) => ({
      name: it.name,
      quantity: it.q,
      unitPriceEur: it.total,
      lineTotalEur: it.total,
      vatLabel: '',
    })),
    subtotalEur: SAMPLE_SUBTOTAL,
    vatEur: '0,00',
    totalEur: SAMPLE_TOTAL,
    paymentMethodLabel: 'Bar',
    cashReceivedEur: SAMPLE_CASH,
    changeEur: SAMPLE_CHANGE,
    // Send the SAME "no TSE" sentinel a real test-mode sale sends, so the
    // Testdruck preview renders the clean one-line "TSE-Ausfall" note (no fake
    // signature block, no meaningless QR) — i.e. exactly what a real receipt
    // looks like today. The "— TESTDRUCK —" footer marks it as a sample.
    tseSignatureValue: 'TSE Ausfall',
    tseSignatureCounter: 'TSE Ausfall',
    tseTransactionNumber: 'TSE Ausfall',
    tseQrPayload: 'TSE Ausfall',
    footerLines: [...(footerLines.length > 0 ? footerLines : DEFAULT_FOOTER), '- TESTDRUCK -'],
  };
}

// ════════════════════════════════════════════════════════════════════════
// Small inputs
// ════════════════════════════════════════════════════════════════════════

function Field({
  label,
  value,
  onChange,
  mono,
  platzhalter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  /** Beispiel für ein LEERES Feld. Nie ein Wert, immer nur ein Muster. */
  platzhalter?: string;
}): JSX.Element {
  return (
    <label style={{ display: 'block' }}>
      <span
        className="w14-smallcaps"
        style={{
          display: 'block',
          color: 'var(--w14-ink-aged)',
          fontSize: 'var(--w14-schrift-zeile)',
          letterSpacing: '0.06em',
          marginBottom: 4,
        }}
      >
        {label}
      </span>
      <input
        placeholder={platzhalter}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...inputStyle,
          fontFamily: mono ? 'var(--w14-font-mono)' : 'var(--w14-font-body)',
        }}
      />
    </label>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 30,
        height: 30,
        flex: '0 0 auto',
        borderRadius: 6,
        border: '1px solid var(--w14-rule)',
        background: 'var(--w14-parchment-2)',
        color: disabled ? 'var(--w14-ink-faded)' : 'var(--w14-ink-aged)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontSize: 'var(--w14-schrift-text)',
      }}
    >
      {children}
    </button>
  );
}

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid var(--w14-rule)',
  borderRadius: 'var(--w14-radius-card)',
  padding: 'var(--w14-abstand-14) var(--w14-abstand-16) var(--w14-abstand-16)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--w14-abstand-12)',
  margin: 0,
  background: 'var(--w14-parchment-1)',
};
const legendStyle: React.CSSProperties = {
  padding: '0 var(--w14-abstand-8)',
  fontFamily: 'var(--w14-font-display)',
  fontSize: 'var(--w14-schrift-betont)',
  color: 'var(--w14-ink-aged)',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 'var(--w14-abstand-8) var(--w14-abstand-10)',
  border: '1px solid var(--w14-feldlinie)',
  borderRadius: 'var(--w14-radius-fein)',
  backgroundColor: 'var(--w14-parchment)',
  fontSize: 'var(--w14-schrift-text)',
  color: 'var(--w14-ink)',
  outline: 'none',
};
const addLineStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  marginTop: 4,
  padding: 'var(--w14-abstand-6) var(--w14-abstand-12)',
  borderRadius: 'var(--w14-radius-button)',
  border: '1px dashed var(--w14-rule)',
  background: 'transparent',
  color: 'var(--w14-ink-aged)',
  cursor: 'pointer',
  fontSize: 'var(--w14-schrift-feld)',
};
/** Ehrliche Statuszeilen der Logo-Gruppe. */
const logoHinweisStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--w14-schrift-feld)',
  color: 'var(--w14-ink-aged)',
  fontStyle: 'italic',
};
/**
 * Der Datei-Knopf: ein label um ein verstecktes input — 44 Punkte hoch,
 * dieselbe Flaeche faehrt spaeter auf der Android-Schale (Tastbedienung).
 */
const logoWaehlenStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 44,
  padding: 'var(--w14-abstand-8) var(--w14-abstand-16)',
  borderRadius: 'var(--w14-radius-button)',
  border: '1px solid var(--w14-rule)',
  background: 'var(--w14-parchment-2)',
  color: 'var(--w14-ink)',
  cursor: 'pointer',
  fontSize: 'var(--w14-schrift-text)',
};

/** Datei → base64 der Originalbytes — fuer Upload UND Byte-Vorschau. */
function dateiAlsBase64(datei: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leser = new FileReader();
    leser.onload = () => {
      const ergebnis = String(leser.result ?? '');
      const komma = ergebnis.indexOf(',');
      resolve(komma >= 0 ? ergebnis.slice(komma + 1) : ergebnis);
    };
    leser.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'));
    leser.readAsDataURL(datei);
  });
}

function formatiereDatum(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const chipStyle: React.CSSProperties = {
  padding: 'var(--w14-abstand-4) var(--w14-abstand-10)',
  borderRadius: 'var(--w14-radius-button)',
  border: '1px solid var(--w14-rule)',
  background: 'var(--w14-parchment-2)',
  color: 'var(--w14-ink-aged)',
  cursor: 'pointer',
  fontSize: 'var(--w14-schrift-zeile)',
};

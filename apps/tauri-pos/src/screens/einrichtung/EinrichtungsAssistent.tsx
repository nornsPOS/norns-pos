/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER EINRICHTUNGSASSISTENT — die Fläche
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Basels Auftrag vom 09.08.2026, wörtlich: „يفتح يطلب منو اسم المحل مثلاً رقم
 * الضريبي ايميل رقم جوال اوقات الدوام وهاكذا … يمشي معه خطوة بخطوة ويضل متابع
 * حاله TSE".
 *
 * Der Händler installiert, meldet sich an, und wird durch sechs Schritte
 * geführt (seit 12.08.2026 fragt der sechste die Steuerberater-Angaben ab). Was er einträgt, landet in genau den Einstellungsschlüsseln, die
 * die Riegel, die Startliste und die Verfahrensdokumentation ohnehin lesen.
 * Die Fragen selbst stehen in `einrichtungs-schritte.ts`, damit prüfbar ist,
 * WAS gefragt wird, ohne etwas zu rendern.
 *
 * ── ⚠️ DREI ENTSCHEIDUNGEN, DIE HIER TRAGEN ─────────────────────────────
 *
 * 1. JEDER SCHRITT SPEICHERT FÜR SICH. Nicht erst am Ende. Wer bei Schritt
 *    drei das Fenster schliesst, findet beim nächsten Start die ersten zwei
 *    ausgefüllt vor. Ein Assistent, der alles erst zum Schluss schreibt,
 *    bestraft jede Unterbrechung — und Unterbrechungen sind der Normalfall,
 *    wenn jemand die Steuernummer erst suchen muss.
 *
 * 2. ER LÄSST SICH VERLASSEN. Ein Formular, das den Weg in die Kasse sperrt,
 *    wäre am ersten Morgen mit Kundschaft vor dem Tresen eine Katastrophe,
 *    und für eine Zweitkasse, deren Daten längst stehen, sinnlos. Wer
 *    „Später" wählt, landet auf der Startliste, die dieselben Lücken zeigt
 *    und zu denselben Stellen führt.
 *
 *    ⚠️ Das ist KEIN Schlupfloch: die fiskalischen Riegel hängen nicht an
 *    diesem Fenster, sondern an den Werten. Ohne sie verkauft die Kasse
 *    weiterhin nicht.
 *
 * 3. OB ER ERSCHEINT, ENTSCHEIDEN DIE DATEN. Nicht ein örtliches Merkzeichen.
 *    Ein Merkzeichen im Fensterspeicher löge auf einer Zweitkasse („noch nie
 *    eingerichtet", obwohl alles steht) und nach einem Neuaufsetzen („schon
 *    erledigt", obwohl nichts steht). Gemessen wird der Firmenname, den
 *    Wanderung 0126 bewusst LEER anlegt.
 *
 * ── UND NICHTS WIRD ERFUNDEN ────────────────────────────────────────────
 *
 * Kein vorausgefülltes Feld, kein geratenes Land, kein Muster als Vorgabe.
 * Ein leeres Feld bleibt leer und der zugehörige Punkt der Startliste offen.
 * Wanderung 0123 musste eine erfundene USt-IdNr. wieder ausbauen, die auf
 * Produktion GEDRUCKT hatte.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@norns/api-client';
import { describeError } from '@norns/i18n-de';
import {
  Button,
  Zwischentitel,
  Field,
  Icon,
  Input,
  ParchmentCard,
  Select,
} from '@norns/ui-kit';
import { ArrowLeft, ArrowRight, Check, ExternalLink, ShieldAlert } from 'lucide-react';

import { useApiClient } from '../../lib/api-context.js';
import { useToastStore } from '../../state/toast-store.js';

import { Belegstreifen, Faden } from './einrichtungs-zeichnungen.js';
import { vorschlaegeFuerLeereFelder, EINRICHTUNGS_SCHRITTE, type Feld, type Schritt } from './einrichtungs-schritte.js';

/**
 * Ein Punkt der ECHTEN Startliste des Motors.
 *
 * Seit dem 14.08.2026 liefert der Motor ALLE Punkte samt Stand; die
 * Filterung auf das Offene geschieht hier, sonst zaehlte der Pruefstein
 * Erledigtes als Sperre.
 */
interface Startpunkt {
  titel: string;
  erklaerung: string;
  sperre: string;
  erledigt: boolean;
}

interface SettingsAntwort {
  settings: Array<{ key: string; value: string }>;
}

/**
 * `GET /api/settings` liefert `value::text` der jsonb-Spalte — ein
 * gespeicherter Text kommt also MIT Anführungszeichen an. Dasselbe Auspacken
 * wie in `BetriebSection`; tolerant, was kein JSON ist bleibt wie es ist.
 */
function auspacken(roh: string): string {
  try {
    const geparst: unknown = JSON.parse(roh);
    return typeof geparst === 'string' ? geparst : roh;
  } catch {
    return roh;
  }
}

/** Die Eingabeart eines Feldes auf das HTML-Attribut abbilden. */
function eingabeArt(f: Feld): string {
  if (f.art === 'email') return 'email';
  if (f.art === 'telefon') return 'tel';
  return 'text';
}

export interface EinrichtungsAssistentProps {
  /** Der Händler will jetzt in die Kasse. Die Fläche schliesst sich. */
  onVerlassen: () => void;
}

export function EinrichtungsAssistent({ onVerlassen }: EinrichtungsAssistentProps) {
  const api = useApiClient();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [wo, setWo] = useState(0);
  const [entwurf, setEntwurf] = useState<Record<string, string>>({});
  const [geladen, setGeladen] = useState(false);

  const abfrage = useQuery({
    queryKey: ['settings', 'einrichtung'],
    queryFn: () => api.request<SettingsAntwort>('GET', '/api/settings'),
  });

  /**
   * ⛔ DIE BEREITSCHAFT WIRD GELESEN, NICHT GERECHNET.
   *
   * Der Prüfstein sagt dem Händler, was seine Kasse jetzt kann. Diese
   * Auskunft MUSS aus derselben Quelle kommen wie die Riegel selbst, also
   * aus `GET /api/einrichtung`.
   *
   * Eine zweite, eigene Rechnung hier wäre der nächste stille Widerspruch
   * dieses Hauses: die Fläche sagte „alles bereit", der Riegel wiese den
   * ersten Verkauf ab, und beide hätten aus ihrer Sicht recht. Genau diese
   * Klasse hat hier schon einmal die Startliste behaupten lassen, ein
   * Verkauf sei unmöglich, während er längst durchging.
   */
  const bereitschaft = useQuery({
    queryKey: ['einrichtung', 'startliste'],
    queryFn: () =>
      api.request<{ kannVerkaufen: boolean; schritte: Startpunkt[] }>('GET', '/api/einrichtung'),
  });

  /**
   * Den Entwurf EINMAL aus den lebenden Werten setzen, danach gehört er der
   * Hand des Händlers. Sonst überschriebe eine Hintergrundabfrage seine
   * halbfertige Eingabe mitten im Tippen.
   */
  useEffect(() => {
    if (abfrage.data === undefined || geladen) return;
    const naechster: Record<string, string> = {};
    for (const zeile of abfrage.data.settings) {
      naechster[zeile.key] = auspacken(zeile.value);
    }

    /*
     * ── VORGABEN STATT FRAGEN (18.08.2026) ──────────────────────────────
     * Leere Felder bekommen den begruendeten Vorschlag SICHTBAR in den
     * Entwurf (Herkunft und Grenzen: `vorschlaegeFuerLeereFelder`). Nichts
     * wird still gespeichert: der Wert steht im Feld, der Mensch prueft ihn
     * und speichert mit „Weiter" selbst. Ein GEFUELLTES Feld wird nie
     * angefasst — der Bestand schlaegt jeden Vorschlag.
     */
    const heute = new Date().toISOString().slice(0, 10);
    for (const [schluessel, wert] of Object.entries(vorschlaegeFuerLeereFelder(heute))) {
      if ((naechster[schluessel] ?? '').trim() === '') naechster[schluessel] = wert;
    }

    setEntwurf(naechster);
    setGeladen(true);

    /*
     * WIEDERAUFNAHME. Beim ersten Laden auf den ersten Schritt springen, der
     * noch eine Lücke hat. Wer gestern bei „Kontakt" aufgehört hat, landet
     * heute dort und nicht wieder am Anfang.
     */
    const ersteLuecke = EINRICHTUNGS_SCHRITTE.findIndex(
      (s) => s.felder.length > 0 && s.felder.some((f) => (naechster[f.schluessel] ?? '').trim() === ''),
    );
    if (ersteLuecke > 0) setWo(ersteLuecke);
  }, [abfrage.data, geladen]);

  const schritt: Schritt | undefined = EINRICHTUNGS_SCHRITTE[wo];

  const speichern = useMutation({
    mutationFn: async (s: Schritt) => {
      const gespeichert: string[] = [];
      for (const f of s.felder) {
        const wert = (entwurf[f.schluessel] ?? '').trim();
        const vorher = auspacken(
          abfrage.data?.settings.find((z) => z.key === f.schluessel)?.value ?? '""',
        ).trim();
        // Nur wirklich Geändertes schreiben. Ein PATCH je Tastendruck wäre
        // ein Tagebucheintrag je Tastendruck.
        if (wert !== vorher) {
          await api.request('PATCH', `/api/settings/${f.schluessel}`, { value: wert });
          gespeichert.push(f.schluessel);
        }
      }
      return gespeichert.length;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['settings'] });
      // Die Startliste liest dieselben Werte und muss sofort nachziehen.
      await qc.invalidateQueries({ queryKey: ['einrichtung'] });
    },
    onError: (err: unknown) => {
      addToast({
        tone: 'alert',
        title: 'Nicht gespeichert',
        body: err instanceof ApiError ? describeError(err) : 'Bitte erneut versuchen.',
      });
    },
  });

  /**
   * ⛔ SPEICHERN VOR JEDEM AUSGANG, NICHT NUR VOR „WEITER".
   *
   * ── DER BEFUND VOM 14.08.2026 ─────────────────────────────────────────
   *
   * `weiter()` speicherte. `Zurück` rief blank `setWo(wo - 1)`, und
   * „Später einrichten" rief blank `onVerlassen()`. Wer die Steuernummer
   * eintippte und dann zurückblätterte, um den Firmennamen zu berichtigen,
   * verlor die Steuernummer, ohne dass irgendwo etwas stand.
   *
   * Das ist bitterer als es klingt: der Kopf dieser Datei verspricht
   * ausdrücklich „JEDER SCHRITT SPEICHERT FÜR SICH … wer bei Schritt drei
   * das Fenster schliesst, findet beim nächsten Start die ersten zwei
   * ausgefüllt vor". Zwei von vier Ausgängen hielten das nicht.
   *
   * Jetzt geht jeder Ausgang durch DIESE eine Tür.
   */
  const ausgang = async (wohin: () => void) => {
    if (schritt !== undefined && schritt.felder.length > 0) {
      try {
        await speichern.mutateAsync(schritt);
      } catch {
        return; // Der Fehler steht schon als Meldung. Nichts verlassen.
      }
    }
    wohin();
  };

  const weiter = async () =>
    ausgang(() => {
      if (wo + 1 < EINRICHTUNGS_SCHRITTE.length) setWo(wo + 1);
      else onVerlassen();
    });

  const zurueck = async () => ausgang(() => setWo(Math.max(0, wo - 1)));
  const spaeter = async () => ausgang(onVerlassen);

  const offeneFelder = useMemo(() => {
    if (schritt === undefined) return 0;
    return schritt.felder.filter((f) => (entwurf[f.schluessel] ?? '').trim() === '').length;
  }, [schritt, entwurf]);

  if (schritt === undefined) return null;

  const letzter = wo + 1 === EINRICHTUNGS_SCHRITTE.length;

  /*
   * ── DIE WERKBANK ──────────────────────────────────────────────────────
   *
   * Basels Klage: „blass, keine Tiefe, keine Bildsprache". Die Antwort ist
   * nicht mehr Schmuck, sondern eine zweite Spalte mit SEINEM Papier.
   *
   * Der Händler wird nicht befragt, sondern EINGERICHTET: neben jeder Frage
   * liegt sein eigener Beleg, auf dem jede noch fehlende Angabe als
   * sichtbare Leerstelle steht. Jede Antwort schliesst eine davon vor
   * seinen Augen. Das ist der Unterschied zwischen einem Formular und einer
   * Werkstatt.
   *
   * ⚠️ Der Beleg liest den ENTWURF, nicht den gespeicherten Stand. Sonst
   * bewegte er sich erst beim Blättern, und der Zusammenhang zwischen dem
   * getippten Wort und dem Papier ginge verloren.
   */
  const ortszeile = [entwurf['shop.postal_code'] ?? '', entwurf['shop.city'] ?? '']
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .join(' ');

  return (
    <div style={BUEHNE}>
      {/*
        Der Schrittwechsel bekommt einen kurzen, wuerdigen Auftritt: das neue
        Blatt steigt eine Handbreit auf und wird dabei sichtbar. Kein Federn,
        kein Schieben der ganzen Buehne — es geht um eine Steuerangelegenheit,
        nicht um eine Diashow. Der Inhalt ist von der ERSTEN Millisekunde an
        im Baum (keine per Klasse versteckte Sichtbarkeit); wer Bewegung
        reduziert hat, sieht ihn schlicht sofort.
      */}
      <style>{`
        @keyframes w14-schritt-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: none; }
        }
        .w14-schritt-blende {
          animation: w14-schritt-in var(--w14-dur-fast) var(--w14-ease-out) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .w14-schritt-blende { animation: none; }
        }
      `}</style>
      <div style={WERKBANK}>
        <ParchmentCard style={KARTE}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--w14-abstand-12)',
          }}
        >
          <Fortschritt wo={wo} entwurf={entwurf} />
          <FortschrittsRing entwurf={entwurf} />
        </div>

        {/*
          Der Faden. Fortschritt als STRECKE, nicht als Prozentzahl: der
          Mensch sieht, wie weit er ist, ohne eine Zahl zu lesen.
        */}
        <Faden etappen={EINRICHTUNGS_SCHRITTE.map((e) => e.titel)} bei={wo} />

        {/*
          `key={wo}` laesst React das Blatt beim Schrittwechsel neu aufziehen,
          und genau dieser Neuaufzug traegt die Blende oben. Ein `form`, damit
          die Eingabetaste in einem Feld dasselbe tut wie „Speichern und
          weiter" — der Haendler tippt sich durch, ohne zur Maus zu greifen.
        */}
        <form
          key={wo}
          className="w14-schritt-blende"
          style={{ display: 'grid', gap: 'var(--w14-abstand-12)' }}
          onSubmit={(ereignis) => {
            ereignis.preventDefault();
            void weiter();
          }}
        >
          <h1 style={TITEL}>{schritt.titel}</h1>
          <p style={EINLEITUNG}>{schritt.einleitung}</p>

          <Zwischentitel />

          {schritt.kennung === 'pruefstein' && (
            <Pruefstein
              kannVerkaufen={bereitschaft.data?.kannVerkaufen}
              punkte={bereitschaft.data?.schritte}
              laedt={bereitschaft.isPending}
            />
          )}

          {schritt.kennung === 'tse' && <TseEintrag />}

          {schritt.felder.length > 0 && (
            <div style={FELDER}>
              {schritt.felder.map((f) => (
                <FeldZeile
                  key={f.schluessel}
                  feld={f}
                  wert={entwurf[f.schluessel] ?? ''}
                  setzen={(v) => setEntwurf((e) => ({ ...e, [f.schluessel]: v }))}
                />
              ))}
            </div>
          )}

          {schritt.anleitung !== undefined && <Anleitung zeilen={schritt.anleitung} />}

          {schritt.hilfe !== undefined && (
            <a href={schritt.hilfe} target="_blank" rel="noreferrer" style={HILFE_LINK}>
              <Icon icon={ExternalLink} size={14} />
              Ausführliche Anleitung auf norns.de
            </a>
          )}
        </form>

        <div style={FUSS}>
          <button type="button" onClick={() => void spaeter()} style={SPAETER}>
            Später einrichten
          </button>

          <div style={{ display: 'flex', gap: 'var(--w14-abstand-8)' }}>
            {wo > 0 && (
              <Button variant="ghost" onClick={() => void zurueck()}>
                <Icon icon={ArrowLeft} size={16} />
                Zurück
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => void weiter()}
              disabled={speichern.isPending}
            >
              {speichern.isPending
                ? 'Wird gespeichert …'
                : letzter
                  ? 'Fertig'
                  : 'Speichern und weiter'}
              <Icon icon={letzter ? Check : ArrowRight} size={16} />
            </Button>
          </div>
        </div>

        {/*
          EHRLICH ÜBER DAS, WAS OFFEN BLEIBT. Kein Zwang, aber auch keine
          Beschönigung: wer weiterblättert, soll wissen, was er zurücklässt.
        */}
        {offeneFelder > 0 && (
          <p style={OFFEN_HINWEIS}>
            {offeneFelder === 1
              ? 'Ein Feld ist noch leer. Sie können es später in den Einstellungen nachtragen.'
              : `${offeneFelder} Felder sind noch leer. Sie können sie später in den Einstellungen nachtragen.`}
          </p>
        )}
        </ParchmentCard>

        {/*
          ── DIE TAFEL ────────────────────────────────────────────────────
          Dunkel, damit das helle Papier darauf WIRKLICH liegt. Zwei
          Pergamenttöne übereinander wären gemessen 1,17 zu 1 und auf einem
          Ladenbildschirm bei Tageslicht nicht zu unterscheiden.
        */}
        <ParchmentCard tone="ink" padding="lg" style={TAFEL}>
          <span style={TAFEL_MARKE}>Ihr Beleg, während er entsteht</span>
          <Belegstreifen
            ladenname={(entwurf['shop.legal_name'] ?? '').trim() || undefined}
            strasse={(entwurf['shop.street'] ?? '').trim() || undefined}
            ortszeile={ortszeile || undefined}
            telefon={(entwurf['shop.phone'] ?? '').trim() || undefined}
            steuernummer={(entwurf['shop.tax_number'] ?? '').trim() || undefined}
            ustId={(entwurf['shop.vat_id'] ?? '').trim() || undefined}
          />
          <span style={TAFEL_FUSS}>
            Was hier noch als Linie steht, fehlt auf dem gedruckten Papier.
          </span>
        </ParchmentCard>
      </div>
    </div>
  );
}

/**
 * Der Fiskal-Ring — Basels Auftrag vom 12.08.2026: eine farbige Anzeige von
 * Rot nach Grün mit dem Prozentwert in der Mitte, damit der Händler auf einen
 * Blick sieht, wie vollständig seine Angaben sind.
 *
 * Gemessen wird der ANTEIL DER GEFÜLLTEN FELDER über alle Schritte, dieselbe
 * Quelle wie die Schrittleiste daneben, damit die zwei Anzeigen nie
 * auseinanderlaufen. Die Farbe läuft über den Farbwinkel 0 (Rot) bis 120
 * (Grün) — bewusst als errechneter Wert, nicht als Hausmarke: es ist eine
 * Messuhr, keine Markenfläche.
 */
/**
 * ⛔ DER RING MISST DIE VERKAUFSBEREITSCHAFT, NICHT DIE FLEISSARBEIT
 * (19.08.2026, Basels Befund).
 *
 * Er zaehlte ALLE Felder aller Schritte. Ein Haendler, der die beiden
 * Sperren beantwortet hat und damit rechtlich verkaufen DARF, sah trotzdem
 * eine orangene 38 Prozent — als fehle das Wichtigste. Der Ring log ihn an,
 * und zwar in die entmutigende Richtung.
 *
 * Gezaehlt werden jetzt die Felder der SPERRENDEN Schritte (Betrieb, Steuer,
 * Sicherungseinrichtung — dieselben zwei Sperren, nach denen die Reihenfolge
 * gebaut ist). Steht der Ring auf 100, ist die Kasse verkaufsbereit; alles
 * Weitere ist Nacharbeit, die die Startliste fuehrt, und keine Schuld.
 */
const SPERRENDE_SCHRITTE = ['betrieb', 'steuer', 'tse'] as const;

function FortschrittsRing({ entwurf }: { entwurf: Record<string, string> }) {
  const felder = EINRICHTUNGS_SCHRITTE.filter((s) =>
    (SPERRENDE_SCHRITTE as readonly string[]).includes(s.kennung),
  ).flatMap((s) => s.felder);
  const gefuellt = felder.filter((f) => (entwurf[f.schluessel] ?? '').trim() !== '').length;
  const anteil = felder.length === 0 ? 0 : gefuellt / felder.length;
  const prozent = Math.round(anteil * 100);
  const farbe = `hsl(${Math.round(anteil * 120)} 62% 38%)`;

  // Kreisumfang bei r=26: 2 * PI * 26. Fest ausgerechnet, damit kein
  // Laufzeitwert die Geometrie bewegt.
  const UMFANG = 163.36;
  return (
    <svg
      width={64}
      height={64}
      viewBox="0 0 64 64"
      role="img"
      aria-label={`Verkaufsbereitschaft ${prozent} Prozent, ${gefuellt} von ${felder.length} nötigen Angaben`}
    >
      <circle cx={32} cy={32} r={26} fill="none" stroke="var(--w14-rule)" strokeWidth={5} />
      <circle
        cx={32}
        cy={32}
        r={26}
        fill="none"
        stroke={farbe}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={`${(anteil * UMFANG).toFixed(2)} ${UMFANG.toFixed(2)}`}
        transform="rotate(-90 32 32)"
      />
      <text
        x={32}
        y={32}
        textAnchor="middle"
        dominantBaseline="central"
        style={{
          fontFamily: 'var(--w14-font-body)',
          fontSize: 'var(--w14-schrift-zeile)',
          fontWeight: 600,
          fill: 'var(--w14-ink)',
        }}
      >
        {prozent}%
      </text>
    </svg>
  );
}

/** Die Schrittleiste. Zeigt, wo man ist und was schon steht. */
function Fortschritt({ wo, entwurf }: { wo: number; entwurf: Record<string, string> }) {
  return (
    <ol style={LEISTE} aria-label="Fortschritt der Einrichtung">
      {EINRICHTUNGS_SCHRITTE.map((s, i) => {
        const fertig =
          s.felder.length > 0 && s.felder.every((f) => (entwurf[f.schluessel] ?? '').trim() !== '');
        const hier = i === wo;
        return (
          <li
            key={s.kennung}
            aria-current={hier ? 'step' : undefined}
            style={{
              ...LEISTE_PUNKT,
              color: hier ? 'var(--w14-ink)' : 'var(--w14-ink-faded)',
              fontWeight: hier ? 600 : 400,
            }}
          >
            <span
              aria-hidden
              style={{
                ...MARKE,
                background: hier
                  ? 'var(--w14-terra)'
                  : fertig
                    ? 'var(--w14-ink-faded)'
                    : 'transparent',
                borderColor: fertig || hier ? 'transparent' : 'var(--w14-rule)',
              }}
            />
            {s.titel}
          </li>
        );
      })}
    </ol>
  );
}

function FeldZeile({
  feld,
  wert,
  setzen,
}: {
  feld: Feld;
  wert: string;
  setzen: (v: string) => void;
}) {
  /*
   * ⛔ 14.08.2026: `wennLeer` WURDE NIRGENDS GEZEIGT.
   *
   * Das Datenfeld trägt die Folge einer fehlenden Angabe, und sein eigener
   * Kommentar in `einrichtungs-schritte.ts` sagt woertlich: „Steht direkt am
   * Feld — der Händler soll entscheiden können, ohne zu raten."
   *
   * Gemessen stand es an keinem Feld. Ein Test erzwingt seit jeher, dass es
   * nicht leer ist; gesehen hat es nie jemand. Neunzehn sorgfältig
   * geschriebene Sätze, für niemanden.
   *
   * Das ist die Hausklasse „Dokument verspricht, was der Code nicht tut",
   * und hier stand das Versprechen im Kommentar des Feldes selbst.
   *
   * ⚠️ Gezeigt wird die Folge NUR, solange das Feld leer ist. Ein Satz über
   * die Folge des Weglassens, der neben einer ausgefüllten Angabe stehen
   * bleibt, ist Lärm: er warnt vor etwas, das nicht mehr eintritt.
   */
  const leer = wert.trim() === '';
  return (
    <Field label={feld.etikett} hint={feld.wozu}>
      <div style={FELD_STAPEL}>
      {feld.art === 'auswahl' && feld.optionen !== undefined ? (
        <Select value={wert} onChange={(e) => setzen(e.target.value)}>
          {/* ⚠️ Leer als ECHTE Wahl, nicht als versteckte Vorgabe. */}
          <option value="">Bitte wählen</option>
          {feld.optionen.map((o) => (
            <option key={o.wert} value={o.wert}>
              {o.etikett}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          type={eingabeArt(feld)}
          value={wert}
          onChange={(e) => setzen(e.target.value)}
          /* ⚠️ `placeholder` zeigt die FORM, ist aber kein Wert. Wer nichts
             tippt, speichert nichts. */
          placeholder={feld.form}
          autoComplete="off"
        />
      )}
        {leer && <span style={FOLGE}>{feld.wennLeer}</span>}
      </div>
    </Field>
  );
}

/**
 * ── DER PRUEFSTEIN ────────────────────────────────────────────────────────
 *
 * Basels Entscheidung vom 14.08.2026: er LAESST den Händler in die Kasse,
 * auch wenn die Sicherungseinrichtung fehlt. Er hält niemanden auf.
 *
 * Aber er beschönigt auch nichts. Ein Prüfstein, der „alles bereit" sagt,
 * während der erste Verkauf abgewiesen wird, wäre schlimmer als gar keiner:
 * der Händler stünde mit Kundschaft vor dem Tresen und suchte einen Fehler,
 * den ihm jemand hätte nennen können.
 *
 * ⚠️ Alles hier kommt aus der Antwort des Motors. Nichts wird gerechnet.
 */
function Pruefstein({
  kannVerkaufen,
  punkte,
  laedt,
}: {
  kannVerkaufen: boolean | undefined;
  punkte: readonly Startpunkt[] | undefined;
  laedt: boolean;
}) {
  if (laedt) {
    return <p style={EINLEITUNG}>Der Stand wird gelesen …</p>;
  }
  /*
   * ⚠️ „null ist nicht grün": kam keine Antwort, wird NICHT „alles bereit"
   * behauptet. Ein Prüfstein, der bei einem Netzfehler Entwarnung gibt, ist
   * genau die Lüge, gegen die er gebaut ist.
   */
  if (kannVerkaufen === undefined || punkte === undefined) {
    return (
      <p style={EINLEITUNG}>
        Der Stand liess sich gerade nicht lesen. Was offen ist, steht auf der
        Startliste in der Werkstatt.
      </p>
    );
  }

  const offen = punkte.filter((p) => !p.erledigt);
  const sperrend = offen.filter((p) => p.sperre === 'VERKAUF');
  const uebrig = offen.filter((p) => p.sperre !== 'VERKAUF');

  return (
    <div style={PRUEFSTEIN}>
      <p style={{ ...EINLEITUNG, margin: 0 }}>
        {kannVerkaufen
          ? 'Diese Kasse kann verkaufen.'
          : 'Diese Kasse kann noch nicht verkaufen.'}
      </p>

      {sperrend.length > 0 && (
        <ul style={PUNKTE}>
          {sperrend.map((p) => (
            <li key={p.titel} style={PUNKT_SPERRE}>
              <strong>{p.titel}</strong>
              <span>{p.erklaerung}</span>
            </li>
          ))}
        </ul>
      )}

      {uebrig.length > 0 && (
        <ul style={PUNKTE}>
          {uebrig.map((p) => (
            <li key={p.titel} style={PUNKT_OFFEN}>
              <strong>{p.titel}</strong>
              <span>{p.erklaerung}</span>
            </li>
          ))}
        </ul>
      )}

      {punkte.length === 0 && (
        <p style={{ ...EINLEITUNG, margin: 0 }}>
          Es ist nichts mehr offen. Sie können sofort anfangen.
        </p>
      )}
    </div>
  );
}


function Anleitung({ zeilen }: { zeilen: readonly string[] }) {
  return (
    <ol style={ANLEITUNG}>
      {zeilen.map((z) => (
        <li key={z} style={ANLEITUNG_ZEILE}>
          {z.startsWith('⚠️') ? (
            <span style={WARNUNG}>
              <Icon icon={ShieldAlert} size={15} />
              <span>{z.replace('⚠️ ', '')}</span>
            </span>
          ) : (
            z
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * ── Die Sicherheitseinrichtung wird HIER eingetragen, nicht woanders ───────
 *
 * DER BEFUND VOM 14.08.2026: der Motor trug längst einen echten Weg,
 * `POST /api/tse/einrichten`, der die Kennungen VOR dem Speichern beim
 * Anbieter prüft und bei Nichterreichbarkeit NICHTS speichert. Gerufen hat
 * ihn niemand. Die Einrichtung sagte dem Händler stattdessen, er solle in
 * die Einstellungen gehen. Das ist die Hausklasse „gebaut und nie
 * angeschlossen", ausgerechnet am wichtigsten Schritt des Hauses.
 *
 * Ehrlichkeit dieser Fläche:
 *   Erfolg heisst: der Anbieter hat bestätigt. Nicht: wir haben gespeichert.
 *   Ein Fehler zeigt den Satz des Motors, keinen Sammelsatz.
 *   Ohne Netz wird NICHTS gespeichert, und genau das steht dann da.
 */
function TseEintrag() {
  const api = useApiClient();
  const qc = useQueryClient();
  const [tssId, setTssId] = useState('');
  const [clientId, setClientId] = useState('');

  const stand = useQuery({
    queryKey: ['tse', 'einrichtung'],
    queryFn: () =>
      api.request<{
        eingerichtet: boolean;
        tssId: string | null;
        clientId: string | null;
        eingerichtetAm: string | null;
      }>('GET', '/api/tse/einrichtung'),
    staleTime: 10_000,
  });

  const eintragen = useMutation({
    mutationFn: () =>
      api.request<{ tssId: string; clientId: string; eingerichtetAm: string; erstmalig: boolean }>(
        'POST',
        '/api/tse/einrichten',
        { tssId: tssId.trim(), clientId: clientId.trim() },
      ),
    onSuccess: async () => {
      // Der Prüfstein und die Startliste lesen dieselbe Quelle: sofort neu.
      await qc.invalidateQueries({ queryKey: ['tse'] });
      await qc.invalidateQueries({ queryKey: ['einrichtung'] });
    },
  });

  if (stand.data?.eingerichtet === true) {
    return (
      <div style={TSE_KARTE}>
        <Check size={18} style={{ color: 'var(--w14-verdigris)', flex: '0 0 auto' }} />
        <div>
          <div style={{ fontWeight: 600 }}>Die Sicherheitseinrichtung ist eingetragen.</div>
          <div style={{ color: 'var(--w14-ink-faded)', fontSize: 'var(--w14-schrift-feld)' }}>
            Kennung {stand.data.tssId}, Kassenklient {stand.data.clientId}. Der Anbieter hat die
            Verbindung bestätigt.
          </div>
        </div>
      </div>
    );
  }

  const fehlerSatz =
    eintragen.error instanceof ApiError
      ? describeError(eintragen.error)
      : eintragen.error instanceof Error
        ? 'Der Anbieter war nicht erreichbar. Es wurde nichts gespeichert.'
        : null;

  return (
    <div style={{ display: 'grid', gap: 'var(--w14-abstand-10)' }}>
      <Field
        label="Kennung der Sicherheitseinrichtung"
        hint={'Vom Anbieter, dort „TSS ID“ genannt. Mindestens acht Zeichen.'}
      >
        <Input value={tssId} onChange={(e) => setTssId(e.target.value)} spellCheck={false} />
      </Field>
      <Field
        label="Kennung dieser Kasse beim Anbieter"
        hint={'Vom Anbieter, dort „Client ID“ genannt.'}
      >
        <Input value={clientId} onChange={(e) => setClientId(e.target.value)} spellCheck={false} />
      </Field>
      <div>
        <Button
          variant="primary"
          size="md"
          disabled={eintragen.isPending || tssId.trim().length < 8 || clientId.trim().length < 1}
          onClick={() => eintragen.mutate()}
        >
          {eintragen.isPending ? 'Fragt beim Anbieter nach…' : 'Prüfen und eintragen'}
        </Button>
      </div>
      {fehlerSatz !== null && (
        <div style={TSE_FEHLER}>
          <ShieldAlert size={16} style={{ flex: '0 0 auto' }} />
          <span>{fehlerSatz}</span>
        </div>
      )}
    </div>
  );
}

const TSE_KARTE: CSSProperties = {
  display: 'flex',
  gap: 'var(--w14-abstand-8)',
  alignItems: 'flex-start',
  padding: 'var(--w14-abstand-12) var(--w14-abstand-14)',
  borderRadius: 'var(--w14-radius-card)',
  border: '1px solid var(--w14-rule)',
  background: 'var(--w14-parchment-2)',
};

const TSE_FEHLER: CSSProperties = {
  display: 'flex',
  gap: 'var(--w14-abstand-6)',
  alignItems: 'flex-start',
  color: 'var(--w14-danger)',
  fontSize: 'var(--w14-schrift-feld)',
};

/* ─────────────────────────────── Gestalt ─────────────────────────────── */

const BUEHNE: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--w14-abstand-32)',
  background: 'var(--w14-parchment)',
  overflowY: 'auto',
};

/**
 * Zwei Spalten, und unter 900 px eine. Die Frage steht dann oben, das
 * Papier darunter: auf einem schmalen Bildschirm ist die Frage das
 * Dringende, nicht die Vorschau.
 */
const WERKBANK: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 34rem) minmax(0, 22rem)',
  gap: 'var(--w14-abstand-24)',
  alignItems: 'start',
  width: '100%',
  maxWidth: '62rem',
};

const TAFEL: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'var(--w14-abstand-16)',
  position: 'sticky',
  top: 'var(--w14-abstand-32)',
};

const TAFEL_MARKE: CSSProperties = {
  fontSize: 'var(--w14-schrift-marke)',
  letterSpacing: '0.12em',
  color: 'var(--w14-parchment-2)',
  textAlign: 'center',
};

const TAFEL_FUSS: CSSProperties = {
  fontSize: 'var(--w14-schrift-fussnote)',
  color: 'var(--w14-parchment-2)',
  textAlign: 'center',
  lineHeight: 1.5,
  maxWidth: '19rem',
};

const KARTE: CSSProperties = {
  width: '100%',
  maxWidth: '38rem',
  padding: 'var(--w14-abstand-32)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--w14-abstand-16)',
};

const LEISTE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--w14-abstand-16)',
  listStyle: 'none',
  margin: 0,
  padding: 0,
  fontSize: 'var(--w14-schrift-zeile)',
};

const LEISTE_PUNKT: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--w14-abstand-6)',
};

const MARKE: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  border: '1px solid',
  display: 'inline-block',
};

const TITEL: CSSProperties = {
  fontFamily: 'var(--w14-font-display)',
  fontSize: 'var(--w14-schrift-titel)',
  margin: 0,
  color: 'var(--w14-ink)',
  textWrap: 'balance',
};

const EINLEITUNG: CSSProperties = {
  margin: 0,
  color: 'var(--w14-ink-aged)',
  fontSize: 'var(--w14-schrift-zeile)',
  lineHeight: 1.55,
  maxWidth: '62ch',
  textWrap: 'pretty',
};

const FELDER: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--w14-abstand-16)',
};

const ANLEITUNG: CSSProperties = {
  margin: 0,
  paddingLeft: 'var(--w14-abstand-20)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--w14-abstand-10)',
  color: 'var(--w14-ink-aged)',
  fontSize: 'var(--w14-schrift-zeile)',
  lineHeight: 1.55,
};

const ANLEITUNG_ZEILE: CSSProperties = { maxWidth: '62ch', textWrap: 'pretty' };

const WARNUNG: CSSProperties = {
  display: 'inline-flex',
  gap: 'var(--w14-abstand-6)',
  alignItems: 'flex-start',
  color: 'var(--w14-terra)',
};

const HILFE_LINK: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--w14-abstand-6)',
  color: 'var(--w14-ink-aged)',
  fontSize: 'var(--w14-schrift-feld)',
  textDecoration: 'underline',
  textUnderlineOffset: '3px',
  alignSelf: 'flex-start',
  minHeight: 44,
};

/**
 * Die Folge einer fehlenden Angabe. Warnend, aber nicht schreiend: es ist
 * eine Auskunft, keine Absage. Der Händler DARF das Feld leer lassen.
 */
const PRUEFSTEIN: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--w14-abstand-12)',
};

const PUNKTE: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--w14-abstand-8)',
};

const PUNKT_SPERRE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--w14-abstand-2)',
  padding: 'var(--w14-abstand-10)',
  background: 'var(--w14-parchment-3)',
  color: 'var(--w14-ink)',
  fontSize: 'var(--w14-schrift-fussnote)',
  lineHeight: 1.5,
};

const PUNKT_OFFEN: CSSProperties = {
  ...PUNKT_SPERRE,
  background: 'transparent',
  color: 'var(--w14-ink-aged)',
  paddingLeft: 'var(--w14-abstand-10)',
  borderLeft: '1px solid var(--w14-tabellenlinie)',
};

const FELD_STAPEL: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--w14-abstand-6)',
};

const FOLGE: CSSProperties = {
  display: 'block',
  fontSize: 'var(--w14-schrift-fussnote)',
  color: 'var(--w14-ink-aged)',
  lineHeight: 1.5,
  paddingLeft: 'var(--w14-abstand-8)',
  borderLeft: '1px solid var(--w14-tabellenlinie)',
};

const FUSS: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--w14-abstand-16)',
  flexWrap: 'wrap',
  marginTop: 'var(--w14-abstand-8)',
};

const SPAETER: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--w14-ink-faded)',
  fontSize: 'var(--w14-schrift-feld)',
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: '3px',
  padding: 'var(--w14-abstand-10)',
  minHeight: 44,
};

const OFFEN_HINWEIS: CSSProperties = {
  margin: 0,
  color: 'var(--w14-ink-faded)',
  fontSize: 'var(--w14-schrift-zeile)',
};

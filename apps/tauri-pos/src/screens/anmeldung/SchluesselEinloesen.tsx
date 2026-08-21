/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Den Notfallschlüssel einlösen — der Weg zurück in die eigene Kasse
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Wer hier steht, hat seinen Kassencode vergessen und den Laden offen. Die
 * Fläche ist auf genau diesen Menschen gebaut:
 *
 *   • Der Schlüssel wird ABGESCHRIEBEN, nicht getippt wie ein Passwort.
 *     Deshalb formt das Feld beim Tippen selbst — Gross, Bindestriche, das
 *     Vorwort. Wer es kleingeschrieben und ohne Striche eingibt, kommt
 *     genauso hinein; der Server räumt dieselbe Form ab.
 *   • Der neue Kassencode wird SOFORT mit gesetzt. Zwei getrennte Schritte
 *     wären zwei Gelegenheiten, in der Mitte steckenzubleiben.
 *   • Eine einzige Fehlermeldung für jeden Fehlschlag — der Server gibt
 *     absichtlich nicht preis, WORAN es lag.
 */

import { useEffect, useState } from 'react';

import { ApiError, type Laufwerk, meistercode, notfallschluessel, rettungsstick } from '@norns/api-client';
import { Button, Input, ParchmentCard, PinPad, Zwischentitel } from '@norns/ui-kit';
import type { ApiClient } from '@norns/api-client';

/** Genau die Form vom Zettel: `NORNS-XXXX-XXXX-XXXX-XXXX`. */
const GRUPPEN = 4;
const JE_GRUPPE = 4;
const VORWORT = 'NORNS';

/**
 * Aus dem, was jemand tippt, die Form vom Zettel machen.
 *
 * ⚠️ Das Vorwort wird ERGÄNZT, nicht verlangt. Wer nur die sechzehn Zeichen
 * abschreibt, sieht seinen Schlüssel trotzdem richtig zusammengesetzt — und
 * der Server rechnet ohnehin nur mit dem Kern.
 */
export function formeSchluessel(eingabe: string): string {
  let roh = eingabe.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (roh.startsWith(VORWORT)) roh = roh.slice(VORWORT.length);
  roh = roh.slice(0, GRUPPEN * JE_GRUPPE);
  const teile: string[] = [];
  for (let i = 0; i < roh.length; i += JE_GRUPPE) teile.push(roh.slice(i, i + JE_GRUPPE));
  return teile.length === 0 ? '' : `${VORWORT}-${teile.join('-')}`;
}

/** Sind alle sechzehn Zeichen da? */
export function schluesselVollstaendig(eingabe: string): boolean {
  const roh = eingabe.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const kern = roh.startsWith(VORWORT) ? roh.slice(VORWORT.length) : roh;
  return kern.length === GRUPPEN * JE_GRUPPE;
}

interface Eigenschaften {
  api: ApiClient;
  /** Wessen Code, falls die Kasse auf jemand anderen gepaart ist. */
  userId?: string | null;
  onAbbruch: () => void;
  /** Der Nachfolger des verbrauchten Schlüssels — wieder einmal sichtbar. */
  onFertig: (nachfolger: string, neuerCode: string) => void;
  /**
   * Stick- und Meister-Weg haben KEINEN Zettel zum Zeigen: der Stick lädt
   * sich selbst nach, der Meister gibt nichts aus. `hinweis` trägt die eine
   * Ehrlichkeit, die es geben kann („Stick tot, neu schreiben").
   */
  onFertigOhneZettel: (neuerCode: string, hinweis: string | null) => void;
}

export function SchluesselEinloesen({
  api,
  userId,
  onAbbruch,
  onFertig,
  onFertigOhneZettel,
}: Eigenschaften): JSX.Element {
  const [schluessel, setSchluessel] = useState('');
  const [neuerCode, setNeuerCode] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  /*
   * ── DER RETTUNGSSTICK MELDET SICH SELBST (21.08.2026) ───────────────────
   *
   * Solange diese Fläche offen ist, fragt sie alle drei Sekunden nach
   * Wechseldatenträgern. Steckt ein Stick mit Rettungsschlüssel, erscheint
   * er OBEN als eigener Weg — der Händler steckt, tippt den neuen Code,
   * fertig. Kein Suchen, kein Auswählen: das Ding IST die Erkennung.
   *
   * ⚠️ Still im Fehlerfall: eine Kasse ohne diesen Weg (Wolke, alte Fassung)
   * antwortet 404, und dann gibt es hier schlicht keinen Stick-Kasten.
   */
  const [stick, setStick] = useState<Laufwerk | null>(null);
  useEffect(() => {
    let lebt = true;
    const frage = async (): Promise<void> => {
      try {
        const { laufwerke } = await rettungsstick.laufwerke(api);
        if (lebt) setStick(laufwerke.find((l) => l.traegtSchluessel) ?? null);
      } catch {
        if (lebt) setStick(null);
      }
    };
    void frage();
    const takt = window.setInterval(() => void frage(), 3000);
    return () => {
      lebt = false;
      window.clearInterval(takt);
    };
  }, [api]);

  /*
   * ── DER HERSTELLERCODE, EINGEKLAPPT ─────────────────────────────────────
   *
   * Die letzte Tür, wenn weder Zettel noch Stick mehr da sind. Erst ein
   * leiser Textknopf; wer ihn öffnet, bekommt die AUFGABE zum Vorlesen und
   * ein Feld für die ANTWORT des Herstellers.
   */
  const [meister, setMeister] = useState<{ aufgabe: string } | null>(null);
  const [antwort, setAntwort] = useState('');

  const quelle: 'stick' | 'meister' | 'zettel' =
    stick !== null ? 'stick' : meister !== null && antwort.trim().length > 0 ? 'meister' : 'zettel';
  const bereit =
    /^\d{6}$/.test(neuerCode) &&
    (quelle === 'stick' ||
      (quelle === 'meister' && antwort.trim().length >= 40) ||
      schluesselVollstaendig(schluessel));

  async function absenden(): Promise<void> {
    if (laeuft || !bereit) return;
    setLaeuft(true);
    setFehler(null);
    try {
      if (quelle === 'stick' && stick !== null) {
        const r = await rettungsstick.einloesen(api, { laufwerk: stick.pfad, neuerCode });
        if (!r.stickNachgeladen) {
          // Ehrlich UND weiter: der Code ist gesetzt, nur der Stick ist tot.
          onFertigOhneZettel(
            neuerCode,
            'Der Code ist gesetzt. Der Stick konnte aber NICHT neu beschrieben werden und gilt nicht mehr. Unter Team einen neuen schreiben.',
          );
          return;
        }
        onFertigOhneZettel(neuerCode, null);
        return;
      }
      if (quelle === 'meister' && meister !== null) {
        await meistercode.einloesen(api, { antwort: antwort.trim(), neuerCode });
        onFertigOhneZettel(neuerCode, null);
        return;
      }
      const r = await notfallschluessel.einloesen(api, {
        schluessel,
        neuerCode,
        ...(userId ? { userId } : {}),
      });
      onFertig(r.neuerSchluessel, neuerCode);
    } catch (err) {
      /*
       * ⚠️ Der Server sagt mit Absicht nicht, WORAN es lag — jede feinere
       * Auskunft wäre ein Hinweis, wo sich der nächste Versuch lohnt. Nur die
       * Sperre bekommt einen eigenen Satz, denn dort hilft Weitertippen
       * wirklich nicht, und das soll der Händler wissen, statt es zu erraten.
       */
      const gesperrt = err instanceof ApiError && err.code === 'PIN_LOCKED';
      setFehler(
        gesperrt
          ? 'Zu viele Fehlversuche. Bitte in einer Viertelstunde erneut versuchen.'
          : quelle === 'stick'
            ? 'Der Stick trägt keinen gültigen Rettungsschlüssel mehr.'
            : quelle === 'meister'
              ? 'Die Antwort stimmt nicht oder ist abgelaufen. Eine neue Aufgabe anfordern.'
              : 'Der Schlüssel stimmt nicht, oder der neue Code hat nicht genau sechs Ziffern.',
      );
      setNeuerCode('');
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <ParchmentCard
      style={{
        maxWidth: 560,
        margin: '0 auto',
        padding: 'var(--w14-abstand-24)',
        textAlign: 'center',
      }}
    >
      <Zwischentitel label="Kassencode vergessen" />

      <p
        style={{
          margin: 'var(--w14-abstand-12) auto var(--w14-abstand-16)',
          maxWidth: '46ch',
          lineHeight: 1.6,
          color: 'var(--w14-ink-aged)',
          textWrap: 'pretty',
        }}
      >
        Tippen Sie den Notfallschlüssel von Ihrem Zettel ab und wählen Sie
        gleich einen neuen Kassencode. Der Schlüssel gilt danach nicht mehr;
        Sie bekommen sofort einen neuen zum Aufschreiben.
      </p>

      {stick !== null && (
        <p
          role="status"
          style={{
            margin: '0 0 var(--w14-abstand-16)',
            padding: 'var(--w14-abstand-12)',
            border: '1px solid var(--w14-feldlinie)',
            borderRadius: 'var(--w14-radius-button)',
            background: 'var(--w14-parchment-3)',
            color: 'var(--w14-ink)',
            lineHeight: 1.5,
            textWrap: 'pretty',
          }}
        >
          Rettungsstick erkannt: <strong>{stick.name}</strong>. Neuen Code
          wählen und bestätigen. Der Zettel wird nicht gebraucht.
        </p>
      )}

      {stick === null && (
        <>
      <label
        htmlFor="notfallschluessel-feld"
        className="w14-smallcaps"
        style={{
          display: 'block',
          textAlign: 'left',
          fontSize: 'var(--w14-schrift-kuerzel)',
          letterSpacing: '0.06em',
          color: 'var(--w14-ink-faded)',
          marginBottom: 'var(--w14-abstand-6)',
        }}
      >
        Notfallschlüssel
      </label>
      {/* Das Feld des Hauses — es trägt die Feldlinie (3,14 nach WCAG
          1.4.11), nicht die Zierlinie. Ein Wächter misst genau das. */}
      <Input
        id="notfallschluessel-feld"
        mono
        value={schluessel}
        onChange={(e) => {
          setSchluessel(formeSchluessel(e.target.value));
          setFehler(null);
        }}
        placeholder="NORNS-XXXX-XXXX-XXXX-XXXX"
        inputMode="text"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        disabled={laeuft}
        style={{ width: '100%', letterSpacing: '0.06em', textAlign: 'center' }}
      />

      {meister === null ? (
        <button
          type="button"
          disabled={laeuft}
          onClick={() => {
            void (async () => {
              try {
                const a = await meistercode.aufgabe(api);
                setMeister({ aufgabe: a.aufgabe });
                setFehler(null);
              } catch {
                setFehler('Die Aufgabe liess sich nicht anfordern.');
              }
            })();
          }}
          style={{
            minHeight: 44,
            marginTop: 'var(--w14-abstand-8)',
            border: 'none',
            background: 'transparent',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-body)',
            fontSize: 'var(--w14-schrift-zeile)',
            textDecoration: 'underline',
            textUnderlineOffset: '0.22em',
            cursor: 'pointer',
          }}
        >
          Weder Zettel noch Stick? Herstellercode anfordern
        </button>
      ) : (
        <div style={{ marginTop: 'var(--w14-abstand-16)', textAlign: 'center' }}>
          <p
            className="w14-smallcaps"
            style={{
              margin: '0 0 var(--w14-abstand-6)',
              fontSize: 'var(--w14-schrift-kuerzel)',
              letterSpacing: '0.06em',
              color: 'var(--w14-ink-faded)',
            }}
          >
            Diese Aufgabe dem Hersteller nennen
          </p>
          <p
            style={{
              margin: '0 0 var(--w14-abstand-10)',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-betont)',
              letterSpacing: '0.06em',
              color: 'var(--w14-ink)',
              userSelect: 'text',
              overflowWrap: 'anywhere',
            }}
          >
            {meister.aufgabe}
          </p>
          <Input
            mono
            value={antwort}
            onChange={(e) => {
              setAntwort(e.target.value);
              setFehler(null);
            }}
            placeholder="Antwort des Herstellers einfügen"
            autoCorrect="off"
            spellCheck={false}
            disabled={laeuft}
            style={{ width: '100%', textAlign: 'center' }}
          />
        </div>
      )}
        </>
      )}

      <p
        className="w14-smallcaps"
        style={{
          margin: 'var(--w14-abstand-20) 0 var(--w14-abstand-8)',
          fontSize: 'var(--w14-schrift-kuerzel)',
          letterSpacing: '0.06em',
          color: 'var(--w14-ink-faded)',
        }}
      >
        Neuer Kassencode, genau sechs Ziffern
      </p>
      <PinPad
        pinLength={6}
        value={neuerCode}
        onChange={(v) => {
          setNeuerCode(v);
          setFehler(null);
        }}
        onSubmit={() => void absenden()}
        disabled={laeuft}
        bindKeyboard
      />

      {laeuft && (
        <p
          role="status"
          style={{
            color: 'var(--w14-ink-faded)',
            margin: 'var(--w14-abstand-12) 0 0',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
          }}
        >
          Wird geprüft …
        </p>
      )}

      {fehler && (
        <p
          role="alert"
          style={{
            color: 'var(--w14-wax-red)',
            margin: 'var(--w14-abstand-12) 0 0',
            fontSize: 'var(--w14-schrift-betont)',
            textWrap: 'pretty',
          }}
        >
          {fehler}
        </p>
      )}

      <div
        style={{
          display: 'flex',
          gap: 'var(--w14-abstand-8)',
          justifyContent: 'center',
          marginTop: 'var(--w14-abstand-20)',
        }}
      >
        <Button variant="ghost" size="lg" fullWidth onClick={onAbbruch} disabled={laeuft}>
          Zurück
        </Button>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          onClick={() => void absenden()}
          disabled={!bereit || laeuft}
        >
          Code neu setzen
        </Button>
      </div>
    </ParchmentCard>
  );
}

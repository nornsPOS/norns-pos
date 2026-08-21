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

import { useState } from 'react';

import { ApiError, notfallschluessel } from '@norns/api-client';
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
}

export function SchluesselEinloesen({
  api,
  userId,
  onAbbruch,
  onFertig,
}: Eigenschaften): JSX.Element {
  const [schluessel, setSchluessel] = useState('');
  const [neuerCode, setNeuerCode] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const bereit = schluesselVollstaendig(schluessel) && /^\d{6}$/.test(neuerCode);

  async function absenden(): Promise<void> {
    if (laeuft || !bereit) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const antwort = await notfallschluessel.einloesen(api, {
        schluessel,
        neuerCode,
        ...(userId ? { userId } : {}),
      });
      onFertig(antwort.neuerSchluessel, neuerCode);
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

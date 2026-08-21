/**
 * PinLogin — first screen on cold start when no session is alive.
 *
 * Corrected 2026-05-26 (memory.md #76) to match the real server contract:
 * `POST /api/auth/pin-login` with `{ pin }` only. mTLS resolves the user
 * via the device cert; the operator never types an email.
 *
 * Error handling maps the stable `ApiError.code` enum to brand-themed
 * messages (memory.md §10.6 voice). `PIN_LOCKED` carries a `lockedUntil`
 * ISO timestamp in `details`, parsed once and used to drive a live
 * countdown.
 *
 * Visual: Seal + wordmark + italic motto + PinPad + retry counter
 * (Roman numerals in wax-red as wax-seal failure marks).
 */

import type React from 'react';
import { useEffect, useMemo, useState } from 'react';

import { type AnmeldbarePerson, ApiError, authPin, notfallschluessel } from '@norns/api-client';
import { Zwischentitel, InfoPunkt, NornsWortmarke, Hourglass, Icon, ParchmentCard, PinPad, RomanIndex } from '@norns/ui-kit';

import { ThemeToggle } from '../app/chrome/ThemeToggle.js';
import { SchluesselEinloesen } from './anmeldung/SchluesselEinloesen.js';
import { SchluesselZettel } from './anmeldung/SchluesselZettel.js';
import { useApiClient } from '../lib/api-context.js';
import { setSessionToken } from '../lib/session-token.js';
import { useSessionStore } from '../state/session-store.js';
import { describeError } from '@norns/i18n-de';
import { ohneApiFehlerSatz } from '../lib/eingereiht.js';

/**
 * Genau sechs Ziffern — die Regel des Servers, hier gespiegelt.
 *
 * ⚠️ 18.08.2026: Basels Anweisung hebt seine eigene vom 30.07. auf (sechs
 * bis zwölf). Er hat sich mit der Spanne selbst vertippt und verheddert;
 * die feste Länge macht die Eingabe eindeutig, und die Tastatur schickt
 * beim sechsten Zeichen von selbst ab. Ein VOR dem 18.08. gesetzter
 * längerer Code lässt sich hier nicht mehr eintippen; sein Ausgang ist
 * der Löschweg (Satz unter der Tastatur).
 *
 * Sie steht bewusst als eigene Funktion da: sie gilt für die Anmeldung UND
 * für die Einrichtung, und zwei Kopien derselben Zahl laufen irgendwann
 * auseinander. Die Wahrheit steht auf dem Server; das hier erspart dem
 * Händler nur die vergebliche Reise.
 */
function laengeStimmt(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

export function PinLogin(): JSX.Element {
  const api = useApiClient();
  const setFromLogin = useSessionStore((s) => s.setFromLogin);

  const [pin, setPin] = useState<string>('');
  const [failedAttempts, setFailedAttempts] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lockedUntilIso, setLockedUntilIso] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [submitting, setSubmitting] = useState<boolean>(false);
  /** Diese Kasse hat noch keinen Code — der Händler setzt ihn jetzt. */
  const [einrichtung, setEinrichtung] = useState<boolean>(false);

  /*
   * ── DER NOTAUSGANG (21.08.2026) ───────────────────────────────────────
   *
   * Zwei Zustände, und beide halten den Bildschirm bewusst an:
   *
   *   `zeigeSchluessel` — ein frisch ausgegebener Schlüssel steht im
   *     Klartext hier und NUR hier. Er wird NICHT in einen Speicher gelegt,
   *     nicht in die Zwischenablage, nicht protokolliert. Verlässt der
   *     Händler die Fläche, ist er fort — deshalb geht es erst weiter, wenn
   *     er bestätigt, ihn aufgeschrieben zu haben.
   *
   *   `einloesen` — die Maske für den, der seinen Code vergessen hat.
   *
   * ⚠️ `nachAnmeldung` hält die Anmeldung ZURÜCK, bis der Zettel gelesen
   * ist. Ginge die Kasse sofort auf, wäre der Schlüssel im selben Augenblick
   * hinter dem Verkaufsbildschirm verschwunden.
   */
  const [zeigeSchluessel, setZeigeSchluessel] = useState<string | null>(null);
  const [einloesen, setEinloesen] = useState<boolean>(false);
  const [nachAnmeldung, setNachAnmeldung] = useState<(() => void) | null>(null);

  /**
   * ── WER MELDET SICH AN (02.08.2026) ────────────────────────────────────
   *
   * Bis heute konnte diese Maske gar nicht fragen: der Server löste den
   * Menschen allein über das GERÄT auf, ein Gerät, ein Mensch, für immer.
   * Jeder angelegte Mitarbeiter konnte sich strukturell nie anmelden, und
   * jede fiskalische Zeile trug denselben Menschen — Bedienerzuordnung nach
   * § 146a AO war damit unmöglich.
   *
   * `null` heisst „noch nicht geladen", ein leeres Feld „geladen, aber die
   * Kasse kennt nur einen Menschen". Beides ist NICHT dasselbe, und die
   * Fläche darf die Wahl erst zeigen, wenn es wirklich etwas zu wählen gibt.
   */
  const [personen, setPersonen] = useState<AnmeldbarePerson[] | null>(null);
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);

  /** Den Code setzen. Danach meldet sich der Händler damit normal an. */
  // Die Personen einmal holen. Scheitert es, bleibt die Maske genau die, die
  // sie vorher war: eine Tastatur. Ein Ladefehler darf die Anmeldung nie
  // versperren — der Weg ohne Wahl funktioniert weiterhin.
  useEffect(() => {
    let lebt = true;
    void authPin
      .anmeldbarePersonen(api)
      .then((a) => {
        if (lebt) setPersonen(a.personen);
      })
      .catch(() => {
        if (lebt) setPersonen([]);
      });
    return () => {
      lebt = false;
    };
  }, [api]);

  /**
   * Die Wahl erscheint nur, wenn es WIRKLICH etwas zu wählen gibt.
   *
   * Eine Liste mit einem einzigen Namen ist keine Wahl, sondern ein Klick
   * mehr auf dem Weg zur Kasse — jeden Morgen, für nichts.
   */
  const zeigeWahl = (personen?.length ?? 0) > 1;
  const gewaehltePerson = personen?.find((p) => p.id === gewaehlt) ?? null;

  async function handleEinrichten(): Promise<void> {
    if (submitting || !laengeStimmt(pin)) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await authPin.setzeCode(api, { pin, ...(gewaehlt ? { userId: gewaehlt } : {}) });
      // Kein Sonderweg: ab hier ist es die gewöhnliche Anmeldung.
      const res = await authPin.loginSafe(api, { pin, ...(gewaehlt ? { userId: gewaehlt } : {}) });
      setSessionToken(res.token);

      /*
       * ── DER SCHLÜSSEL, DIREKT NACH DEM ERSTEN CODE ────────────────────
       *
       * Genau HIER gehört er hin: der Händler hat eben seinen Code gewählt,
       * hat Stift und Aufmerksamkeit, und die Anmeldung hat den Zeitstempel
       * für die Zwischenprüfung frisch gesetzt — der Weg zum Ausgeben
       * verlangt sie.
       *
       * ⚠️ Nur der INHABER bekommt einen. Für einen Mitarbeiter antwortet
       * der Motor mit 403, und das ist richtig: sein Weg zurück ist der
       * Löschweg über den Inhaber, bei dem NIEMAND den Code eines anderen
       * erfährt (§ 146a AO). Deshalb wird der Fehlschlag hier still
       * geschluckt — er ist keiner.
       *
       * ⚠️ Und wenn das Ausgeben aus einem ANDEREN Grund scheitert, geht die
       * Kasse trotzdem auf. Eine Kasse, die sich wegen eines Zettels nicht
       * öffnen lässt, ist am Samstagvormittag das grössere Übel.
       */
      let frisch: string | null = null;
      try {
        frisch = (await notfallschluessel.erzeugen(api)).schluessel;
      } catch {
        frisch = null;
      }
      if (frisch !== null) {
        setNachAnmeldung(() => () => setFromLogin(res));
        setZeigeSchluessel(frisch);
        return;
      }
      setFromLogin(res);
    } catch (err) {
      // ⚠️ 31.07.2026: hier wurde JEDES `UNAUTHORIZED` zu „Dieser Code ist zu
      // leicht zu erraten" gemacht. Der Server benutzt denselben Code aber für
      // DREI verschiedene Gründe (`routes/auth-pin.ts:677`): Sperrliste,
      // falsche Länge, keine Ziffern — und er schickt seinen Grund als Satz
      // mit. Basel suchte deshalb stundenlang nach einem besseren Code,
      // während in Wahrheit die Länge scheiterte.
      //
      // Jetzt entscheidet der SERVER, nicht wir. Nur wenn seine Auskunft
      // wirklich von der Sperrliste spricht, sagen wir das auch.
      const auskunft = err instanceof ApiError ? (err.message ?? '') : '';
      const istGassenhauer = /blacklist|weak/i.test(auskunft);
      setErrorMsg(
        err instanceof ApiError
          ? istGassenhauer
            ? 'Dieser Code steht auf der Liste der zu einfachen Codes. Bitte einen anderen wählen.'
            : /genau sechs|6 to 12|6 bis 12/i.test(auskunft)
              ? 'Der Kassencode hat genau sechs Ziffern.'
              : describeError(err)
          : 'Der Code konnte nicht gesetzt werden.',
      );
      setPin('');
    } finally {
      setSubmitting(false);
    }
  }

  // Re-render once a second while locked so the countdown ticks.
  useEffect(() => {
    if (!lockedUntilIso) return;
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [lockedUntilIso]);

  const lockoutSecondsLeft = useMemo(() => {
    if (!lockedUntilIso) return 0;
    const target = new Date(lockedUntilIso).getTime();
    return Math.max(0, Math.ceil((target - now) / 1_000));
  }, [lockedUntilIso, now]);

  const locked = lockoutSecondsLeft > 0;

  // Clear the lockout silently once the countdown finishes.
  useEffect(() => {
    if (lockedUntilIso && lockoutSecondsLeft === 0) {
      setLockedUntilIso(null);
      setErrorMsg(null);
    }
  }, [lockedUntilIso, lockoutSecondsLeft]);

  async function handleSubmit(): Promise<void> {
    // ⚠️ 30.07.2026. Hier stand `pin.length !== 4`. Der Server verlangte ab
    // da SECHS bis ZWÖLF Ziffern — ein korrekter sechsstelliger Code wäre
    // also nie abgeschickt worden, und der Händler hätte getippt und getippt,
    // ohne dass je etwas passiert. Sitzung A hat davor gewarnt, bevor es
    // jemanden traf. Seit dem 18.08.2026 gilt: GENAU sechs (laengeStimmt).
    if (locked || submitting || !laengeStimmt(pin)) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await authPin.loginSafe(api, { pin, ...(gewaehlt ? { userId: gewaehlt } : {}) });
      // Store the token for the Bearer-header auth path (Windows WebView2 drops
      // the cross-site session cookie) before flipping the session state.
      setSessionToken(res.token);
      setFromLogin(res);
    } catch (err) {
      if (err instanceof ApiError) {
        switch (err.code) {
          case 'UNAUTHORIZED':
            setFailedAttempts((n) => n + 1);
            setErrorMsg('Falsche PIN.');
            break;
          case 'PIN_LOCKED':
            {
              const details = err.details as { lockedUntil?: string } | undefined;
              if (details?.lockedUntil) setLockedUntilIso(details.lockedUntil);
              setErrorMsg('Konto gesperrt. Bitte Geduld.');
            }
            break;
          case 'PIN_NOT_SET':
            // Kein Fehler, sondern ein anderer Zustand: diese Kasse ist neu
            // und hat noch keinen Code. Ohne diesen Zweig sähe der Händler
            // beim allerersten Start „Falsche PIN" für etwas, das er nie
            // gesetzt hat, und käme nie hinein.
            setEinrichtung(true);
            setErrorMsg(null);
            break;
          case 'DEVICE_NOT_AUTHORIZED':
            setErrorMsg('Dieses Gerät ist nicht autorisiert.');
            break;
          case 'RATE_LIMITED':
            setErrorMsg('Zu viele Versuche, kurz innehalten.');
            break;
          /**
           * ⛔ 12.08.2026, IN DER VORSCHAU BEGANGEN: „Datensatz nicht gefunden."
           *
           * Ohne diesen Zweig fiel NOT_FOUND auf `describeError` und der
           * Kassierer las am Tresen „Datensatz nicht gefunden." — er hielt sein
           * KONTO für unbekannt, tippte die PIN noch einmal, und noch einmal.
           *
           * Diese Auskunft ist nicht nur unfreundlich, sie ist UNMÖGLICH:
           * `routes/auth-pin.ts` wirft nie NOT_FOUND. Ein unbekannter Mensch
           * bekommt dort mit Absicht `UnauthorizedError` („Invalid PIN"), damit
           * sich die Namensliste nicht abfragen lässt. Ein 404 auf diesem
           * Bildschirm kann deshalb NUR heissen: die Anmeldung des Motors ist
           * gar nicht erreichbar — er läuft noch nicht, oder das Programm ruft
           * einen Weg, den seine Fassung nicht kennt (Fassungsversatz nach
           * einer Aktualisierung).
           *
           * Der Satz sagt jetzt, was wirklich los ist, und nennt den Weg.
           */
          case 'NOT_FOUND':
            setErrorMsg(
              'Die Kasse erreicht ihren Motor gerade nicht. Das liegt nicht an Ihrer PIN. ' +
                'Bitte einen Augenblick warten und erneut versuchen; bleibt es dabei, die ' +
                'Kasse neu starten.',
            );
            break;
          default:
            setErrorMsg(describeError(err));
        }
      } else {
        setErrorMsg(ohneApiFehlerSatz(err));
      }
      setPin('');
    } finally {
      setSubmitting(false);
    }
  }

  const lockoutLabel = useMemo(() => {
    if (!locked) return null;
    const m = Math.floor(lockoutSecondsLeft / 60);
    const s = lockoutSecondsLeft % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }, [locked, lockoutSecondsLeft]);

  /*
   * Der Grund, auf dem jede der drei Flächen steht. Einmal benannt: drei
   * Abschriften desselben Blocks laufen irgendwann auseinander, und dann
   * steht der Notausgang auf anderem Papier als die Anmeldung.
   */
  const huelle: React.CSSProperties = {
    minHeight: '100dvh',
    display: 'grid',
    placeItems: 'center',
    padding: 'var(--w14-abstand-24)',
    background: 'var(--w14-parchment)',
  };

  /*
   * ── ZWEI FLÄCHEN, DIE DIE ANMELDEKARTE ERSETZEN ─────────────────────────
   *
   * Beide sind ein VOLLSTÄNDIGER Halt, keine Einblendung über der Tastatur.
   * Wer seinen Schlüssel abschreibt oder seinen Code neu setzt, tut genau
   * eine Sache; ein Ziffernfeld daneben ist nur eine Gelegenheit, sich zu
   * vertippen.
   */
  if (zeigeSchluessel !== null) {
    return (
      <div style={huelle} className="w14-paper-noise">
        <SchluesselZettel
          schluessel={zeigeSchluessel}
          onWeiter={() => {
            const weiter = nachAnmeldung;
            // Der Klartext wird als ERSTES fallen gelassen.
            setZeigeSchluessel(null);
            setNachAnmeldung(null);
            weiter?.();
          }}
          {...(nachAnmeldung === null ? { weiterLabel: 'Notiert, zur Anmeldung' } : {})}
        />
      </div>
    );
  }

  if (einloesen) {
    return (
      <div style={huelle} className="w14-paper-noise">
        <SchluesselEinloesen
          api={api}
          userId={gewaehlt}
          onAbbruch={() => setEinloesen(false)}
          onFertigOhneZettel={(_neuerCode, hinweis) => {
            /*
             * Stick- und Meister-Weg geben keinen Zettel aus: der Stick hat
             * sich selbst nachgeladen, der Meister gibt nichts. Zurück zur
             * Anmeldung; ein Hinweis (toter Stick) erscheint als Fehlerzeile,
             * denn er verlangt Handeln — unter Team neu schreiben.
             */
            setEinloesen(false);
            setPin('');
            setFailedAttempts(0);
            setLockedUntilIso(null);
            setErrorMsg(hinweis);
          }}
          onFertig={(nachfolger) => {
            setEinloesen(false);
            setPin('');
            setErrorMsg(null);
            setFailedAttempts(0);
            setLockedUntilIso(null);
            /*
             * ⚠️ KEINE Anmeldung. Der Notausgang setzt nur den Code neu; der
             * Händler tippt ihn danach ganz gewöhnlich ein. Genau daran hängt
             * die Zusicherung, dass ein gefundener Zettel allein nichts
             * buchen kann. `nachAnmeldung` bleibt deshalb leer.
             */
            setZeigeSchluessel(nachfolger);
          }}
        />
      </div>
    );
  }

  return (
    <div style={huelle} className="w14-paper-noise">
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 'var(--w14-z-klebend)' }}>
        <ThemeToggle />
      </div>
      <ParchmentCard padding="lg" style={{ width: 'min(440px, 100%)', textAlign: 'center' }}>
        {/* ⚠️ 31.07.2026: HIER STAND DAS WAPPEN DES FREMDEN HAUSES.
            300 Pixel breit, als Erstes und Grösstes auf der Anmeldekarte:
            Medaillon mit der Ziffer 14, Schriftzug WAREHOUSE, darunter
            ANTIQUITÄTEN · BRIEFMARKEN · MÜNZEN. Daneben stand alt="Norns POS",
            die Fläche gab dem fremden Wappen also den Namen dieses Hauses.

            Kein Textgrep konnte es finden: die Datei ist reine Pfadgrafik,
            jeder Buchstabe zu Kurven ausgezogen. Nur Rastern und Hinsehen.

            Es kommt NICHT als Bilddatei zurück. Hier steht die Wortmarke
            dieses Hauses, gesetzt wie auf der Startfläche (`Motorstart.tsx`),
            damit die Kasse von der ersten Sekunde an DIESELBE Identität
            trägt. Den Namen des Ladens kann diese Fläche nicht zeigen: sie
            steht VOR der Anmeldung, und die Ladendaten hängen an einer
            Sitzung, die es hier noch nicht gibt. Etwas zu zeigen, das erst
            nach dem Anmelden stimmt, wäre wieder eine Fläche, die rät. */}
        {/* ⚠️ DAS ZEICHEN DES HAUSES, an seinem Platz.
            Es lag nur als Rasterbild fuer die Fensterleiste vor. IN der Kasse
            stand an seiner Stelle nur der Name als Textzeile: der Haendler sah
            die Marke also nirgends, wo er arbeitet. Der Schriftzug darunter
            bleibt unveraendert. */}
        {/* ⚠️ 20.08.2026, Basels Anweisung: das Zeichen IST das N des Namens.
            Hier standen bis heute BEIDE untereinander — das Zeichen gross,
            darunter der Schriftzug mit einem gewoehnlichen N. Zwei Marken
            uebereinander, und die obere war eine Wiederholung der unteren.
            Jetzt EIN Wort, dessen erster Buchstabe die Marke selbst ist. */}
        {/* Die GRÖSSE ist gemessen, nicht geschätzt (20.08.2026): die Karte
            gibt 376 Punkte Platz frei, und die Marke misst das 4,89-fache
            ihrer Schriftgrösse. 4,4rem (70 Punkte) füllen die Karte mit Luft
            an beiden Seiten; darunter greift 13vw, damit sie auf einem engen
            Schirm mitgeht statt zu brechen.
            Vorher trug diese Fläche ein 92 Punkte hohes Zeichen UND darunter
            den Schriftzug. Jetzt trägt sie EINE Marke, und die darf denselben
            Auftritt haben wie vorher beide zusammen. */}
        {/* ⛔ 21.08.2026, auf Basels Schirm gesehen: die Wortmarke lief mit
            `--w14-schrift-wortmarke` (bis 4,4rem, an 13vw haengend) BREITER
            als die Tastatur darunter — das S ragte aus der Karte. Die Karte
            ist fest 440px; eine Groesse, die am FENSTER haengt, passt nie
            verlaesslich in eine feste Karte. Jetzt die Buehnen-Stufe der
            Leiter (3rem): gross genug fuer den Auftritt, sicher innerhalb. */}
        <NornsWortmarke
          faden="var(--w14-weinrot, #9c2630)"
          tinte="var(--w14-ink)"
          style={{
            fontSize: 'var(--w14-schrift-buehne)',
            fontWeight: 500,
            margin: '0 0 var(--w14-abstand-4)',
          }}
        />
        {/* ⚰️ 21.08.2026: hier stand der Sinnspruch „Was lange ruht, spricht
            leise." Basels Anweisung — die Anmeldung ist eine Tuer, kein
            Poesiealbum. Er lebt weiter, wo er Atmosphaere traegt (Leerlauf
            des Tagebuchs, Spotlight, Fehlerflaeche), nicht auf dem Weg zur
            Arbeit. */}
        {/* Beim ERSTEN Start heisst die Tür anders, weil sie etwas anderes
            tut: der Händler meldet sich nicht an, er nimmt die Kasse in
            Besitz. Dieselbe Tastatur, ein anderer Satz darüber. */}
        <Zwischentitel label={einrichtung ? 'Kasse einrichten' : 'Anmelden'} />

        {/* ── WER STEHT HIER? ─────────────────────────────────────────────
            Erscheint NUR, wenn es wirklich etwas zu wählen gibt. Eine Liste
            mit einem einzigen Namen ist keine Wahl, sondern ein Klick mehr
            auf dem Weg zur Kasse — jeden Morgen, für nichts. */}
        {zeigeWahl && (
          <div
            role="radiogroup"
            aria-label="Wer meldet sich an"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 'var(--w14-abstand-8)',
              marginTop: 'var(--w14-abstand-14)',
            }}
          >
            {(personen ?? []).map((person) => {
              const aktiv = person.id === gewaehlt;
              return (
                <button
                  key={person.id}
                  type="button"
                  role="radio"
                  aria-checked={aktiv}
                  onClick={() => {
                    setGewaehlt(aktiv ? null : person.id);
                    // Der Code des einen gehört nicht zum anderen. Bei jedem
                    // Wechsel wird die Tastatur geleert, sonst wanderten
                    // getippte Ziffern still auf einen anderen Menschen.
                    setPin('');
                    setErrorMsg(null);
                    // Ein Mensch ohne Code kommt zum Einrichten, nicht zur
                    // Anmeldung. Die Maske sagt es dann selbst.
                    setEinrichtung(!aktiv && !person.hatCode);
                  }}
                  style={{
                    minHeight: 44,
                    padding: '0 var(--w14-abstand-14)',
                    border: `1px solid ${aktiv ? 'var(--w14-gold)' : 'var(--w14-rule)'}`,
                    borderRadius: 'var(--w14-radius-button)',
                    background: aktiv ? 'var(--w14-parchment-3)' : 'transparent',
                    color: 'var(--w14-ink)',
                    fontFamily: 'var(--w14-font-body)',
                    fontSize: 'var(--w14-schrift-text)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--w14-abstand-6)',
                  }}
                >
                  {person.name}
                  {!person.hatCode && (
                    <span
                      className="w14-smallcaps"
                      style={{
                        fontSize: 'var(--w14-schrift-kuerzel)',
                        letterSpacing: '0.06em',
                        color: 'var(--w14-ink-faded)',
                      }}
                    >
                      noch ohne Code
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Ein gewählter Mensch ohne Code bekommt den Grund zu lesen, statt
            sich zu wundern, warum die Überschrift plötzlich anders heisst. */}
        {zeigeWahl && gewaehltePerson !== null && !gewaehltePerson.hatCode && (
          <p
            style={{
              margin: 'var(--w14-abstand-10) 0 0',
              maxWidth: '46ch',
              textAlign: 'center',
              lineHeight: 1.6,
              color: 'var(--w14-ink-aged)',
              fontSize: 'var(--w14-schrift-feld)',
              textWrap: 'pretty',
            }}
          >
            {gewaehltePerson.name} hat noch keinen Kassencode. Jetzt einen wählen, genau sechs
            Ziffern. Niemand sonst erfährt ihn, auch der Inhaber nicht.
          </p>
        )}
        {einrichtung && (
          <p
            style={{
              margin: 'var(--w14-abstand-12) 0 0',
              textAlign: 'center',
              lineHeight: 1.6,
              color: 'var(--w14-ink-aged)',
              textWrap: 'pretty',
            }}
          >
            Neu hier. Einen Code aus sechs Ziffern wählen.{' '}
            <InfoPunkt
              richtung="links"
              ariaLabel="Warum dieser Code"
              text="Der Code wird nicht vorgegeben, und niemand ausser Ihnen kennt ihn. Direkt nach dem Setzen zeigt die Kasse einmalig einen Notfallschlüssel zum Aufschreiben, den einzigen Weg zurück, falls Sie den Code vergessen."
            />
          </p>
        )}

        {/*
          ── 20.08.2026: DER SATZ, DER BISHER FEHLTE ────────────────────────

          Hier stand nur „Notieren Sie ihn an einem sicheren Ort." Das ist ein
          guter Rat, aber er sagt nicht, was auf dem Spiel steht.

          GEMESSEN: den Kassencode eines Menschen löscht
          `POST /api/admin/staff/:id/kassencode-loeschen`, und dieses Tor
          verlangt `requireOwner`. Für einen Mitarbeiter ist das genau
          richtig — der Inhaber löscht, der Mitarbeiter setzt neu, und
          niemand kennt je den Code eines anderen (§ 146a AO,
          Bedienerzuordnung).

          Für den INHABER SELBST gibt es dieses Tor nicht: er müsste sich
          anmelden, um sich zurückzusetzen. Vergisst er seinen Code, kommt
          niemand mehr in die Kasse — auch kein zweiter Mitarbeiter mit
          Verwalterrechten. Der Weg zurück führt dann über die Datenbank,
          also über einen Techniker.

          ── 21.08.2026: DER WEG IST GEBAUT ────────────────────────────────

          Der Notfallschlüssel steht. Er ist bewusst SCHWÄCHER als ein
          Kassencode: er meldet nicht an, er erlaubt nur, einen neuen Code zu
          setzen; er gilt einmal; er wirkt nur am gepaarten Gerät; und er
          schreibt ins Tagebuch. Damit öffnet ein gefundener Zettel keine
          Buchung, sondern löst einen sichtbaren Vorgang aus — die
          Bedienerzuordnung nach § 146a AO bleibt heil.

          Der Satz hier sagt deshalb jetzt etwas anderes: nicht mehr „niemand
          kann Ihnen helfen", sondern „schreiben Sie den Schlüssel auf, der
          gleich kommt".
        */}
        {einrichtung && (
          <p
            style={{
              margin: 'var(--w14-abstand-10) 0 0',
              maxWidth: '44ch',
              textAlign: 'center',
              lineHeight: 1.6,
              fontSize: 'var(--w14-schrift-zeile)',
              color: 'var(--w14-wax-red)',
              textWrap: 'pretty',
            }}
          >
            Gleich danach zeigt die Kasse einmalig den Notfallschlüssel.
            Stift bereithalten.
          </p>
        )}

        <PinPad
          // Genau sechs Ziffern (18.08.2026). Feste Laenge heisst: die
          // Tastatur zeigt sechs Felder und schickt beim sechsten Zeichen
          // von selbst ab; kein Abschicken-Knopf, kein Verzaehlen.
          pinLength={6}
          value={pin}
          onChange={setPin}
          onSubmit={() => void (einrichtung ? handleEinrichten() : handleSubmit())}
          disabled={locked || submitting}
          bindKeyboard
        />

        {/* Während der Prüfung schluckt die gesperrte Tastatur jede Eingabe
            STUMM — wer schnell tippt, verliert Ziffern ins Leere und wundert
            sich über den nächsten Fehlversuch. Die eine Zeile benennt das
            Fenster ehrlich, statt es zu verstecken. */}
        {submitting && (
          <p
            role="status"
            style={{
              color: 'var(--w14-ink-faded)',
              margin: '14px 0 0',
              fontFamily: 'var(--w14-font-display)',
              fontStyle: 'italic',
            }}
          >
            Wird geprüft …
          </p>
        )}
        {errorMsg && (
          <p
            role="alert"
            style={{
              color: 'var(--w14-wax-red)',
              margin: '14px 0 0',
              fontSize: 'var(--w14-schrift-betont)',
            }}
          >
            {errorMsg}
          </p>
        )}

        {/* Der Ausgang, wenn der Code weg ist. Er benennt den WIRKLICH
            gebauten Weg (Team, kassencode-loeschen): der Inhaber loescht,
            der Mensch waehlt am Tresen selbst neu. Derselbe Weg fuehrt auch
            einen VOR dem 18.08.2026 gesetzten laengeren Code heraus, der in
            die sechs Felder nicht mehr passt.

            ⚠️ 20.08.2026: hier stand ein zweiter Satz — „Der Inhaber selbst
            meldet sich dafuer mit Google an." Auf Basels Schirm gelesen. Er
            war FALSCH: diese Kasse hat keine Google-Anmeldung, der Knopf
            dazu wurde nie durchgereicht, und der Weg dahinter verlangt Netz
            und einen fremden Arbeitsbereich. Ein Satz, der einem Menschen am
            Tresen eine Tuer verspricht, hinter der niemand steht. */}
        {/* ── 21.08.2026: ZWEI ZEILEN WERDEN EINE ─────────────────────────
            Hier standen zwei Saetze Erklaerung UND darunter der
            Notfallschluessel-Knopf. Basels Anweisung: Texte einsammeln,
            hinter das Fragezeichen. Der WEG (der Knopf unten) bleibt
            sichtbar; das WARUM wohnt in der Blase. */}

        {/* ── DER AUSGANG FÜR DEN INHABER SELBST (21.08.2026) ──────────────

            Den Satz darüber gibt es seit jeher, und er stimmt — für
            MITARBEITER. Der Inhaber steht nicht darin, denn ihm kann niemand
            den Code löschen. Bis heute endete sein Weg in der Datenbank.

            Der Knopf steht mit Absicht LEISE da, als Textknopf und nicht als
            zweiter goldener Kasten: er ist der seltene Weg, nicht der
            tägliche. Wer ihn nicht braucht, soll ihn nicht sehen müssen. */}
        {!einrichtung && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--w14-abstand-4)',
              marginTop: 'var(--w14-abstand-6)',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setEinloesen(true);
                setPin('');
                setErrorMsg(null);
              }}
              style={{
                minHeight: 44,
                padding: '0 var(--w14-abstand-10)',
                border: 'none',
                background: 'transparent',
                color: 'var(--w14-ink-aged)',
                fontFamily: 'var(--w14-font-body)',
                fontSize: 'var(--w14-schrift-zeile)',
                textDecoration: 'underline',
                textUnderlineOffset: '0.22em',
                cursor: 'pointer',
              }}
            >
              Code vergessen?
            </button>
            <InfoPunkt
              richtung="links"
              ariaLabel="Was tun bei vergessenem Code"
              text="Mitarbeiter: der Inhaber löscht den Code unter Team, danach hier neu wählen. Inhaber: Notfallschlüssel vom Zettel, Rettungsstick einstecken, oder als letzter Weg der Herstellercode."
            />
          </span>
        )}

        {failedAttempts > 0 && !locked && (
          <p style={{ margin: '12px 0 0', color: 'var(--w14-wax-red-soft)' }}>
            <RomanIndex value={failedAttempts} variant="lower" tone="wax-red" />
            &nbsp;
            <span style={{ fontFamily: 'var(--w14-font-display)', fontStyle: 'italic' }}>
              Fehlversuch{failedAttempts === 1 ? '' : 'e'}
            </span>
          </p>
        )}

        {locked && lockoutLabel && (
          <p
            style={{
              color: 'var(--w14-wax-red)',
              margin: '14px 0 0',
              fontFamily: 'var(--w14-font-mono)',
              fontSize: 'var(--w14-schrift-titel)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--w14-abstand-6)',
            }}
          >
            {/* Sanduhr als Strich-Icon — das ⌛ rendert auf Windows als
                buntes Segoe-Emoji (Dekret „Symbole statt Emoji", 26.07.2026). */}
            <Icon icon={Hourglass} size={16} />
            {lockoutLabel}
          </p>
        )}

        <Zwischentitel />
        <p
          style={{
            fontSize: 'var(--w14-schrift-zeile)',
            color: 'var(--w14-ink-faded)',
            fontFamily: 'var(--w14-font-display)',
            fontStyle: 'italic',
            margin: 0,
          }}
        >
          {/* ⚠️ 31.07.2026: hier stand „Antiquitäten · Briefmarken · Münzen",
              die Geschäftsfelder des FREMDEN Hauses, auf der Anmeldekarte
              eines Schmuck- und Edelmetallhändlers. */}
          Kasse
        </p>
        {/*
          ── 20.08.2026: DIE FREMDE TÜR IST AUSGEBAUT ────────────────────────
          Hier stand ein Knopf „Mit Google anmelden" hinter `onUseGoogle`.
          GEMESSEN: keine einzige Stelle reichte diese Angabe je durch —
          `App.tsx` ruft `<PinLogin />` ohne sie. Der Knopf war also nie zu
          sehen; geblieben war nur der Satz darüber, der dem Kassierer
          trotzdem von Google erzählte.
          Und er hätte auch nicht funktionieren dürfen: der Weg dahinter
          (`admin-auth-google.ts`) verlangt Netz, einen Google-Arbeitsbereich
          und eine auf `warehouse14.de` beschränkte Zustimmung — das Erbe
          eines fremden Hauses. Diese Kasse läuft ohne Netz.
        */}
      </ParchmentCard>
    </div>
  );
}

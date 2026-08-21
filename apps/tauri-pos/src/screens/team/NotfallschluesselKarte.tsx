/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Der Notfallschlüssel des Inhabers — Zustand und Erneuerung
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── WARUM SIE HIER STEHT UND NICHT IN DEN EINSTELLUNGEN ────────────────────
 *
 * „Team & Rollen" ist die Fläche, auf der beantwortet wird, WER in diese Kasse
 * kommt. Für Mitarbeiter steht es unten in der Liste (Code löschen, der
 * Mensch setzt am Tresen neu). Der Inhaber fehlte dort — ihm kann niemand
 * löschen. Sein Weg zurück ist dieser Schlüssel, und er gehört genau daneben,
 * nicht in einen anderen Bereich zwei Klicks entfernt.
 *
 * ── WAS SIE ZEIGT UND WAS NICHT ───────────────────────────────────────────
 *
 * ⚠️ NIE den Schlüssel selbst. Der Motor gibt ihn im Zustand gar nicht heraus;
 * er steht genau einmal auf dem Schirm, im Augenblick des Ausgebens.
 *
 * ⚠️ Ein neuer Schlüssel TÖTET den alten. Der Knopf sagt das, bevor er
 * gedrückt wird — sonst wirft jemand seinen gültigen Zettel weg, weil er
 * dachte, es käme ein zweiter dazu.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { ApiError, type Laufwerk, notfallschluessel, rettungsstick } from '@norns/api-client';
import { Button, ParchmentCard, Zwischentitel, ZustandFehler } from '@norns/ui-kit';
import { describeError } from '@norns/i18n-de';

import { abfragestand } from '../../lib/abfragestand.js';
import { useApiClient } from '../../lib/api-context.js';
import { isStepUpCancelled } from '../../state/step-up-store.js';
import { useToastStore } from '../../state/toast-store.js';
import { SchluesselZettel } from '../anmeldung/SchluesselZettel.js';

/** `2026-08-21T…` → `21.08.2026`, wie es im Laden gelesen wird. */
function alsTag(iso: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  }).format(new Date(iso));
}

export function NotfallschluesselKarte(): JSX.Element {
  const client = useApiClient();
  const addToast = useToastStore((s) => s.addToast);
  const [laeuft, setLaeuft] = useState(false);
  const [frisch, setFrisch] = useState<string | null>(null);

  const abfrage = useQuery({
    queryKey: ['notfallschluessel', 'stand'],
    queryFn: () => notfallschluessel.stand(client),
  });

  /*
   * ── DER RETTUNGSSTICK (21.08.2026) ──────────────────────────────────────
   * Solange die Karte offen ist, alle 3 Sekunden nach Laufwerken sehen —
   * der Inhaber steckt den Stick und der Knopf erscheint, ohne Suchen.
   * 404 (Wolke, alte Fassung) heisst still: kein Stick-Absatz.
   */
  const [laufwerke, setLaufwerke] = useState<Laufwerk[] | null>(null);
  const [stickLaeuft, setStickLaeuft] = useState(false);
  const [stickGesetztAm, setStickGesetztAm] = useState<string | null>(null);
  useEffect(() => {
    let lebt = true;
    const frage = async (): Promise<void> => {
      try {
        const r = await rettungsstick.laufwerke(client);
        if (lebt) setLaufwerke(r.laufwerke);
      } catch {
        if (lebt) setLaufwerke(null);
      }
    };
    void frage();
    const takt = window.setInterval(() => void frage(), 3000);
    return () => {
      lebt = false;
      window.clearInterval(takt);
    };
  }, [client]);

  async function stickSchreiben(l: Laufwerk): Promise<void> {
    if (stickLaeuft) return;
    setStickLaeuft(true);
    try {
      const r = await rettungsstick.schreiben(client, l.pfad);
      setStickGesetztAm(r.gesetztAm);
      addToast({
        tone: 'success',
        title: 'Rettungsstick beschrieben',
        body: `Der Stick „${l.name}" öffnet jetzt den Weg zu einem neuen Kassencode. Sicher verwahren; ein vorheriger Stick gilt nicht mehr.`,
      });
    } catch (err) {
      if (isStepUpCancelled(err)) return;
      addToast({
        tone: 'alert',
        title: 'Der Stick konnte nicht beschrieben werden',
        body: err instanceof ApiError ? describeError(err) : 'Unbekannter Fehler.',
      });
    } finally {
      setStickLaeuft(false);
    }
  }

  /*
   * ⚠️ Der erschöpfende Zustand statt `isLoading`/`isError`. Ohne Netz steht
   * eine Abfrage auf `paused`: `isLoading` falsch, `isError` falsch, `data`
   * leer — und die Fläche bliebe stumm weiss. Zehn Flächen hatten genau das.
   */
  const stand = abfragestand(abfrage, () =>
    abfrage.error instanceof ApiError
      ? describeError(abfrage.error)
      : 'Der Zustand des Schlüssels ist nicht abrufbar.',
  );

  async function erneuern(): Promise<void> {
    if (laeuft) return;
    setLaeuft(true);
    try {
      const { schluessel } = await notfallschluessel.erzeugen(client);
      setFrisch(schluessel);
      void abfrage.refetch();
    } catch (err) {
      // Ein abgebrochener Gerätecode ist kein Fehler, sondern eine Entscheidung.
      if (isStepUpCancelled(err)) return;
      addToast({
        tone: 'alert',
        title: 'Der Schlüssel konnte nicht ausgegeben werden',
        body: err instanceof ApiError ? describeError(err) : 'Unbekannter Fehler.',
      });
    } finally {
      setLaeuft(false);
    }
  }

  // Der frische Schlüssel verdrängt alles andere: er steht genau einmal da,
  // und daneben soll nichts um Aufmerksamkeit werben.
  if (frisch !== null) {
    return (
      <SchluesselZettel
        schluessel={frisch}
        titel="Ihr neuer Notfallschlüssel"
        weiterLabel="Notiert, zurück zum Team"
        onWeiter={() => setFrisch(null)}
      />
    );
  }

  return (
    <ParchmentCard tone="parchment" padding="md">
      <Zwischentitel label="Ihr Notfallschlüssel" />

      <p
        style={{
          margin: 'var(--w14-abstand-8) 0 var(--w14-abstand-12)',
          maxWidth: '64ch',
          lineHeight: 1.6,
          color: 'var(--w14-ink-aged)',
          fontSize: 'var(--w14-schrift-zeile)',
          textWrap: 'pretty',
        }}
      >
        Einen Mitarbeiter setzen Sie unten zurück. Sie selbst können das nicht —
        deshalb gibt es diesen Schlüssel. Mit ihm setzen Sie am Tresen einen
        neuen Kassencode, falls Sie Ihren vergessen. Anmelden kann man sich
        damit nicht, und jeder Gebrauch steht in der Aufsicht.
      </p>

      {stand.art === 'fehler' && <ZustandFehler satz={stand.satz} />}

      {stand.art === 'laedt' && (
        <p style={{ margin: 0, color: 'var(--w14-ink-faded)' }}>Wird geprüft …</p>
      )}

      {stand.art === 'wartet' && (
        <p style={{ margin: 0, color: 'var(--w14-ink-faded)' }}>
          Ohne Verbindung zum Motor. Der Zustand wird nachgeholt, sobald sie steht.
        </p>
      )}

      {stand.art === 'da' && abfrage.data !== undefined && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--w14-abstand-12)',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <p style={{ margin: 0, flex: '1 1 24ch', color: 'var(--w14-ink)' }}>
            {abfrage.data.vorhanden && abfrage.data.gesetztAm !== null
              ? `Gültig, ausgegeben am ${alsTag(abfrage.data.gesetztAm)}.`
              : 'Noch keiner ausgegeben.'}
            {abfrage.data.gebrauchtAm !== null && (
              <>
                {' '}
                <span style={{ color: 'var(--w14-ink-aged)' }}>
                  Zuletzt eingelöst am {alsTag(abfrage.data.gebrauchtAm)}.
                </span>
              </>
            )}
          </p>
          <Button
            variant={abfrage.data.vorhanden ? 'ghost' : 'primary'}
            size="md"
            disabled={laeuft}
            title={
              abfrage.data.vorhanden
                ? 'Gibt einen neuen aus. Der bisherige Zettel gilt danach NICHT mehr.'
                : 'Gibt einen Schlüssel aus. Er steht genau einmal auf dem Schirm.'
            }
            onClick={() => void erneuern()}
          >
            {laeuft
              ? 'Wird ausgegeben …'
              : abfrage.data.vorhanden
                ? 'Neuen ausgeben (alter verfällt)'
                : 'Schlüssel ausgeben'}
          </Button>
        </div>
      )}

      {laufwerke !== null && (
        <div
          style={{
            marginTop: 'var(--w14-abstand-16)',
            paddingTop: 'var(--w14-abstand-12)',
            borderTop: '1px solid var(--w14-rule)',
          }}
        >
          <p
            style={{
              margin: '0 0 var(--w14-abstand-8)',
              maxWidth: '64ch',
              lineHeight: 1.6,
              color: 'var(--w14-ink-aged)',
              fontSize: 'var(--w14-schrift-zeile)',
              textWrap: 'pretty',
            }}
          >
            Rettungsstick: derselbe Schlüssel als Ding. Ein gewöhnlicher
            USB-Stick wird beschrieben und öffnet an der Anmeldung denselben
            Weg, ganz ohne Zettel.
            {stickGesetztAm !== null && (
              <> Zuletzt beschrieben am {alsTag(stickGesetztAm)}.</>
            )}
          </p>
          {laufwerke.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--w14-ink-faded)' }}>
              Kein USB-Stick eingesteckt. Stick einstecken — er erscheint hier
              von selbst.
            </p>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--w14-abstand-8)', flexWrap: 'wrap' }}>
              {laufwerke.map((l) => (
                <Button
                  key={l.pfad}
                  variant="ghost"
                  size="md"
                  disabled={stickLaeuft}
                  title={
                    l.traegtSchluessel
                      ? 'Trägt schon einen Rettungsschlüssel. Neu beschreiben ersetzt ihn.'
                      : 'Schreibt den Rettungsschlüssel auf diesen Stick. Der Stick wird NICHT gelöscht.'
                  }
                  onClick={() => void stickSchreiben(l)}
                >
                  {stickLaeuft
                    ? 'Wird beschrieben …'
                    : l.traegtSchluessel
                      ? `${l.name}: Schlüssel erneuern`
                      : `Auf „${l.name}" schreiben`}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </ParchmentCard>
  );
}

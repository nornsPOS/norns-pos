/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Das Sitzungsmerkmal — es wohnt im Tresor des Betriebssystems
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── WOZU ES ÜBERHAUPT EIN MERKMAL GIBT ────────────────────────────────────
 *
 * Die Sitzung ist ein `SameSite=None; Secure; HttpOnly`-Keks. Auf macOS trägt
 * das (der Ursprung `tauri://localhost` gilt als sicherer Zusammenhang), auf
 * Windows nicht: dort ist der Ursprung das unsichere `http://tauri.localhost`,
 * und ein fremdseitiger `Secure`-Keks wird verworfen. Die Kasse führt das
 * Merkmal deshalb ZUSÄTZLICH als `Authorization: Bearer` mit, was keine
 * Keksregel kennt. Der Datenstrom reicht es als Abfrageteil weiter.
 *
 * ── ⚰️ 22.08.2026: ES LAG IM BROWSERSPEICHER ──────────────────────────────
 *
 * Bis heute stand es in `localStorage` unter `w14.session-token`, und diese
 * Datei trug den Vermerk selbst: „SECURITY (go-live TODO): move this to the
 * Tauri OS keychain". Basels Anweisung vom 22.08.: „انقله ضروري لـ OS
 * Keychain. نبي هنا أقصى درجات الأمان وبمستوى البنوك."
 *
 * Zwei Dinge folgten daraus:
 *
 *   • RUHEND AUF DER PLATTE. Der Speicher der Webansicht ist eine gewöhnliche
 *     Datei im Benutzerprofil, unverschlüsselt. Wer das Gerät in die Hand
 *     bekommt oder eine Sicherung des Profils liest, hat das Merkmal — ohne
 *     die Kasse je zu starten und ohne den Kassencode zu kennen.
 *   • JEDES SKRIPT IM FENSTER kann `localStorage` lesen.
 *
 * ⚠️ WAS DIESER SCHRITT NICHT LEISTET, und das gehört dazugesagt: ein
 * Träger-Merkmal MUSS zur Laufzeit im Fenster liegen, sonst kann die Kasse
 * keine Anfrage stellen. Wer in diesem Augenblick Code im Fenster ausführt,
 * kommt weiterhin an den laufenden Wert. Genommen ist das RUHENDE Merkmal:
 * es überlebt keinen Profilzugriff, keine Sicherung des Benutzerordners und
 * keinen Blick in den Speicher nach dem Schliessen. Das ist die Stufe, die
 * zählt, wenn ein Gerät verlorengeht.
 *
 * ── DIE FORM BLEIBT SYNCHRON ──────────────────────────────────────────────
 *
 * `getSessionToken()` wird bei JEDER Anfrage gerufen und muss synchron
 * bleiben; der Tresor antwortet asynchron. Also führt diese Datei den Wert
 * weiter im Arbeitsspeicher und benutzt den Tresor als HALTBARKEIT dahinter:
 * einmal beim Start gelesen (`ladeSitzungAusTresor`, vor dem ersten Bild),
 * danach bei jeder Änderung geschrieben. Kein Aufrufer ändert sich.
 */

import { invoke } from '@tauri-apps/api/core';

import { describeHardwareError, isHardwareError, isRunningInTauri } from './hardware-client.js';

let cached: string | null = null;

/** A change listener: receives the NEW token value (null on sign-out). */
type TokenListener = (token: string | null) => void;
const listeners = new Set<TokenListener>();

/**
 * ⛔ DIE REIHENFOLGE DER SCHREIBZÜGE, UND WARUM SIE HIER STEHT
 *
 * Anmelden und Abmelden schreiben beide in den Tresor, und beide Wege sind
 * asynchron. Zwei lose abgeschickte Züge können in JEDER Reihenfolge
 * ankommen — und wenn ein Abmelden vor dem Anmelden landet, bleibt nach dem
 * Abmelden ein GÜLTIGES Merkmal im Tresor liegen. Ein Gerät, das der Händler
 * für abgemeldet hält, wäre angemeldet.
 *
 * Deshalb hängen alle Schreibzüge an EINER Kette: der nächste beginnt erst,
 * wenn der vorige fertig ist. Ein gescheiterter Zug reisst die Kette nicht
 * ab, denn dann käme kein Abmelden mehr durch.
 */
let kette: Promise<unknown> = Promise.resolve();

/** Der letzte Fehler beim Schreiben, für die Fläche lesbar. */
let letzterSchreibfehler: string | null = null;

/**
 * Ob der Tresor beim Abmelden zuletzt gemeckert hat.
 *
 * ⚠️ Ein gescheitertes LÖSCHEN ist der schwerere Fall: dann liegt ein
 * gültiges Merkmal weiter im Tresor. Der Abmeldeweg fragt das ab.
 */
export function letzterTresorFehler(): string | null {
  return letzterSchreibfehler;
}

function schreibeInDenTresor(token: string | null): void {
  if (!isRunningInTauri()) return;
  kette = kette
    .then(() => invoke('sitzung_schreiben', { merkmal: token }))
    .then(() => {
      letzterSchreibfehler = null;
    })
    .catch((fehler: unknown) => {
      /*
       * ⛔ NICHT `String(fehler)`. Der Rumpf lehnt mit dem gereihten
       * `{ kind, details }` ab, nicht mit einem `Error`; `String({…})` ergibt
       * woertlich `[object Object]`. Mein erster Entwurf schrieb genau das,
       * und `keine-rohe-ablehnung` hat es gefangen — der Waechter, den dieses
       * Haus am 02.08. gebaut hat, nachdem ein Haendler `[object Object]`
       * ueber ein Geraet las, das er in der Hand hielt.
       */
      letzterSchreibfehler = isHardwareError(fehler)
        ? describeHardwareError(fehler)
        : fehler instanceof Error
          ? fehler.message
          : 'Die Schlüsselverwaltung des Betriebssystems hat nicht geantwortet.';
    });
}

/**
 * Das Merkmal EINMAL beim Start aus dem Tresor holen.
 *
 * ⚠️ Muss vor der ersten angemeldeten Anfrage laufen, sonst hielte sich die
 * Kasse nach einem Neustart für abgemeldet. `Motorstart` wartet ohnehin auf
 * den Motor; dieser Zug reist mit und kostet keinen eigenen Augenblick.
 *
 * Schweigt der Tresor, bleibt der Wert `null` — das heisst „bitte anmelden",
 * und das ist in jedem Fall die richtige Antwort. Ein Fehlerbild statt des
 * Anmeldebildes wäre es nicht.
 */
export async function ladeSitzungAusTresor(): Promise<void> {
  if (!isRunningInTauri()) return;
  try {
    const merkmal = await invoke<string | null>('sitzung_lesen');
    if (typeof merkmal === 'string' && merkmal.length > 0) {
      cached = merkmal;
      for (const fn of listeners) {
        try {
          fn(merkmal);
        } catch {
          /* ein Zuhörer darf den Start nie aufhalten */
        }
      }
    }
  } catch {
    /* Tresor stumm — die Kasse zeigt das Anmeldebild. */
  }
}

/**
 * Subscribe to token changes — login, mid-shift RENEWAL, and sign-out all flow
 * through here. Returns an unsubscribe.
 * A listener that throws can never break the token write or sibling listeners.
 */
export function onSessionTokenChange(fn: TokenListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The current session token, or null when signed out. */
export function getSessionToken(): string | null {
  return cached;
}

/** Persist (or clear, when null) the session token. Notifies listeners on change. */
export function setSessionToken(token: string | null): void {
  const prev = cached;
  cached = token;
  schreibeInDenTresor(token);
  if (prev !== token) {
    for (const fn of listeners) {
      try {
        fn(token);
      } catch {
        /* a listener must NEVER break the token write or the other listeners */
      }
    }
  }
}

/** Clear the session token (sign-out cascade). */
export function clearSessionToken(): void {
  setSessionToken(null);
}

/**
 * Warten, bis alle angestossenen Schreibzüge im Tresor angekommen sind.
 *
 * Der Abmeldeweg ruft das, bevor er meldet „abgemeldet": sonst stünde der
 * Satz auf dem Schirm, während das Löschen noch unterwegs ist.
 */
export async function tresorIstGeschrieben(): Promise<void> {
  await kette;
}

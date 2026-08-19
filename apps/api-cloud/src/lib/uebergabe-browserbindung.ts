/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE BESTÄTIGUNG GEHÖRT DEM BROWSER, DER SICH GERADE ANGEMELDET HAT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ Diese Datei entstand, weil die Bestätigungsstufe vom selben Tag den
 * Angriff NICHT geschlossen hat, gegen den sie gebaut wurde. Der Kommentar an
 * `/confirm` begründete die offene Route so:
 *
 *     „Wer diese Route direkt aufruft, kann damit nur seine EIGENE Übergabe
 *      freigeben — er kennt ja bereits die Kennung."
 *
 * Das ist im Angriffsfall falsch, und zwar genau umgekehrt. Der Angreifer
 * WÄHLT die Kennung N und schickt dem Opfer den Link. Nach der Anmeldung des
 * Opfers liegt unter N die Sitzung des OPFERS. Der Angreifer brauchte den
 * Menschen also gar nicht:
 *
 *     POST /confirm { nonce: N }   →  200
 *     POST /claim   { nonce: N }   →  die Sitzung des Opfers
 *
 * Beides ohne Anmeldung, ohne Keks, ohne Gerät, von jeder Adresse der Welt.
 * An der offenen Adresse nachgemessen, mit fremdem `Origin`: **200**.
 *
 * ── Und die andere Hälfte, die noch schlimmer war ────────────────────────
 *
 * Ein `<form method="POST">` ohne `enctype` sendet
 * `application/x-www-form-urlencoded`. Fastify 4 versteht ab Werk nur JSON,
 * und `@fastify/formbody` fehlte. Gemessen:
 *
 *     Skript mit JSON            →  200
 *     Mensch mit dem Formular    →  400
 *
 * **Das Tor stand genau verkehrt herum.** Der Angreifer kam durch, der
 * rechtmässige Besitzer nicht. Der Browser-Rückfallweg aller drei Anwendungen
 * war damit tot — auf einem Gerät ohne Play-Dienste gab es gar keinen Zugang
 * mehr.
 *
 * ── Was diese Datei tut ──────────────────────────────────────────────────
 *
 * Beim Google-Rücklauf bekommt der Browser einen `httpOnly`-Keks mit einem
 * Geheimnis, das der SERVER erzeugt. `/confirm` verlangt es. Damit kann nur
 * noch der Browser bestätigen, der den Rücklauf wirklich durchlaufen hat —
 * der Angreifer, der bloss die Kennung kennt, hat ihn nicht.
 *
 * `SameSite=Lax` ist dabei nicht Beiwerk, sondern der zweite Riegel: es lässt
 * den Keks beim Rücklauf von Google (ein Seitenwechsel auf oberster Ebene)
 * mitlaufen, blockt ihn aber bei einem fremden POST von einer Angreiferseite.
 *
 * ── Was damit NICHT geschlossen ist, und das ist ehrlich zu sagen ────────
 *
 * Ein Opfer, das den Link öffnet, sich anmeldet und danach selbst tippt, gibt
 * dem Angreifer die Sitzung weiterhin. Dagegen hilft nur, was RFC 8628 tut:
 * die Kennung muss vom SERVER kommen, und das GERÄT muss den Code anzeigen,
 * den der Mensch im Browser wiedererkennt. Heute zeigt ihn keine der drei
 * Anwendungen an — die Warnung auf der Seite trägt den Rest allein.
 *
 * Der Unterschied ist trotzdem gross: vorher brauchte der Angriff KEINEN
 * Menschen, jetzt braucht er einen, der eine ausdrückliche Warnung übergeht.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Der Keks der Admin-Tür. Zwei Türen, zwei Namen, damit sie sich nie kreuzen. */
export const ADMIN_UEBERGABE_KEKS = 'warehouse14.uebergabe';
/** Der Keks der Kunden-Tür. */
export const SHOP_UEBERGABE_KEKS = 'warehouse14.shop_uebergabe';

/**
 * Nur der Bestätigungsweg braucht ihn. Ein Keks mit `path: '/'` liefe bei
 * jeder Anfrage mit und wäre an tausend Stellen zu verlieren.
 */
export const ADMIN_KEKS_PFAD = '/api/admin/auth/google/confirm';
export const SHOP_KEKS_PFAD = '/api/storefront/auth/google/confirm';

/** Dasselbe Fenster wie die Übergabe selbst. Länger wäre er nur eine Angriffsfläche. */
export const UEBERGABE_KEKS_TTL_SEK = 300;

export interface Browserbindung {
  /** Wandert in den Keks. Verlässt den Server nur dorthin. */
  geheimnis: string;
  /** Wandert in den Wartebereich. Aus ihm lässt sich das Geheimnis nicht zurückrechnen. */
  abdruck: string;
}

/**
 * Erzeugt die Bindung.
 *
 * Im Wartebereich liegt bewusst nur der Abdruck. Sonst stünde in einem
 * Speicherabzug oder einem versehentlichen Protokollsatz das Geheimnis selbst.
 */
export function neueBrowserbindung(): Browserbindung {
  const geheimnis = randomBytes(32).toString('base64url');
  return { geheimnis, abdruck: abdruckVon(geheimnis) };
}

export function abdruckVon(geheimnis: string): string {
  return createHash('sha256').update(geheimnis).digest('hex');
}

/**
 * Passt der Keks zum Wartebereich?
 *
 * Zeitkonstant verglichen. Der Vorteil eines frühen `!==` wäre hier zwar
 * winzig, aber die Regel gilt im ganzen Haus einheitlich, und eine Ausnahme
 * ist schwerer zu prüfen als die Regel.
 *
 * Fehlt der Keks, ist die Antwort `false` — genau das ist der Fall des
 * Angreifers, der nur die Kennung kennt.
 */
export function bindungStimmt(keks: string | undefined, erwarteterAbdruck: string | undefined): boolean {
  if (!keks || !erwarteterAbdruck) return false;
  const a = Buffer.from(abdruckVon(keks), 'utf8');
  const b = Buffer.from(erwarteterAbdruck, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Die Kekseinstellungen. `sameSite: 'lax'` ist der zweite Riegel, siehe oben. */
export function keksOptionen(pfad: string, sicher: boolean) {
  return {
    httpOnly: true,
    secure: sicher,
    sameSite: 'lax' as const,
    path: pfad,
    maxAge: UEBERGABE_KEKS_TTL_SEK,
  };
}

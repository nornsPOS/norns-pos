/**
 * ════════════════════════════════════════════════════════════════════════
 *  Der Gerätecode gehört vor das, was sich NICHT rückgängig machen lässt
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── BASELS BEFUND VOM 05.08.2026 ────────────────────────────────────────
 *
 * Wörtlich: „لازم نحل مشكلة الصلاحيات وطلب رمز الماك بوك او الجهاز ست مرات
 * مختلفة مزعجة جداً المفروض تكون مرا وحدة كاملة متكاملة ماتنطلب مرا ثانية"
 * — der Code wurde sechs verschiedene Male verlangt; er soll EINMAL kommen,
 * vollständig, und nicht wieder.
 *
 * Gemessen waren es nicht sechs Stellen, sondern SIEBENUNDVIERZIG Endpunkte.
 * Darunter reine Lesezugriffe (`GET /api/shifts/current`), das Anlegen eines
 * Produkts, jede Ausgabe, jede Einstellung, jeder Kursstand. Wer einen
 * Vormittag lang arbeitete, tippte den Code ein Dutzend Mal.
 *
 * Seine Entscheidung dazu, wörtlich auf die Rückfrage: „مرة عند الفتح،
 * وثانية فقط عند الأفعال التي لا تُلغى" — einmal beim Öffnen, und ein
 * zweites Mal nur bei Handlungen, die sich nicht widerrufen lassen.
 *
 * ── WAS DIESER WÄCHTER FESTHÄLT ─────────────────────────────────────────
 *
 * Die Liste unten ist die Entscheidung, nicht eine Beschreibung des
 * Ist-Zustands. Der Test liest die ECHTEN Routendateien und vergleicht:
 *
 *   • Ein neuer Code vor einer alltäglichen Handlung  → ROT
 *     (sonst wächst die Liste stumm zurück auf 47)
 *   • Ein verschwundener Code vor etwas Endgültigem   → ROT
 *     (ein gelöschtes Stück, ein Steuer-Export, ein Tagesabschluss ohne
 *      Bestätigung wäre schlimmer als jede Frage zu viel)
 *
 * ── ⚠️ WARUM DIESER WÄCHTER DIE DATEIEN LIEST ───────────────────────────
 *
 * Er könnte eine Namensliste führen — und wäre damit genau der Wächter aus
 * `waechter-mit-namensliste-wird-blind`: ein Eintrag ohne Datei fällt nie
 * auf. Deshalb prüft er zusätzlich, dass JEDE Datei der Liste existiert und
 * dass die gefundene Gesamtzahl mit der Liste übereinstimmt. Eine umbenannte
 * Route wird rot, statt lautlos aus der Prüfung zu fallen.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTEN = new URL('../../src/routes/', import.meta.url).pathname;

/**
 * Die Handlungen, die den Code weiterhin verlangen. Jede Zeile ist eine
 * Entscheidung mit Begründung — wer eine hinzufügt, muss die Begründung
 * schreiben können.
 */
const UNWIDERRUFLICH: ReadonlyArray<{ pfad: string; grund: string }> = [
  // Fiskale Siegel. Ein gesetzter Abschluss und ein gezogener Export sind
  // Erklärungen gegenüber dem Finanzamt und dürfen nie beiläufig passieren.
  { pfad: 'POST /api/closings/finalize', grund: 'Tagesabschluss, danach ist der Tag versiegelt' },
  { pfad: 'GET /api/closings/:id/export/datev', grund: 'Steuer-Export an die Buchhaltung' },
  { pfad: 'GET /api/closings/:id/export/dsfinvk', grund: 'Steuer-Export für die Prüfung' },
  { pfad: 'GET /api/closings/:id/export/kassenbericht', grund: 'Steuer-Export Kassenbericht' },
  // 18.08.2026, und dieser Waechter hat es wieder erzwungen (Lauf wurde ROT,
  // erst die Begruendung macht den Aufruf gueltig): das Prueferpaket der
  // Kassennachschau exportiert DIESELBEN fiskalen Daten wie die drei
  // Einzelexporte darueber, nur ueber einen ganzen Zeitraum. Ein Weg, der
  // mit weniger Schutz MEHR herausgibt, waere ein Loch neben dem Tor.
  { pfad: 'POST /api/pruefer/paket', grund: 'Steuer-Export der Kassennachschau, ganzer Zeitraum' },
  // 18.08.2026: der Fremdbeleg-Export gibt dieselbe Klasse Daten heraus wie
  // der Tages-DATEV-Export darueber; gleicher Schutz, gleicher Grund.
  { pfad: 'GET /api/expenses/export/datev', grund: 'Steuer-Export der unbaren Ausgaben' },
  { pfad: 'POST /api/transactions/storno', grund: 'fiskale Umkehrung eines Belegs' },
  // 19.08.2026: die Warenruecknahme (Tz. 4.2.5) ist dieselbe Klasse wie der
  // Storno — Bargeld verlaesst das Haus, ein fiskaler Beleg entsteht, und
  // beides laesst sich nicht ungeschehen machen. Dieser Waechter wurde ROT,
  // als der Aufruf gesetzt war, und erst diese Zeile macht ihn gueltig.
  { pfad: 'POST /api/transactions/rueckgabe', grund: 'fiskale Warenruecknahme mit Barauszahlung' },
  // ⚠️ 08.08.2026 dazugekommen, und dieser Wächter hat es erzwungen: der
  // Aufruf wurde gesetzt, der Lauf wurde ROT, und erst die Begründung hier
  // macht ihn gültig. Genau so soll er wirken.
  //
  // Eine Kartenerstattung schickt Geld HINAUS, zurück auf die Karte des
  // Kunden. Stripe holt eine ausgeführte Erstattung nicht zurück. Damit ist
  // sie so endgültig wie der Storno, und der verlangt den Code seit jeher
  // ohne Ausnahme und ohne Betragsgrenze.
  {
    pfad: 'POST /api/stripe/terminal/payments/:id/refund',
    grund: 'Geld geht endgültig an den Kunden zurück, Stripe holt es nicht wieder',
  },

  // Endgültige Löschungen.
  { pfad: 'DELETE /api/products/:id', grund: 'das Stück ist danach fort' },
  { pfad: 'POST /api/customers/:id/erase', grund: 'Löschung nach Datenschutzrecht, nicht umkehrbar' },
  { pfad: 'DELETE /api/customers/:id/kyc-documents', grund: 'Ausweisunterlagen mit Aufbewahrungspflicht' },
  { pfad: 'DELETE /api/customers/:id/kyc-documents/:docId', grund: 'einzelne Ausweisunterlage' },

  // Macht über andere: wer darf handeln, und womit.
  { pfad: 'POST /api/admin/staff', grund: 'ein neuer Mensch bekommt Zugriff auf die Kasse' },
  { pfad: 'POST /api/admin/staff/:id/deactivate', grund: 'jemandem den Zugriff nehmen' },
  { pfad: 'POST /api/admin/staff/:id/kassencode-loeschen', grund: 'fremden Zugang zurücksetzen' },
  { pfad: 'POST /api/api-keys', grund: 'Schlüsselmaterial, das die Kasse von aussen öffnet' },
  /*
   * ⚠️ 21.08.2026 dazugekommen, und dieser Wächter hat es erzwungen: der
   * Aufruf war gesetzt, der Lauf wurde ROT, und erst diese Begründung macht
   * ihn gültig. Genau so soll er wirken.
   *
   * Zwei Dinge sind hier endgültig, und beide zählen:
   *
   *   1. Der VORIGE Schlüssel stirbt in demselben Augenblick. Der Zettel im
   *      Tresor wird zu Papier. Wer den neuen nicht notiert — er steht genau
   *      einmal auf dem Schirm —, hat danach GAR keinen Weg zurück mehr.
   *   2. Ein gezeigter Schlüssel lässt sich nicht ungezeigt machen. Wer
   *      danebensteht, hat ihn.
   *
   * Es ist ausserdem Schlüsselmaterial, das die Kasse öffnet — dieselbe
   * Klasse wie die Zeile darüber.
   */
  {
    pfad: 'POST /api/auth/notfallschluessel/erzeugen',
    grund: 'der vorige Schlüssel stirbt dabei, und der neue ist einmal sichtbar',
  },
  { pfad: 'POST /api/api-keys/:id/revoke', grund: 'Schlüsselmaterial entwerten' },

  // Die Sicherheitseinrichtung selbst.
  // ⚠️ DREI falsche PUK-Versuche zerstören die TSE dauerhaft.
  { pfad: 'POST /api/tse/einrichten', grund: 'Sicherungseinrichtung, PUK-Falle' },
  { pfad: 'GET /api/compliance/unlock', grund: 'Freischaltung für die Kassennachschau' },
];

interface Fund {
  verb: string;
  pfad: string;
  datei: string;
}

/** Liest aus den echten Routendateien, welcher Endpunkt den Code verlangt. */
function codeVerlangendeEndpunkte(): Fund[] {
  const funde: Fund[] = [];
  for (const datei of readdirSync(ROUTEN)) {
    if (!datei.endsWith('.ts') || datei.includes('.test.')) continue;
    const zeilen = readFileSync(join(ROUTEN, datei), 'utf8').split('\n');
    let letztes: { verb: string; pfad: string } | null = null;
    for (let i = 0; i < zeilen.length; i += 1) {
      const zeile = zeilen[i] ?? '';
      const m = /app\.(get|post|patch|put|delete)/.exec(zeile);
      if (m) {
        /*
         * ⚠️ 20.08.2026: hier wurde nur die EIGENE und die naechste Zeile
         * gelesen. Als die Rueckgabe-Route ihren Rumpftyp auf mehrere Zeilen
         * verteilte (ein Feld kam dazu), stand der Pfad ploetzlich zehn Zeilen
         * weiter — der Waechter sah `POST ?` und meldete die Route gleich
         * doppelt: einmal als „verlangt den Code, obwohl widerruflich",
         * einmal als „Bestaetigung fehlt". Beides falsch; der Code stand
         * unveraendert an seiner Stelle.
         *
         * Ein Waechter, der an der Schreibweise haengt, meldet Unschuldige.
         * Gesucht wird jetzt bis zur oeffnenden Klammer des Aufrufs, hoechstens
         * zwoelf Zeilen weit — so weit reicht kein Rumpftyp und kein Schema.
         */
        let pfadTreffer: RegExpExecArray | null = null;
        for (let j = i; j < Math.min(i + 12, zeilen.length); j += 1) {
          // NUR ein Weg zaehlt, also eine Zeichenkette, die mit / beginnt.
          // Ohne diese Schranke fing der Blick das erste beste Wort in
          // Anfuehrungszeichen aus dem Rumpftyp ein (gemessen: 'BAR').
          pfadTreffer = /'(\/[^']*)'/.exec(zeilen[j] ?? '');
          if (pfadTreffer) break;
        }
        letztes = { verb: (m[1] ?? '').toUpperCase(), pfad: pfadTreffer?.[1] ?? '?' };
      }
      if (/^\s*require(Owner)?StepUp\(req\)/.test(zeile) && letztes) {
        funde.push({ ...letztes, datei });
      }
    }
  }
  return funde;
}

describe('Der Gerätecode steht nur noch vor Unwiderruflichem', () => {
  const funde = codeVerlangendeEndpunkte();
  const gefunden = new Set(funde.map((f) => `${f.verb} ${f.pfad}`));
  const erwartet = new Set(UNWIDERRUFLICH.map((u) => u.pfad));

  it('verlangt den Code an KEINER alltäglichen Handlung', () => {
    const zuviel = [...gefunden].filter((p) => !erwartet.has(p)).sort();
    expect(
      zuviel,
      'Diese Endpunkte verlangen den Code, obwohl sie widerruflich sind. ' +
        'Basel, 05.08.2026: „مرة عند الفتح، وثانية فقط عند الأفعال التي لا تُلغى". ' +
        'Entweder die Handlung ist wirklich endgültig — dann gehört sie mit ' +
        'Begründung in UNWIDERRUFLICH — oder der Aufruf gehört entfernt.',
    ).toEqual([]);
  });

  it('verlangt den Code an JEDER unwiderruflichen Handlung', () => {
    const fehlt = [...erwartet].filter((p) => !gefunden.has(p)).sort();
    expect(
      fehlt,
      'Vor diesen Handlungen fehlt die Bestätigung. Ein gelöschtes Stück, ' +
        'ein gezogener Steuer-Export oder ein gesetzter Tagesabschluss ohne ' +
        'Nachfrage ist schlimmer als eine Frage zu viel.',
    ).toEqual([]);
  });

  it('findet jede Datei der Liste wirklich — kein Eintrag ohne Route', () => {
    // Der Riegel gegen die Namensliste, die blind wird: gäbe es einen
    // Endpunkt der Liste gar nicht mehr (umbenannt, verschoben, gelöscht),
    // wäre er oben schon als „fehlt" aufgefallen. Diese Zeile hält
    // zusätzlich die ZAHL fest, damit ein doppelt gezählter Fund die
    // Rechnung nicht zufällig aufgehen lässt.
    expect(funde.length).toBe(UNWIDERRUFLICH.length);
  });

  it('jeder Eintrag trägt eine Begründung', () => {
    const ohne = UNWIDERRUFLICH.filter((u) => u.grund.trim().length < 10).map((u) => u.pfad);
    expect(ohne, 'Wer den Code vor eine Handlung stellt, muss sagen warum.').toEqual([]);
  });

  it('ist gegenüber dem gemessenen Ausgangsstand deutlich kleiner', () => {
    // Am 05.08.2026 gemessen: 47 Endpunkte. Diese Zeile ist kein Selbstlob,
    // sondern ein Riegel: kriecht die Liste je wieder über dreissig, ist die
    // Entscheidung faktisch zurückgenommen, ohne dass es jemand gesagt hat.
    expect(funde.length).toBeLessThan(30);
  });
});

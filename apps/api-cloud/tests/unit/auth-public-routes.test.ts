/**
 * Guard against "catch #76": a route that lives under a PUBLIC prefix but whose
 * handler calls `requireAuth(req)`.
 *
 * The auth preHandler (plugins/auth.ts) skips anything matching PUBLIC_PREFIXES,
 * so `req.actor` is never populated for such a route, so its own
 * `requireAuth(req)` throws on every request. The route fails CLOSED: not a hole,
 * but permanently unusable — and silently, because a 401 from an auth route
 * looks exactly like a wrong password.
 *
 * It has now happened three times. First on /api/auth/session, /sign-out and
 * /step-up (fixed by adding AUTHENTICATED_PATHS_UNDER_PUBLIC_PREFIX). Then,
 * unnoticed, on `/api/auth/pin/set` — staff could not change their POS PIN —
 * and on `/api/auth/duress-pin/set` — nobody could set or rotate the duress
 * PIN, the safety control for an armed robbery. A safety control that cannot be
 * armed is its own emergency, and no test was watching.
 *
 * This test reads the route sources, finds every path registered under a public
 * prefix, checks whether that route's handler calls requireAuth, and fails if it
 * is not listed as an exception. It is a source scan on purpose: the bug lives in
 * the gap between two files, which no runtime unit test of either file can see.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AUTHENTICATED_PATHS_UNDER_PUBLIC_PREFIX,
  PUBLIC_PREFIXES,
} from '../../src/lib/public-routes.js';

const ROUTES_DIR = new URL('../../src/routes', import.meta.url).pathname;

/**
 * `app.post(\n  '/api/auth/pin/set',` → the quoted path literal.
 *
 * ⛔ 21.08.2026, DER FUENFTE FANG DERSELBEN FAMILIE — und diesmal war es die
 * SYNTAX, nicht der Name.
 *
 * Bis heute stand hier `\.(?:get|post|…)\(` ohne Zwischenraum fuer eine
 * Typangabe. Fastify wird aber an sehr vielen Stellen typisiert gerufen:
 *
 *     app.get<{ Params: { id: string } }>(
 *       '/api/customers/:id',
 *
 * GEMESSEN: der Waechter sah 61 Wege. Es gibt 167. Er war fuer 106 davon
 * BLIND — 63 Prozent, darunter `/api/closings/:id/export/datev`, ein
 * Steuerexport.
 *
 * Am Morgen desselben Tages hatte ich diesen Waechter geschaerft, weil er
 * `requireOwner` nicht als Wache erkannte. Die Schaerfung war richtig und
 * deckte trotzdem nur 37 Prozent der Flaeche ab. Die Lehre steht nicht im
 * Ausdruck, sondern in der Probe darunter: ein Waechter muss BEWEISEN, dass
 * er alles sieht, was es gibt.
 */
const ROUTE_PATH_RE =
  /\b(?:app|fastify)\.(?:get|post|put|patch|delete)(?:<[\s\S]*?>)?\s*\(\s*'([^']+)'/g;

interface RouteRef {
  file: string;
  path: string;
  index: number;
}

function collectRoutes(): RouteRef[] {
  const out: RouteRef[] = [];
  for (const file of readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(ROUTES_DIR, file), 'utf8');
    for (const m of src.matchAll(ROUTE_PATH_RE)) {
      const path = m[1];
      if (path !== undefined && m.index !== undefined) out.push({ file, path, index: m.index });
    }
  }
  return out;
}

/**
 * ⛔ DER VIERTE FANG, UND DIESMAL WAR ES DER WÄCHTER SELBST (21.08.2026)
 *
 * Bis heute suchte diese Probe wörtlich nach `requireAuth(req)`. Ein Weg unter
 * `/api/auth/`, der stattdessen `requireOwner(req)` ruft, lief glatt an ihr
 * vorbei — obwohl `requireOwner` als ERSTE Zeile `requireAuth` ruft und damit
 * exakt denselben Fehlschlag erzeugt: `req.actor` bleibt leer, der Weg
 * antwortet für immer mit 401.
 *
 * Genau das ist mir beim Notfallschlüssel passiert. Zwölf Proben rot, die
 * Ursache eine Zeile in einer ganz anderen Datei — und dieser Wächter stand
 * daneben und blieb grün.
 *
 * Deshalb steht die Liste der Wächterfunktionen jetzt NIRGENDS als Liste. Sie
 * wird aus `lib/auth-policy.ts` abgeleitet: jede ausgeführte Funktion, die
 * `requireAuth` ruft — direkt oder über eine andere solche Funktion. Wer
 * morgen `requireKassenwart` schreibt, ist ohne Zutun mit abgedeckt.
 */
function waechterfunktionen(): string[] {
  const src = readFileSync(new URL('../../src/lib/auth-policy.ts', import.meta.url).pathname, 'utf8');
  // Name → Rumpf, grob vom `export function` bis zum nächsten.
  const koerper = new Map<string, string>();
  const treffer = [...src.matchAll(/export function (\w+)\s*\(/g)];
  for (const [i, m] of treffer.entries()) {
    const name = m[1];
    if (name === undefined || m.index === undefined) continue;
    const ende = treffer[i + 1]?.index ?? src.length;
    koerper.set(name, src.slice(m.index, ende));
  }

  const verlangt = new Set(['requireAuth']);
  // Fixpunkt: solange noch etwas dazukommt, erneut durchgehen.
  for (let runde = 0; runde < koerper.size + 1; runde++) {
    const vorher = verlangt.size;
    for (const [name, rumpf] of koerper) {
      if (verlangt.has(name)) continue;
      for (const bekannt of verlangt) {
        if (new RegExp(`\\b${bekannt}\\(\\s*req\\s*\\)`).test(rumpf)) {
          verlangt.add(name);
          break;
        }
      }
    }
    if (verlangt.size === vorher) break;
  }
  return [...verlangt];
}

const WAECHTER = waechterfunktionen();

/**
 * Verlangt der Rumpf dieses Weges eine Sitzung? Gelesen von seiner eigenen
 * Anmeldung bis zur nächsten in derselben Datei — genau das Fenster, in dem
 * sich der Fehler versteckt.
 */
function handlerCallsRequireAuth(file: string, index: number): boolean {
  const src = readFileSync(join(ROUTES_DIR, file), 'utf8');
  const after = src.slice(index);
  const next = after.slice(1).search(/\b(?:app|fastify)\.(?:get|post|put|patch|delete)\(/);
  const body = next === -1 ? after : after.slice(0, next + 1);
  return WAECHTER.some((w) => new RegExp(`\\b${w}\\(\\s*req\\s*\\)`).test(body));
}

const underPublicPrefix = (path: string): boolean =>
  PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));

describe('public routes versus requireAuth (catch #76 guard)', () => {
  const routes = collectRoutes();

  it('finds routes to scan at all (the scan itself must not silently pass)', () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  it('⛔ sieht JEDEN Weg, den es gibt — nicht nur die untypisierten', () => {
    /*
     * Die Probe, die am 21.08.2026 gefehlt hat. Sie zaehlt die Wege ein
     * ZWEITES Mal, mit einem absichtlich groben Ausdruck (nur `app.get(`
     * irgendwo in einer Zeile, ohne Ruecksicht auf die Form), und verlangt,
     * dass der feine Ausdruck oben genauso viele findet.
     *
     * Ein Waechter, der 61 von 167 Wegen sieht, ist gefaehrlicher als keiner:
     * er ist gruen und man glaubt ihm.
     */
    let grob = 0;
    for (const file of readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(join(ROUTES_DIR, file), 'utf8');
      for (const m of src.matchAll(/\b(?:app|fastify)\.(?:get|post|put|patch|delete)\b/g)) {
        // Nur echte Anmeldungen zaehlen: irgendwo danach muss ein Pfad stehen.
        if (/^[\s\S]{0,400}?\(\s*'\//.test(src.slice(m.index))) grob++;
      }
    }
    expect(
      routes.length,
      `Der feine Ausdruck findet ${routes.length} Wege, der grobe ${grob}. ` +
        'Die Luecke sind Wege, die der Waechter NICHT prueft — meist typisiert ' +
        'gerufen (`app.get<{ Params: … }>(`).',
    ).toBe(grob);
  });

  it('every route under a public prefix whose handler calls requireAuth is listed as an exception', () => {
    const broken = routes
      .filter((r) => underPublicPrefix(r.path))
      .filter((r) => !AUTHENTICATED_PATHS_UNDER_PUBLIC_PREFIX.has(r.path))
      .filter((r) => handlerCallsRequireAuth(r.file, r.index))
      .map((r) => `${r.path}  (${r.file})`);

    expect(
      broken,
      'These routes sit under a PUBLIC prefix so the auth preHandler skips them, but their ' +
        'handlers call requireAuth(req) — so req.actor is never populated and they return 401 ' +
        'forever. Add each path to AUTHENTICATED_PATHS_UNDER_PUBLIC_PREFIX in lib/public-routes.ts.',
    ).toEqual([]);
  });

  it('⛔ der Wächter kennt MEHR als requireAuth — sonst sieht er requireOwner nicht', () => {
    // Der Fang vom 21.08.2026: die wörtliche Suche nach `requireAuth` liess
    // jeden Weg durch, der `requireOwner` ruft. Bleibt diese Probe grün, bleibt
    // die Ableitung aus auth-policy.ts am Leben.
    expect(WAECHTER).toContain('requireAuth');
    expect(WAECHTER).toContain('requireOwner');
    expect(WAECHTER).toContain('requireOwnerStepUp');
  });

  it('keeps the two PIN-setting routes armed (the regression that started this)', () => {
    expect(AUTHENTICATED_PATHS_UNDER_PUBLIC_PREFIX.has('/api/auth/pin/set')).toBe(true);
    expect(AUTHENTICATED_PATHS_UNDER_PUBLIC_PREFIX.has('/api/auth/duress-pin/set')).toBe(true);
  });

  it('does not list an exception that no longer exists as a route', () => {
    const known = new Set(routes.map((r) => r.path));
    const stale = [...AUTHENTICATED_PATHS_UNDER_PUBLIC_PREFIX].filter((p) => !known.has(p));
    expect(stale, 'Exception listed for a route that is gone. Remove it.').toEqual([]);
  });
});

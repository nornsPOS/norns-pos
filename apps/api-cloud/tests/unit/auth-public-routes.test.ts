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

/** `app.post(\n  '/api/auth/pin/set',` → the quoted path literal. */
const ROUTE_PATH_RE = /\b(?:app|fastify)\.(?:get|post|put|patch|delete)\(\s*'([^']+)'/g;

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
 * Does this route's handler call requireAuth? Scanned from the route's own
 * registration up to the next registration in the same file, which is the
 * handler's text. Crude but honest: it is exactly the window the bug hides in.
 */
function handlerCallsRequireAuth(file: string, index: number): boolean {
  const src = readFileSync(join(ROUTES_DIR, file), 'utf8');
  const after = src.slice(index);
  const next = after.slice(1).search(/\b(?:app|fastify)\.(?:get|post|put|patch|delete)\(/);
  const body = next === -1 ? after : after.slice(0, next + 1);
  return /requireAuth\(\s*req\s*\)/.test(body);
}

const underPublicPrefix = (path: string): boolean =>
  PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));

describe('public routes versus requireAuth (catch #76 guard)', () => {
  const routes = collectRoutes();

  it('finds routes to scan at all (the scan itself must not silently pass)', () => {
    expect(routes.length).toBeGreaterThan(20);
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

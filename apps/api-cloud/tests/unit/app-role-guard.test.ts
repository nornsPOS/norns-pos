/**
 * Der Wächter, der verhindert, dass die API mit zu vielen Rechten startet.
 *
 * Er existierte, hatte aber KEINEN Test, und deshalb fiel niemandem auf, dass
 * er neben seiner eigentlichen Absicht auch eine Ein-Mandanten-Annahme
 * festschrieb: er verlangte wörtlich die Rolle `warehouse14_app`.
 *
 * Am 26.07.2026 wurde Mandant 1 auf einen eigenen Anmeldebenutzer `t001_app`
 * umgestellt, weil das Verbindungsrecht sonst über die gemeinsame Gruppenrolle
 * vererbt wird und jeder Mandant in die Datenbank jedes anderen kommt. Der
 * Dienst stürzte daraufhin beim Start ab.
 *
 * Diese Tests halten BEIDE Anforderungen gleichzeitig fest:
 *   1. Mandantenrollen sind erlaubt.
 *   2. Privilegierte Rollen bleiben verboten, und zwar ausnahmslos.
 */

import { describe, expect, it } from 'vitest';

import { assertAppRoleInDatabaseUrl } from '../../src/config/env.js';

const mitRolle = (rolle: string) =>
  ({ DATABASE_URL: `postgresql://${rolle}:geheim@postgres:5432/warehouse14` }) as never;

describe('erlaubte Anwendungsrollen', () => {
  it('die bisherige Rolle bleibt gültig', () => {
    expect(() => assertAppRoleInDatabaseUrl(mitRolle('warehouse14_app'))).not.toThrow();
  });

  it('Mandantenrollen sind erlaubt', () => {
    for (const r of ['t001_app', 't002_app', 't047_app', 't1000_app']) {
      expect(() => assertAppRoleInDatabaseUrl(mitRolle(r)), r).not.toThrow();
    }
  });
});

describe('privilegierte Rollen bleiben verboten', () => {
  it('der Migrator darf die API niemals fahren', () => {
    // Der Migrator darf Schemata ändern. Liefe die API damit, könnte ein
    // Fehler in einer Route die Struktur der Datenbank verändern.
    for (const r of ['warehouse14_migrator', 't001_migrator']) {
      expect(() => assertAppRoleInDatabaseUrl(mitRolle(r)), r).toThrow(/least-privileged/);
    }
  });

  it('der Worker darf die API niemals fahren', () => {
    // Der Worker darf als einziger auf einer Tabelle löschen (0081). Die API
    // darf das nirgends.
    for (const r of ['warehouse14_worker', 't001_worker']) {
      expect(() => assertAppRoleInDatabaseUrl(mitRolle(r)), r).toThrow(/least-privileged/);
    }
  });

  it('Eigentümer und Superuser sind verboten', () => {
    for (const r of ['warehouse14', 'postgres', 'warehouse14_security']) {
      expect(() => assertAppRoleInDatabaseUrl(mitRolle(r)), r).toThrow(/least-privileged/);
    }
  });

  it('ein Name, der nur SO AUSSIEHT wie eine Anwendungsrolle, reicht nicht', () => {
    // Diese Zeile ist der eigentliche Wert des Musters: es ist verankert.
    // Ohne ^ und $ käme `warehouse14_migrator_app` oder `boese_t001_app`
    // durch, und der ganze Wächter wäre eine Zierde.
    for (const r of [
      'warehouse14_app_admin',
      'boese_t001_app',
      't001_app_migrator',
      'tXXX_app',
      'app',
      't1_app',
    ]) {
      expect(() => assertAppRoleInDatabaseUrl(mitRolle(r)), r).toThrow(/least-privileged/);
    }
  });
});

describe('kaputte Verbindungszeilen', () => {
  it('eine Zeile ohne erkennbare Rolle wird abgelehnt', () => {
    expect(() => assertAppRoleInDatabaseUrl({ DATABASE_URL: 'nicht-mal-eine-url' } as never)).toThrow(
      /expected .* shape/,
    );
  });
});

import { defineConfig } from 'vitest/config';

/**
 * Eigene Einstellung für die Integrationsproben, und der Grund dafür.
 *
 * ⚠️ Diese 24 Dateien liefen bis zum 26.07.2026 NIRGENDS: der Handgriff `test`
 * schliesst `tests/integration` aus, und kein Arbeitsablauf ruft sie. Beim
 * ersten Lauf fielen 22 von 24 Dateien um.
 *
 * Der Grund war NICHT, dass die Proben kaputt sind. Einzeln laufen sie:
 * `health.test.ts` allein ist grün, `day20-stripe-real.test.ts` allein war
 * grün mit acht Proben (die Datei fiel am 14.08.2026 mit dem
 * Netz-Verkaufskanal weg). Es war die gemeinsame Einstellung.
 *
 * `vitest.config.ts` setzt `singleFork: true`, damit ein Behälter nicht je
 * Datei neu hochgefahren wird. Für Einheitstests ist das richtig. Hier heisst
 * es aber: ALLE 24 Dateien teilen sich EINEN Prozess, und dann treffen
 * aufeinander, was sich nie treffen darf:
 *
 *   • prom-client führt ein globales Verzeichnis. Die zweite Datei, die eine
 *     Anwendung baut, bekommt „A metric with the name
 *     process_cpu_user_seconds_total has already been registered".
 *   • Die Behälter der einen Datei werden abgebaut, während die nächste sie
 *     noch benutzt. Daraus wird das nichtssagende
 *     „Cannot read properties of undefined (reading 'close')", das den
 *     eigentlichen Fehler verdeckt.
 *
 * Deshalb hier: eine Datei, ein Prozess. Das kostet Anlaufzeit je Datei und
 * ist trotzdem der bessere Handel, denn eine Probe, die nur allein grün ist,
 * ist keine Probe, sondern eine Erinnerung.
 *
 * `maxForks: 2`, weil jede Datei einen eigenen Postgres-Behälter startet. Auf
 * einem Laptop ist mehr Gleichzeitigkeit kein Gewinn, sondern der Grund, warum
 * ein Behälter „permission denied to create extension" meldet: die Maschine
 * kommt nicht nach.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
    include: ['tests/integration/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: false, minForks: 1, maxForks: 2 },
    },
  },
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Gemeinsames der Rettungswege — Inhaber finden, Laufwerke sehen
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Drei Türen führen zurück in eine verschlossene Kasse (Notfallschlüssel,
 * Rettungsstick, Herstellercode). Was sie teilen, wohnt hier — EINMAL,
 * damit drei Kopien nicht auseinanderlaufen.
 */

import { exec } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { devices, users } from '@norns/db/schema';

const execAsync = promisify(exec);

/**
 * Der INHABER, dem dieses Gerät gehört.
 *
 * ⚠️ Die Rettungswege setzen IMMER den Code des Inhabers neu, nie den eines
 * Mitarbeiters — für Mitarbeiter gibt es den Löschweg über den Inhaber, bei
 * dem niemand den Code eines anderen erfährt (§ 146a AO). Ist das Gerät von
 * einem Mitarbeiter gepaart (kommt in Norns nicht vor, ist aber möglich),
 * fällt die Suche auf das EINE Inhaberkonto zurück.
 */
export async function findeInhaberFuerGeraet(
  app: FastifyInstance,
  deviceId: string,
): Promise<{ id: string } | null> {
  const geraet = await app.db
    .select({ pairedBy: devices.pairedByUserId })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  const gepaart = geraet[0]?.pairedBy;
  if (!gepaart) return null;

  const gepaarterMensch = await app.db
    .select({ id: users.id, isOwner: users.isOwner })
    .from(users)
    .where(and(eq(users.id, gepaart), isNull(users.softDeletedAt)))
    .limit(1);
  if (gepaarterMensch[0]?.isOwner) return { id: gepaarterMensch[0].id };

  const inhaber = await app.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isOwner, true), isNull(users.softDeletedAt)))
    .limit(1);
  return inhaber[0] ? { id: inhaber[0].id } : null;
}

/** Ein Wechseldatenträger, wie die Fläche ihn zeigt. */
export interface Laufwerk {
  /** Absoluter Pfad des Einhängepunkts, z. B. `/Volumes/STICK` oder `E:\`. */
  pfad: string;
  /** Der Name, den der Mensch kennt. */
  name: string;
}

/**
 * Die Wechseldatenträger DIESES Rechners.
 *
 * ── DREI BETRIEBSSYSTEME, DREI WAHRHEITEN ─────────────────────────────────
 *
 *   macOS    `/Volumes/<Name>` — der Startträger hängt dort als Verweis mit;
 *            er fliegt heraus, indem sein Gerät mit dem von `/` verglichen
 *            wird (st_dev), nicht über seinen Namen (der ist frei wählbar).
 *   Windows  `Get-CimInstance Win32_LogicalDisk` mit DriveType=2
 *            (Wechseldatenträger). Kein wmic: das ist seit Windows 11
 *            entfernt.
 *   Linux    `/media/<user>/<Name>` und `/run/media/<user>/<Name>`.
 *
 * ⚠️ FÜR DIE PROBE übersteuerbar: `NORNS_RETTUNG_WURZELN` (durch `:` bzw.
 * unter Windows `;` getrennte Ordner) macht aus jedem Ordner ein „Laufwerk".
 * Nur so lässt sich der ganze Weg ohne echten Stick messen.
 */
export async function listeLaufwerke(): Promise<Laufwerk[]> {
  const uebersteuert = process.env['NORNS_RETTUNG_WURZELN'];
  if (uebersteuert) {
    const trenner = process.platform === 'win32' ? ';' : ':';
    const raus: Laufwerk[] = [];
    for (const wurzel of uebersteuert.split(trenner).filter(Boolean)) {
      try {
        if ((await stat(wurzel)).isDirectory()) {
          raus.push({ pfad: wurzel, name: wurzel.split(/[\\/]/).filter(Boolean).pop() ?? wurzel });
        }
      } catch {
        // Ein fehlender Ordner ist kein Laufwerk — still weiter.
      }
    }
    return raus;
  }

  if (process.platform === 'darwin') {
    const wurzelGeraet = (await stat('/')).dev;
    const raus: Laufwerk[] = [];
    for (const name of await readdir('/Volumes').catch(() => [] as string[])) {
      const pfad = join('/Volumes', name);
      try {
        const s = await stat(pfad);
        if (s.isDirectory() && s.dev !== wurzelGeraet) raus.push({ pfad, name });
      } catch {
        // Auswerfen mitten im Lesen — dann ist es eben kein Laufwerk mehr.
      }
    }
    return raus;
  }

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk | Where-Object {$_.DriveType -eq 2} | Select-Object -ExpandProperty DeviceID"',
        { timeout: 8000, windowsHide: true },
      );
      return stdout
        .split(/\r?\n/)
        .map((z) => z.trim())
        .filter((z) => /^[A-Z]:$/.test(z))
        .map((z) => ({ pfad: `${z}\\`, name: z }));
    } catch {
      return [];
    }
  }

  // Linux
  const raus: Laufwerk[] = [];
  for (const basis of ['/media', '/run/media']) {
    for (const nutzer of await readdir(basis).catch(() => [] as string[])) {
      const ordner = join(basis, nutzer);
      for (const name of await readdir(ordner).catch(() => [] as string[])) {
        const pfad = join(ordner, name);
        try {
          if ((await stat(pfad)).isDirectory()) raus.push({ pfad, name });
        } catch {
          // fort ist fort
        }
      }
    }
  }
  return raus;
}

/**
 * Ist dieser Pfad WIRKLICH eines der eben gesehenen Laufwerke?
 *
 * ⚠️ Der Riegel gegen Pfad-Spiele: die Fläche schickt einen Laufwerkspfad
 * zurück, und ohne diese Prüfung wäre das ein Schreibrecht an beliebiger
 * Stelle der Platte. Es zählt NUR, was die eigene Liste eben enthielt.
 */
export async function istErlaubtesLaufwerk(pfad: string): Promise<boolean> {
  const laufwerke = await listeLaufwerke();
  return laufwerke.some((l) => l.pfad === pfad);
}

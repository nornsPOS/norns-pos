/**
 * Aufgaben-Vokabular — Fälligkeit lesen und bewerten.
 *
 * Der Server speichert `dueDate` entweder als reines Datum („2026-07-12") oder
 * als vollen Zeitstempel. Beides wird hier auf den LOKALEN Kalendertag gefaltet,
 * nie über `toISOString()` (das würde den Tag gegen UTC verschieben).
 *
 * Überfällig und heute-fällig entscheiden, ob eine Zeile eine Warnfarbe trägt.
 * Eine abgeschlossene oder stornierte Aufgabe ist nie überfällig. Framework-frei
 * und mit injizierbarem `now`, damit die Regel deterministisch testbar bleibt.
 */
import type { TaskRow, TaskStatus } from "@norns/api-client"

/** Die Aufgabe ist erledigt oder storniert und braucht keine Fristfarbe mehr. */
export function isTerminalStatus(status: TaskStatus): boolean {
  return status === "DONE" || status === "CANCELLED"
}

/** „2026-07-12" oder ein Zeitstempel als lokaler Mitternacht-Termin. */
function parseDueDateLocal(value: string): Date | null {
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnly) {
    const [, yyyy, mm, dd] = dateOnly
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 0, 0, 0, 0)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Der Zeitpunkt „jetzt" auf lokale Mitternacht gesetzt (injizierbar für Tests). */
function todayLocal(now: number): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Ob die Frist in der Vergangenheit liegt (lokale Mitternacht). Eine laufende,
 * überfällige Aufgabe wird mit einem Warnakzent gezeigt; eine terminale nie.
 */
export function isOverdue(task: TaskRow, now: number = Date.now()): boolean {
  if (!task.dueDate || isTerminalStatus(task.status)) return false
  const due = parseDueDateLocal(task.dueDate)
  if (!due) return false
  due.setHours(0, 0, 0, 0)
  return due.getTime() < todayLocal(now).getTime()
}

/** Ob die Frist heute liegt (lokales Tagesfenster). Terminale zählen nie. */
export function isDueToday(task: TaskRow, now: number = Date.now()): boolean {
  if (!task.dueDate || isTerminalStatus(task.status)) return false
  const due = parseDueDateLocal(task.dueDate)
  if (!due) return false
  const today = new Date(now)
  return (
    due.getFullYear() === today.getFullYear() &&
    due.getMonth() === today.getMonth() &&
    due.getDate() === today.getDate()
  )
}

/** Deutsches Datum einer Frist, oder null wenn undatiert/ungültig. */
export function formatDueDate(iso: string | null): string | null {
  if (!iso) return null
  const d = parseDueDateLocal(iso)
  if (!d) return null
  return d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })
}

/** Der Dringlichkeitsgrad einer Zeile, für Farbe und Sortierung. */
export type DueUrgency = "overdue" | "today" | "later" | "none"

export function dueUrgency(task: TaskRow, now: number = Date.now()): DueUrgency {
  if (isOverdue(task, now)) return "overdue"
  if (isDueToday(task, now)) return "today"
  return task.dueDate && !isTerminalStatus(task.status) ? "later" : "none"
}

/**
 * Vergleicht zwei Aufgaben für die Anzeige: überfällig zuerst, dann heute,
 * dann die übrigen datierten nach Frist, undatierte zuletzt. Bei Gleichstand
 * bleibt die Server-Reihenfolge erhalten (stabil über den Index).
 */
export function compareByDue(a: TaskRow, b: TaskRow, now: number = Date.now()): number {
  const rank: Record<DueUrgency, number> = { overdue: 0, today: 1, later: 2, none: 3 }
  const ra = rank[dueUrgency(a, now)]
  const rb = rank[dueUrgency(b, now)]
  if (ra !== rb) return ra - rb
  // Innerhalb „später": die frühere Frist zuerst.
  if (a.dueDate && b.dueDate) {
    const da = parseDueDateLocal(a.dueDate)?.getTime() ?? 0
    const db = parseDueDateLocal(b.dueDate)?.getTime() ?? 0
    if (da !== db) return da - db
  }
  return 0
}

import { describe, expect, it } from "vitest"

import { compareByDue, dueUrgency, isDueToday, isOverdue } from "./task-vocab"

// A fixed "now": 2026-07-12 14:00 local.
const NOW = new Date(2026, 6, 12, 14, 0, 0).getTime()

const task = (dueDate: string | null, status = "OPEN") =>
  ({ id: "x", dueDate, status }) as never

describe("isOverdue", () => {
  it("marks a past due date on a live task", () => {
    expect(isOverdue(task("2026-07-11"), NOW)).toBe(true)
  })
  it("does not mark today", () => {
    expect(isOverdue(task("2026-07-12"), NOW)).toBe(false)
  })
  it("does not mark a future date", () => {
    expect(isOverdue(task("2026-07-13"), NOW)).toBe(false)
  })
  it("never marks a terminal task, even if past due", () => {
    expect(isOverdue(task("2026-07-01", "DONE"), NOW)).toBe(false)
    expect(isOverdue(task("2026-07-01", "CANCELLED"), NOW)).toBe(false)
  })
  it("is false when undated", () => {
    expect(isOverdue(task(null), NOW)).toBe(false)
  })
})

describe("isDueToday", () => {
  it("matches the local calendar day, not UTC", () => {
    expect(isDueToday(task("2026-07-12"), NOW)).toBe(true)
    expect(isDueToday(task("2026-07-11"), NOW)).toBe(false)
  })
})

describe("dueUrgency + compareByDue", () => {
  it("ranks overdue before today before later before none", () => {
    expect(dueUrgency(task("2026-07-01"), NOW)).toBe("overdue")
    expect(dueUrgency(task("2026-07-12"), NOW)).toBe("today")
    expect(dueUrgency(task("2026-08-01"), NOW)).toBe("later")
    expect(dueUrgency(task(null), NOW)).toBe("none")
  })

  it("sorts overdue first, undated last, earlier deadline first among later", () => {
    const rows = [
      task(null),
      task("2026-08-10"),
      task("2026-07-01"),
      task("2026-08-02"),
      task("2026-07-12"),
    ]
    const order = [...rows].sort((a, b) => compareByDue(a, b, NOW)).map((t) => t.dueDate)
    expect(order).toEqual(["2026-07-01", "2026-07-12", "2026-08-02", "2026-08-10", null])
  })
})

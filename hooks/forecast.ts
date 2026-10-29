// When a usage window runs out at the pace it is being used. Pure: the band
// keeps a short trail of readings per window and asks this for a time.

import type { Sample } from '../types'

/** How far back the pace is read: long enough to smooth a burst, short enough to follow a change. */
export const LOOKBACK_MS = 60 * 60 * 1000
/** Under this much history there is no pace to speak of. */
export const MIN_SPAN_MS = 10 * 60 * 1000
const MAX_SAMPLES = 120

/**
 * The trail with a new reading on the end. A reading lower than the last means
 * the window reset, and the trail starts over from it.
 */
export const addSample = (trail: readonly Sample[], at: number, pct: number): Sample[] => {
  const last = trail[trail.length - 1]
  if (last && pct < last.pct - 0.5) return [{ at, pct }]
  if (last && last.pct === pct && at - last.at < 60_000) return [...trail]
  // Keep one reading older than the lookback, so a slow pace still has its start.
  const from = at - LOOKBACK_MS
  const kept = trail.filter((s, i) => s.at >= from || (trail[i + 1]?.at ?? -Infinity) >= from)
  return [...kept, { at, pct }].slice(-MAX_SAMPLES)
}

/** The 5-hour window's length: how often its limit lifts. */
export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000

/**
 * The trail's pace in points a millisecond and its last reading, or null when
 * it isn't climbing, there isn't enough history, or the readings are an hour
 * stale (quota only burns while you work).
 */
export const paceOf = (trail: readonly Sample[], now: number): { rate: number; pct: number } | null => {
  const last = trail[trail.length - 1]
  const first = last && (trail.find(s => s.at >= last.at - LOOKBACK_MS) ?? trail[0])
  if (!last || !first) return null
  const span = last.at - first.at
  const rise = last.pct - first.pct
  if (span < MIN_SPAN_MS || rise <= 0 || now - last.at > LOOKBACK_MS) return null
  return { rate: rise / span, pct: last.pct }
}

const resetIn = (resetsAt: string | undefined, now: number): number => (resetsAt ? Date.parse(resetsAt) - now : NaN)

/**
 * Milliseconds until the window is used up at the trail's pace, or null when
 * there is no pace or it resets first.
 */
export const runsOutIn = (trail: readonly Sample[], now: number, resetsAt?: string): number | null => {
  const p = paceOf(trail, now)
  if (!p) return null
  const eta = Math.max(0, 100 - p.pct) / p.rate
  const reset = resetIn(resetsAt, now)
  return !Number.isNaN(reset) && eta >= reset ? null : eta
}

/**
 * The weekly window's run-out, held back by the 5-hour one: at the pace you
 * work you burn both, and when the 5-hour window is used up you wait for it to
 * reset before the weekly one moves again. Steps cycle by cycle, from the
 * 5-hour window as it stands now, until the week runs dry or resets first.
 * Without a 5-hour pace there is nothing holding it back: the plain run-out.
 */
export const weekRunsOutIn = (
  week: readonly Sample[],
  now: number,
  weekResetsAt: string | undefined,
  five: readonly Sample[],
  fiveResetsAt: string | undefined,
): number | null => {
  const w = paceOf(week, now)
  const f = paceOf(five, now)
  if (!w) return null
  if (!f) return runsOutIn(week, now, weekResetsAt)
  const weekReset = resetIn(weekResetsAt, now)
  const horizon = Number.isNaN(weekReset) ? 8 * 24 * 60 * 60 * 1000 : weekReset
  const fiveReset = resetIn(fiveResetsAt, now)
  let t = 0
  let weekLeft = Math.max(0, 100 - w.pct)
  // This cycle: what the 5-hour window has left, until it resets.
  let cycle = Number.isNaN(fiveReset) || fiveReset <= 0 ? FIVE_HOURS_MS : fiveReset
  let fiveLeft = Math.max(0, 100 - f.pct)
  while (t < horizon) {
    const working = Math.min(cycle, fiveLeft / f.rate)
    if (weekLeft <= w.rate * working) {
      const eta = t + weekLeft / w.rate
      return eta >= horizon ? null : eta
    }
    weekLeft -= w.rate * working
    t += cycle
    // Every later cycle starts with a fresh 5-hour window.
    cycle = FIVE_HOURS_MS
    fiveLeft = 100
  }
  return null
}

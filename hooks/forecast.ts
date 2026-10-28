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

/**
 * Milliseconds until the window is used up at the trail's pace, or null when
 * it isn't climbing, there isn't enough history, or it resets first.
 */
export const runsOutIn = (trail: readonly Sample[], now: number, resetsAt?: string): number | null => {
  const last = trail[trail.length - 1]
  const first = last && (trail.find(s => s.at >= last.at - LOOKBACK_MS) ?? trail[0])
  if (!last || !first) return null
  const span = last.at - first.at
  const rise = last.pct - first.pct
  if (span < MIN_SPAN_MS || rise <= 0) return null
  // Quota only burns while you work: the pace runs from the last reading, and
  // readings gone an hour stale say nothing about now.
  if (now - last.at > LOOKBACK_MS) return null
  const eta = (Math.max(0, 100 - last.pct) / rise) * span
  const reset = resetsAt ? Date.parse(resetsAt) - now : NaN
  if (!Number.isNaN(reset) && eta >= reset) return null
  return eta
}

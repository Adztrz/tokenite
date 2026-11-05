// Keep-warm and the cold guard's decisions. Pure: the band holds the state, runs
// the pings and draws; this says when a ping is due, what one cost, whether it
// found the cache warm, and when holding the cache has stopped being worth it.

import type { Keep, Window } from '../types'
import { coldCost, warmCost } from './cache-art'
import type { Model } from './cache-art'

/** A ping goes out after this long idle, ten minutes before the hour-long cache lapses. */
export const PING_AFTER_MS = 50 * 60 * 1000
export const DEFAULT_WINDOW_MS = 6 * 60 * 60 * 1000
export const MAX_WINDOW_MS = 24 * 60 * 60 * 1000
const MIN_WINDOW_MS = 60 * 1000
/** A busy API is tried again after 1, 2 and 4 minutes, while a ping can still land in time. */
export const RETRY_MS = 60 * 1000
export const MAX_RETRIES = 3
/** Stop holding once a window has this little left, the same line as the band's LOW. */
const LOW_LEFT = 15
/** Stop holding when the week is on pace to run dry within this long. */
const WEEK_SOON_MS = 6 * 60 * 60 * 1000
/** The guard leaves small chats alone: a rewrite under this is not worth a second send. */
export const GUARD_MIN_TOKENS = 50_000

/** The usage a request reports. */
export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** A window such as 90m, 6h or 2h30m in milliseconds, or null when it isn't one or is out of range. */
export const parseWindow = (text: string): number | null => {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(text)
  if (!m || (!m[1] && !m[2])) return null
  const ms = (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60_000
  return ms >= MIN_WINDOW_MS && ms <= MAX_WINDOW_MS ? ms : null
}

/** A warm read takes the prefix and writes only its own message; a tenth or more written means the prefix broke. */
export const readWarm = (u: Usage): boolean =>
  u.cache_read_input_tokens > 0 && u.cache_creation_input_tokens < 0.1 * u.cache_read_input_tokens

/** What a request cost in dollars. Output runs at five times input on every listed model. */
export const requestCost = (m: Model, u: Usage): number =>
  (u.input_tokens * m.input +
    u.cache_read_input_tokens * m.read +
    u.cache_creation_input_tokens * m.input * 2 +
    u.output_tokens * m.input * 5) /
  1e6

/** A fresh window over a cache last touched at `lastAt`. */
export const newKeep = (deadline: number, lastAt: number): Keep => ({
  deadline,
  breakFrom: lastAt,
  breakUsd: 0,
  breakPings: 0,
  pings: 0,
  pingUsd: 0,
  last: null,
  retries: 0,
  retryAt: 0,
  waiting: false,
  stopped: null,
})

/** When the next ping is due, for the band's countdown and the timer. */
export const nextPingAt = (k: Keep, lastAt: number): number => Math.max(lastAt + PING_AFTER_MS, k.retryAt)

/** Why not to spend another ping because of the limits, or null when there's room. */
export const limitReason = (list: readonly Window[], weekOutMs: number | null): string | null => {
  for (const w of list) {
    if (100 - w.percentUsed < LOW_LEFT) return `${w.kind === 'five_hour' ? '5-hour' : w.kind === 'seven_day' ? '7-day' : w.kind} usage is low`
  }
  return weekOutMs !== null && weekOutMs < WEEK_SOON_MS ? 'the 7-day window is on pace to run out soon' : null
}

/** Why another ping isn't worth it: this break's pings would cost as much as the rewrite they save. */
export const brokeEven = (k: Keep, m: Model, tokens: number): boolean =>
  k.breakUsd + warmCost(m, tokens) >= coldCost(m, tokens)

/** What one kept break saved: the rewrite avoided, less the read the return paid anyway and the pings. */
export const savedBy = (m: Model, tokens: number, pingUsd: number): number =>
  Math.max(0, coldCost(m, tokens) - warmCost(m, tokens) - pingUsd)

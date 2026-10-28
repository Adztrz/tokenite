// What today has cost across sessions. Pure: the band keeps one ledger in the
// plugin's store and folds each session's /cost total into it.

import type { Ledger } from '../types'

/** The local calendar day of a clock time, as YYYY-MM-DD. */
export const dayOf = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The ledger after a session reports its running total. A session's first
 * report sets where it starts counting (a resumed session's earlier spend
 * belongs to earlier days); every later one adds what grew. A new day starts
 * the total over, each session counting on from where it stands.
 */
export const tally = (ledger: Ledger | null, day: string, session: string, usd: number, baseline = false): Ledger => {
  const seen = ledger && ledger.day === day ? ledger.seen : Object.fromEntries(Object.entries(ledger?.seen ?? {}).filter(([k]) => k === session))
  const total = ledger && ledger.day === day ? ledger.usd : 0
  const before = seen[session]
  const grew = before === undefined || baseline ? 0 : Math.max(0, usd - before)
  return { day, usd: total + grew, seen: { ...seen, [session]: usd } }
}

/** One usage window: which one, how much is used (0 to 100), when it resets. */
export type Window = { kind: string; percentUsed: number; resetsAt?: string }

/**
 * The prompt cache as the band last saw it: when the main thread last sent a
 * request (clock milliseconds), how much context the next request re-sends,
 * the model's context window, and the model.
 */
export type CacheFacts = { lastAt: number; tokens: number; window: number; model: string | null }

/** Whether the cache card is open, remembered only for the state it was set in. */
export type Fold = { mode: 'warm' | 'cold'; open: boolean }

/** One reading of a window: when (clock milliseconds) and how much was used. */
export type Sample = { at: number; pct: number }

/** Each window's recent readings, by kind, for the run-out forecast. */
export type Trails = Record<string, Sample[]>

/**
 * Today's spend across sessions, kept in the plugin's store: the day
 * (YYYY-MM-DD), the dollars counted on it, and each session's last /cost total.
 */
export type Ledger = { day: string; usd: number; seen: Record<string, number> }

/** What the band shows of spend: this session's /cost total and today's. */
export type Spend = { session: number; today: number }

declare module 'claude-code' {
  interface PluginState {
    'tokenite': {
      windows: Window[]
      cache: CacheFacts | null
      fold: Fold | null
      trails: Trails
      warned: number
      spend: Spend | null
    }
  }
}

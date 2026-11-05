import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheFacts, Fold, Keep, Ledger, Spend, Trails, Window } from '../types'
import {
  ALERT, BG, BODY, PRIMARY, EMPTY, HUE, INK, MODELS, MUTED, MARK_SIZE, TEXT, TTL_MIN, TTL_MS, WORD,
  bandPx, cardKindOf, cardSvg, chipSvg, coldCost, costOf, familyOf, fmtIdle, kindOf, mineModel, markSvg, usd, warmCost,
} from './cache-art'
import type { CacheView } from './cache-art'
import { addSample, runsOutIn, weekRunsOutIn } from './forecast'
import {
  DEFAULT_WINDOW_MS, GUARD_MIN_TOKENS, MAX_RETRIES, RETRY_MS, brokeEven, limitReason, newKeep, nextPingAt,
  parseWindow, readWarm, requestCost, savedBy,
} from './keepwarm'
import type { Usage } from './keepwarm'
import { dayOf, tally } from './spend'

// A band above the prompt in Claude's palette: ivory and grey text,
// dot-matrix bars. Shows how much of each usage window is LEFT, 7-day first, then
// 5-hour; 7D is orange, 5H is grey; a window under 15% adds a bold LOW.
//
// After the first reply it also shows the prompt cache: WARM (orange, the mark bobbing)
// for an hour after the last request, then COLD (blue, the mark frozen) with what the
// next message costs to re-cache. Hide / Show folds the card; warm starts folded,
// cold starts open, and a choice holds until the cache flips. Zero token cost:
// it reads the engine's own figures and draws.
//
// What tokenite adds: each window says when it runs out at the pace it is being
// used, when that comes before its reset; the crystal fills with the 5-hour window
// left; a toast warns five minutes before the cache goes cold; and the card counts
// what this session and today have cost.
//
// /keepwarm holds the cache through a break with a small ping every 50 idle
// minutes, for a window you choose. It stops on a ping that finds the cache gone,
// on low limits, and once its pings would cost as much as the rewrite they save.
// /coldguard (off by default) holds a cold message once, so its price is a choice.

const CELLS = 10
const LOW_AT = 15
const TIGHT_CELLS = 6
/** On the folded one-liner, beside the cache badge, the bars give up four dots so it all fits on one line. */
const SHARED_CELLS = 6
/** On the one-liner above the open card, with only the button beside it. */
const OPEN_CELLS = 8
/** How often the band redraws, so the countdown and the warm-to-cold flip stay current. */
const TICK_MS = 30_000
/** How long before the cache goes cold the toast warns. */
const WARN_MS = 5 * 60 * 1000

const windows = atom({ plugin: 'tokenite', key: 'windows' } as const, [] as Window[])
const cache = atom({ plugin: 'tokenite', key: 'cache' } as const, null as CacheFacts | null)
const fold = atom({ plugin: 'tokenite', key: 'fold' } as const, null as Fold | null)
const trails = atom({ plugin: 'tokenite', key: 'trails' } as const, {} as Trails)
const warned = atom({ plugin: 'tokenite', key: 'warned' } as const, 0)
const spend = atom({ plugin: 'tokenite', key: 'spend' } as const, null as Spend | null)

const keep = atom({ plugin: 'tokenite', key: 'keep' } as const, null as Keep | null)
const saved = atom({ plugin: 'tokenite', key: 'saved' } as const, 0)

/** This session in the spend ledger: when it began, which a resume keeps. */
let sessionKey = ''
/** One ping out at a time. */
let pinging = false
/** The cold guard: off until /coldguard on, remembered across sessions. */
let guardOn = false
/** The lastAt of the cold send the guard already held once; the resend goes through. */
let guardHeld = 0
/** A return from a break the pings held, to be scored once its turn says the cache was warm. */
let pendingSave: { tokens: number; model: string | null; pingUsd: number } | null = null
/** The one fixed thing a ping ever says. */
const PING_PROMPT = 'Reply with the single word: warm'
/** Prompts nobody typed can't be sent again, so the guard never holds them. */
const UNATTENDED = new Set(['plugin', 'task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'coordinator', 'observer', 'observer-activity'])

const NAMES: Record<string, string> = { seven_day: '7D', five_hour: '5H', spend_limit: 'SPEND' }
const ORDER: Record<string, number> = { seven_day: 0, five_hour: 1 }
const COLORS: Record<string, string> = { seven_day: PRIMARY, five_hour: BODY }

const clean = (list: readonly Window[]): Window[] =>
  list
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))

const dots = (left: number, cells: number): { on: string; off: string } => {
  const n = Math.max(0, Math.min(cells, Math.round((left / 100) * cells)))
  return { on: '●'.repeat(n), off: '·'.repeat(cells - n) }
}

const fmtDur = (ms: number): string => {
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

const fmtReset = (iso: string | undefined, now: number): string => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (Number.isNaN(ms)) return ''
  if (ms <= 0) return 'resetting'
  return fmtDur(ms)
}

/** What the cache drawings read, or null until a request and its context size are known. */
export const viewOf = (c: CacheFacts | null, now: number): CacheView | null => {
  if (!c || c.lastAt <= 0 || c.tokens <= 0) return null
  const idleMs = Math.max(0, now - c.lastAt)
  return {
    mode: idleMs >= TTL_MS ? 'cold' : 'warm',
    idle: fmtIdle(idleMs),
    idleMin: Math.floor(idleMs / 60000),
    tokens: c.tokens,
    window: c.window,
    mine: familyOf(c.model),
  }
}

const pull = async ($: EngineInterface): Promise<void> => {
  const u = await $.session.usage()
  await remember($, u.rateLimits)
}

/** A fresh reading onto the band, and into the store so the next session opens with it. */
const remember = async ($: EngineInterface, list: readonly Window[]): Promise<void> => {
  if (list.length === 0) return
  const next = clean(list)
  await update($, windows, () => next)
  await $.store.set('windows', next)
  await record($, list)
}

/**
 * The last session's reading, until this one has its own: a window whose reset
 * has passed since then has started over, so it shows full with no reset time.
 */
const recall = async ($: EngineInterface): Promise<void> => {
  const saved = (await $.store.get('windows')) as Window[] | undefined
  if (!saved || saved.length === 0) return
  const now = await $.clock.now()
  const passed = (w: Window) => w.resetsAt !== undefined && Date.parse(w.resetsAt) <= now
  await update($, windows, () => saved.map(w => (passed(w) ? { kind: w.kind, percentUsed: 0 } : w)))
}

/** Each window's reading onto its trail, kept in the store so the next session starts with the pace. */
const record = async ($: EngineInterface, list: readonly Window[]): Promise<void> => {
  if (list.length === 0) return
  const now = await $.clock.now()
  await update($, trails, t => {
    const next: Trails = { ...t }
    for (const w of list) next[w.kind] = addSample(t[w.kind] ?? [], now, w.percentUsed)
    return next
  })
  await $.store.set('trails', await read($, trails))
}

/** A session's /cost total into today's ledger; `baseline` only marks where it starts counting. */
const count = async ($: EngineInterface, usdNow: number, baseline = false): Promise<void> => {
  if (!sessionKey) return
  const ledger = (await $.store.get('ledger')) as Ledger | undefined
  const next = tally(ledger ?? null, dayOf(await $.clock.now()), sessionKey, usdNow, baseline)
  await $.store.set('ledger', next)
  await update($, spend, () => ({ session: usdNow, today: next.usd }))
}

/** Once per warm spell, a toast five minutes before the cache goes cold. */
const warn = async ($: EngineInterface): Promise<void> => {
  const c = await read($, cache)
  if (!c || c.lastAt <= 0 || c.tokens <= 0) return
  const left = TTL_MS - ((await $.clock.now()) - c.lastAt)
  if (left <= 0 || left > WARN_MS || (await read($, warned)) === c.lastAt) return
  await update($, warned, () => c.lastAt)
  const k = await read($, keep)
  if (k && !k.stopped) return // the pings have it
  const m = MODELS.find(x => x.id === familyOf(c.model))
  const mins = Math.max(1, Math.round(left / 60000))
  $.ui.toast(
    m
      ? `Cache goes cold in ${mins}m. Send now and the next message costs ${usd(warmCost(m, c.tokens))}, not ${usd(coldCost(m, c.tokens))}, or /keepwarm to hold it.`
      : `Cache goes cold in ${mins}m. Send now to keep it warm, or /keepwarm to hold it.`,
    { timeoutMs: 15_000 },
  )
}

/** Starts or stretches a window. Its deadline is kept so a restart can pick it up. */
const arm = async ($: EngineInterface, ms: number): Promise<void> => {
  const now = await $.clock.now()
  const c = await read($, cache)
  // A window already running keeps its count; only its end moves.
  await update($, keep, k =>
    k ? { ...k, deadline: now + ms, stopped: null, retries: 0, retryAt: 0 } : newKeep(now + ms, c?.lastAt ?? now),
  )
  await $.store.set(`keep:${sessionKey}`, now + ms)
}

/** Ends pinging, keeping the record so this break can still be scored; says why, once. */
const halt = async ($: EngineInterface, reason: string): Promise<void> => {
  await update($, keep, k => (k ? { ...k, stopped: reason } : k))
  await $.store.delete(`keep:${sessionKey}`)
  $.ui.toast(`Keep-warm stopped: ${reason}.`, { timeoutMs: 15_000 })
}

const disarm = async ($: EngineInterface): Promise<void> => {
  await update($, keep, () => null)
  await $.store.delete(`keep:${sessionKey}`)
}

/** Each tick: send a ping when one is due and still worth sending. */
const tend = async ($: EngineInterface): Promise<void> => {
  const k = await read($, keep)
  if (!k || k.stopped || pinging) return
  const now = await $.clock.now()
  if (now >= k.deadline) return halt($, 'the window ended')
  const c = await read($, cache)
  // Nothing warm to hold: cold after a sleep or a restart, or cleared. The next message warms it.
  if (!c || c.lastAt <= 0 || c.tokens <= 0 || now - c.lastAt >= TTL_MS || k.waiting) return
  if (now < nextPingAt(k, c.lastAt)) return
  const list = await read($, windows)
  const tracks = await read($, trails)
  const five = list.find(w => w.kind === 'five_hour')
  const week = list.find(w => w.kind === 'seven_day')
  const weekOut = week ? weekRunsOutIn(tracks.seven_day ?? [], now, week.resetsAt, tracks.five_hour ?? [], five?.resetsAt) : null
  const limit = limitReason(list, weekOut)
  if (limit) return halt($, limit)
  const m = MODELS.find(x => x.id === familyOf(c.model))
  if (m && brokeEven(k, m, c.tokens)) return halt($, 'more pings would cost as much as the rewrite they save')

  pinging = true
  const sent = await $.model.fork({ prompt: PING_PROMPT }).then(reply => ({ reply }), (err: unknown) => ({ err }))
  pinging = false
  const at = await $.clock.now()
  const fresh = await read($, cache)
  const current = await read($, keep)
  // /keepwarm off, or a real request that moved the clock while this was out: it answers nothing now.
  if (!current || current.stopped) return
  const moved = fresh?.lastAt !== c.lastAt
  if ('err' in sent) return moved ? undefined : halt($, 'the ping failed')
  const reply = sent.reply
  if (!reply.isAnswered) {
    if (moved) return
    // A restarted process has nothing to fork until its first turn; the window waits for one.
    if (reply.reason === 'nothing-to-fork') {
      await update($, keep, x => (x ? { ...x, waiting: true } : x))
      return
    }
    const busy = reply.reason === 'api-error' && (reply.status === null || reply.status === 429 || reply.status >= 500)
    const wait = RETRY_MS * 2 ** current.retries
    if (busy && current.retries < MAX_RETRIES && at + wait < Math.min(current.deadline, c.lastAt + TTL_MS - RETRY_MS)) {
      await update($, keep, x => (x ? { ...x, retries: x.retries + 1, retryAt: at + wait } : x))
      return
    }
    return halt($, reply.reason === 'api-error' ? 'the API kept failing' : 'the ping got no answer')
  }
  const u: Usage = reply.usage
  const cost = m ? requestCost(m, u) : null
  await update($, keep, x =>
    x
      ? {
          ...x,
          pings: x.pings + 1,
          pingUsd: x.pingUsd + (cost ?? 0),
          breakPings: x.breakPings + 1,
          breakUsd: x.breakUsd + (cost ?? 0),
          last: { read: u.cache_read_input_tokens, write: u.cache_creation_input_tokens, usd: cost },
          retries: 0,
          retryAt: 0,
        }
      : x,
  )
  if (moved) return
  if (!readWarm(u)) return halt($, 'a ping found the cache already gone')
  // The ping refreshed the hour, so the band's clock runs from it.
  await update($, cache, x => (x ? { ...x, lastAt: at } : x))
}

const windowWords = (ms: number): string => fmtDur(ms)

const keepStatus = (k: Keep | null, lastAt: number, now: number, total: number): string => {
  const head = !k
    ? 'Keep-warm is off.'
    : k.stopped
      ? `Keep-warm stopped: ${k.stopped}.`
      : `Keep-warm is on for ${fmtDur(k.deadline - now)} more, next ping ${k.waiting ? 'after your next message' : `in ${fmtDur(Math.max(0, nextPingAt(k, lastAt) - now))}`}.`
  const pings = k && k.pings > 0 ? ` ${k.pings} ping${k.pings === 1 ? '' : 's'} so far, ~${usd(k.pingUsd)}.` : ''
  const last = k?.last
    ? ` Last read ${Math.round(k.last.read / 1000)}k, wrote ${Math.round(k.last.write / 1000)}k${k.last.usd === null ? '' : `, ~${usd(k.last.usd)}`}.`
    : ''
  return `${head}${pings}${last} Saved so far: ~${usd(total)}.`
}

/** Fresh context figures from the engine onto the cache facts, when it has them. */
const measure = async ($: EngineInterface, lastAt: number | null, model: string | null): Promise<void> => {
  const u = await $.session.usage()
  const m = model ?? (await $.session.model())
  await update($, cache, c => ({
    lastAt: lastAt ?? c?.lastAt ?? 0,
    tokens: u.context.tokens && u.context.tokens > 0 ? u.context.tokens : (c?.tokens ?? 0),
    window: u.context.window || c?.window || 0,
    model: m || c?.model || null,
  }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const stored = (await $.store.get('trails')) as Trails | undefined
    if (stored) await update($, trails, () => stored)
    await recall($)
    await pull($)
    const u = await $.session.usage()
    sessionKey = String(u.startedAt)
    await count($, u.cost?.usd ?? 0, true)
    guardOn = (await $.store.get('guard')) === true
    const total = await $.store.get('saved')
    if (typeof total === 'number') await update($, saved, () => total)
    // A window from before a restart carries on, once a turn gives it something to fork.
    const deadline = await $.store.get(`keep:${sessionKey}`)
    if (typeof deadline === 'number') {
      const now = await $.clock.now()
      if (deadline > now) {
        const had = await read($, keep)
        if (!had) await update($, keep, () => ({ ...newKeep(deadline, 0), waiting: true }))
      } else await $.store.delete(`keep:${sessionKey}`)
    }
    $.clock.every(TICK_MS, async () => {
      await warn($)
      await tend($)
      $.ui.invalidate('ui.render')
    })
    await $.command.register({
      name: 'keepwarm',
      description: 'Hold the prompt cache through a break: a window such as 90m (6h by default), off, or status',
      argumentHint: '[6h | off | status]',
      immediate: true,
    })
    await $.command.register({
      name: 'coldguard',
      description: 'Hold a message once when the cache is cold, so its rewrite price is a choice: on, off, or status',
      argumentHint: '[on | off | status]',
      immediate: true,
    })
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await remember($, e.rateLimits)
    }
    if (e.changed.includes('cost') && e.cost) await count($, e.cost.usd)
    if (e.changed.includes('context') && e.context.tokens && e.context.tokens > 0) {
      const tokens = e.context.tokens
      await update($, cache, c => (c ? { ...c, tokens, window: e.context.window || c.window } : c))
    }
    return next(e)
  })

  // A resumed or forked session knows how long it was away and how big it is.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.source === 'clear' || e.source === 'compact') {
      await update($, cache, () => null)
      await update($, fold, () => null)
      pendingSave = null
      // A cleared chat has nothing to hold. A compacted one does, once its next request caches it.
      if (e.source === 'clear') await disarm($)
      else await update($, keep, k => (k ? { ...k, breakUsd: 0, breakPings: 0 } : k))
    } else if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      const now = await $.clock.now()
      const lastAt = now - e.seconds_since_last_response * 1000
      const window = (await $.session.usage()).context.window
      const model = typeof e.model === 'string' ? e.model : await $.session.model()
      const tokens = typeof e.context_tokens === 'number' ? e.context_tokens : 0
      await update($, cache, () => ({ lastAt, tokens, window, model }))
    }
    return r
  }).catch(($, e, next) => next(e)) // a band that fails to seed never holds up the session

  // Each main-thread request reads or writes the cache, so its start resets the hour.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const now = await $.clock.now()
      const was = await read($, cache)
      const k = await read($, keep)
      // Back from a break the pings outlasted: the rewrite was avoided if this turn reads warm.
      if (k && k.breakPings > 0 && was && now - k.breakFrom >= TTL_MS) {
        pendingSave = { tokens: was.tokens, model: was.model, pingUsd: k.breakUsd }
      }
      await update($, cache, c => ({ lastAt: now, tokens: c?.tokens ?? 0, window: c?.window ?? 0, model: c?.model ?? null }))
      await update($, keep, x => (x ? { ...x, breakFrom: now, breakUsd: 0, breakPings: 0, waiting: false, retries: 0, retryAt: 0 } : x))
    }
    yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    const now = await $.clock.now()
    const c = await read($, cache)
    // turn.step stamps the exact request time; when no step of this turn did, the turn's end is the floor.
    const lastAt = !c || now - c.lastAt > e.durationMs ? now : c.lastAt
    await measure($, lastAt, e.usage?.model ?? null)
    const held = pendingSave
    pendingSave = null
    if (held && e.usage && readWarm(e.usage)) {
      const m = MODELS.find(x => x.id === familyOf(held.model))
      if (m) {
        const total = (await read($, saved)) + savedBy(m, held.tokens, held.pingUsd)
        await update($, saved, () => total)
        await $.store.set('saved', total)
      }
    }
    return r
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    const word = String(e.args ?? '').trim()
    const now = await $.clock.now()
    const c = await read($, cache)
    const warm = !!c && c.lastAt > 0 && c.tokens > 0 && now - c.lastAt < TTL_MS
    if (word === 'off') {
      await disarm($)
      return { text: 'Keep-warm is off.' }
    }
    if (word === 'status') return { text: keepStatus(await read($, keep), c?.lastAt ?? now, now, await read($, saved)) }
    const ms = word === '' ? DEFAULT_WINDOW_MS : parseWindow(word)
    if (ms === null) return { text: 'Use a window from 1m to 24h, such as 90m, 6h or 2h30m; or off, or status.' }
    await arm($, ms)
    return {
      text: warm
        ? `Keep-warm is on for ${windowWords(ms)}: a small ping every 50 idle minutes, each costing a cache read and a one-word reply. Claude Code has to stay open and the PC awake.`
        : `Keep-warm is on for ${windowWords(ms)}, but the cache is cold, so pings start after your next message.`,
    }
  })

  on('command.run', { command: 'coldguard' }, async ($, e) => {
    const word = String(e.args ?? '').trim()
    if (word === 'on' || word === 'off') {
      guardOn = word === 'on'
      await $.store.set('guard', guardOn)
    } else if (word !== '' && word !== 'status') return { text: 'Use /coldguard on, off, or status.' }
    return {
      text: guardOn
        ? 'Cold guard is on: a message to a cold cache of 50k tokens or more is held once with its price. Send it again to pay, or /clear to start fresh.'
        : 'Cold guard is off.',
    }
  })

  // The guard: a cold send is held once, with its price; the same send again goes through.
  on('prompt.submit', async ($, e, next) => {
    if (!guardOn || UNATTENDED.has(e.origin.kind) || typeof e.text !== 'string' || e.text.trimStart().startsWith('/')) return next(e)
    const c = await read($, cache)
    if (!c || c.lastAt <= 0 || c.tokens < GUARD_MIN_TOKENS || (await $.clock.now()) - c.lastAt < TTL_MS) return next(e)
    if (guardHeld === c.lastAt) {
      guardHeld = 0
      return next(e)
    }
    guardHeld = c.lastAt
    const m = MODELS.find(x => x.id === familyOf(c.model))
    const price = m ? `about ${usd(coldCost(m, c.tokens))}, not ${usd(warmCost(m, c.tokens))}` : 'much more than a warm message'
    return { drop: `The cache is cold, so this message rewrites ${Math.round(c.tokens / 1000)}k tokens: ${price}. Send it again to pay, or /clear to start fresh.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // Svg draws on desktop, mobile and VS Code; the terminal gets the text form.
    // Ask the surface, not the table: the terminal's table still lists Svg.
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
    const list = await read($, windows)
    const now = await $.clock.now()
    const tracks = await read($, trails)
    const spent = await read($, spend)
    // The crystal is a gauge: it stands as full as the 5-hour window has left.
    const five = list.find(w => w.kind === 'five_hour')
    const level = five ? Math.max(0, Math.min(1, (100 - five.percentUsed) / 100)) : 1
    const facts = await read($, cache)
    const base = viewOf(facts, now)
    const held = await read($, keep)
    const holding = held !== null && held.stopped === null
    const savedTotal = await read($, saved)
    const view: CacheView | null = base && {
      ...base,
      level,
      spend: spent ?? undefined,
      keep: holding || savedTotal > 0 ? { saved: savedTotal, pings: held?.pings ?? 0, pingUsd: held?.pingUsd ?? 0 } : undefined,
    }

    if (list.length === 0 && !view) {
      return (
        <Box backgroundColor={BG} paddingX={1}>
          <Text color={MUTED}>USAGE · waiting for the first reply</Text>
        </Box>
      )
    }

    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 100
    const kind = kindOf(columns)
    const isWide = kind === 'wide'
    const stored = await read($, fold)
    const opened = (v: CacheView) => Svg !== null && (stored && stored.mode === v.mode ? stored.open : v.mode === 'cold')
    // Once there is a cache, a wide band keeps its usage to one compact line, folded
    // or open: no label, shorter words. Folded, the bars also make room for the badge.
    const oneLine = isWide && view !== null
    const folded = oneLine && view !== null && !opened(view)
    const cells = kind === 'tight' ? TIGHT_CELLS : folded ? SHARED_CELLS : oneLine ? OPEN_CELLS : CELLS

    const parts = (w: Window) => {
      const left = Math.max(0, Math.round((100 - w.percentUsed) * 10) / 10)
      return {
        left,
        col: COLORS[w.kind] ?? TEXT,
        name: NAMES[w.kind] ?? w.kind.toUpperCase(),
        d: dots(left, cells),
        reset: fmtReset(w.resetsAt, now),
        // At this pace the window runs dry before it resets: say when, in the reset's place.
        // The week only moves while the 5-hour window has room, so its run-out waits out each 5-hour reset.
        out: (eta => (eta === null ? '' : fmtDur(eta)))(
          w.kind === 'seven_day'
            ? weekRunsOutIn(tracks[w.kind] ?? [], now, w.resetsAt, tracks.five_hour ?? [], five?.resetsAt)
            : runsOutIn(tracks[w.kind] ?? [], now, w.resetsAt),
        ),
      }
    }

    // Wide: every window on one row. Narrow: each window is a block of three
    // lines (name and dots, percent left, reset time) so nothing wraps or clips.
    const wide = (w: Window, i: number) => {
      const p = parts(w)
      return (
        <Box key={`w-${i}`} flexDirection="row" flexShrink={0} marginRight={2}>
          <Text color={MUTED} bold>{p.name} </Text>
          <Text color={p.col}>{p.d.on}</Text>
          <Text color={EMPTY}>{p.d.off}</Text>
          <Text color={p.col} bold> {p.left}%{oneLine ? '' : ' left'}</Text>
          {p.left < LOW_AT ? <Text color={ALERT} bold> LOW</Text> : null}
          {/* The run-out when the pace gets there first, and always the reset, ↻. */}
          {p.out ? <Text color={TEXT} bold> · out {oneLine ? '' : '~'}{p.out}</Text> : null}
          {p.reset ? <Text color={MUTED}> · ↻ {p.reset}</Text> : null}
        </Box>
      )
    }

    const stacked = (w: Window, i: number) => {
      const p = parts(w)
      return (
        <Box key={`w-${i}`} flexDirection="column" flexShrink={0} marginRight={3}>
          <Box flexDirection="row">
            <Text color={MUTED} bold>{p.name} </Text>
            <Text color={p.col}>{p.d.on}</Text>
            <Text color={EMPTY}>{p.d.off}</Text>
          </Box>
          <Box flexDirection="row">
            <Text color={p.col} bold>{p.left}% left</Text>
            {p.left < LOW_AT ? <Text color={ALERT} bold> LOW</Text> : null}
          </Box>
          {p.reset ? <Text color={MUTED}>resets {p.reset}</Text> : null}
          {p.out ? <Text color={TEXT} bold>out in ~{p.out}</Text> : null}
        </Box>
      )
    }

    const label = oneLine ? null : (
      <Box key="label" flexShrink={0} marginRight={isWide ? 2 : 3}>
        <Text color={TEXT} bold>USAGE</Text>
      </Box>
    )
    const usage = list.length > 0
      ? list.map(isWide ? wide : stacked)
      : [<Box key="wait" flexShrink={0} marginRight={3}><Text color={MUTED}>waiting for the first reply</Text></Box>]

    // Before the first reply there is no cache to show: today's band, as it was.
    if (!view) {
      return (
        <Box flexDirection="row" backgroundColor={BG} paddingX={1}>
          {label}
          {usage}
        </Box>
      )
    }

    const mode = view.mode
    const cold = mode === 'cold'
    const hue = HUE[mode]
    const mine = mineModel(view)
    // Folding needs the card, and the card is a drawing: the terminal stays folded.
    const open = opened(view)
    const toggle = () =>
      update($, fold, f => ({ mode, open: !(f && f.mode === mode ? f.open : mode === 'cold') }))

    // Holding a warm cache, the badge says so and counts to the next ping.
    const holdingWarm = holding && !cold
    const chipWord = holdingWarm ? 'HOLD' : WORD[mode]
    const pingIn = holdingWarm && held ? fmtDur(Math.max(0, nextPingAt(held, facts?.lastAt ?? now) - now)) : ''
    const badge = Svg
      ? [
          <Svg key="mark" source={markSvg(mode, level)} alt={`Crystal, ${Math.round(level * 100)}% full, ${cold ? 'frozen' : 'bobbing'}`} width={MARK_SIZE} height={MARK_SIZE} isInteractive />,
          <Text key="gap"> </Text>,
          (() => {
            const c = chipSvg(mode, chipWord)
            return <Svg key="chip" source={c.source} alt={chipWord} width={c.w} height={c.h} />
          })(),
        ]
      : [<Text key="chip" backgroundColor={hue} color={INK} bold>{` ${chipWord} `}</Text>]

    const summary = cold
      ? [
          <Text key="idle" color={hue} bold>{` ${view.idle}`}</Text>,
          mine ? <Text key="dot" color={MUTED}> · </Text> : null,
          mine ? <Text key="cost" color={TEXT} bold>{usd(costOf(mine, mode, view.tokens))}</Text> : null,
        ]
      : holdingWarm
        ? [<Text key="left" color={hue} bold>{` ping ${held?.waiting ? 'next turn' : pingIn}`}</Text>]
        : [<Text key="left" color={hue} bold>{` ${Math.max(0, TTL_MIN - view.idleMin)}m${oneLine ? '' : ' left'}`}</Text>]
    // The card counts spend; the terminal, which has no card, says today's on the row.
    if (!Svg && spent) summary.push(<Text key="spent" color={MUTED}>{` · today ~${usd(spent.today)}`}</Text>)

    // One press to start or stop holding: always on the open card; folded, only to
    // start one when the hour is nearly up, since the one-line row has little room.
    const toggleKeep = async () => {
      if ((await read($, keep))?.stopped === null) await disarm($)
      else await arm($, DEFAULT_WINDOW_MS)
    }
    const offerKeep = !cold && (open || (!holding && TTL_MIN - view.idleMin <= 10))
    const button = Svg ? (
      <Box key="fold" flexDirection="row" flexShrink={0} alignItems="flex-start">
        {offerKeep ? (
          <Box marginRight={1}>
            <Button key="keep-warm" label={holding ? 'Stop holding' : 'Keep warm'} onPress={toggleKeep} />
          </Box>
        ) : null}
        <Button key="cache-fold" label={open ? 'Hide' : 'Show'} onPress={toggle} />
      </Box>
    ) : null
    const grow = <Box key="grow" flexGrow={1} />

    let rows
    if (kind === 'wide') {
      // The groups (7D, 5H and, folded, the cache) spread evenly across the band
      // rather than bunching at the left; the button keeps the right edge. The app
      // draws text wider than the cells it lays out, so they may wrap, never clip.
      rows = (
        <Box key="row" flexDirection="row" paddingX={1} alignItems="center">
          {label}
          <Box key="items" flexDirection="row" flexWrap="wrap" flexGrow={1} flexShrink={1} minWidth={0} alignItems="center" justifyContent="space-between">
            {usage}
            {open ? null : (
              <Box key="inline" flexDirection="row" flexShrink={0} marginRight={2} alignItems="center">
                {badge}
                {summary}
              </Box>
            )}
          </Box>
          {button}
        </Box>
      )
    } else if (kind === 'stacked') {
      // The cache becomes a third stacked block, the same shape as 7D and 5H.
      rows = (
        <Box key="row" flexDirection="row" paddingX={1}>
          <Box key="items" flexDirection="row" flexWrap="wrap" flexGrow={1} flexShrink={1} minWidth={0}>
            {label}
            {usage}
            {open ? null : (
              <Box key="block" flexDirection="column" flexShrink={0} marginRight={2}>
                <Box flexDirection="row" alignItems="center">{badge}</Box>
                <Text color={hue} bold>{cold ? `${view.idle} idle` : `${Math.max(0, TTL_MIN - view.idleMin)}m left`}</Text>
                {mine ? (
                  <Box flexDirection="row">
                    <Text color={TEXT} bold>{usd(costOf(mine, mode, view.tokens))}</Text>
                    <Text color={MUTED}> next</Text>
                  </Box>
                ) : null}
              </Box>
            )}
          </Box>
          {button}
        </Box>
      )
    } else {
      // Narrow: the cache gets its own row under the usage blocks.
      rows = [
        <Box key="row" flexDirection="row" paddingX={1}>
          {label}
          {usage}
        </Box>,
        <Box key="cache" flexDirection="row" paddingX={1} alignItems="center">
          {badge}
          {summary}
          {grow}
          {button}
        </Box>,
      ]
    }

    let card = null
    if (open && Svg) {
      const W = bandPx(columns)
      const c = cardSvg(view, cardKindOf(W), W)
      card = (
        <Box key="card" flexDirection="row">
          <Svg source={c.source} alt={c.alt} width={c.w} height={c.h} isInteractive={kind !== 'tight'} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" backgroundColor={BG}>
        {rows}
        {card}
      </Box>
    )
  })
}

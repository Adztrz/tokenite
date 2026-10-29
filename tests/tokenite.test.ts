import { expect, mock, test } from 'claude-code/testing'

import { addSample, runsOutIn } from '../hooks/forecast'
import { dayOf, tally } from '../hooks/spend'

const NOW = Date.parse('2098-12-31T22:00:00Z')
const MIN = 60_000
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const

test('the forecast reads the pace and says when a window runs dry, unless it resets first', async () => {
  let trail = addSample([], NOW - 30 * MIN, 50)
  trail = addSample(trail, NOW, 60)
  // 10 points in 30 minutes, 40 points left: two hours.
  expect(runsOutIn(trail, NOW, '2099-01-01T03:00:00Z')).toBe(120 * MIN)
  // The window resets in an hour, before it would run dry.
  expect(runsOutIn(trail, NOW, '2098-12-31T23:00:00Z')).toBeNull()
  // A lower reading is a reset: the trail starts over, with no pace yet.
  expect(addSample(trail, NOW + MIN, 2)).toEqual([{ at: NOW + MIN, pct: 2 }])
  expect(runsOutIn(addSample(trail, NOW + MIN, 2), NOW + MIN)).toBeNull()
  // Readings an hour stale say nothing about now.
  expect(runsOutIn(trail, NOW + 61 * MIN)).toBeNull()
})

test('the ledger counts what each session adds today, and starts over on a new day', async () => {
  let l = tally(null, '2098-12-31', 'a', 2, true)
  expect(l.usd).toBe(0)
  l = tally(l, '2098-12-31', 'a', 3.5)
  l = tally(l, '2098-12-31', 'b', 0, true)
  l = tally(l, '2098-12-31', 'b', 1)
  expect(l.usd).toBe(2.5)
  // A new day: what a session reports from now on counts toward it, never what came before.
  l = tally(l, '2099-01-01', 'a', 4)
  expect(l.usd).toBe(0.5)
  expect(l.seen).toEqual({ a: 4 })
  expect(tally(l, '2099-01-01', 'a', 4.25).usd).toBe(0.75)
  expect(dayOf(new Date(2098, 11, 31, 23, 59).getTime())).toBe('2098-12-31')
})

test('a window on pace to run dry says when, in the place of its reset', async ($, on) => {
  const windows = [
    { kind: 'five_hour', percentUsed: 60, resetsAt: '2099-01-01T03:00:00Z' },
    { kind: 'seven_day', percentUsed: 10 },
  ]
  mock.store(on, { trails: { five_hour: [{ at: NOW - 30 * MIN, pct: 50 }] } })
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 1000000 }, rateLimits: windows } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'tokenite', surface, component: 'AbovePrompt', props: PROPS })
    expect(await band.find({ text: ' · out ~2h 0m' })).toBeDefined()
    await band.unmount()
  }
})

test('five minutes before the cache goes cold a toast says what sending now saves, once', async ($, on) => {
  const toasts: string[] = []
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 1000000 }, rateLimits: [] } }))
  on('classic.SessionStart', () => ({}))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  // 53 minutes idle: 7 left, not yet.
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 53 * 60, context_tokens: 500000, model: 'claude-opus-5-5' })
  await clock.advance(MIN)
  expect(toasts).toEqual([])
  await clock.advance(2 * MIN)
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('Cache goes cold in')
  expect(toasts[0]).toContain('$0.10, not $4.00')
  await clock.advance(3 * MIN)
  expect(toasts.length).toBe(1)
})

test('the card counts this session and today; the terminal says today on the row', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // A resumed session that had already cost $2 before today.
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 1000000 }, rateLimits: [], cost: { usd: 2 } } }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 2 * 3600, context_tokens: 500000, model: 'claude-opus-5-5' })
  await $.session.measure({ context: { window: 1000000 }, rateLimits: [], cost: { usd: 3.5 }, changed: ['cost'] })

  const band = await $.ui.mount({ plugin: 'tokenite', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const card = JSON.stringify(await band.find({ key: 'card' }))
  expect(card).toContain('SPENT THIS SESSION')
  expect(card).toContain('$3.50')
  expect(card).toContain('SPENT TODAY')
  expect(card).toContain('$1.50')
  await band.unmount()

  const row = await $.ui.mount({ plugin: 'tokenite', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await row.find({ text: ' · today ~$1.50' })).toBeDefined()
  await row.unmount()
})

test('a new session opens with the last reading, a window past its reset shown full', async ($, on) => {
  mock.store(on, {
    windows: [
      { kind: 'seven_day', percentUsed: 30, resetsAt: '2099-01-03T00:00:00Z' },
      { kind: 'five_hour', percentUsed: 80, resetsAt: '2098-12-31T21:00:00Z' },
    ],
  })
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // No reading yet in this session.
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 1000000 }, rateLimits: [] } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'tokenite', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: '70% left' })).toBeDefined()
  expect(await band.find({ text: '100% left' })).toBeDefined()
  expect(await band.find({ text: 'USAGE · waiting for the first reply' })).toBeUndefined()
  await band.unmount()
})

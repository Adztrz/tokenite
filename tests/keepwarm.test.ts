import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { MODELS } from '../hooks/cache-art'
import { brokeEven, newKeep, parseWindow, readWarm, savedBy } from '../hooks/keepwarm'

const NOW = Date.parse('2098-12-31T22:00:00Z')
const MIN = 60_000
const OPUS = MODELS.find(m => m.id === 'opus')!
const TOKENS = 500_000
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const
const WARM_PING = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: TOKENS, cache_creation_input_tokens: 100 }

type Reply =
  | { usage: typeof WARM_PING }
  | { fail: 'api-error'; status: number | null }
  | { fail: 'nothing-to-fork' }

const setup = (on: On, o: { replies?: Reply[]; rateLimits?: { kind: string; percentUsed: number; resetsAt?: string }[] } = {}) => {
  const toasts: string[] = []
  const forks: string[] = []
  const replies = o.replies ?? []
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 1, context: { window: 1000000 }, rateLimits: o.rateLimits ?? [] } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('classic.SessionStart', () => ({}))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('turn.step', async function* ($, e) {
    yield { kind: 'stop' as const, stopReason: 'end_turn' as const, usage: null }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('model.fork', ($, e) => {
    forks.push(String(e.prompt))
    const r = replies.shift() ?? { usage: WARM_PING }
    if ('usage' in r) return { value: { isAnswered: true as const, text: 'warm', usage: r.usage } }
    if (r.fail === 'nothing-to-fork') return { value: { isAnswered: false as const, reason: 'nothing-to-fork' as const } }
    return {
      value: { isAnswered: false as const, reason: 'api-error' as const, status: r.status, error: 'unknown' as never, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    }
  })
  return { toasts, forks, clock }
}

const run = (command: 'keepwarm' | 'coldguard', args: string) => ({
  command,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 80 },
})
const say = (text: string, kind: 'composer' | 'plugin' = 'composer') => ({ text, wait: false, origin: { kind } }) as never
const start = (idleMin: number) => ({ source: 'resume', seconds_since_last_response: idleMin * 60, context_tokens: TOKENS, model: 'claude-opus-5-5' }) as never

test('windows parse within range; a warm read and the money add up', async () => {
  expect(parseWindow('90m')).toBe(90 * MIN)
  expect(parseWindow('2h30m')).toBe(150 * MIN)
  expect(parseWindow('6h')).toBe(360 * MIN)
  expect(parseWindow('25h')).toBeNull()
  expect(parseWindow('soon')).toBeNull()
  expect(parseWindow('')).toBeNull()
  expect(readWarm(WARM_PING)).toBe(true)
  expect(readWarm({ ...WARM_PING, cache_read_input_tokens: 0 })).toBe(false)
  expect(readWarm({ ...WARM_PING, cache_creation_input_tokens: TOKENS / 2 })).toBe(false)
  // 500k on Opus: a rewrite is $4.00, a read $0.10.
  expect(Math.abs(savedBy(OPUS, TOKENS, 0.2) - 3.7) < 1e-9).toBe(true)
  expect(brokeEven({ ...newKeep(0, 0), breakUsd: 3.8 }, OPUS, TOKENS)).toBe(false)
  expect(brokeEven({ ...newKeep(0, 0), breakUsd: 3.95 }, OPUS, TOKENS)).toBe(true)
})

test('a ping goes out after 50 idle minutes and restarts the hour, only inside a window', async ($, on) => {
  const { forks, clock } = setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await $.classic.SessionStart(start(49))
  await clock.advance(3 * MIN)
  expect(forks.length).toBe(0) // no window, no pings

  await $.command.run(run('keepwarm', '6h'))
  await clock.advance(MIN)
  expect(forks).toEqual(['Reply with the single word: warm'])
  // One ping per idle stretch: the next is 50 minutes on, and the band still says warm past the old hour.
  await clock.advance(40 * MIN)
  expect(forks.length).toBe(1)
  await clock.advance(11 * MIN)
  expect(forks.length).toBe(2)
  const band = await $.ui.mount({ plugin: 'tokenite', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect((await band.findAll({ type: 'Svg' })).map(s => s.props.alt)).toContain('HOLD')
  await band.unmount()
  const status = await $.command.run(run('keepwarm', 'status'))
  expect(JSON.stringify(status)).toContain('2 pings so far')
  expect(JSON.stringify(status)).toContain('Last read 500k')
})

test('off stops it, and the window ending stops it', async ($, on) => {
  const { forks, clock, toasts } = setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await $.classic.SessionStart(start(49))
  await $.command.run(run('keepwarm', '30m'))
  await $.command.run(run('keepwarm', 'off'))
  await clock.advance(5 * MIN)
  expect(forks.length).toBe(0)

  await $.command.run(run('keepwarm', '1m'))
  await clock.advance(2 * MIN)
  expect(toasts.some(t => t.includes('the window ended'))).toBe(true)
})

test('a ping that finds the cache gone stops the window', async ($, on) => {
  const { forks, clock, toasts } = setup(on, { replies: [{ usage: { ...WARM_PING, cache_read_input_tokens: 0, cache_creation_input_tokens: TOKENS } }] })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await $.classic.SessionStart(start(49))
  await $.command.run(run('keepwarm', ''))
  await clock.advance(2 * MIN)
  expect(forks.length).toBe(1)
  expect(toasts.some(t => t.includes('the cache already gone'))).toBe(true)
  await clock.advance(55 * MIN)
  expect(forks.length).toBe(1)
})

test('low limits stop it before a ping is spent', async ($, on) => {
  const { forks, clock, toasts } = setup(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 90, resetsAt: '2099-01-01T01:00:00Z' }] })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await $.classic.SessionStart(start(49))
  await $.command.run(run('keepwarm', ''))
  await clock.advance(2 * MIN)
  expect(forks.length).toBe(0)
  expect(toasts.some(t => t.includes('5-hour usage is low'))).toBe(true)
})

test('a busy API is retried; nothing to fork waits for the next turn', async ($, on) => {
  const { forks, clock } = setup(on, { replies: [{ fail: 'api-error', status: 529 }, { fail: 'nothing-to-fork' }] })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await $.classic.SessionStart(start(49))
  await $.command.run(run('keepwarm', ''))
  await clock.advance(1.5 * MIN)
  expect(forks.length).toBe(1)
  await clock.advance(MIN)
  expect(forks.length).toBe(2)
  await clock.advance(5 * MIN)
  expect(forks.length).toBe(2) // waiting
  for await (const c of $.turn.step({ turnId: 'a', index: 0, model: 'claude-opus-5-5', messageCount: 2 })) void c
  await clock.advance(51 * MIN)
  expect(forks.length).toBe(3)
})

test('coming back warm after the hour counts as saved; coming back early does not', async ($, on) => {
  const { clock } = setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await $.classic.SessionStart(start(49))
  await $.command.run(run('keepwarm', ''))
  await clock.advance(2 * MIN) // pinged, 51 minutes into the break
  const usage = { ...WARM_PING, model: 'claude-opus-5-5' }
  const back = async (id: string) => {
    for await (const c of $.turn.step({ turnId: id, index: 0, model: 'claude-opus-5-5', messageCount: 2 })) void c
    await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: id, reason: 'answer', usage })
  }
  // Only 51 minutes: the cache would have held anyway.
  await back('early')
  expect(JSON.stringify(await $.command.run(run('keepwarm', 'status')))).toContain('Saved so far: ~$0.00')

  await clock.advance(70 * MIN) // pinged at 50, back at 70
  await back('late')
  expect(JSON.stringify(await $.command.run(run('keepwarm', 'status')))).toContain('Saved so far: ~$3.8')
  const band = await $.ui.mount({ plugin: 'tokenite', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await band.press({ key: 'cache-fold' })
  expect(JSON.stringify(await band.find({ key: 'card' }))).toContain('KEEP-WARM SAVED')
  await band.unmount()
})

test('the band button starts and stops holding', async ($, on) => {
  const { forks, clock } = setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await $.classic.SessionStart(start(40))
  const band = await $.ui.mount({ plugin: 'tokenite', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // Folded, it waits until the hour is nearly up; on the open card it's always there.
  expect(await band.find({ key: 'keep-warm' })).toBeUndefined()
  await band.press({ key: 'cache-fold' })
  expect((await band.find({ key: 'keep-warm' }))?.props.label).toBe('Keep warm')
  await band.press({ key: 'keep-warm' })
  expect((await band.find({ key: 'keep-warm' }))?.props.label).toBe('Stop holding')
  await band.press({ key: 'keep-warm' })
  await clock.advance(5 * MIN)
  expect(forks.length).toBe(0)
  await band.unmount()
})

test('the cold guard is off by default; on, it holds a cold send once with its price', async ($, on) => {
  setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await $.classic.SessionStart(start(120))
  expect(await $.prompt.submit(say('hi'))).toEqual({ text: 'hi' })

  await $.command.run(run('coldguard', 'on'))
  const held = JSON.stringify(await $.prompt.submit(say('hi')))
  expect(held).toContain('"drop"')
  expect(held).toContain('$4.00, not $0.10')
  // Sent again it goes through; slash commands and prompts nobody typed never wait.
  expect(await $.prompt.submit(say('hi'))).toEqual({ text: 'hi' })
  expect(await $.prompt.submit(say('/clear'))).toEqual({ text: '/clear' })
  expect(await $.prompt.submit(say('tick', 'plugin'))).toEqual({ text: 'tick' })

  await $.command.run(run('coldguard', 'off'))
  expect(await $.prompt.submit(say('hi'))).toEqual({ text: 'hi' })
})

test('the guard leaves a warm cache and a small chat alone', async ($, on) => {
  setup(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })
  await $.command.run(run('coldguard', 'on'))
  await $.classic.SessionStart(start(10))
  expect(await $.prompt.submit(say('warm'))).toEqual({ text: 'warm' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 7200, context_tokens: 20_000, model: 'claude-opus-5-5' } as never)
  expect(await $.prompt.submit(say('small'))).toEqual({ text: 'small' })
})

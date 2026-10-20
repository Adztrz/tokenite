import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'ribbon',
  component: 'Pane',
  requestId: 'ribbon',
  props: {
    title: 'Model × Effort',
    isFocused: true,
    bodyColumns: 80,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

const STEP = { turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 3 } as const

const DONE = { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as const

test('a dot press sets the pick and every main request goes out on it', async ($, on) => {
  mock.store(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  let sent: { model: string; effort?: unknown } = { model: '' }
  on('turn.step', async function* (_$, e) {
    sent = { model: e.model, effort: e.effort }
    return { ...DONE }
  })

  for (const surface of ['desktop', 'terminal'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ key: 'pick-1-1' })).toBeDefined()
    expect(await pane.find({ key: 'hand-back' })).toBeUndefined()
    await pane.press({ key: 'pick-1-1' })
    expect((await pane.find({ key: 'pick-1-1' }))?.text).toBe('●')
    expect(await pane.find({ key: 'hand-back' })).toBeDefined()
    await pane.press({ key: 'hand-back' })
    await pane.unmount()
  }

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'pick-1-1' })
  for await (const _ of $.turn.step({ ...STEP })) void _
  expect(sent).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })

  // a subagent's request keeps its own model
  for await (const _ of $.turn.step({ ...STEP, agentId: 'a1' })) void _
  expect(sent).toEqual({ model: 'claude-opus-5-5', effort: 'high' })

  // moving rows remembers the old row's effort, as the OS adjuster does
  await pane.press({ key: 'pick-3-4' })
  expect((await pane.find({ key: 'pick-1-1' }))?.text).toBe('○')
  for await (const _ of $.turn.step({ ...STEP })) void _
  expect(sent).toEqual({ model: 'claude-fable-5-1', effort: 'max' })

  // handing back lets the app's own pick through untouched
  await pane.press({ key: 'hand-back' })
  for await (const _ of $.turn.step({ ...STEP })) void _
  expect(sent).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  await pane.unmount()
})

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GridPick } from '../types'

// The Agentic OS skills-widget picker (MODEL x EFFORT) as a pane above the chat
// box. A pick rewrites the model and effort of every main-loop request, so it
// wins over the app's own picker until "hand back" turns it off. Subagents keep
// whatever model they were started on.

const PANE = 'model-grid'
const STORE_KEY = 'pick'

const MODELS = ['HAIKU', 'SONNET', 'OPUS', 'FABLE'] as const
const MODEL_IDS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1'] as const
const MODEL_COL = ['#2aa88a', '#3f8fd4', '#9a66e0', '#ff6b1a'] as const
const EFFORTS = ['LOW', 'MEDIUM', 'HIGH', 'XHIGH', 'MAX'] as const
const EFFORT_IDS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** The OS card's dark palette. */
const BG = '#1c1b19'
const TEXT = '#e8e2d2'
const MUTED = '#8d8775'

/** Cells: the model label column, then one column per effort. */
const LBL_W = 10
const COL_W = 9

const OFF: GridPick = { isOn: false, model: 2, effort: 2, mem: [-1, -1, -1, -1] }

const pick = atom({ plugin: 'model-grid', key: 'pick' } as const, OFF)

const isPick = (v: unknown): v is GridPick => {
  if (v === null || typeof v !== 'object') return false
  const p = v as GridPick
  return (
    typeof p.isOn === 'boolean' &&
    Number.isInteger(p.model) && p.model >= 0 && p.model < MODELS.length &&
    Number.isInteger(p.effort) && p.effort >= 0 && p.effort < EFFORTS.length &&
    Array.isArray(p.mem) && p.mem.length === MODELS.length
  )
}

const label = (p: GridPick): string => `${MODELS[p.model]} · ${EFFORTS[p.effort]}`

const save = async ($: EngineInterface): Promise<void> => {
  const p = await read($, pick)
  $.ui.status(p.isOn ? `◆ ${label(p)}` : undefined)
  await $.store.set(STORE_KEY, p)
}

/** As the OS adjuster: moving to another row remembers the effort the old row had. */
const choose = async ($: EngineInterface, model: number, effort: number): Promise<void> => {
  await update($, pick, p => {
    const mem = [...p.mem]
    if (p.isOn && model !== p.model) mem[p.model] = p.effort
    return { isOn: true, model, effort, mem }
  })
  await save($)
}

const handBack = async ($: EngineInterface): Promise<void> => {
  await update($, pick, p => ({ ...p, isOn: false }))
  await save($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'picker',
      description: 'Pick the model and effort on the Agentic OS grid (/picker off hands back to the app)',
    })
    const saved = await $.store.get(STORE_KEY)
    if (isPick(saved)) await update($, pick, () => saved)
    const p = await read($, pick)
    $.ui.status(p.isOn ? `◆ ${label(p)}` : undefined)
    return next(e)
  })

  on('command.run', { command: 'picker' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'off') {
      await handBack($)
      return { text: "Model grid off. The app's picker decides again." }
    }
    const opened = await $.ui.open({ id: PANE, title: 'Model × Effort', focus: true, closeOnEscape: true, rows: 9 })
    const p = await read($, pick)
    const now = p.isOn ? `Running on ${label(p)}.` : "Off: the app's picker decides."
    return { text: opened.isPlaced ? `Model grid open. ${now}` : `Model grid could not open here. ${now}` }
  })

  // Every request of the main conversation goes out on the grid's pick.
  on('turn.step', async function* ($, e, next) {
    const p = await read($, pick)
    if (e.agentId !== undefined || !p.isOn) return yield* next(e)
    return yield* next({ ...e, model: MODEL_IDS[p.model] ?? e.model, effort: EFFORT_IDS[p.effort] ?? e.effort })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const p = await read($, pick)
    const appModel = await $.session.model()

    const cell = (m: number, x: number) => {
      const isRow = p.isOn && m === p.model
      const isKnob = isRow && x === p.effort
      const isMem = !isRow && p.mem[m] === x
      return (
        <Box key={`cell-${m}-${x}`} width={COL_W} justifyContent="center">
          <Button
            key={`pick-${m}-${x}`}
            plain
            dimColor={!isKnob}
            label={isKnob ? '●' : isMem ? '○' : '•'}
            onPress={() => void choose($, m, x)}
          />
        </Box>
      )
    }

    const row = (name: string, m: number) => {
      const isRow = p.isOn && m === p.model
      const cells = EFFORTS.map((_, x) => cell(m, x))
      const parts = isRow
        ? [
            <Box key={`pill-${m}`} flexDirection="row" backgroundColor={MODEL_COL[m]}>
              {cells.slice(0, p.effort + 1)}
            </Box>,
            ...cells.slice(p.effort + 1),
          ]
        : cells
      return (
        <Box key={`row-${m}`} flexDirection="row" alignItems="center">
          <Box width={LBL_W}>
            <Text color={isRow ? MODEL_COL[m] : MUTED} bold={isRow}>
              {name}
            </Text>
          </Box>
          {parts}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" backgroundColor={BG} paddingX={2} paddingY={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" marginBottom={1}>
          <Text>
            <Text color={TEXT} bold>
              /model
            </Text>
            <Text color={MUTED}> · MODEL × EFFORT</Text>
          </Text>
          <Button key="close" plain dimColor role="dismiss" label="✕" onPress={() => void $.ui.close({ id: PANE })} />
        </Box>
        <Box flexDirection="row">
          <Box width={LBL_W} />
          {EFFORTS.map((n, x) => (
            <Box key={`head-${x}`} width={COL_W} justifyContent="center">
              <Text color={MUTED}>{n}</Text>
            </Box>
          ))}
        </Box>
        {MODELS.map((n, m) => row(n, m))}
        {p.isOn ? (
          <Box flexDirection="row" alignItems="center" gap={2} marginTop={1}>
            <Text color={MUTED}>
              Every reply runs on {MODELS[p.model]} at {EFFORTS[p.effort]}.
            </Text>
            <Button key="hand-back" plain dimColor label="hand back to the app's picker" onPress={() => void handBack($)} />
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text color={MUTED}>Off: the app's picker decides ({appModel}). Pick a dot to take over.</Text>
          </Box>
        )}
      </Box>
    )
  })
}

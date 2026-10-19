/** The grid's pick: row (model) and column (effort) as indexes, and the
 *  effort each other model last had, -1 where it never had one. */
export type GridPick = { isOn: boolean; model: number; effort: number; mem: number[] }

declare module 'claude-code' {
  interface PluginState {
    'model-grid': { pick: GridPick }
  }
}

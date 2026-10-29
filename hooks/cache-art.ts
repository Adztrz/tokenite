// The cache card's drawings. Pure: each function returns an SVG string the band
// hands to Svg. Nothing here touches the engine.

import { SANS } from './font'

export type Mode = 'warm' | 'cold'
export type Kind = 'wide' | 'stacked' | 'tight'

// The band's colours: Claude's own palette (Anthropic's brand colours). Orange is
// the one primary (the 7-day bar); the cache's states take orange and blue.
// The background is the app's own band slot (measured, dark theme), so the band
// sits flush in its frame; the dots and lines are lifted to read on it.
export const BG = '#232323'      // the app's band slot
export const TEXT = '#faf9f5'    // values: ivory
export const BODY = '#b0aea5'    // the 5-hour bar: mid grey
export const MUTED = '#9a988f'   // labels
export const EMPTY = '#4a4945'   // unlit dots
export const LINE = '#3a3935'    // hairlines inside the card
export const PRIMARY = '#d97757'    // the primary: the 7-day bar, Claude orange
export const ALERT = '#faf9f5'   // LOW: ivory, bold, beside the orange

// The cache's two states: Claude orange, and the palette's blue.
export const HUE: Record<Mode, string> = { warm: '#d97757', cold: '#6a9bcc' }
/** Text on a filled chip: Claude's dark. */
export const INK = '#141413'

export const WORD: Record<Mode, string> = { warm: 'WARM', cold: 'COLD' }

/** The prompt cache lives an hour after the last request that read or wrote it. */
export const TTL_MIN = 60
export const TTL_MS = TTL_MIN * 60 * 1000

/** One row needs about 78 columns for two windows; under that, each window stacks. */
export const WIDE_AT = 78
/** Under this the dot bars shrink and the cache gets its own row. */
export const TIGHT_AT = 42

export const kindOf = (columns: number): Kind => (columns >= WIDE_AT ? 'wide' : columns >= TIGHT_AT ? 'stacked' : 'tight')

/**
 * Pixels a cell is taken for. The app draws the band in its code font, whose
 * advance differs by platform and font: about 12 px on some, under 10 on others.
 * Too large a guess makes the app shrink the card to the slot while keeping the
 * height it was given, which leaves empty rows under it; too small leaves a
 * margin at the right. 9.6 px, a 16 px monospace's advance, errs to the margin.
 */
export const CELL_PX = 9.6

/**
 * The band's width in CSS pixels for a column count: the engine keeps 5 cells
 * for its [-]. Rounds down, so the card never runs past the slot.
 */
export const bandPx = (columns: number): number => Math.floor((columns + 5) * CELL_PX)

/** The card's own layout, by its width in pixels: three zones abreast, two over one, or one column. */
export const cardKindOf = (W: number): Kind => (W >= 860 ? 'wide' : W >= 480 ? 'stacked' : 'tight')

// $ per million tokens: input, and the cache read. The 1-hour cache write is 2 times
// input. Haiku 5.5 is $0.10 up to 100K tokens and $0.50 above; long sessions use the
// higher rate.
export type Model = { id: string; NAME: string; input: number; read: number }
export const MODELS: Model[] = [
  { id: 'fable', NAME: 'FABLE', input: 10, read: 0.25 },
  { id: 'opus', NAME: 'OPUS', input: 4, read: 0.2 },
  { id: 'sonnet', NAME: 'SONNET', input: 2, read: 0.2 },
  { id: 'haiku', NAME: 'HAIKU', input: 0.5, read: 0.05 },
]

/** Which row of MODELS a model id belongs to, or null for one the card doesn't price. */
export const familyOf = (model: string | null | undefined): string | null => {
  const m = (model ?? '').toLowerCase()
  return MODELS.find(x => m.includes(x.id))?.id ?? null
}

export const coldCost = (m: Model, tokens: number): number => (tokens / 1e6) * m.input * 2
export const warmCost = (m: Model, tokens: number): number => (tokens / 1e6) * m.read
export const costOf = (m: Model, mode: Mode, tokens: number): number => (mode === 'cold' ? coldCost(m, tokens) : warmCost(m, tokens))
export const usd = (n: number): string => '$' + n.toFixed(2)
export const tok = (n: number): string => (n >= 1e6 ? `${Number((n / 1e6).toFixed(1))}M` : `${Math.round(n / 1000)}k`)

/** Idle time the way the card writes it: 18m, 2h 5m, 3d 9h. */
export const fmtIdle = (ms: number): string => {
  const mins = Math.max(0, Math.floor(ms / 60000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** What every drawing of the cache reads. */
export type CacheView = {
  mode: Mode
  /** How long since the last request, written out: 3d 9h, 18m. */
  idle: string
  /** The same in whole minutes, for the warm countdown. */
  idleMin: number
  /** Context the next request re-sends. */
  tokens: number
  /** The model's context window. */
  window: number
  /** This session's MODELS id, or null when the model isn't priced. */
  mine: string | null
  /** How full the tower stands, 0 to 1: the 5-hour window left. Absent, full. */
  level?: number
  /** What this session and today have cost, for the card's footer. */
  spend?: { session: number; today: number }
}

export const mineModel = (v: CacheView): Model | undefined => MODELS.find(m => m.id === v.mine)

// ---------- SVG helpers ----------
export const svgDoc = (w: number, h: number, body: string, font: boolean): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  (font
    ? `<style>@font-face{font-family:RS;font-weight:100 900;src:url(data:font/woff2;base64,${SANS}) format('woff2')} text{font-family:RS,system-ui,'Segoe UI',sans-serif}</style>`
    : '') +
  body +
  '</svg>'

// ---------- Pill chips (WARM, COLD, YOU): tags, so full pills ----------
// A text background can't be rounded, so a chip is a small drawing. The mod can't
// measure text, so each chip's size was measured once, in the
// embedded font: width = the word plus 0.62 em of padding each side, height 1.65 em.
const CHIP: Record<string, { w: number; h: number }> = {
  'WARM@13': { w: 63, h: 21 },
  'COLD@13': { w: 58, h: 21 },
  'WARM@11': { w: 54, h: 18 },
  'COLD@11': { w: 50, h: 18 },
  'YOU@10': { w: 36, h: 17 },
}

export const chipShapes = (x: number, y: number, word: string, fill: string, size: number, ls: number): { w: number; h: number; svg: string } => {
  const { w, h } = CHIP[`${word}@${size}`] ?? { w: Math.round(word.length * size * 0.8 + size * 1.24), h: Math.round(size * 1.65) }
  return {
    w,
    h,
    svg:
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/>` +
      `<text x="${x + w / 2}" y="${y + h / 2 + size * 0.36}" font-size="${size}" font-weight="700" letter-spacing="${ls}"` +
      ` text-anchor="middle" fill="${INK}">${word}</text>`,
  }
}

/** The WARM or COLD chip beside the mark in the band's row. */
export const chipSvg = (mode: Mode): { source: string; w: number; h: number } => {
  const c = chipShapes(0, 0, WORD[mode], HUE[mode], 11, 1)
  return { source: svgDoc(c.w, c.h, c.svg, true), w: c.w, h: c.h }
}

// ---------- The mark: a tower, bobbing when warm, frozen in ice when cold ----------
const mix = (a: string, b: string, t: number): string =>
  '#' +
  [1, 3, 5]
    .map(i => Math.round(parseInt(a.substr(i, 2), 16) * (1 - t) + parseInt(b.substr(i, 2), 16) * t).toString(16).padStart(2, '0'))
    .join('')

/** The mark: a crenellated tower, 450 x 620, centred on x = 0 (assets/mark-light.svg). */
const LOGO = 'M-200 0H-105V55H-50V0H50V55H105V0H200V120L120 210V390L225 485V620H-225V485L-120 390V210L-200 120Z'
/** Box the band places the mark in, in units of `s`: the tower fits its height, centred across it. */
const MARK_W = 58
const shards = (s: number, fill: string): string =>
  `<g transform="translate(${29 * s} 0) scale(${(56 * s) / 620})"><path d="${LOGO}" fill="${fill}"/></g>`

/**
 * The tower as a gauge, like a vessel in a lab: a faint shell, filled from the
 * bottom to `level` (0 to 1), its surface gently moving. `id` names the clip, one
 * per drawing.
 */
const gauge = (s: number, fill: string, level: number, id: string): string => {
  const top = 620 * (1 - Math.max(0, Math.min(1, level)))
  const wave = (y: number) => `<animate attributeName="y" values="${y};${y - 10};${y}" dur="2.4s" repeatCount="indefinite"/>`
  const deep = (h: number) => `<animate attributeName="height" values="${h};${h + 10};${h}" dur="2.4s" repeatCount="indefinite"/>`
  return (
    `<g transform="translate(${29 * s} 0) scale(${(56 * s) / 620})">` +
    `<clipPath id="${id}"><path d="${LOGO}"/></clipPath>` +
    `<path d="${LOGO}" fill="${fill}" fill-opacity=".2" stroke="${fill}" stroke-opacity=".55" stroke-width="16"/>` +
    `<g clip-path="url(#${id})">` +
    `<rect x="-230" y="${top}" width="460" height="${620 - top}" fill="${fill}">${top > 0 ? wave(top) + deep(620 - top) : ''}</rect>` +
    (top > 0 && top < 620 ? `<rect x="-230" y="${top}" width="460" height="18" fill="#fff" fill-opacity=".4">${wave(top)}</rect>` : '') +
    '</g></g>'
  )
}

/**
 * The mark in a box `size` pixels square, top-left at x, y, filled to `level`.
 * SMIL only, so the Svg needs isInteractive.
 */
export const markShapes = (x: number, y: number, size: number, mode: Mode, level = 1, id = 'tk'): string => {
  const ease = 'calcMode="spline" keyTimes="0;0.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"'
  if (mode === 'warm') {
    // The mark takes the WARM chip's red, so the two read as one badge.
    const FILL = HUE.warm
    const u = size / 10
    const ox = x + u
    const oy = y + 1.2 * u
    return (
      `<g transform="translate(${ox} ${oy})" shape-rendering="crispEdges">` +
      `<ellipse cx="${4 * u}" cy="${8.5 * u}" rx="${3 * u}" ry="${0.42 * u}" fill="#000" opacity=".4" shape-rendering="auto">` +
      `<animate attributeName="rx" values="${3 * u};${2.3 * u};${3 * u}" dur="1.2s" repeatCount="indefinite" ${ease}/></ellipse>` +
      `<g><animateTransform attributeName="transform" type="translate" values="0 0;0 ${-1.1 * u};0 0" dur="1.2s" repeatCount="indefinite" ${ease}/>` +
      gauge((8 * u) / MARK_W, FILL, level, id) +
      // A glint every few seconds: the tower lights up for a moment.
      `<g opacity="0">${shards((8 * u) / MARK_W, '#fff')}` +
      `<animate attributeName="opacity" values="0;0;.35;0;0" keyTimes="0;0.86;0.9;0.95;1" dur="3.4s" repeatCount="indefinite"/></g>` +
      `</g></g>`
    )
  }
  // Cold: still, pale, inside a rounded ice block with icicles and one twinkle.
  const u = size / 12.2
  const ice = mix(HUE.cold, '#ffffff', 0.5)
  const ox = x + 1.6 * u
  const oy = y + 1.6 * u
  const bx = -1.2 * u
  const by = -1.2 * u
  const bw = 10.4 * u
  const bh = 9.4 * u
  let s = `<g transform="translate(${ox} ${oy})">`
  s += gauge((8 * u) / MARK_W, ice, level, id)
  s += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${1.5 * u}" fill="${HUE.cold}" fill-opacity=".28" stroke="${ice}" stroke-width="${0.38 * u}"/>`
  s += `<path d="M${bx + 0.9 * u} ${by + 2.6 * u}l${1.6 * u} ${-1.6 * u}M${bx + 0.9 * u} ${by + 4.2 * u}l${0.8 * u} ${-0.8 * u}" stroke="#fff" stroke-opacity=".75" stroke-width="${0.32 * u}" stroke-linecap="round"/>`
  for (const ix of [1.4, 4.4, 7.2]) {
    const tx = bx + ix * u
    const ty = by + bh
    s += `<path d="M${tx} ${ty}h${0.9 * u}l${-0.45 * u} ${1.5 * u}z" fill="${ice}"/>`
  }
  const sx = bx + bw - 0.2 * u
  const sy = by + 0.2 * u
  const r = 1.1 * u
  s +=
    `<path d="M${sx} ${sy - r}L${sx + 0.25 * r} ${sy - 0.25 * r}L${sx + r} ${sy}L${sx + 0.25 * r} ${sy + 0.25 * r}L${sx} ${sy + r}L${sx - 0.25 * r} ${sy + 0.25 * r}L${sx - r} ${sy}L${sx - 0.25 * r} ${sy - 0.25 * r}z" fill="#fff">` +
    `<animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.55;0.7;0.85;1" dur="2.8s" repeatCount="indefinite"/></path>`
  return s + '</g>'
}

/** The mark beside the chip in the band's row. */
export const MARK_SIZE = 20
export const markSvg = (mode: Mode, level = 1): string =>
  svgDoc(MARK_SIZE, MARK_SIZE, markShapes(0, 0, MARK_SIZE, mode, level, 'tk-band'), false)

// ---------- The card, laid out for the band's width ----------
type TextOpts = { size?: number; w?: number; fill?: string; ls?: number; anchor?: string }

/** The gap between the row and the card, drawn inside the card. */
const CARD_TOP = 4

export const cardSvg = (v: CacheView, kind: Kind, W: number): { source: string; w: number; h: number; alt: string } => {
  const mode = v.mode
  const cold = mode === 'cold'
  const HUEM = HUE[mode]
  const FIRE = HUE.warm
  const ICE = HUE.cold
  const t = (x: number, y: number, str: string, o: TextOpts = {}) =>
    `<text x="${x}" y="${y}" font-size="${o.size || 11}" font-weight="${o.w || 700}" fill="${o.fill || MUTED}"` +
    ` letter-spacing="${o.ls ?? 0}" text-anchor="${o.anchor || 'start'}">${str}</text>`
  const vline = (x: number, y: number, h: number) => `<rect x="${x}" y="${y}" width="1" height="${h}" fill="${LINE}"/>`
  const hline = (y: number) => `<rect x="13" y="${y}" width="${W - 26}" height="1" fill="${LINE}"/>`

  // How long since the last reply, with the mark and the chip in the header.
  const zoneIdle = (x: number, y: number, w: number, o: { compact?: boolean; header?: boolean } = {}) => {
    const k = o.compact ? { lab: 24, big: 60, bs: 30, line: 80, cap: 100 } : { lab: 22, big: 56, bs: 30, line: 74, cap: 94 }
    let g = ''
    if (o.header) {
      g += markShapes(x - 2, y + k.lab - 17, 22, mode, v.level ?? 1, 'tk-card')
      const c = chipShapes(x + 26, y + k.lab - 13, WORD[mode], HUEM, 11, 1)
      g += c.svg + t(x + 26 + c.w + 8, y + k.lab, 'IDLE', { ls: 1.4 })
    } else {
      g += t(x, y + k.lab, 'IDLE', { ls: 1.4 })
    }
    g += t(x, y + k.big, v.idle, { size: k.bs, w: 600, fill: TEXT })
    const ly = y + k.line
    const x0 = x + 3
    const x1 = x + w - 14
    if (cold) {
      g += `<line x1="${x0}" y1="${ly}" x2="${x0 + 18}" y2="${ly}" stroke="${FIRE}" stroke-width="5" stroke-linecap="round"/>`
      for (let cx = x0 + 30; cx <= x1 - 14; cx += 9) g += `<circle cx="${cx}" cy="${ly}" r="2.2" fill="${ICE}"/>`
      g += `<circle cx="${x1}" cy="${ly}" r="5.5" fill="${ICE}"/>`
      g += t(x, y + k.cap, 'warm 1h', { size: 12, w: 600, fill: FIRE })
      g += t(x1 + 5, y + k.cap, 'cold now', { size: 12, w: 600, fill: ICE, anchor: 'end' })
    } else {
      const now = x0 + (x1 - x0) * Math.min(1, v.idleMin / TTL_MIN)
      g += `<line x1="${x0}" y1="${ly}" x2="${now}" y2="${ly}" stroke="${FIRE}" stroke-width="5" stroke-linecap="round"/>`
      for (let cx = now + 12; cx <= x1 - 12; cx += 9) g += `<circle cx="${cx}" cy="${ly}" r="2.2" fill="${EMPTY}"/>`
      g += `<circle cx="${x1}" cy="${ly}" r="4.5" fill="none" stroke="${ICE}" stroke-width="2"/>`
      g += t(x, y + k.cap, 'last reply', { size: 12, w: 500 })
      g += t(x1 + 5, y + k.cap, `cold in ${Math.max(0, TTL_MIN - v.idleMin)}m`, { size: 12, w: 600, fill: ICE, anchor: 'end' })
    }
    return g
  }

  // The conversation's size, as a dot grid of the context window.
  const zoneSize = (x: number, y: number, w: number, o: { compact?: boolean } = {}) => {
    const share = v.window > 0 ? Math.min(1, v.tokens / v.window) : 0
    let g = t(x, y + (o.compact ? 24 : 22), cold ? 'RE-CACHE' : 'IN CACHE', { ls: 1.4 })
    const big = (yy: number, bs: number, ts: number) =>
      `<text x="${x}" y="${yy}" font-weight="600" fill="${TEXT}"><tspan font-size="${bs}">${tok(v.tokens)}</tspan><tspan font-size="${ts}" font-weight="500" fill="${MUTED}" dx="7">tokens</tspan></text>`
    const grid = (gx: number, gy: number, cols: number, step: number) => {
      let d = ''
      const lit = Math.round(share * cols * 2)
      for (let r = 0; r < 2; r++)
        for (let c = 0; c < cols; c++) d += `<circle cx="${gx + 3 + c * step}" cy="${gy + r * 9}" r="3" fill="${r * cols + c < lit ? HUEM : EMPTY}"/>`
      return d
    }
    if (o.compact) {
      const cols = 20
      const gx = x + w - (cols - 1) * 9.6 - 6
      return g + big(y + 56, 26, 14) + grid(gx, y + 42, cols, 9.6)
    }
    // 25 dots a row on the page; fewer only where the band is too narrow for them.
    const cols = Math.max(10, Math.min(25, Math.floor(w / 9.6)))
    return g + big(y + 56, 30, 14) + grid(x, y + 74, cols, 9.6) + t(x, y + 97, `${Math.round(share * 100)}% of the ${tok(v.window)} context`, { size: 12, w: 500 })
  }

  // What the next message costs, by model. One scale for both states (the cold
  // write's top price), so a warm read shows as the tiny bar it is.
  const zoneCost = (x: number, y: number, colW: number, o: { compact?: boolean } = {}) => {
    const k = o.compact
      ? { lab: 24, base: 100, rows: 6, step: 7, chip: 58, price: 88, name: 102 }
      : { lab: 22, base: 92, rows: 7, step: 8, chip: 46, price: 80, name: 95 }
    let g = t(x, y + k.lab, cold ? 'NEXT MESSAGE COSTS' : 'NEXT MESSAGE COSTS, CACHED', { ls: 1.4 })
    const top = Math.max(...MODELS.map(m => coldCost(m, v.tokens)))
    MODELS.forEach((m, i) => {
      const mine = m.id === v.mine
      const n = top > 0 ? Math.max(1, Math.round((costOf(m, mode, v.tokens) / top) * k.rows)) : 1
      const bx = x + i * colW
      for (let r = 0; r < k.rows; r++)
        for (let c = 0; c < 3; c++)
          g += `<circle cx="${bx + 3 + c * 8}" cy="${y + k.base - r * k.step}" r="2.8" fill="${r < n ? (mine ? HUEM : MUTED) : EMPTY}"/>`
      if (mine) g += chipShapes(bx + 30, y + k.chip, 'YOU', HUEM, 10, 0.8).svg
      g += t(bx + 30, y + k.price, usd(costOf(m, mode, v.tokens)), { size: 17, w: mine ? 700 : 500, fill: mine ? TEXT : MUTED })
      g += t(bx + 30, y + k.name, m.NAME, { size: 11, w: 700, fill: mine ? HUEM : MUTED, ls: 0.8 })
    })
    return g
  }

  let H: number
  let g: string
  // Where the second column starts and the line before it, for the spend strip to line up.
  let split = { v1: 314, x2: 340 }
  if (kind === 'wide') {
    H = 106
    // The zones share the width: idle and size in proportion, the prices the rest,
    // 92 px a model column at most, the last still needing about 90 px for its price.
    const w1 = Math.round(W * 0.27)
    const x2 = 13 + w1 + 24
    const w2 = Math.round(W * 0.25)
    const x3 = x2 + w2 + 24
    const colW = Math.min(92, Math.floor((W - x3 - 103) / 3))
    split = { v1: 13 + w1 + 11, x2 }
    g =
      zoneIdle(13, 0, w1, { header: true }) +
      vline(split.v1, 18, H - 36) +
      zoneSize(x2, 0, w2) +
      vline(x2 + w2 + 11, 18, H - 36) +
      zoneCost(x3, 0, colW)
  } else if (kind === 'stacked') {
    H = 212
    g =
      zoneIdle(13, 0, 290, { header: true }) +
      vline(314, 18, 76) +
      zoneSize(340, 0, W - 340 - 13) +
      hline(110) +
      zoneCost(13, 110, Math.min(160, (W - 26) / 4))
  } else {
    // Narrow: the cache row above already shows the mark and the chip.
    H = 296
    g =
      zoneIdle(13, 0, W - 26, { compact: true }) +
      hline(110) +
      zoneSize(13, 110, W - 26, { compact: true }) +
      hline(180) +
      zoneCost(13, 182, (W - 26) / 4, { compact: true })
  }
  // Spend: a slim strip on the card's grid, a label over a figure, the chat's
  // under IDLE and today's under the second column.
  if (v.spend) {
    const y = H
    const tight = kind === 'tight'
    const col2 = tight ? Math.round(W / 2) : split.x2
    const stat = (x: number, label: string, amount: number) =>
      t(x, y + 22, label, { ls: 1.4 }) +
      `<text x="${x}" y="${y + 50}" font-weight="600" fill="${TEXT}">` +
      `<tspan font-size="${tight ? 15 : 17}" font-weight="500" fill="${MUTED}" dy="-4">~</tspan>` +
      `<tspan font-size="${tight ? 22 : 26}" dy="4" dx="2">${usd(amount)}</tspan></text>`
    g +=
      hline(y) +
      stat(13, 'SPENT THIS CHAT', v.spend.session) +
      vline(tight ? col2 - 14 : split.v1, y + 12, 44) +
      stat(col2, 'SPENT TODAY · ALL CHATS', v.spend.today)
    H += 62
  }
  const h = H + CARD_TOP
  const body = `<rect width="${W}" height="${h}" fill="${BG}"/><g transform="translate(0 ${CARD_TOP})">` + hline(0) + g + '</g>'
  const alt = cold
    ? `Cache cold. Idle ${v.idle}. Next message re-caches ${tok(v.tokens)} tokens.`
    : `Cache warm. Goes cold in ${Math.max(0, TTL_MIN - v.idleMin)} minutes. ${tok(v.tokens)} tokens cached.`
  return { source: svgDoc(W, h, body, true), w: W, h, alt }
}

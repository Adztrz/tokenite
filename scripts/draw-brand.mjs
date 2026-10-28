// Draws the adz-ribbon mark and banner in the Faust (Talos) palette. Usage: node scripts/draw-brand.mjs .
import { readFileSync, writeFileSync } from 'node:fs'
const repo = process.argv[2]
const SANS = readFileSync(`${repo}/hooks/font.ts`, 'utf8').match(/SANS = '([^']+)'/)[1]
const C = { canvas: '#07090b', card: '#090b0c', raised: '#1a1d1e', divider: '#262727', border: '#363738',
  strong: '#efefed', bone: '#e9e1dc', text: '#b3b0af', muted: '#8a8b8a', subtle: '#6d6f6f', faint: '#565858',
  warm: '#f12614', cold: '#3e7edf' }
// The mark: a crenellated tower, 450 x 620, centred on x = 0. MARK(fill) fits it to the
// 58 x 56 box at (2, 6) the layout below was drawn around.
const LOGO = 'M-200 0H-105V55H-50V0H50V55H105V0H200V120L120 210V390L225 485V620H-225V485L-120 390V210L-200 120Z'
const MARK = fill => `<g transform="translate(31 6) scale(${56 / 620})"><path d="${LOGO}" fill="${fill}"/></g>`
const markDoc = fill => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-225 0 450 620"><path d="${LOGO}" fill="${fill}"/></svg>\n`
const iconDoc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-512 -202 1024 1024"><rect x="-512" y="-202" width="1024" height="1024" fill="${C.canvas}"/><path d="${LOGO}" fill="${C.bone}"/></svg>\n`
writeFileSync(`${repo}/assets/icon.svg`, iconDoc)  // rsvg-convert -w 1024 assets/icon.svg -o .claude-plugin/icon.png
writeFileSync(`${repo}/assets/mark-light.svg`, markDoc(C.bone))   // for dark backgrounds
writeFileSync(`${repo}/assets/mark-dark.svg`, markDoc('#1b1b1d'))  // for light backgrounds

const W = 1600, H = 560
const font = `<style>@font-face{font-family:O;font-weight:100 900;src:url(data:font/woff2;base64,${SANS}) format('woff2')} text{font-family:O,Inter,system-ui,sans-serif}</style>`
const t = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size ?? 16}" font-weight="${o.w ?? 400}" fill="${o.fill ?? C.text}" letter-spacing="${o.ls ?? 0}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}>${s}</text>`
let g = `<rect width="${W}" height="${H}" fill="${C.canvas}"/>`
// Halftone dot field on the right, fading toward the copy.
for (let y = 24; y < H; y += 16) for (let x = 760; x < W; x += 16) {
  const k = Math.min(1, (x - 760) / 700) * (0.5 + 0.5 * Math.sin(x / 90 + y / 70))
  if (k > 0.08) g += `<circle cx="${x}" cy="${y}" r="${(1.6 * k + 0.4).toFixed(2)}" fill="${C.faint}" fill-opacity="${(0.25 + 0.5 * k).toFixed(2)}"/>`
}
// Copy, Column structure: mark, tag-with-dot eyebrow, tight heading, light subtitle.
g += `<g transform="translate(81 92) scale(1.45)">${MARK(C.bone)}</g>`
g += `<circle cx="100" cy="214" r="4" fill="${C.bone}"/>` + t(114, 219, 'CLAUDE CODE MOD', { size: 14, w: 500, fill: C.muted, ls: 2.2 })
g += t(94, 296, 'adz-ribbon', { size: 76, w: 600, fill: C.strong, ls: -2.5 })
g += t(97, 344, 'Usage left, reset times and a warm or cold prompt cache,', { size: 24, w: 300 })
g += t(97, 378, 'in one slim band above the prompt.', { size: 24, w: 300 })
// A sample band in a card: 8px radius, hairline edge.
const cx = 96, cy = 430, cw = W - 192, ch = 68
g += `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="8" fill="${C.card}" stroke="${C.border}"/>`
const dots = (x, y, n, on, col) => { let s = ''; for (let i = 0; i < n; i++) s += `<circle cx="${x + i * 13}" cy="${y}" r="4" fill="${i < on ? col : C.border}"/>`; return s }
const by = cy + 40
g += t(cx + 28, by, 'USAGE', { size: 16, w: 600, fill: C.strong, ls: 1.2 })
g += t(cx + 120, by, '7D', { size: 16, w: 600, fill: C.muted }) + dots(cx + 156, by - 5, 10, 6, C.bone)
g += t(cx + 296, by, '62% left', { size: 16, w: 600, fill: C.bone }) + t(cx + 372, by, '· 3d 4h', { size: 16, fill: C.muted })
g += t(cx + 480, by, '5H', { size: 16, w: 600, fill: C.muted }) + dots(cx + 516, by - 5, 10, 9, C.text)
g += t(cx + 656, by, '91% left', { size: 16, w: 600, fill: C.text }) + t(cx + 732, by, '· 2h 10m', { size: 16, fill: C.muted })
g += `<g transform="translate(${cx + 862} ${cy + 20}) scale(0.5)">${MARK(C.warm)}</g>`
g += `<rect x="${cx + 900}" y="${cy + 22}" width="66" height="24" rx="12" fill="${C.warm}"/>` + t(cx + 933, by, 'WARM', { size: 14, w: 700, fill: C.canvas, ls: 1, anchor: 'middle' })
g += t(cx + 980, by, '53m left', { size: 16, w: 600, fill: C.warm })
g += `<rect x="${cx + cw - 96}" y="${cy + 18}" width="72" height="32" rx="8" fill="none" stroke="${C.border}"/>` + t(cx + cw - 60, by, 'Hide', { size: 15, w: 500, fill: C.text, anchor: 'middle' })
writeFileSync(`${repo}/assets/banner.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${font}${g}</svg>\n`)

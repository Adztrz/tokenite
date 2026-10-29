// Draws the tokenite mark and banner in Claude's palette. Usage: node scripts/draw-brand.mjs .
import { readFileSync, writeFileSync } from 'node:fs'
const repo = process.argv[2]
const SANS = readFileSync(`${repo}/hooks/font.ts`, 'utf8').match(/SANS = '([^']+)'/)[1]
// Claude's palette (Anthropic's brand colours); `bone` is the primary, Claude orange.
const C = { canvas: '#141413', card: '#1f1e1d', raised: '#30302e', divider: '#2b2a27', border: '#3d3c38',
  strong: '#faf9f5', bone: '#d97757', text: '#b0aea5', muted: '#9a988f', subtle: '#77756e', faint: '#5e5d59',
  warm: '#d97757', cold: '#6a9bcc' }
// The mark: a crenellated tower, 450 x 620, centred on x = 0. MARK(fill) fits it to the
// 58 x 56 box at (2, 6) the layout below was drawn around.
const LOGO = 'M-200 0H-105V55H-50V0H50V55H105V0H200V120L120 210V390L225 485V620H-225V485L-120 390V210L-200 120Z'
const MARK = fill => `<g transform="translate(31 6) scale(${56 / 620})"><path d="${LOGO}" fill="${fill}"/></g>`
const markDoc = fill => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-225 0 450 620"><path d="${LOGO}" fill="${fill}"/></svg>\n`
const iconDoc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-512 -202 1024 1024"><rect x="-512" y="-202" width="1024" height="1024" fill="${C.canvas}"/><path d="${LOGO}" fill="${C.bone}"/></svg>\n`
writeFileSync(`${repo}/assets/icon.svg`, iconDoc)  // rsvg-convert -w 1024 assets/icon.svg -o .claude-plugin/icon.png
writeFileSync(`${repo}/assets/mark-light.svg`, markDoc(C.bone))   // for dark backgrounds
writeFileSync(`${repo}/assets/mark-dark.svg`, markDoc(C.bone))     // for light backgrounds: orange reads on both

// ---------- The banner, animated with Claude's motion ----------
// Soft expo-out easing, staggered fade-ups that clear a light blur, a breathing
// live dot and a shimmer across the name; then the band at work on a 12 s loop:
// the 5H reset swaps with the run-out forecast, the cache goes from WARM to COLD.
// CSS and SMIL only, so GitHub plays it from an <img>; reduced motion gets the
// finished frame, which is every element's own resting style.
const W = 1600, H = 560
const EASE = 'cubic-bezier(.16,1,.3,1)'
const LOOP = 12
const css = `
@font-face{font-family:O;font-weight:100 900;src:url(data:font/woff2;base64,${SANS}) format('woff2')}
text{font-family:O,Inter,system-ui,sans-serif}
.rise{animation:rise .9s ${EASE} both}
@keyframes rise{from{opacity:0;transform:translateY(14px);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
.lit{animation:lit .5s ${EASE} both}
@keyframes lit{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:none}}
.lit,.fill,.ring{transform-box:fill-box;transform-origin:50% 50%}
.fill{transform-origin:50% 100%;animation:fill 1.8s ${EASE} .5s both}
@keyframes fill{from{transform:scaleY(0)}to{transform:none}}
.surf{animation:surf 2.6s ease-in-out 2.3s infinite}
@keyframes surf{50%{transform:translateY(-14px)}}
.ring{animation:ring 2.4s ${EASE} 1s infinite}
@keyframes ring{from{opacity:.7;transform:scale(1)}to{opacity:0;transform:scale(3.2)}}
.dots{animation:breathe 8s ease-in-out infinite}
@keyframes breathe{50%{opacity:.55}}
.a{animation:a ${LOOP}s ${EASE} 2s infinite}
.b{opacity:0;animation:b ${LOOP}s ${EASE} 2s infinite}
@keyframes a{0%,38%{opacity:1;filter:none}44%,94%{opacity:0;filter:blur(3px)}100%{opacity:1;filter:none}}
@keyframes b{0%,38%{opacity:0;filter:blur(3px)}44%,94%{opacity:1;filter:none}100%{opacity:0;filter:blur(3px)}}
.f1{animation:f1 ${LOOP}s ${EASE} 2s infinite}
.f2{opacity:0;animation:f2 ${LOOP}s ${EASE} 2s infinite}
@keyframes f1{0%,14%{opacity:1}20%,70%{opacity:0}76%,100%{opacity:1}}
@keyframes f2{0%,14%{opacity:0}20%,70%{opacity:1}76%,100%{opacity:0}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
`
const t = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size ?? 16}" font-weight="${o.w ?? 400}" fill="${o.fill ?? C.text}" letter-spacing="${o.ls ?? 0}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}>${s}</text>`
const rise = (delay, body) => `<g class="rise" style="animation-delay:${delay}s">${body}</g>`
// The tower as a gauge, as the band draws it: a faint shell filled from the bottom.
const gauge = (fill, level, id, live) => {
  const top = 620 * (1 - level)
  return `<g transform="translate(31 6) scale(${56 / 620})"><clipPath id="${id}"><path d="${LOGO}"/></clipPath>` +
    `<path d="${LOGO}" fill="${fill}" fill-opacity=".18" stroke="${fill}" stroke-opacity=".5" stroke-width="14"/>` +
    `<g clip-path="url(#${id})"><g${live ? ' class="fill"' : ''}><rect x="-230" y="${top}" width="460" height="${640 - top}" fill="${fill}"/>` +
    `<rect${live ? ' class="surf"' : ''} x="-230" y="${top}" width="460" height="16" fill="#fff" fill-opacity=".45"/></g></g></g>`
}

let g = `<rect width="${W}" height="${H}" fill="${C.canvas}"/>`
// Halftone dot field on the right, fading toward the copy, breathing slowly.
g += '<g class="dots">'
for (let y = 24; y < H; y += 16) for (let x = 760; x < W; x += 16) {
  const k = Math.min(1, (x - 760) / 700) * (0.5 + 0.5 * Math.sin(x / 90 + y / 70))
  if (k > 0.08) g += `<circle cx="${x}" cy="${y}" r="${(1.6 * k + 0.4).toFixed(2)}" fill="${C.faint}" fill-opacity="${(0.25 + 0.5 * k).toFixed(2)}"/>`
}
g += '</g>'
// Copy: the tower filling, the eyebrow with its live dot, the name with a shimmer, the line under it.
g += rise(0.05, `<g transform="translate(81 92) scale(1.45)">${gauge(C.bone, 0.62, 'hero', true)}</g>`)
g += rise(0.25, `<circle class="ring" cx="100" cy="214" r="4" fill="none" stroke="${C.bone}" stroke-width="1.5"/><circle cx="100" cy="214" r="4" fill="${C.bone}"/>` +
  t(114, 219, 'CLAUDE CODE MOD', { size: 14, w: 500, fill: C.muted, ls: 2.2 }))
g += `<defs><linearGradient id="shine" gradientUnits="userSpaceOnUse" x1="-400" x2="-100" y1="0" y2="0">` +
  `<stop offset="0" stop-color="${C.strong}"/><stop offset=".5" stop-color="#f3b49b"/><stop offset="1" stop-color="${C.strong}"/>` +
  `<animateTransform attributeName="gradientTransform" type="translate" values="0 0;0 0;900 0" keyTimes="0;.6;1" dur="6s" begin="1.4s" repeatCount="indefinite"/></linearGradient></defs>`
g += rise(0.4, t(94, 296, 'tokenite', { size: 76, w: 600, fill: 'url(#shine)', ls: -2.5 }))
g += rise(0.55, t(97, 344, 'Usage left and when it runs out, a warm or cold cache,', { size: 24, w: 300 }) +
  t(97, 378, 'and what it all costs, in one band above the prompt.', { size: 24, w: 300 }))

// The band at work, in a card: 8px radius, hairline edge.
const cx = 96, cy = 430, cw = W - 192, ch = 68, by = cy + 40
let b = `<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="8" fill="${C.card}" stroke="${C.border}"/>`
let n = 0
const dots = (x, y, cells, on, col) => {
  let d = ''
  for (let i = 0; i < cells; i++) {
    d += i < on
      ? `<circle class="lit" style="animation-delay:${(1.0 + 0.045 * n++).toFixed(3)}s" cx="${x + i * 13}" cy="${y}" r="4" fill="${col}"/>`
      : `<circle cx="${x + i * 13}" cy="${y}" r="4" fill="${C.border}"/>`
  }
  return d
}
b += t(cx + 28, by, 'USAGE', { size: 16, w: 600, fill: C.strong, ls: 1.2 })
b += t(cx + 120, by, '7D', { size: 16, w: 600, fill: C.muted }) + dots(cx + 156, by - 5, 10, 8, C.bone)
b += t(cx + 296, by, '84% left', { size: 16, w: 600, fill: C.bone }) + t(cx + 372, by, '· 3d 4h', { size: 16, fill: C.muted })
b += t(cx + 480, by, '5H', { size: 16, w: 600, fill: C.muted }) + dots(cx + 516, by - 5, 10, 6, C.text)
b += t(cx + 656, by, '62% left', { size: 16, w: 600, fill: C.text })
// The 5H reset gives way to the forecast while the pace would run it dry first.
b += `<g class="f1">${t(cx + 732, by, '· 4h 57m', { size: 16, fill: C.muted })}</g>`
b += `<g class="f2">${t(cx + 732, by, '· out ~1h 40m', { size: 16, w: 600, fill: C.strong })}</g>`
// The cache: WARM with the tower full of orange, then COLD in blue with the re-cache price.
const badge = (fill, word, chipW, after, afterFill) =>
  `<g transform="translate(${cx + 862} ${cy + 20}) scale(0.5)">${gauge(fill, 0.62, `b-${word}`, false)}</g>` +
  `<rect x="${cx + 900}" y="${cy + 22}" width="${chipW}" height="24" rx="12" fill="${fill}"/>` +
  t(cx + 900 + chipW / 2, by, word, { size: 14, w: 700, fill: C.canvas, ls: 1, anchor: 'middle' }) +
  t(cx + 912 + chipW, by, after, { size: 16, w: 600, fill: afterFill })
b += `<g class="a">${badge(C.warm, 'WARM', 66, '53m left', C.warm)}</g>`
b += `<g class="b">${badge(C.cold, 'COLD', 60, '12h 45m · $1.46', C.cold)}</g>`
b += `<rect x="${cx + cw - 96}" y="${cy + 18}" width="72" height="32" rx="8" fill="none" stroke="${C.border}"/>` + t(cx + cw - 60, by, 'Hide', { size: 15, w: 500, fill: C.text, anchor: 'middle' })
g += rise(0.8, b)
writeFileSync(`${repo}/assets/banner.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${css}</style>${g}</svg>\n`)

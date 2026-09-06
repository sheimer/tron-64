import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

console.log('--- Testing Multi-Palette Color Schemes & Accessibility ---')

// --------------------------------------------------------------------------
// 1. Color Math & Metrics
// --------------------------------------------------------------------------
function hexToRgb(hex) {
  hex = hex.replace('#', '')
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  const num = parseInt(hex, 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

function srgbToLinear(c) {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

function relativeLuminance([r, g, b]) {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

function wcagContrast(c1, c2) {
  const l1 = relativeLuminance(hexToRgb(c1))
  const l2 = relativeLuminance(hexToRgb(c2))
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

function rgbToLab([r, g, b]) {
  const R = srgbToLinear(r)
  const G = srgbToLinear(g)
  const B = srgbToLinear(b)

  let X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047
  let Y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / 1.00000
  let Z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883

  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fX = f(X)
  const fY = f(Y)
  const fZ = f(Z)

  return [116 * fY - 16, 500 * (fX - fY), 200 * (fY - fZ)]
}

function deltaE76(c1, c2) {
  const [L1, a1, b1] = rgbToLab(hexToRgb(c1))
  const [L2, a2, b2] = rgbToLab(hexToRgb(c2))
  return Math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2)
}

// Brettel/Viénot CVD simulation
function simulateCVD([r, g, b], type) {
  const R = srgbToLinear(r)
  const G = srgbToLinear(g)
  const B = srgbToLinear(b)

  let rSim, gSim, bSim
  if (type === 'protanopia') {
    rSim = 0.56667 * R + 0.43333 * G + 0.0 * B
    gSim = 0.55833 * R + 0.44167 * G + 0.0 * B
    bSim = 0.0 * R + 0.24167 * G + 0.75833 * B
  } else if (type === 'deuteranopia') {
    rSim = 0.625 * R + 0.375 * G + 0.0 * B
    gSim = 0.700 * R + 0.300 * G + 0.0 * B
    bSim = 0.0 * R + 0.300 * G + 0.700 * B
  } else {
    return [r, g, b]
  }

  return [
    Math.round(Math.min(255, Math.max(0, linearToSrgb(rSim) * 255))),
    Math.round(Math.min(255, Math.max(0, linearToSrgb(gSim) * 255))),
    Math.round(Math.min(255, Math.max(0, linearToSrgb(bSim) * 255))),
  ]
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// --------------------------------------------------------------------------
// 2. Parse palettes.css directly from disk
// --------------------------------------------------------------------------
console.log('1. Parsing public/stylesheets/palettes.css...')
const cssPath = path.join(rootDir, 'public/stylesheets/palettes.css')
assert.ok(fs.existsSync(cssPath), 'palettes.css should exist')
const cssContent = fs.readFileSync(cssPath, 'utf-8')

function parsePalettes(css) {
  const paletteBlocks = [
    ...css.matchAll(
      /(?:\[data-palette="([^"]+)"\]|:root\s*,\s*\[data-palette="([^"]+)"\])\s*\{([^}]+)\}/g,
    ),
  ]
  const palettes = {}
  for (const match of paletteBlocks) {
    const id = match[1] || match[2]
    const body = match[3]
    const props = {}
    const propMatches = [
      ...body.matchAll(
        /--color-([a-z-]+):\s*light-dark\(\s*([^,\)]+)\s*,\s*([^,\)]+)\s*\);/g,
      ),
    ]
    for (const p of propMatches) {
      const propName = p[1]
      const lightVal = p[2].trim()
      const darkVal = p[3].trim()
      props[propName] = { light: lightVal, dark: darkVal }
    }
    palettes[id] = props
  }
  return palettes
}

const palettes = parsePalettes(cssContent)
const EXPECTED_PALETTES = [
  'forestbones',
  'zenbones',
  'zenburned',
  'tokyobones',
  'rosebones',
  'nordbones',
  'duckbones',
  'seoulbones',
  'c64',
  'c64-original',
  'arcade-neon',
  'amber-crt',
  'green-crt',
]

for (const id of EXPECTED_PALETTES) {
  assert.ok(palettes[id], `Palette '${id}' must be defined in palettes.css`)
}
console.log(`✔ All ${EXPECTED_PALETTES.length} palettes parsed successfully.`)

// --------------------------------------------------------------------------
// 3. Token Completeness & Semantic Contract
// --------------------------------------------------------------------------
console.log('2. Verifying token completeness across all palettes...')
const REQUIRED_TOKENS = [
  'bg',
  'bg-hl',
  'bg-muted',
  'fg',
  'fg-hl',
  'fg-muted',
  'rose',
  'water',
  'wood',
  'leaf',
  'blossom',
  'sky',
  'rock',
]
const PLAYER_KEYS = ['water', 'wood', 'leaf', 'blossom', 'sky', 'rock']
const MONOCHROME_PALETTES = new Set(['c64-original', 'amber-crt', 'green-crt'])

for (const id of EXPECTED_PALETTES) {
  const p = palettes[id]
  for (const token of REQUIRED_TOKENS) {
    assert.ok(
      p[token],
      `Palette '${id}' missing required token '--color-${token}'`,
    )
    assert.ok(
      p[token].light.startsWith('#'),
      `Palette '${id}' light value for '--color-${token}' must be a hex color`,
    )
    assert.ok(
      p[token].dark.startsWith('#'),
      `Palette '${id}' dark value for '--color-${token}' must be a hex color`,
    )
  }
}
console.log('✔ All palettes implement the 13 required semantic color tokens.')

// --------------------------------------------------------------------------
// 4. WCAG 2.1 Contrast Requirements
// --------------------------------------------------------------------------
console.log('3. Verifying WCAG 2.1 AA text and graphical contrast...')
for (const id of EXPECTED_PALETTES) {
  const pal = palettes[id]
  for (const mode of ['light', 'dark']) {
    const bg = pal.bg[mode]
    const fg = pal.fg[mode]

    // Rule 1: Text Readability (fg on bg >= 4.5:1)
    const fgContrast = wcagContrast(fg, bg)
    assert.ok(
      fgContrast >= 4.5,
      `[WCAG Text Fail] ${id} (${mode}): fg contrast ${fgContrast.toFixed(2)} is < 4.5:1`,
    )

    // Rule 2: Trail Visibility (all 6 player colors + rose on bg >= 3.0:1)
    for (const key of [...PLAYER_KEYS, 'rose']) {
      const trail = pal[key][mode]
      const trailContrast = wcagContrast(trail, bg)
      assert.ok(
        trailContrast >= 3.0,
        `[WCAG Trail Fail] ${id} (${mode}): ${key} contrast ${trailContrast.toFixed(2)} is < 3.0:1`,
      )
    }
  }
}
console.log('✔ All palettes meet WCAG text (>=4.5:1) and trail (>=3.0:1) contrast.')

// --------------------------------------------------------------------------
// 5. Perceptual Color Distance (CIELAB ΔE*)
// --------------------------------------------------------------------------
console.log('4. Verifying perceptual color discriminability across player pairs...')
for (const id of EXPECTED_PALETTES) {
  if (MONOCHROME_PALETTES.has(id)) continue
  const pal = palettes[id]
  for (const mode of ['light', 'dark']) {
    let minDeltaE = Infinity
    let closestPair = ''
    let totalDeltaE = 0
    let pairCount = 0

    for (let i = 0; i < PLAYER_KEYS.length; i++) {
      for (let j = i + 1; j < PLAYER_KEYS.length; j++) {
        const c1 = pal[PLAYER_KEYS[i]][mode]
        const c2 = pal[PLAYER_KEYS[j]][mode]
        const dE = deltaE76(c1, c2)
        totalDeltaE += dE
        pairCount++
        if (dE < minDeltaE) {
          minDeltaE = dE
          closestPair = `${PLAYER_KEYS[i]} vs ${PLAYER_KEYS[j]}`
        }
      }
    }

    const avgDeltaE = totalDeltaE / pairCount
    // Minimum pairwise distance threshold guarantees adjacent colors do not collide
    assert.ok(
      minDeltaE >= 8.5,
      `[Discriminability Fail] ${id} (${mode}): closest pair ${closestPair} has ΔE* ${minDeltaE.toFixed(1)} < 8.5`,
    )
    // Mean pairwise distance across 6 player cycles must exceed 22 to guarantee vivid diversity
    assert.ok(
      avgDeltaE >= 22.0,
      `[Discriminability Fail] ${id} (${mode}): average ΔE* ${avgDeltaE.toFixed(1)} is < 22.0`,
    )
  }
}
console.log('✔ All chromatic palettes achieve distinct player trail hues.')

// --------------------------------------------------------------------------
// 6. Color Vision Deficiency (CVD) Simulation
// --------------------------------------------------------------------------
console.log('5. Verifying Color Vision Deficiency (CVD) simulation contrast...')
for (const id of EXPECTED_PALETTES) {
  const pal = palettes[id]
  for (const mode of ['light', 'dark']) {
    for (const cvdType of ['protanopia', 'deuteranopia']) {
      const bgRgb = hexToRgb(pal.bg[mode])
      const fgRgb = hexToRgb(pal.fg[mode])
      const bgSim = rgbToHex(simulateCVD(bgRgb, cvdType))
      const fgSim = rgbToHex(simulateCVD(fgRgb, cvdType))

      const cFg = wcagContrast(fgSim, bgSim)
      assert.ok(
        cFg >= 3.0,
        `[CVD Text Fail] ${id} (${mode}, ${cvdType}): simulated fg contrast ${cFg.toFixed(2)} < 3.0:1`,
      )

      for (const key of [...PLAYER_KEYS, 'rose']) {
        const trailRgb = hexToRgb(pal[key][mode])
        const trailSim = rgbToHex(simulateCVD(trailRgb, cvdType))
        const cTrail = wcagContrast(trailSim, bgSim)
        assert.ok(
          cTrail >= 2.0,
          `[CVD Trail Fail] ${id} (${mode}, ${cvdType}): ${key} contrast ${cTrail.toFixed(2)} < 2.0:1`,
        )
      }
    }
  }
}
console.log('✔ All palettes pass Deuteranopia and Protanopia CVD accessibility tests.')

// --------------------------------------------------------------------------
// 7. Template & Settings View Integration
// --------------------------------------------------------------------------
console.log('6. Verifying Settings UI and template dropdown bindings...')
const controlsPugPath = path.join(rootDir, 'views/controls.pug')
const controlsContent = fs.readFileSync(controlsPugPath, 'utf-8')
const ACTIVE_PALETTES = EXPECTED_PALETTES.filter((id) => id !== 'c64-original')

assert.ok(
  controlsContent.includes("select(id='game-palette')"),
  "controls.pug must contain select(id='game-palette')",
)
for (const id of ACTIVE_PALETTES) {
  assert.ok(
    controlsContent.includes(`value='${id}'`),
    `controls.pug must include option for '${id}'`,
  )
}
assert.ok(
  !controlsContent.includes("value='c64-original'"),
  "controls.pug must not contain disabled 'c64-original'",
)
console.log(`✔ controls.pug contains all ${ACTIVE_PALETTES.length} active palette selection options.`)

console.log('--- ALL PALETTE & ACCESSIBILITY TESTS PASSED! ---')

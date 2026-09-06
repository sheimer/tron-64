#!/usr/bin/env node

/**
 * Palette Gallery Generator for Bitcycles
 * Generates an offline, standalone single-page visual comparison report:
 * test/reports/palette-gallery.html
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const cssPath = path.join(rootDir, 'public/stylesheets/palettes.css')
const reportsDir = path.join(rootDir, 'test/reports')
const outputPath = path.join(reportsDir, 'palette-gallery.html')

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
        /--color-([a-z-]+):\s*light-dark\(\s*([^,)]+)\s*,\s*([^,)]+)\s*\);/g,
      ),
    ]
    for (const p of propMatches) {
      const propName = p[1]
      props[propName] = { light: p[2].trim(), dark: p[3].trim() }
    }
    palettes[id] = props
  }
  return palettes
}

const cssContent = fs.readFileSync(cssPath, 'utf-8')
const palettes = parsePalettes(cssContent)

function hexToRgb(hex) {
  hex = hex.replace('#', '')
  if (hex.length === 3)
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  const num = parseInt(hex, 16)
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
}

function rgbToHsl([r, g, b]) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b)
  let h,
    s,
    l = (max + min) / 2
  if (max === min) {
    h = s = 0
  } else {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      case b:
        h = ((r - g) / d + 4) / 6
        break
    }
  }
  return [Math.round(h * 360), s * 100, l * 100]
}

function hslToRgb(h, s, l) {
  s = Math.max(0, Math.min(100, s)) / 100
  l = Math.max(0, Math.min(100, l)) / 100
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0,
    g = 0,
    b = 0
  if (0 <= h && h < 60) {
    r = c
    g = x
    b = 0
  } else if (60 <= h && h < 120) {
    r = x
    g = c
    b = 0
  } else if (120 <= h && h < 180) {
    r = 0
    g = c
    b = 0
  } else if (180 <= h && h < 240) {
    r = 0
    g = x
    b = c
  } else if (240 <= h && h < 300) {
    r = x
    g = 0
    b = c
  } else if (300 <= h && h < 360) {
    r = c
    g = 0
    b = x
  }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

function parseParam(str, target) {
  const re = new RegExp(`calc\\(${target}\\s*\\*\\s*([0-9.]+)\\)`)
  const m = str.match(re)
  return m ? parseFloat(m[1]) : 1.0
}

function parseRelativeRulesByScope(css) {
  const blocks = [
    ...css.matchAll(
      /(?:\[data-palette="([^"]+)"\]|:root(?!\s*,\s*\[))\s*\{([^}]+)\}/g,
    ),
  ]
  const relativeRulesByScope = {}
  for (const b of blocks) {
    const id = b[1] || 'root'
    const body = b[2]
    const rules = {}
    const relRegex =
      /--color-([a-z-]+):\s*light-dark\(\s*hsl\(from\s+var\(--color-([a-z]+)\)\s+h\s+([\s\S]+?)\)\s*,\s*hsl\(from\s+var\(--color-[a-z]+\)\s+h\s+([\s\S]+?)\)\s*\);/g
    for (const m of body.matchAll(relRegex)) {
      const token = m[1]
      const base = m[2]
      rules[token] = {
        base,
        light: { s: parseParam(m[3], 's'), l: parseParam(m[3], 'l') },
        dark: { s: parseParam(m[4], 's'), l: parseParam(m[4], 'l') },
      }
    }
    relativeRulesByScope[id] = rules
  }
  return relativeRulesByScope
}

const relativeRulesByScope = parseRelativeRulesByScope(cssContent)

function resolveTriads(paletteId, mode, pal) {
  const groups = [
    { key: 'bg', label: 'BG' },
    { key: 'fg', label: 'FG' },
    { key: 'rose', label: 'Rose' },
    { key: 'water', label: 'P0 Water' },
    { key: 'wood', label: 'P1 Wood' },
    { key: 'leaf', label: 'P2 Leaf' },
    { key: 'blossom', label: 'P3 Blossom' },
    { key: 'sky', label: 'P4 Sky' },
    { key: 'rock', label: 'P5 Rock' },
  ]

  return groups.map((g) => {
    const baseColor = pal[g.key][mode]
    let hlColor = pal[`${g.key}-hl`]?.[mode]
    let mutedColor = pal[`${g.key}-muted`]?.[mode]

    if (!hlColor) {
      const hlRule =
        relativeRulesByScope[paletteId]?.[`${g.key}-hl`] ||
        relativeRulesByScope['root']?.[`${g.key}-hl`]
      if (hlRule) {
        const [h, s, l] = rgbToHsl(hexToRgb(pal[hlRule.base][mode]))
        const m = hlRule[mode]
        hlColor = rgbToHex(
          hslToRgb(
            h,
            Math.min(100, s * m.s),
            Math.min(100, Math.max(0, l * m.l)),
          ),
        )
      } else {
        hlColor = baseColor
      }
    }

    if (!mutedColor) {
      const mutedRule =
        relativeRulesByScope[paletteId]?.[`${g.key}-muted`] ||
        relativeRulesByScope['root']?.[`${g.key}-muted`]
      if (mutedRule) {
        const [h, s, l] = rgbToHsl(hexToRgb(pal[mutedRule.base][mode]))
        const m = mutedRule[mode]
        mutedColor = rgbToHex(
          hslToRgb(
            h,
            Math.min(100, s * m.s),
            Math.min(100, Math.max(0, l * m.l)),
          ),
        )
      } else {
        mutedColor = baseColor
      }
    }

    return {
      label: g.label,
      key: g.key,
      base: baseColor,
      hl: hlColor,
      muted: mutedColor,
    }
  })
}

const PALETTE_META = {
  forestbones: { name: 'Forestbones', group: 'Zenbones Family (Default)' },
  zenbones: { name: 'Zenbones', group: 'Zenbones Family' },
  zenburned: { name: 'Zenburned', group: 'Zenbones Family' },
  tokyobones: { name: 'Tokyobones', group: 'Zenbones Family' },
  rosebones: { name: 'Rosebones', group: 'Zenbones Family' },
  nordbones: { name: 'Nordbones', group: 'Zenbones Family' },
  duckbones: { name: 'Duckbones', group: 'Zenbones Family' },
  seoulbones: { name: 'Seoulbones', group: 'Zenbones Family' },
  c64: { name: 'Commodore 64 (VIC-II)', group: 'Retro & Display' },
  'c64-original': {
    name: 'Commodore 64 (Original Hi-Res - Prototype)',
    group: 'Retro & Display',
  },
  'arcade-neon': { name: 'Arcade Neon', group: 'Retro & Display' },
  'amber-crt': { name: 'Amber Phosphor CRT', group: 'Retro & Display' },
  'green-crt': { name: 'Green Phosphor CRT', group: 'Retro & Display' },
}

function renderArenaSvg(colors) {
  // Arena coordinates based on 320x200 grid
  return `
  <svg viewBox="0 0 320 200" width="320" height="200" class="arena-preview" xmlns="http://www.w3.org/2000/svg">
    <rect width="320" height="200" fill="${colors.bg}" />
    <!-- Arena Perimeter Border with Breach -->
    <path d="M 10 10 L 140 10 M 180 10 L 310 10 L 310 190 L 10 190 Z" fill="none" stroke="${colors.fg}" stroke-width="2" />
    
    <!-- Player 0 (Water): horizontal then turn down -->
    <path d="M 30 40 L 120 40 L 120 110" fill="none" stroke="${colors.water}" stroke-width="2" />
    <rect x="118" y="110" width="4" height="4" fill="${colors.water}" />
    
    <!-- Player 1 (Wood): right to left -->
    <path d="M 290 50 L 160 50 L 160 80" fill="none" stroke="${colors.wood}" stroke-width="2" />
    <rect x="158" y="80" width="4" height="4" fill="${colors.wood}" />

    <!-- Player 2 (Leaf): upward curve -->
    <path d="M 60 160 L 60 90 L 140 90" fill="none" stroke="${colors.leaf}" stroke-width="2" />
    <rect x="140" y="88" width="4" height="4" fill="${colors.leaf}" />

    <!-- Player 3 (Blossom): diagonal maneuver -->
    <path d="M 260 160 L 200 160 L 200 120 L 250 120" fill="none" stroke="${colors.blossom}" stroke-width="2" />
    <rect x="250" y="118" width="4" height="4" fill="${colors.blossom}" />

    <!-- Player 4 (Sky): perimeter escape run toward breach -->
    <path d="M 80 130 L 80 25 L 160 25 L 160 5" fill="none" stroke="${colors.sky}" stroke-width="2" />
    <rect x="158" y="3" width="4" height="4" fill="${colors.sky}" />

    <!-- Player 5 (Rock): central trap -->
    <path d="M 230 70 L 230 140 L 110 140" fill="none" stroke="${colors.rock}" stroke-width="2" />
    <rect x="108" y="138" width="4" height="4" fill="${colors.rock}" />

    <!-- Particle Explosion (Rose) -->
    <g fill="${colors.rose}">
      <circle cx="160" cy="10" r="2.5" />
      <circle cx="156" cy="7" r="1.5" />
      <circle cx="165" cy="8" r="1.8" />
      <circle cx="158" cy="14" r="1.2" />
      <circle cx="163" cy="13" r="2.0" />
      <circle cx="152" cy="10" r="1.0" />
      <circle cx="168" cy="11" r="1.4" />
    </g>
  </svg>
  `
}

function renderScoreboard(colors) {
  return `
  <table class="scoreboard-preview" style="background-color: ${colors.bg}; color: ${colors.fg}; border: 1px solid ${colors['fg-muted'] || colors.fg};">
    <thead>
      <tr style="border-bottom: 1px solid ${colors['fg-muted'] || colors.fg};">
        <th style="text-align: left;">Rank</th>
        <th style="text-align: left;">Player</th>
        <th style="text-align: right;">Kills</th>
        <th style="text-align: right;">Total</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="color: ${colors.leaf};">#1</td>
        <td style="color: ${colors.water}; font-weight: bold;">Tron</td>
        <td style="text-align: right;">3</td>
        <td style="text-align: right; font-weight: bold;">125</td>
      </tr>
      <tr>
        <td style="color: ${colors.leaf};">#2</td>
        <td style="color: ${colors.sky}; font-weight: bold;">Clu</td>
        <td style="text-align: right;">2</td>
        <td style="text-align: right; font-weight: bold;">98</td>
      </tr>
      <tr>
        <td>#3</td>
        <td style="color: ${colors.wood}; font-weight: bold;">Sark</td>
        <td style="text-align: right;">1</td>
        <td style="text-align: right; font-weight: bold;">74</td>
      </tr>
      <tr>
        <td>#4</td>
        <td style="color: ${colors.blossom}; font-weight: bold;">Yori</td>
        <td style="text-align: right;">0</td>
        <td style="text-align: right; font-weight: bold;">42</td>
      </tr>
      <tr>
        <td>#5</td>
        <td style="color: ${colors.rock}; font-weight: bold;">Ram</td>
        <td style="text-align: right;">0</td>
        <td style="text-align: right; font-weight: bold;">30</td>
      </tr>
      <tr>
        <td style="color: ${colors.rose};">💥</td>
        <td style="color: ${colors.rose}; font-weight: bold;">Flynn</td>
        <td style="text-align: right;">0</td>
        <td style="text-align: right; font-weight: bold;">15</td>
      </tr>
    </tbody>
  </table>
  `
}

function renderSwatches(triads, fgColor) {
  return `
  <div class="swatch-bar">
    ${triads
      .map((t) => {
        return `
      <div class="swatch-group">
        <span class="swatch-group-title">${t.label}</span>
        <div class="swatch-triad">
          <div class="swatch-sub" title="${t.label} (Base): ${t.base}">
            <div class="swatch-color" style="background-color: ${t.base}; border: 1px solid ${fgColor};"></div>
            <span class="swatch-code">${t.base}</span>
            <span class="swatch-sublabel">Base</span>
          </div>
          <div class="swatch-sub" title="${t.label} (Highlight): ${t.hl}">
            <div class="swatch-color" style="background-color: ${t.hl}; border: 1px solid ${fgColor};"></div>
            <span class="swatch-code">${t.hl}</span>
            <span class="swatch-sublabel">-hl</span>
          </div>
          <div class="swatch-sub" title="${t.label} (Muted): ${t.muted}">
            <div class="swatch-color" style="background-color: ${t.muted}; border: 1px solid ${fgColor};"></div>
            <span class="swatch-code">${t.muted}</span>
            <span class="swatch-sublabel">-muted</span>
          </div>
        </div>
      </div>`
      })
      .join('')}
  </div>`
}

let cardsHtml = ''
for (const [id, pal] of Object.entries(palettes)) {
  const meta = PALETTE_META[id] || { name: id, group: 'Custom' }
  const lightColors = {}
  const darkColors = {}
  for (const [prop, val] of Object.entries(pal)) {
    lightColors[prop] = val.light
    darkColors[prop] = val.dark
  }

  const darkTriads = resolveTriads(id, 'dark', pal)
  const lightTriads = resolveTriads(id, 'light', pal)

  cardsHtml += `
  <section class="palette-card" id="palette-${id}">
    <div class="palette-card-header">
      <div class="palette-title-wrap">
        <h2>${meta.name}</h2>
        <span class="palette-group-badge">${meta.group}</span>
        <code class="palette-id">data-palette="${id}"</code>
      </div>
    </div>
    
    <div class="palette-modes-container">
      <!-- Dark Mode Column -->
      <div class="palette-mode-box dark-box">
        <div class="mode-header">
          <h3>Dark Mode</h3>
        </div>
        <div class="mode-content">
          ${renderArenaSvg(darkColors)}
          ${renderScoreboard(darkColors)}
        </div>
        ${renderSwatches(darkTriads, darkColors.fg)}
      </div>

      <!-- Light Mode Column -->
      <div class="palette-mode-box light-box">
        <div class="mode-header">
          <h3>Light Mode</h3>
        </div>
        <div class="mode-content">
          ${renderArenaSvg(lightColors)}
          ${renderScoreboard(lightColors)}
        </div>
        ${renderSwatches(lightTriads, lightColors.fg)}
      </div>
    </div>
  </section>
  `
}

const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bitcycles Multi-Palette Visual Verification Gallery</title>
  <style>
    :root {
      --bg: #121417;
      --fg: #e2e8f0;
      --card-bg: #1e2229;
      --border: #2d3748;
      --accent: #38bdf8;
    }
    body {
      margin: 0;
      padding: 2rem;
      background: var(--bg);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.5;
    }
    header {
      max-width: 1400px;
      margin: 0 auto 2rem auto;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1.5rem;
    }
    h1 {
      margin: 0 0 0.5rem 0;
      font-size: 2rem;
      color: #fff;
    }
    .lead {
      font-size: 1.1rem;
      color: #94a3b8;
      margin: 0 0 1rem 0;
    }
    .cvd-controls {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
      background: var(--card-bg);
      padding: 0.75rem 1rem;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    .cvd-controls span {
      font-weight: bold;
      margin-right: 0.5rem;
    }
    .cvd-btn {
      background: #2a303c;
      color: #cbd5e1;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0.4rem 0.8rem;
      cursor: pointer;
      font-size: 0.875rem;
    }
    .cvd-btn.active {
      background: var(--accent);
      color: #0f172a;
      font-weight: bold;
      border-color: var(--accent);
    }
    .gallery-container {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 2.5rem;
    }
    .palette-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.5rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
    }
    .palette-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.75rem;
    }
    .palette-title-wrap {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .palette-title-wrap h2 {
      margin: 0;
      font-size: 1.5rem;
      color: #fff;
    }
    .palette-group-badge {
      background: #334155;
      color: #94a3b8;
      font-size: 0.75rem;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
      font-weight: 600;
    }
    .palette-id {
      font-family: monospace;
      font-size: 0.85rem;
      color: var(--accent);
    }
    .palette-modes-container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
    }
    @media (max-width: 1024px) {
      .palette-modes-container {
        grid-template-columns: 1fr;
      }
    }
    .palette-mode-box {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
    }
    .dark-box {
      background: #111317;
    }
    .light-box {
      background: #232730;
    }
    .mode-header h3 {
      margin: 0 0 0.75rem 0;
      font-size: 1.1rem;
      color: #e2e8f0;
    }
    .mode-content {
      display: flex;
      gap: 1rem;
      align-items: flex-start;
      margin-bottom: 1rem;
    }
    .arena-preview {
      border-radius: 4px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.5);
      image-rendering: pixelated;
    }
    .scoreboard-preview {
      font-family: monospace;
      font-size: 0.8rem;
      border-collapse: collapse;
      border-radius: 4px;
      overflow: hidden;
      flex: 1;
    }
    .scoreboard-preview th,
    .scoreboard-preview td {
      padding: 0.35rem 0.6rem;
    }
    .swatch-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      padding-top: 0.75rem;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .swatch-group {
      display: flex;
      flex-direction: column;
      align-items: center;
      background: rgba(0, 0, 0, 0.22);
      padding: 0.35rem 0.45rem;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
    .swatch-group-title {
      font-size: 0.68rem;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 0.25rem;
    }
    .swatch-triad {
      display: flex;
      gap: 0.3rem;
    }
    .swatch-sub {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.15rem;
      min-width: 38px;
    }
    .swatch-color {
      width: 28px;
      height: 18px;
      border-radius: 3px;
    }
    .swatch-code {
      font-family: monospace;
      font-size: 0.62rem;
      color: #94a3b8;
    }
    .swatch-sublabel {
      font-size: 0.58rem;
      color: #64748b;
    }

    /* CVD SVG Filters */
    .filter-protanopia { filter: url('#filter-protanopia'); }
    .filter-deuteranopia { filter: url('#filter-deuteranopia'); }
    .filter-tritanopia { filter: url('#filter-tritanopia'); }
    .filter-monochrome { filter: grayscale(100%); }
  </style>
</head>
<body>
  <!-- Embedded CVD SVG Simulation Filters -->
  <svg style="display:none;">
    <defs>
      <!-- Protanopia (Red-Blind) -->
      <filter id="filter-protanopia">
        <feColorMatrix type="matrix" values="0.56667 0.43333 0 0 0  0.55833 0.44167 0 0 0  0 0.24167 0.75833 0 0  0 0 0 1 0" />
      </filter>
      <!-- Deuteranopia (Green-Blind) -->
      <filter id="filter-deuteranopia">
        <feColorMatrix type="matrix" values="0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0" />
      </filter>
      <!-- Tritanopia (Blue-Blind) -->
      <filter id="filter-tritanopia">
        <feColorMatrix type="matrix" values="0.95 0.05 0 0 0  0 0.43333 0.56667 0 0  0 0.475 0.525 0 0  0 0 0 1 0" />
      </filter>
    </defs>
  </svg>

  <header>
    <h1>Bitcycles Multi-Palette Visual Verification Gallery</h1>
    <p class="lead">Interactive visual comparison suite for all 12 curated game color schemes in Light and Dark modes.</p>
    <div class="cvd-controls">
      <span>Color Vision Deficiency (CVD) Simulation:</span>
      <button class="cvd-btn active" data-filter="">Normal (Full Vision)</button>
      <button class="cvd-btn" data-filter="filter-deuteranopia">Deuteranopia (Green-Blind)</button>
      <button class="cvd-btn" data-filter="filter-protanopia">Protanopia (Red-Blind)</button>
      <button class="cvd-btn" data-filter="filter-tritanopia">Tritanopia (Blue-Blind)</button>
      <button class="cvd-btn" data-filter="filter-monochrome">Monochrome</button>
    </div>
  </header>

  <main class="gallery-container" id="gallery-root">
    ${cardsHtml}
  </main>

  <script>
    const cvdButtons = document.querySelectorAll('.cvd-btn');
    const galleryRoot = document.getElementById('gallery-root');

    cvdButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        cvdButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filterClass = btn.dataset.filter;
        
        galleryRoot.className = 'gallery-container ' + filterClass;
      });
    });
  </script>
</body>
</html>
`

fs.mkdirSync(reportsDir, { recursive: true })
fs.writeFileSync(outputPath, fullHtml, 'utf-8')
console.log(`✔ Generated palette gallery at: ${outputPath}`)

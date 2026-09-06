import { AUTO, DARK, LIGHT, DEFAULT_PALETTE, settings } from './settings.js'

const darkThemeMq = window.matchMedia('(prefers-color-scheme: dark)')

export const isDarkMode = () => {
  if (settings.theme === DARK) return true
  if (settings.theme === LIGHT) return false
  return darkThemeMq.matches
}

/**
 * Resolves a light-dark(lightVal, darkVal) CSS expression or returns the raw value.
 * @param {string} value
 * @param {boolean} isDark
 * @returns {string}
 */
const resolveLightDark = (value, isDark) => {
  const trimmed = value.trim()
  if (!trimmed.startsWith('light-dark(')) {
    return trimmed
  }
  const inner = trimmed.slice(11, -1).trim()
  let depth = 0
  let splitIdx = -1
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++
    else if (inner[i] === ')') depth--
    else if (inner[i] === ',' && depth === 0) {
      splitIdx = i
      break
    }
  }
  if (splitIdx !== -1) {
    return isDark
      ? inner.slice(splitIdx + 1).trim()
      : inner.slice(0, splitIdx).trim()
  }
  return trimmed
}

/**
 * Reads computed CSS variables directly from documentElement.
 * @returns {Record<string, string>}
 */
export const getThemeColors = () => {
  const isDark = isDarkMode()
  const style = getComputedStyle(document.documentElement)
  const getVal = (prop) =>
    resolveLightDark(style.getPropertyValue(prop), isDark)

  return {
    bg: getVal('--color-bg'),
    bgHl: getVal('--color-bg-hl'),
    bgMuted: getVal('--color-bg-muted'),
    fg: getVal('--color-fg'),
    fgHl: getVal('--color-fg-hl'),
    fgMuted: getVal('--color-fg-muted'),
    rose: getVal('--color-rose'),
    water: getVal('--color-water'),
    wood: getVal('--color-wood'),
    leaf: getVal('--color-leaf'),
    blossom: getVal('--color-blossom'),
    sky: getVal('--color-sky'),
    rock: getVal('--color-rock'),
  }
}

const themeListeners = new Set()

/**
 * Registers a listener for theme changes.
 * @param {(colors: Record<string, string>) => void} callback
 * @returns {() => void} Unsubscribe function
 */
export const onThemeChange = (callback) => {
  themeListeners.add(callback)
  return () => themeListeners.delete(callback)
}

const notifyThemeChange = () => {
  const colors = getThemeColors()
  themeListeners.forEach((fn) => {
    try {
      fn(colors)
    } catch (err) {
      console.error('Error in theme listener:', err)
    }
  })
}

export const initTheme = () => {
  document.documentElement.style.colorScheme = settings.theme
  document.body.style.colorScheme = settings.theme
  document.documentElement.dataset.palette =
    settings.palette || DEFAULT_PALETTE

  darkThemeMq.addEventListener('change', () => {
    if (settings.theme === AUTO) {
      notifyThemeChange()
    }
  })

  settings.addListener('theme', (theme) => {
    document.documentElement.style.colorScheme = theme
    document.body.style.colorScheme = theme
    notifyThemeChange()
  })

  settings.addListener('palette', (palette) => {
    document.documentElement.dataset.palette = palette
    notifyThemeChange()
  })
}

initTheme()

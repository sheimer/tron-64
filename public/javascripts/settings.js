export const AUTO = 'light dark'
export const LIGHT = 'light'
export const DARK = 'dark'

export const DEFAULT_PALETTE = 'forestbones'

export const FAST = 50
export const NORMAL = 40
export const SLOW = 25
export const SPEED = { FAST, NORMAL, SLOW }

class Settings {
  theme
  palette
  coloredPlayers
  showPalette
  showGamestats
  speed

  listeners

  constructor() {
    this.listeners = {
      theme: new Set(),
      palette: new Set(),
      coloredPlayers: new Set(),
      showGamestats: new Set(),
      showPalette: new Set(),
      speed: new Set(),
    }
    this.theme = JSON.parse(localStorage.getItem('theme')) ?? AUTO
    this.palette =
      JSON.parse(localStorage.getItem('palette')) ?? DEFAULT_PALETTE

    this.coloredPlayers =
      JSON.parse(localStorage.getItem('coloredPlayers')) ?? true

    this.showPalette = JSON.parse(localStorage.getItem('showPalette')) ?? false
    this.showGamestats =
      JSON.parse(localStorage.getItem('showGamestats')) ?? true

    this.speed = JSON.parse(localStorage.getItem('speed')) ?? NORMAL
  }

  set(key, value) {
    if (typeof this[key] === 'undefined') {
      console.log(`${key} is undefined!`)
    }
    localStorage.setItem(key, JSON.stringify(value))
    this[key] = value

    this.listeners[key].forEach((listener) => {
      listener(value)
    })
  }

  addListener(key, listener) {
    if (typeof this[key] === 'undefined') {
      console.log(`${key} is undefined!`)
    }
    this.listeners[key].add(listener)
  }

  removeListener(key, listener) {
    if (typeof this[key] === 'undefined') {
      console.log(`${key} is undefined!`)
    }
    this.listeners[key].delete(listener)
  }
}

export const settings = new Settings()

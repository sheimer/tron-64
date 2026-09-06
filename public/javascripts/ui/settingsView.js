import { LIGHT, DARK, AUTO, SPEED, settings } from '../settings.js'

export class SettingsView {
  constructor() {
    this.elements = {
      theme: {
        [AUTO]: document.getElementById('scheme-auto'),
        [LIGHT]: document.getElementById('scheme-light'),
        [DARK]: document.getElementById('scheme-dark'),
      },
      coloredPlayers: document.querySelector('#colored-players input'),
      showGamestats: document.querySelector('#show-gamestats input'),
      showPalette: document.querySelector('#show-palette input'),
      palette: document.getElementById('game-palette'),
      speed: document.getElementById('game-speed'),
      pingDiv: document.getElementById('ping'),
      paletteDiv: document.getElementById('palette'),
    }

    this.initThemeButtons()
    this.initPaletteSelect()
    this.initCheckboxes()
    this.initSpeedSelect()
    this.initVisibilityListeners()
  }

  initThemeButtons() {
    Object.entries(this.elements.theme).forEach(([theme, button]) => {
      if (button) {
        button.onclick = () => {
          settings.set('theme', theme)
        }
      }
    })

    const updateThemeSelected = (newTheme) => {
      Object.entries(this.elements.theme).forEach(([theme, button]) => {
        if (button) {
          if (theme === newTheme) {
            button.classList.add('selected')
          } else {
            button.classList.remove('selected')
          }
        }
      })
    }

    updateThemeSelected(settings.theme)
    settings.addListener('theme', updateThemeSelected)
  }

  initPaletteSelect() {
    if (this.elements.palette) {
      this.elements.palette.value = settings.palette || 'forestbones'
      this.elements.palette.onchange = (evt) => {
        settings.set('palette', evt.target.value)
      }

      settings.addListener('palette', (newPalette) => {
        if (this.elements.palette) {
          this.elements.palette.value = newPalette
        }
      })
    }
  }

  initCheckboxes() {
    if (this.elements.coloredPlayers) {
      this.elements.coloredPlayers.checked = settings.coloredPlayers
      this.elements.coloredPlayers.onchange = (evt) => {
        settings.set('coloredPlayers', evt.target.checked)
      }
    }

    if (this.elements.showGamestats) {
      this.elements.showGamestats.checked = settings.showGamestats
      this.elements.showGamestats.onchange = (evt) => {
        settings.set('showGamestats', evt.target.checked)
      }
    }

    if (this.elements.showPalette) {
      this.elements.showPalette.checked = settings.showPalette
      this.elements.showPalette.onchange = (evt) => {
        settings.set('showPalette', evt.target.checked)
      }
    }
  }

  initSpeedSelect() {
    if (this.elements.speed) {
      const speedByValue = Object.entries(SPEED).reduce(
        (speeds, [key, value]) => {
          speeds[value] = key
          return speeds
        },
        {},
      )
      this.elements.speed.value = speedByValue[settings.speed] || 'NORMAL'
      this.elements.speed.onchange = (evt) => {
        settings.set('speed', SPEED[evt.target.value])
      }

      settings.addListener('speed', (newSpeed) => {
        if (this.elements.speed) {
          this.elements.speed.value = speedByValue[newSpeed] || 'NORMAL'
        }
      })
    }
  }

  updateSpeed(speedValue) {
    if (this.elements.speed) {
      const speedByValue = Object.entries(SPEED).reduce(
        (speeds, [key, value]) => {
          speeds[value] = key
          return speeds
        },
        {},
      )
      this.elements.speed.value = speedByValue[speedValue] || 'NORMAL'
    }
  }

  setSpectatorMode(isSpectator) {
    if (this.elements.speed) {
      this.elements.speed.disabled = isSpectator
      this.elements.speed.title = isSpectator
        ? 'Spectators cannot change game speed'
        : ''
    }
  }

  initVisibilityListeners() {
    const updateGamestats = (show) => {
      if (this.elements.pingDiv) {
        this.elements.pingDiv.style.visibility = show
          ? 'visible'
          : 'hidden'
      }
    }
    updateGamestats(settings.showGamestats)
    settings.addListener('showGamestats', updateGamestats)

    const updatePalette = (show) => {
      if (this.elements.paletteDiv) {
        this.elements.paletteDiv.style.visibility = show ? 'visible' : 'hidden'
      }
    }
    updatePalette(settings.showPalette)
    settings.addListener('showPalette', updatePalette)
  }
}

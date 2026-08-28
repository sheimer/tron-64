import { CELL_TYPE } from '/shared/constants.js'

export class Renderer {
  constructor({
    blocksize = 2,
    bgColor,
    bordercolor,
    explosioncolor,
    playercolors,
    size = { x: 320, y: 200 },
    id = 'arena',
  }) {
    this.baseBlocksize = blocksize
    this.size = size
    this.id = id

    this.bgColor = bgColor
    this.bordercolor = bordercolor
    this.explosioncolor = explosioncolor
    this.playercolors = playercolors

    this.domCanvas = document.getElementById(id)
    this.canvas = this.domCanvas ? this.domCanvas.getContext('2d') : null

    // Initialize ground-truth grid buffer
    this.fields = []
    for (let x = 0; x < this.size.x; x++) {
      this.fields[x] = new Int8Array(this.size.y).fill(CELL_TYPE.EMPTY)
    }

    this.dprMediaQuery = null
    this.onPixelRatioChange = null
    this.onWindowResize = null
    this.resizeObserver = null

    this.setupDimensions()
    this.setupPixelRatioListener()
    this.redrawAll()
  }

  /**
   * Updates canvas dimensions based on CSS multiplicator and pixel density.
   * For dynamic zoom/DPR monitoring via matchMedia:
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio#monitoring_screen_resolution_or_zoom_level_changes
   */
  setupDimensions() {
    const multiplicatorVal = getComputedStyle(document.body).getPropertyValue(
      '--multiplicator',
    )
    const multiplicator = parseFloat(multiplicatorVal) || 1

    this.blocksize = this.baseBlocksize * multiplicator
    this.width = this.size.x * this.blocksize
    this.height = this.size.y * this.blocksize

    if (this.domCanvas) {
      if (
        this.domCanvas.width !== this.width ||
        this.domCanvas.height !== this.height
      ) {
        this.domCanvas.width = this.width
        this.domCanvas.height = this.height
      }
    }
  }

  /**
   * Listens to screen resolution / zoom level / devicePixelRatio changes and window resizes.
   * Automatically adjusts canvas dimensions and repaints the buffer.
   */
  setupPixelRatioListener() {
    if (typeof window === 'undefined' || !window.matchMedia) return

    this.onPixelRatioChange = () => {
      if (this.dprMediaQuery && this.onPixelRatioChange) {
        this.dprMediaQuery.removeEventListener(
          'change',
          this.onPixelRatioChange,
        )
      }
      this.dprMediaQuery = window.matchMedia(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`,
      )
      this.dprMediaQuery.addEventListener('change', this.onPixelRatioChange)

      this.setupDimensions()
      this.redrawAll()
    }

    this.onWindowResize = () => {
      this.setupDimensions()
      this.redrawAll()
    }

    this.onPixelRatioChange()
    window.addEventListener('resize', this.onWindowResize)

    if (typeof ResizeObserver !== 'undefined' && this.domCanvas) {
      this.resizeObserver = new ResizeObserver(() => {
        this.setupDimensions()
        this.redrawAll()
      })
      this.resizeObserver.observe(this.domCanvas)
    }
  }

  destroy() {
    if (this.dprMediaQuery && this.onPixelRatioChange) {
      this.dprMediaQuery.removeEventListener('change', this.onPixelRatioChange)
    }
    if (this.onWindowResize) {
      window.removeEventListener('resize', this.onWindowResize)
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
    }
  }

  setColors({ bgColor, bordercolor, explosioncolor, playercolors }) {
    if (bgColor) this.bgColor = bgColor
    if (bordercolor) this.bordercolor = bordercolor
    if (explosioncolor) this.explosioncolor = explosioncolor
    if (playercolors) this.playercolors = playercolors

    this.redrawAll()
  }

  /**
   * Updates local grid buffer and renders a single cell on the canvas.
   * @param {number} x
   * @param {number} y
   * @param {number} value
   */
  drawCell(x, y, value) {
    if (x < 0 || x >= this.size.x || y < 0 || y >= this.size.y) {
      return
    }

    this.fields[x][y] = value

    const cx = x * this.blocksize
    const cy = y * this.blocksize

    if (value === CELL_TYPE.EMPTY) {
      this.canvas.fillStyle = this.bgColor
    } else if (value === CELL_TYPE.BORDER) {
      this.canvas.fillStyle = this.bordercolor
    } else if (value === CELL_TYPE.EXPLOSION) {
      this.canvas.fillStyle = this.explosioncolor
    } else if (value >= 0 && value < this.playercolors.length) {
      this.canvas.fillStyle = this.playercolors[value]
    } else {
      return
    }

    this.canvas.fillRect(cx, cy, this.blocksize, this.blocksize)
  }

  /**
   * Delta painting: Only draws modified cells on the canvas.
   * Supports both binary DataView (zero-copy) and Array<[x, y, cellValue]>.
   * @param {DataView | Array<[number, number, number]>} changes
   */
  draw(changes) {
    if (!this.canvas || !changes) {
      return
    }

    if (changes instanceof DataView) {
      const len = changes.byteLength
      // Opcode is byte 0; each cell is 5 bytes (Uint16 x, Uint16 y, Int8 value)
      for (let offset = 1; offset + 5 <= len; offset += 5) {
        this.drawCell(
          changes.getUint16(offset),
          changes.getUint16(offset + 2),
          changes.getInt8(offset + 4),
        )
      }
      return
    }

    if (!changes.length) {
      return
    }

    for (let i = 0; i < changes.length; i++) {
      const [x, y, value] = changes[i]
      this.drawCell(x, y, value)
    }
  }

  /**
   * Full redraw of the entire grid buffer.
   * Used for theme changes, zoom/resize events, or spectator reconnects.
   */
  redrawAll() {
    if (!this.canvas) return

    this.canvas.fillStyle = this.bgColor
    this.canvas.fillRect(0, 0, this.width, this.height)

    const bs = this.blocksize
    for (let x = 0; x < this.size.x; x++) {
      const col = this.fields[x]
      const cx = x * bs
      for (let y = 0; y < this.size.y; y++) {
        const val = col[y]
        if (val === CELL_TYPE.EMPTY) continue

        const cy = y * bs
        if (val === CELL_TYPE.BORDER) {
          this.canvas.fillStyle = this.bordercolor
        } else if (val === CELL_TYPE.EXPLOSION) {
          this.canvas.fillStyle = this.explosioncolor
        } else if (val >= 0 && val < this.playercolors.length) {
          this.canvas.fillStyle = this.playercolors[val]
        } else {
          continue
        }

        this.canvas.fillRect(cx, cy, bs, bs)
      }
    }
  }

  resetGrid() {
    this.setupDimensions()
    const xMax = this.size.x - 1
    const yMax = this.size.y - 1

    for (let x = 0; x < this.size.x; x++) {
      for (let y = 0; y < this.size.y; y++) {
        if (x === 0 || y === 0 || x === xMax || y === yMax) {
          this.fields[x][y] = CELL_TYPE.BORDER
        } else {
          this.fields[x][y] = CELL_TYPE.EMPTY
        }
      }
    }
    this.redrawAll()
  }

  clear() {
    this.setupDimensions()
    for (let x = 0; x < this.size.x; x++) {
      this.fields[x].fill(CELL_TYPE.EMPTY)
    }
    if (this.canvas) {
      this.canvas.fillStyle = this.bgColor
      this.canvas.fillRect(0, 0, this.width, this.height)
    }
  }
}

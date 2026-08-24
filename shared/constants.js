export const GRID_WIDTH = 320
export const GRID_HEIGHT = 200
export const GRID_SIZE = { x: GRID_WIDTH, y: GRID_HEIGHT }
export const BLOCK_SIZE = 2

export const CELL_TYPE = {
  EXPLOSION: -3,
  BORDER: -2,
  EMPTY: -1,
}

export const MAX_PLAYERS = 6
export const MIN_PLAYERS = 2
export const KILLZONE_LENGTH = 32

export const MAX_ACTIVE_GAMES =
  typeof process !== 'undefined' && process.env?.MAX_ACTIVE_GAMES
    ? parseInt(process.env.MAX_ACTIVE_GAMES, 10) || 50
    : 50
export const MAX_CLIENTS_PER_ROOM = 32
export const IDLE_ROOM_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes inactivity cleanup

export const EXPLOSION_MAX_MS_RUNNING = 6000 // Max explosion duration while players are still alive
export const EXPLOSION_MAX_MS_FINISHED = 4000 // Max explosion duration after all/last players crash

export const SPEED = {
  SLOW: 25,
  NORMAL: 40,
  FAST: 50,
}

export const PLAYER_COLOR_KEYS = [
  'water',
  'wood',
  'leaf',
  'blossom',
  'sky',
  'rock',
]

export const START_POSITIONS = [
  { x: 50, y: 50 },
  { x: 270, y: 50 },
  { x: 50, y: 100 },
  { x: 270, y: 100 },
  { x: 50, y: 150 },
  { x: 270, y: 150 },
]

export const AVAILABLE_POSITIONS = [
  [2, 3], // 2 players
  [1, 2, 5], // 3 players
  [0, 1, 4, 5], // 4 players
  [0, 1, 2, 4, 5], // 5 players
  [0, 1, 2, 3, 4, 5], // 6 players
]

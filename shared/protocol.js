export const MSG_TYPE = {
  // Connection / Ping
  PING: 'PING',
  PONG: 'PONG',

  // Lobby actions & events
  LOBBY_LIST: 'LOBBY_LIST',
  CREATE_GAME: 'CREATE_GAME',
  GAME_CREATED: 'GAME_CREATED',
  JOIN_GAME: 'JOIN_GAME',
  LEAVE_GAME: 'LEAVE_GAME',

  // Match configuration & lifecycle
  ADD_PLAYER: 'ADD_PLAYER',
  SET_INTERVAL: 'SET_INTERVAL',
  START_GAME: 'START_GAME',
  CHANGE_DIR: 'CHANGE_DIR',

  // Real-time gameplay events
  GAME_INFO: 'GAME_INFO',
  GAME_STATE: 'GAME_STATE',
  GAME_RESET: 'GAME_RESET',
  ARENA_READY: 'ARENA_READY',
  GAME_DRAW: 'GAME_DRAW',
  GAME_FINISH: 'GAME_FINISH',
  ERROR: 'ERROR',
}

export const BINARY_OPCODE = {
  DRAW: 0x01,
  CHANGE_DIR: 0x02,
}

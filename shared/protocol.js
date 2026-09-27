export const MSG_TYPE = {
  // Connection / Ping
  PING: 'PING',
  PONG: 'PONG',

  // Lobby actions & events
  LOBBY_LIST: 'LOBBY_LIST',
  CREATE_GAME: 'CREATE_GAME',
  GAME_CREATED: 'GAME_CREATED',
  JOIN_GAME: 'JOIN_GAME',
  JOIN_RESULT: 'JOIN_RESULT',
  OWNERSHIP_REVOKED: 'OWNERSHIP_REVOKED',
  LEAVE_GAME: 'LEAVE_GAME',

  // Match configuration & lifecycle
  ADD_PLAYER: 'ADD_PLAYER',
  PLAYER_REGISTERED: 'PLAYER_REGISTERED',
  SET_INTERVAL: 'SET_INTERVAL',
  START_GAME: 'START_GAME',

  // Real-time gameplay events
  GAME_INFO: 'GAME_INFO',
  GAME_STATE: 'GAME_STATE',
  GAME_RESET: 'GAME_RESET',
  ARENA_READY: 'ARENA_READY',
  GAME_DRAW: 'GAME_DRAW',
  GAME_FINISH: 'GAME_FINISH',
  ERROR: 'ERROR',
}

// All client messages carry this version. Binary input is enabled only after
// a versioned room join, preventing old clients from treating handles as IDs.
export const PROTOCOL_VERSION = 2

export const BINARY_OPCODE = {
  DRAW: 0x01,
  CHANGE_DIR: 0x02,
}

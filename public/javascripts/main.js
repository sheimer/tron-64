import './ui/dropdown.js'
import { state } from './state.js'
import { settings } from './settings.js'
import { network } from './network.js'
import { Renderer } from './Renderer.js'
import { getThemeColors, onThemeChange } from './theme.js'
import { WelcomeView } from './ui/welcomeView.js'
import { SettingsView } from './ui/settingsView.js'
import { LobbyView } from './ui/lobbyView.js'
import { ConfigView } from './ui/configView.js'
import { GameView } from './ui/gameView.js'

import { AppCoordinator } from './appCoordinator.js'

export const app = new AppCoordinator({
  state,
  settings,
  network,
  Renderer,
  getThemeColors,
  onThemeChange,
  WelcomeView,
  SettingsView,
  LobbyView,
  ConfigView,
  GameView,
})

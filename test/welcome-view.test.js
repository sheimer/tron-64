import assert from 'node:assert'
import http from 'node:http'
import { app } from '../app.js'
import { state } from '../public/javascripts/state.js'
import { WelcomeView } from '../public/javascripts/ui/welcomeView.js'

async function runTests() {
  console.log('--- Testing Welcome View, Route Rendering & Navigation ---')

  // 1. Test Express Route & Pug Template Rendering
  console.log('1. Verifying Express route rendering for Bitcycles and welcome components...')
  const testServer = http.createServer(app)
  await new Promise((resolve) => testServer.listen(0, resolve))
  const port = testServer.address().port

  const html = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/`, (res) => {
      assert.strictEqual(res.statusCode, 200, 'Expected HTTP 200')
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => resolve(body))
      res.on('error', reject)
    })
  })

  await new Promise((resolve) => testServer.close(resolve))

  assert.ok(html.includes('Bitcycles'), 'HTML should contain Bitcycles title')
  assert.ok(html.includes('id="welcome"'), 'HTML should contain #welcome container')
  assert.ok(html.includes('id="btn-header-enter-lobby"'), 'HTML should contain #btn-header-enter-lobby')
  assert.ok(html.includes('id="btn-info"'), 'HTML should contain #btn-info')
  assert.ok(html.includes('id="modal-legal"'), 'HTML should contain #modal-legal')
  assert.ok(html.includes('id="modal-privacy"'), 'HTML should contain #modal-privacy')
  assert.ok(html.includes('Ultimate Tron II'), 'HTML should reference Ultimate Tron II tribute')
  assert.ok(html.includes('Telemetrie'), 'HTML should mention game telemetry in privacy section')

  // 2. Test State Store Initial Screen and Navigation
  console.log('2. Verifying State store default screen and transitions...')
  assert.strictEqual(state.screen, 'welcome', 'State default screen must be "welcome"')
  
  let screenChanged = null
  const unsub = state.subscribe('screen', (newScreen) => {
    screenChanged = newScreen
  })

  state.setScreen('lobby')
  assert.strictEqual(state.screen, 'lobby')
  assert.strictEqual(screenChanged, 'lobby')

  state.setScreen('welcome')
  assert.strictEqual(state.screen, 'welcome')
  assert.strictEqual(screenChanged, 'welcome')
  unsub()

  // 3. Test WelcomeView DOM Controller Mocking
  console.log('3. Verifying WelcomeView lifecycle and modal controller...')
  const mockListeners = new Map()
  const createMockElement = (id, classList = []) => {
    const classes = new Set(classList)
    return {
      id,
      classList: {
        contains: (cls) => classes.has(cls),
        add: (cls) => classes.add(cls),
        remove: (cls) => classes.delete(cls),
      },
      style: { display: '' },
      addEventListener: (evt, handler) => {
        if (!mockListeners.has(id + ':' + evt)) {
          mockListeners.set(id + ':' + evt, [])
        }
        mockListeners.get(id + ':' + evt).push(handler)
      },
      dispatchEvent: (evtName, evtObj = {}) => {
        const handlers = mockListeners.get(id + ':' + evtName) || []
        handlers.forEach((h) => h(evtObj))
      },
    }
  }

  // Setup minimal DOM globals for WelcomeView unit test
  const originalDocument = global.document
  const originalWindow = global.window

  const elements = {
    'layout': createMockElement('layout'),
    'welcome': createMockElement('welcome'),
    'footer': createMockElement('footer'),
    'btn-header-enter-lobby': createMockElement('btn-header-enter-lobby'),
    'btn-info': createMockElement('btn-info'),
    'modal-legal': createMockElement('modal-legal', ['modal']),
    'modal-privacy': createMockElement('modal-privacy', ['modal']),
    'btn-open-legal': createMockElement('btn-open-legal'),
    'btn-open-privacy': createMockElement('btn-open-privacy'),
    'btn-close-legal': createMockElement('btn-close-legal'),
    'btn-close-privacy': createMockElement('btn-close-privacy'),
  }

  const windowListeners = []
  global.window = {
    addEventListener: (evt, handler) => {
      windowListeners.push({ evt, handler })
    },
  }
  global.document = {
    getElementById: (id) => elements[id] || null,
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute: () => {}, style: {} }),
  }

  let enteredLobbyCount = 0
  const welcomeView = new WelcomeView({
    onEnterLobby: () => {
      enteredLobbyCount++
    },
  })

  // Test header enter lobby button
  elements['btn-header-enter-lobby'].dispatchEvent('click')
  assert.strictEqual(enteredLobbyCount, 1, 'onEnterLobby must be triggered on header button click')

  // Test opening legal modal
  let defaultPrevented = false
  elements['btn-open-legal'].dispatchEvent('click', {
    preventDefault: () => {
      defaultPrevented = true
    },
  })
  assert.strictEqual(defaultPrevented, true)
  assert.strictEqual(elements['modal-legal'].style.display, 'flex')
  assert.strictEqual(elements['modal-privacy'].style.display, 'none')

  // Test closing legal modal via close button
  elements['btn-close-legal'].dispatchEvent('click')
  assert.strictEqual(elements['modal-legal'].style.display, 'none')

  // Test opening privacy modal
  elements['btn-open-privacy'].dispatchEvent('click', {
    preventDefault: () => {},
  })
  assert.strictEqual(elements['modal-privacy'].style.display, 'flex')

  // Test closing modal via Escape key
  const escapeHandler = windowListeners.find((l) => l.evt === 'keydown')?.handler
  assert.ok(escapeHandler, 'Escape key listener should be registered')
  escapeHandler({ key: 'Escape' })
  assert.strictEqual(elements['modal-privacy'].style.display, 'none')

  // Test show / hide
  welcomeView.hide()
  assert.strictEqual(elements['welcome'].style.display, 'none')
  assert.strictEqual(elements['btn-header-enter-lobby'].style.display, 'none')
  assert.strictEqual(elements['btn-info'].style.display, '')
  assert.strictEqual(elements['layout'].classList.contains('screen-welcome'), false)

  welcomeView.show()
  assert.strictEqual(elements['welcome'].style.display, '')
  assert.strictEqual(elements['btn-header-enter-lobby'].style.display, '')
  assert.strictEqual(elements['btn-info'].style.display, 'none')
  assert.strictEqual(elements['layout'].classList.contains('screen-welcome'), true)

  // Restore globals
  global.document = originalDocument
  global.window = originalWindow

  console.log('--- ALL WELCOME VIEW UNIT & ROUTE TESTS PASSED! ---')
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

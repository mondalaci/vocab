/**
 * The overlay itself: one frameless, transparent, always-on-top window that
 * stays hidden until the hotkey is pressed.
 *
 * It is also the whole backend. SQLite, OpenRouter, Wikipedia and speech used to
 * live in a separate express process reached over loopback HTTP; they are now
 * imported here and the renderer talks to them over IPC. There is no port, no
 * static server and nothing on the network — just this window.
 *
 * `main.mjs` is bundled by esbuild into `dist-electron/main.mjs` (see
 * `npm run build:main`) so it can import the TypeScript modules in `server/`.
 */
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  net,
  protocol,
  screen,
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadConfig } from '../server/config.ts'
import { createService } from '../server/service.ts'
import { registerApi } from '../server/ipc.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const distDir = path.join(projectRoot, 'dist')

/** Speech clips: `vocab://tts/<file>.wav`. */
const SCHEME = 'vocab'
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

// Before anything else: give this app its own identity. Run as a bare script,
// Electron would call itself "Electron" and share ~/.config/Electron with every
// other Electron app on the machine — whose single-instance lock then makes this
// one quit on startup.
app.setName('vocab')
app.setPath('userData', path.join(app.getPath('appData'), 'vocab'))

const loaded = await loadConfig()
const config = loaded.config
const service = createService(config, loaded)

const hasBuild = fs.existsSync(path.join(distDir, 'index.html'))
const devUrl = (process.env.VOCAB_OVERLAY_URL || config.overlay.url || '').trim()
const targetUrl = devUrl || `${SCHEME}://app/`
const hotkey = process.env.VOCAB_HOTKEY?.trim() || config.hotkey

let overlayWindow = null
let hideOnBlur = Boolean(config.overlay.hideOnBlur)
let retries = 0

function bounds() {
  // Work area, so a panel or dock is not covered up.
  const { workArea } = screen.getPrimaryDisplay()
  return workArea
}

/** Static files for the `vocab://app/` origin, straight from dist/. */
function serveFromDist(pathname) {
  const relative =
    pathname === '' || pathname === '/'
      ? 'index.html'
      : decodeURIComponent(pathname).replace(/^\/+/, '')
  const file = path.resolve(distDir, relative)
  if (file !== distDir && !file.startsWith(distDir + path.sep)) {
    return new Response('Not found', { status: 404 })
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return new Response('Not found', { status: 404 })
  }
  return net.fetch(pathToFileURL(file).href)
}

function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host === 'app') return serveFromDist(url.pathname)

    if (url.host === 'tts') {
      const name = path.basename(decodeURIComponent(url.pathname))
      const file = service.ttsFile(name)
      if (!file) return new Response('No such clip.', { status: 404 })
      return net.fetch(pathToFileURL(file).href)
    }

    return new Response('Not found', { status: 404 })
  })
}

/** The renderer's view of the backend: invoke for calls, send for cancellation. */
function registerTransport() {
  registerApi(
    {
      handle: (method, handler) =>
        ipcMain.handle(`${SCHEME}:${method}`, (event, payload) =>
          handler(payload, {
            send: (channel, data) => {
              if (!event.sender.isDestroyed()) event.sender.send(`${SCHEME}:${channel}`, data)
            },
          }),
        ),
      receive: (message, handler) =>
        ipcMain.on(`${SCHEME}:${message}`, (_event, payload) => handler(payload)),
    },
    service,
  )
}

function createWindow() {
  const area = bounds()
  overlayWindow = new BrowserWindow({
    ...area,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: Boolean(config.overlay.skipTaskbar),
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(projectRoot, 'electron', 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM preload scripts need the sandbox off; nothing else is exposed.
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  overlayWindow.on('blur', () => {
    if (hideOnBlur) hide()
  })

  // 'screen-saver' is the level that stays above ordinary windows and most
  // fullscreen games; workspaces are included so a switch does not lose it.
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWindow.setIgnoreMouseEvents(false)

  load()
}

/** A dev server may still be starting — keep trying. A missing build is fatal. */
function load() {
  if (!devUrl && !hasBuild) {
    overlayWindow.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          '<body style="background:#0b0b0f;color:#ddd;font:15px system-ui;padding:2rem">' +
            '<h1 style="font-size:17px">No build yet</h1>' +
            '<p>Run <code>npm run build</code> in the vocab project, then restart the overlay.</p>',
        ),
    )
    return
  }
  overlayWindow
    .loadURL(targetUrl)
    .then(() => {
      retries = 0
    })
    .catch((error) => {
      if (retries > 30) {
        console.error('[overlay] giving up on', targetUrl, error.message)
        return
      }
      retries += 1
      setTimeout(() => {
        if (overlayWindow && !overlayWindow.isDestroyed()) load()
      }, 1500)
    })
}

function show() {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (retries > 0) load()
  overlayWindow.setBounds(bounds())
  overlayWindow.show()
  overlayWindow.focus()
  overlayWindow.webContents.send('overlay:shown')
}

function hide() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  overlayWindow.webContents.send('overlay:hidden')
  overlayWindow.hide()
}

function toggle() {
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) hide()
  else show()
}

const lock = app.requestSingleInstanceLock()
console.log(`[overlay] userData ${app.getPath('userData')} · single-instance lock ${lock}`)
if (!lock) {
  console.error('[overlay] another overlay is already running — leaving this one to quit')
  app.quit()
} else {
  app.on('second-instance', () => show())
}

app.whenReady().then(() => {
  registerProtocol()
  registerTransport()
  createWindow()

  const registered = globalShortcut.register(hotkey, toggle)
  if (!registered) {
    console.error(`[overlay] could not grab "${hotkey}" — is another app holding it?`)
  }
  console.log(`[overlay] ${hotkey} toggles the window`)
  console.log(`[overlay] loading ${targetUrl}`)
  console.log(
    `[overlay] database ${service.status().database} · config ${loaded.file}${loaded.usingDefaults ? ' (missing, using defaults)' : ''}`,
  )

  if (process.env.VOCAB_DEBUG) {
    const beat = setInterval(() => {
      console.log(
        '[overlay] alive, windows:',
        BrowserWindow.getAllWindows().length,
        'visible:',
        overlayWindow?.isVisible(),
        'destroyed:',
        overlayWindow?.isDestroyed(),
      )
    }, 1500)
    beat.unref?.()
    overlayWindow.on('close', () => console.log('[overlay] window close'))
    overlayWindow.on('closed', () => console.log('[overlay] window closed'))
    overlayWindow.webContents.on('render-process-gone', (_e, details) =>
      console.log('[overlay] renderer gone:', details.reason),
    )
    overlayWindow.webContents.on('did-finish-load', () => console.log('[overlay] page loaded'))
    overlayWindow.webContents.on('did-fail-load', (_e, code, description) =>
      console.log('[overlay] load failed:', code, description),
    )
    process.on('exit', (code) => console.log('[overlay] process exiting', code))
  }

  // Escape and the ✕ come through here, as does the blur preference.
  ipcMain.on('overlay:hide', () => hide())
  ipcMain.on('overlay:quit', () => app.quit())
  ipcMain.on('overlay:hideOnBlur', (_event, enabled) => {
    hideOnBlur = Boolean(enabled)
  })
})

app.on('window-all-closed', () => {
  // Closing the window would mean closing the app; the hotkey owns its life —
  // the window is only ever hidden, so reaching this means something went wrong.
  console.error('[overlay] every window closed; quitting (this should not happen)')
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => console.log('[overlay] quitting'))
app.on('child-process-gone', (_event, details) => {
  console.error('[overlay] a child process died:', details.type, details.reason)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

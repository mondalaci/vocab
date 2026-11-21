/**
 * The overlay itself: one frameless, transparent, always-on-top window that
 * stays hidden until the hotkey is pressed.
 *
 * It is a normal Electron main process (Node), which is what makes the global
 * shortcut solid — `globalShortcut` grabs the key through X11 rather than
 * polling for it, which is the part that every "osd" package got wrong.
 */
import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')

// Before anything else: give this app its own identity. Run as a bare script,
// Electron would call itself "Electron" and share ~/.config/Electron with every
// other Electron app on the machine — whose single-instance lock then makes this
// one quit on startup.
app.setName('vocab')
app.setPath('userData', path.join(app.getPath('appData'), 'vocab'))
// Note: run unpackaged, Electron reports WM_CLASS "electron" whatever we call
// ourselves. It does not matter here — the window is skipped from the taskbar.

const DEFAULTS = {
  hotkey: 'Control+Alt+Shift+F12',
  server: { port: 8787, host: '127.0.0.1' },
  overlay: { url: '', scrim: 0.55, hideOnBlur: false, skipTaskbar: true },
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function merge(base, override) {
  if (!isPlainObject(override)) return base
  const out = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? merge(out[key], value) : value
  }
  return out
}

async function readConfig(file) {
  if (!fs.existsSync(file)) return undefined
  const url = `${pathToFileURL(file).href}?v=${fs.statSync(file).mtimeMs}`
  return (await import(url)).default
}

const config = merge(
  merge(DEFAULTS, await readConfig(path.join(projectRoot, 'config.example.mjs'))),
  await readConfig(process.env.VOCAB_CONFIG || path.join(projectRoot, 'config.mjs')),
)

const host = config.server.host === '0.0.0.0' ? '127.0.0.1' : config.server.host
const targetUrl =
  process.env.VOCAB_OVERLAY_URL?.trim() ||
  config.overlay.url?.trim() ||
  `http://${host}:${config.server.port}/`

const hotkey = process.env.VOCAB_HOTKEY?.trim() || config.hotkey

let overlayWindow = null
let hideOnBlur = Boolean(config.overlay.hideOnBlur)
let retries = 0

function bounds() {
  // Work area, so a panel or dock is not covered up.
  const { workArea } = screen.getPrimaryDisplay()
  return workArea
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
      preload: path.join(here, 'preload.mjs'),
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

/** The server may still be starting (or restarting under pm2) — keep trying. */
function load() {
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
  createWindow()

  const registered = globalShortcut.register(hotkey, toggle)
  if (!registered) {
    console.error(`[overlay] could not grab "${hotkey}" — is another app holding it?`)
  }
  console.log(`[overlay] ${hotkey} toggles the window`)
  console.log(`[overlay] loading ${targetUrl}`)

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

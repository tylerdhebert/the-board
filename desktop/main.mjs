import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { boundsOnScreen, loadWindowState, saveWindowState } from './windowState.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..')
const WINDOW_STATE_PATH = path.join(__dirname, '.window-state.json')

const DEFAULT_BOUNDS = { width: 1600, height: 1000 }

app.commandLine.appendSwitch(
  'remote-debugging-port',
  process.env.TUTOR_CDP_PORT ?? '9223',
)
// Keep the compositor painting when the window is covered by other windows —
// otherwise capturePage() fails with UnknownVizError, which makes screenshot
// tooling flaky depending on what happens to be on top (observed live).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

const smoke = process.argv.includes('--smoke')
let win = null
let saveTimer = null
/** Last non-maximized bounds while the window is alive. */
let lastNormal = { ...DEFAULT_BOUNDS }

function pad2(n) {
  return String(n).padStart(2, '0')
}

function shotStamp() {
  const d = new Date()
  return {
    day: `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    time: `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`,
  }
}

function sendMaximized() {
  if (!win || win.isDestroyed()) return
  win.webContents.send('win:maximized-changed', win.isMaximized())
}

function rememberNormalBounds() {
  if (!win || win.isDestroyed() || win.isMaximized()) return
  const b = win.getBounds()
  lastNormal = { x: b.x, y: b.y, width: b.width, height: b.height }
}

function persistWindowState() {
  if (!win || win.isDestroyed()) return
  rememberNormalBounds()
  const maximized = win.isMaximized()
  const state = {
    maximized,
    x: lastNormal.x,
    y: lastNormal.y,
    width: lastNormal.width,
    height: lastNormal.height,
  }
  try {
    saveWindowState(state, WINDOW_STATE_PATH)
  } catch {
    /* best-effort */
  }
}

function schedulePersist() {
  if (saveTimer != null) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (win && !win.isDestroyed() && !win.isMaximized()) persistWindowState()
  }, 500)
}

ipcMain.on('win:minimize', () => {
  win?.minimize()
})

ipcMain.on('win:close', () => {
  win?.close()
})

ipcMain.on('win:toggle-maximize', () => {
  if (!win) return
  if (win.isMaximized()) {
    win.unmaximize()
  } else {
    rememberNormalBounds()
    win.maximize()
  }
})

ipcMain.handle('win:is-maximized', () => win?.isMaximized() ?? false)

ipcMain.handle('debug:capture', async (_event, opts = {}) => {
  if (!win) throw new Error('Main window is not available')
  const { day, time } = shotStamp()
  const name = opts.name?.trim() || `shot-${time}.png`
  const parts = [repoRoot, '.shots', day]
  if (opts.outDir?.trim()) parts.push(opts.outDir.trim())
  const dir = path.join(...parts)
  const outputPath = path.join(dir, name)
  await mkdir(dir, { recursive: true })
  const image = await win.webContents.capturePage()
  const png = image.toPNG()
  await writeFile(outputPath, png)
  return {
    path: outputPath,
    sha256: createHash('sha256').update(png).digest('hex'),
  }
})

function createWindow() {
  const saved = loadWindowState(WINDOW_STATE_PATH)
  const opts = {
    frame: false,
    backgroundColor: '#16241d',
    width: DEFAULT_BOUNDS.width,
    height: DEFAULT_BOUNDS.height,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  }
  if (saved) {
    opts.width = saved.width
    opts.height = saved.height
    lastNormal = {
      width: saved.width,
      height: saved.height,
      ...(saved.x != null ? { x: saved.x } : {}),
      ...(saved.y != null ? { y: saved.y } : {}),
    }
    if (
      saved.x != null &&
      saved.y != null &&
      boundsOnScreen(
        { x: saved.x, y: saved.y, width: saved.width, height: saved.height },
        screen.getAllDisplays(),
      )
    ) {
      opts.x = saved.x
      opts.y = saved.y
    }
  }

  win = new BrowserWindow(opts)
  rememberNormalBounds()

  win.on('maximize', () => {
    // Capture normal bounds before Electron reports maximized (already too late
    // for getBounds — use lastNormal remembered on prior resize/move).
    sendMaximized()
    persistWindowState()
  })
  win.on('unmaximize', () => {
    sendMaximized()
    persistWindowState()
  })
  win.on('resize', () => {
    rememberNormalBounds()
    schedulePersist()
  })
  win.on('move', () => {
    rememberNormalBounds()
    schedulePersist()
  })

  win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'd') {
      win?.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  if (process.env.TUTOR_OPEN_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  if (saved?.maximized) win.maximize()

  void win.loadURL(process.env.TUTOR_WEB_URL ?? 'http://localhost:5173')
}

app.whenReady().then(() => {
  if (smoke) {
    process.stdout.write('smoke ok\n')
    app.quit()
    return
  }
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
  win = null
})

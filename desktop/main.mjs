import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { boundsOnScreen, loadWindowState, saveWindowState } from './windowState.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..')
const WINDOW_STATE_PATH = app.isPackaged
  ? path.join(app.getPath('userData'), 'window-state.json')
  : path.join(__dirname, '.window-state.json')
const isWin = process.platform === 'win32'

const DEFAULT_BOUNDS = { width: 1600, height: 1000 }

const debugSurface =
  !app.isPackaged || process.env.TUTOR_DEBUG === '1'

if (debugSurface) {
  app.commandLine.appendSwitch(
    'remote-debugging-port',
    process.env.TUTOR_CDP_PORT ?? '9223',
  )
}
// Keep the compositor painting when the window is covered by other windows —
// otherwise capturePage() fails with UnknownVizError, which makes screenshot
// tooling flaky depending on what happens to be on top (observed live).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
}

const smoke = process.argv.includes('--smoke')
let win = null
let saveTimer = null
/** Last non-maximized bounds while the window is alive. */
let lastNormal = { ...DEFAULT_BOUNDS }
/** @type {import('node:child_process').ChildProcess | null} */
let apiChild = null
let apiStderr = []
let shuttingDown = false

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

function killApiChild() {
  if (!apiChild?.pid || apiChild.killed) return
  const pid = apiChild.pid
  apiChild = null
  if (isWin) {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* ignore */
    }
  }
}

function waitForTutorReady(child, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`API did not emit TUTOR_READY within ${timeoutMs}ms`))
    }, timeoutMs)

    const onData = (chunk) => {
      buf += chunk.toString('utf8')
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('TUTOR_READY ')) continue
        try {
          const payload = JSON.parse(trimmed.slice('TUTOR_READY '.length))
          if (typeof payload.port === 'number') {
            cleanup()
            resolve(payload.port)
            return
          }
        } catch {
          /* keep scanning */
        }
      }
    }

    const onExit = (code) => {
      cleanup()
      reject(new Error(`API exited before ready (code ${code})`))
    }

    const cleanup = () => {
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.off('exit', onExit)
    }

    child.stdout?.on('data', onData)
    child.on('exit', onExit)
  })
}

function startPackagedApi() {
  const R = process.resourcesPath
  const serverPath = path.join(R, 'server', 'server.cjs')
  const userData = app.getPath('userData')
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: '0',
      TUTOR_DATA_DIR: userData,
      TUTOR_SCRATCH_DIR: path.join(userData, 'scratch'),
      TUTOR_WEB_DIST: path.join(R, 'web-dist'),
      TUTOR_SEED_CARDS: path.join(R, 'seed-cards'),
      TUTOR_PYRIGHT_PATH: path.join(R, 'pyright', 'langserver.index.js'),
      TUTOR_PROMPTS_DIR: path.join(R, 'prompts'),
      TUTOR_SCHEMA_PATH: path.join(R, 'schema.json'),
      TUTOR_TS_RUNNER: 'strip',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  apiChild = child
  apiStderr = []
  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString('utf8')
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue
      apiStderr.push(line)
      if (apiStderr.length > 20) apiStderr.shift()
    }
  })
  child.on('exit', (code) => {
    if (shuttingDown || apiChild !== child) return
    apiChild = null
    const tail = apiStderr.join('\n') || '(no stderr)'
    dialog.showErrorBox(
      'The Board',
      `The tutor API exited unexpectedly (code ${code}).\n\n${tail}`,
    )
    app.quit()
  })
  return waitForTutorReady(child)
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

if (debugSurface) {
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
}

function createWindow(webUrl) {
  const saved = loadWindowState(WINDOW_STATE_PATH)
  const opts = {
    frame: false,
    backgroundColor: '#16241d',
    width: DEFAULT_BOUNDS.width,
    height: DEFAULT_BOUNDS.height,
    // Low enough to fit a portrait 1080 monitor (even at 125–150% display
    // scaling). The renderer switches to compact mode well before this.
    minWidth: 720,
    minHeight: 600,
    icon: path.join(__dirname, 'build', 'icon.png'),
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
  win.on('close', () => {
    killApiChild()
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

  // External links (e.g. the "on leetcode" statement link) go to the browser,
  // never to a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  void win.loadURL(webUrl)
}

app.on('before-quit', () => {
  shuttingDown = true
  killApiChild()
})

if (gotLock) {
  app.whenReady().then(async () => {
    if (smoke) {
      process.stdout.write('smoke ok\n')
      app.quit()
      return
    }

    try {
      let webUrl
      if (app.isPackaged) {
        const port = await startPackagedApi()
        webUrl = `http://127.0.0.1:${port}`
      } else {
        webUrl = process.env.TUTOR_WEB_URL ?? 'http://localhost:5173'
      }
      createWindow(webUrl)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      dialog.showErrorBox('The Board', message)
      shuttingDown = true
      killApiChild()
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
    win = null
  })
}

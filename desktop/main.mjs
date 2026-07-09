import { app, BrowserWindow, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..')

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

ipcMain.on('win:minimize', () => {
  win?.minimize()
})

ipcMain.on('win:close', () => {
  win?.close()
})

ipcMain.on('win:toggle-maximize', () => {
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
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
  win = new BrowserWindow({
    frame: false,
    backgroundColor: '#16241d',
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  win.on('maximize', sendMaximized)
  win.on('unmaximize', sendMaximized)

  win.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'd') {
      win?.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  if (process.env.TUTOR_OPEN_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' })
  }

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

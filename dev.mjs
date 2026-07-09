// Run the API server and the web dev server together with reliable cleanup.
//
// The subtlety with `concurrently` on Windows: it kills its DIRECT child, but the
// grandchildren (npm -> tsx -> node, or npm -> vite -> esbuild service) can be
// left orphaned holding the port. This launcher force-kills the whole process
// TREE of each child on exit, and tears the other side down when one dies.
//
//   npm run dev                        # api :8787, web :5173
//   SERVER_PORT=8801 WEB_PORT=5199 npm run dev
import { spawn } from 'node:child_process'

const isWin = process.platform === 'win32'
const SERVER_PORT = process.env.SERVER_PORT || '8787'
const WEB_PORT = process.env.WEB_PORT || '5173'

const children = []
let shuttingDown = false

function log(name, color, chunk) {
  const text = chunk.toString().replace(/\s+$/, '')
  if (text) process.stdout.write(`\x1b[${color}m[${name}]\x1b[0m ${text}\n`)
}

function start(name, color, args, env) {
  // npm is npm.cmd on Windows, so go through a shell there. detached on POSIX
  // puts the child in its own process group so we can kill the whole group.
  const p = spawn('npm', args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    shell: isWin,
    detached: !isWin,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  p.stdout.on('data', (d) => log(name, color, d))
  p.stderr.on('data', (d) => log(name, color, d))
  p.on('exit', (code) => {
    log(name, color, Buffer.from(`exited (${code})`))
    if (!shuttingDown) shutdown(code ?? 1)
  })
  children.push(p)
  return p
}

function killTree(p) {
  if (!p.pid || p.killed) return
  if (isWin) {
    spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-p.pid, 'SIGTERM') // negative pid = the whole process group
    } catch {
      try { p.kill('SIGTERM') } catch {}
    }
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  process.stdout.write('\nshutting down both servers…\n')
  for (const p of children) killTree(p)
  setTimeout(() => process.exit(code), 500)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

start('api', '36', ['--prefix', 'server', 'run', 'start'], { PORT: SERVER_PORT })
start('web', '35', ['--prefix', 'web', 'run', 'dev', '--', '--port', WEB_PORT, '--strictPort'], {})
process.stdout.write(`\napi  →  http://localhost:${SERVER_PORT}\nweb  →  http://localhost:${WEB_PORT}   (open this)\n\n`)

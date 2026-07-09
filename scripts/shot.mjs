import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CDP_PORT = process.env.TUTOR_CDP_PORT ?? '9223'
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function pad2(n) {
  return String(n).padStart(2, '0')
}

function dayStamp() {
  const d = new Date()
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function timeStamp() {
  const d = new Date()
  return `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
}

function usage() {
  return `Usage:
  node scripts/shot.mjs capture [--name x.png] [--out-dir slug]
  node scripts/shot.mjs eval "<js>"

Connects to Electron CDP on port ${CDP_PORT} (override with TUTOR_CDP_PORT).
Start the desktop shell first: npm run desktop`
}

async function getTargets() {
  let res
  try {
    res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`)
  } catch (err) {
    throw new Error(
      `No CDP target on port ${CDP_PORT} (${err instanceof Error ? err.message : String(err)}). Start with: npm run desktop`,
    )
  }
  if (!res.ok) {
    throw new Error(`CDP /json returned ${res.status} on port ${CDP_PORT}`)
  }
  const targets = await res.json()
  return Array.isArray(targets) ? targets : []
}

function pickPageTarget(targets) {
  return targets.find(
    (t) =>
      t.type === 'page' &&
      typeof t.url === 'string' &&
      t.url.includes('localhost:5173') &&
      !t.url.startsWith('devtools://'),
  )
}

function createCdpClient(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()

  ws.onmessage = (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
    if (!message.id) return
    const resolvers = pending.get(message.id)
    if (!resolvers) return
    pending.delete(message.id)
    if (message.error) {
      resolvers.reject(new Error(JSON.stringify(message.error)))
      return
    }
    resolvers.resolve(message.result)
  }

  function send(method, params = {}) {
    const requestId = ++id
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject })
      ws.send(JSON.stringify({ id: requestId, method, params }))
    })
  }

  async function connect() {
    await new Promise((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = (e) => reject(e instanceof Error ? e : new Error('WebSocket error'))
    })
    await send('Runtime.enable')
  }

  async function evaluate(expression) {
    return send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
  }

  function close() {
    ws.close()
  }

  return { connect, evaluate, send, close }
}

function parseCaptureArgs(argv) {
  let name
  let outDir
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--name') {
      name = argv[++i]
      if (!name) throw new Error('--name requires a value')
      continue
    }
    if (arg === '--out-dir') {
      outDir = argv[++i]
      if (!outDir) throw new Error('--out-dir requires a value')
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return { name, outDir }
}

async function cdpFallbackCapture(client, { name, outDir }) {
  await client.send('Page.enable')
  const result = await client.send('Page.captureScreenshot', { format: 'png' })
  const png = Buffer.from(result.data, 'base64')
  const day = dayStamp()
  const fileName = name?.trim() || `shot-${timeStamp()}.png`
  const parts = [repoRoot, '.shots', day]
  if (outDir?.trim()) parts.push(outDir.trim())
  const dir = path.join(...parts)
  await mkdir(dir, { recursive: true })
  const outputPath = path.join(dir, fileName)
  await writeFile(outputPath, png)
  return {
    path: outputPath,
    sha256: createHash('sha256').update(png).digest('hex'),
  }
}

async function runCapture(argv) {
  const opts = parseCaptureArgs(argv)
  const targets = await getTargets()
  const target = pickPageTarget(targets)
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(
      `No CDP page target for localhost:5173 on port ${CDP_PORT}. Start with: npm run desktop`,
    )
  }

  const client = createCdpClient(target.webSocketDebuggerUrl)
  try {
    await client.connect()
    const optsLiteral = JSON.stringify({
      ...(opts.name ? { name: opts.name } : {}),
      ...(opts.outDir ? { outDir: opts.outDir } : {}),
    })
    const evalResult = await client.evaluate(
      `window.tutorDesktop ? window.tutorDesktop.captureShot(${optsLiteral}) : null`,
    )
    if (evalResult.exceptionDetails) {
      const text =
        evalResult.exceptionDetails.exception?.description ||
        evalResult.exceptionDetails.text ||
        'Runtime.evaluate failed'
      throw new Error(text)
    }
    let shot = evalResult.result?.value
    if (!shot || typeof shot.path !== 'string') {
      shot = await cdpFallbackCapture(client, opts)
    }
    process.stdout.write(`${shot.path}  ${shot.sha256}\n`)
  } finally {
    client.close()
  }
}

async function runEval(expression) {
  if (!expression) throw new Error('eval requires a JavaScript expression')
  const targets = await getTargets()
  const target = pickPageTarget(targets)
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(
      `No CDP page target for localhost:5173 on port ${CDP_PORT}. Start with: npm run desktop`,
    )
  }

  const client = createCdpClient(target.webSocketDebuggerUrl)
  try {
    await client.connect()
    const evalResult = await client.evaluate(expression)
    if (evalResult.exceptionDetails) {
      const text =
        evalResult.exceptionDetails.exception?.description ||
        evalResult.exceptionDetails.text ||
        'Runtime.evaluate failed'
      process.stderr.write(`${text}\n`)
      process.exitCode = 1
      return
    }
    const value = evalResult.result?.value
    process.stdout.write(`${JSON.stringify(value)}\n`)
  } finally {
    client.close()
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(`${usage()}\n`)
    return
  }
  if (cmd === 'capture') {
    await runCapture(rest)
    return
  }
  if (cmd === 'eval') {
    await runEval(rest.join(' '))
    return
  }
  throw new Error(`Unknown subcommand: ${cmd}\n${usage()}`)
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import CodeEditor from './CodeEditor'
import { mdLength, parseMd, renderMd } from './md'
import {
  addTake,
  chalkStress,
  createSession,
  getProblems,
  getSession,
  getSettings,
  putSettings,
  runExamples,
  saveEditor,
  startSession,
  submitTurn,
  type AppSettingsModels,
  type PersistedTake,
  type Problem,
  type ProblemSummary,
  type RunCaseResult,
  type StudentRunResult,
  type TurnStage,
  type Vocab,
} from './api'
import WindowControls from './WindowControls'

const LANGS = ['csharp', 'typescript', 'python', 'javascript'] as const
const RUNNABLE = new Set(['python', 'typescript', 'javascript', 'csharp'])

// Monaco language id -> LeetCode langSlug (for picking the starter scaffold).
const LANG_SLUG: Record<string, string> = {
  csharp: 'csharp',
  typescript: 'typescript',
  python: 'python3',
  javascript: 'javascript',
  java: 'java',
  cpp: 'cpp',
  go: 'golang',
}

function snippetFor(problem: Problem | null, lang: string): string {
  const slug = LANG_SLUG[lang] ?? lang
  return problem?.codeSnippets?.find((s) => s.langSlug === slug)?.code ?? ''
}

/** Right-trim every line, drop trailing blank lines. Indentation still counts. */
export function normalizeForDirty(code: string): string {
  return code
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n+$/, '')
}

function difficultyClass(d: string): string {
  const lower = d.toLowerCase()
  if (lower === 'easy') return 'easy'
  if (lower === 'medium') return 'medium'
  if (lower === 'hard') return 'hard'
  return 'medium'
}

function officialCases(res: StudentRunResult): RunCaseResult[] {
  return res.cases.filter((c) => !c.stress)
}

function stressCases(res: StudentRunResult): RunCaseResult[] {
  return res.cases.filter((c) => c.stress)
}

function takeAllPass(t: PersistedTake): boolean {
  const res = t.results
  if (res == null || res.error) return false
  const official = officialCases(res)
  return official.length > 0 && official.every((c) => c.pass)
}

function takeScoreLabel(t: PersistedTake, knownTotal: number | null): string {
  const res = t.results
  if (res == null || res.error) {
    return knownTotal == null ? '–/–' : `–/${knownTotal}`
  }
  const official = officialCases(res)
  const tougher = stressCases(res)
  const oPass = official.filter((c) => c.pass).length
  const base = `${oPass}/${official.length}`
  if (tougher.length === 0) return base
  const tPass = tougher.filter((c) => c.pass).length
  return `${base} · ${tPass}/${tougher.length} tough`
}

function LoadingBoard({ query, ingesting }: { query: string; ingesting: boolean }) {
  const steps = ingesting
    ? [
        `finding “${query}” on the board…`,
        'reading the problem…',
        'working it out myself first — so I never mislead you…',
        'checking my solution against the examples…',
        'almost ready…',
      ]
    : ['pulling it up…']
  const [i, setI] = useState(0)
  useEffect(() => {
    setI(0)
    if (!ingesting) return
    const t = setInterval(() => setI((v) => (v + 1 < steps.length ? v + 1 : v)), 6500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingesting, query])
  return (
    <div className="loadingboard">
      <svg className="chalk-spin" viewBox="0 0 80 80" width="76" height="76" aria-hidden="true">
        <g className="spin-ring">
          <circle cx="40" cy="40" r="31" fill="none" stroke="#f0c34a" strokeWidth="2.4" strokeDasharray="17 13" filter="url(#chalk-rough)" />
        </g>
        <text x="40" y="52" textAnchor="middle" fontFamily="Bricolage Grotesque, sans-serif" fontWeight="800" fontSize="30" fill="#ece6d6">Σ</text>
      </svg>
      <p className="load-step">{steps[i]}</p>
      {ingesting && (
        <p className="load-note">
          first time for this one — fetching it and working it through takes about 30–60s. after
          this it’s cached and instant.
        </p>
      )}
    </div>
  )
}

type Mode = 'socratic' | 'analog' | 'scaffold'
type Note = {
  role: 'student' | 'tutor'
  text: string
  mode?: Mode
  unlocked?: string[]
  redrafted?: boolean
  revealing?: boolean
}

const STAGE_COPY: Record<TurnStage, string> = {
  unlock: "checking what you've earned…",
  draft: 'thinking about your move…',
  gate: "making sure i'm not giving it away…",
  redraft: 'rewording — i almost said too much…',
}

function RevealingText({
  text,
  onDone,
  onGrow,
}: {
  text: string
  onDone: () => void
  onGrow: () => void
}) {
  const [n, setN] = useState(0)
  const doneRef = useRef(false)
  const onDoneRef = useRef(onDone)
  const onGrowRef = useRef(onGrow)
  onDoneRef.current = onDone
  onGrowRef.current = onGrow

  // Reveal budget runs over parsed segments (markdown markers excluded), so
  // code/bold style in as they appear instead of raw backticks popping.
  const segs = useMemo(() => parseMd(text), [text])
  const total = useMemo(() => mdLength(segs), [segs])

  useEffect(() => {
    const t = setInterval(() => {
      setN((v) => {
        if (v >= total) return v
        return Math.min(v + 3, total)
      })
    }, 16)
    return () => clearInterval(t)
  }, [total])

  useEffect(() => {
    onGrowRef.current()
    if (n >= total && !doneRef.current) {
      doneRef.current = true
      onDoneRef.current()
    }
  }, [n, total])

  function finish() {
    if (doneRef.current) return
    setN(total)
  }

  const done = n >= total
  return (
    <p className="say" onClick={finish} style={done ? undefined : { cursor: 'pointer' }}>
      {renderMd(segs, n)}
      {!done && <span className="caret">▌</span>}
    </p>
  )
}

const MARGIN_WIDTH_KEY = 'the-board:margin-width'
const MARGIN_MIN_PX = 240
const DESK_MIN_PX = 420
const COMPOSER_LINE_PX = 22 // ~14.5px * 1.5
const COMPOSER_PAD_PX = 16 // vertical padding inside the chalk field
const COMPOSER_MIN_PX = COMPOSER_LINE_PX * 2 + COMPOSER_PAD_PX
const COMPOSER_AUTO_MAX_PX = COMPOSER_LINE_PX * 6 + COMPOSER_PAD_PX
const COMPOSER_MANUAL_MAX_PX = COMPOSER_LINE_PX * 16 + COMPOSER_PAD_PX

function defaultMarginWidth(viewport = typeof window !== 'undefined' ? window.innerWidth : 1200): number {
  return Math.round(viewport * 0.25)
}

function clampMarginWidth(
  px: number,
  viewport = typeof window !== 'undefined' ? window.innerWidth : 1200,
): number {
  const max = Math.max(MARGIN_MIN_PX, Math.min(Math.round(viewport * 0.5), viewport - DESK_MIN_PX))
  return Math.min(max, Math.max(MARGIN_MIN_PX, Math.round(px)))
}

function readStoredMarginWidth(): number {
  try {
    const raw = localStorage.getItem(MARGIN_WIDTH_KEY)
    if (raw != null) {
      const n = Number(raw)
      if (Number.isFinite(n)) return clampMarginWidth(n)
    }
  } catch {
    /* private mode / blocked storage */
  }
  return clampMarginWidth(defaultMarginWidth())
}

function persistMarginWidth(px: number) {
  try {
    localStorage.setItem(MARGIN_WIDTH_KEY, String(px))
  } catch {
    /* ignore */
  }
}

/** Hidden payload for review-my-work. Transcript still shows the short label. */
function reviewPrompt(notes?: string): string {
  let prompt =
    'Please review my current board and push me one step forward — point out ' +
    'what to reconsider, but do NOT give me the answer or write the fix.'
  const noteText = notes?.trim()
  if (noteText) {
    prompt += `\n\nMy notes:\n${noteText}`
  }
  return prompt
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toLowerCase()
}

function statusMark(status: ProblemSummary['status']): { mark: string; className: string } {
  if (status === 'solved') return { mark: '✓', className: 'mark-solved' }
  if (status === 'attempted') return { mark: '~', className: 'mark-attempted' }
  return { mark: '·', className: 'mark-new' }
}

/** Stable smear widths from slot index only — never from the real term. */
function smearWidth(i: number): number {
  const w = [64, 88, 52, 76, 96, 58, 70, 82]
  return w[i % w.length]!
}

export default function App() {
  const [problems, setProblems] = useState<ProblemSummary[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [input, setInput] = useState('')
  const [code, setCode] = useState('')
  const [seed, setSeed] = useState('') // the scaffold currently loaded, to detect edits
  const [lang, setLang] = useState<string>('typescript')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<TurnStage | null>(null)
  const [loading, setLoading] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [loadingQuery, setLoadingQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [takes, setTakes] = useState<PersistedTake[]>([])
  const [selectedTake, setSelectedTake] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [stressing, setStressing] = useState(false)
  const [attemptsCollapsed, setAttemptsCollapsed] = useState(false)
  const [sessionSolved, setSessionSolved] = useState(false)
  const [vocab, setVocab] = useState<Vocab | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(() => new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsModels, setSettingsModels] = useState<AppSettingsModels | null>(null)
  const [settingsBackends, setSettingsBackends] = useState<string[]>([])
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [marginWidth, setMarginWidth] = useState(readStoredMarginWidth)
  const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN_PX)
  const [composerManual, setComposerManual] = useState(false)
  const notesRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editorSaveRef = useRef<Promise<void>>(Promise.resolve())
  const savedLangRef = useRef(lang)

  function refreshProblems() {
    getProblems().then(setProblems).catch(() => {})
  }

  useEffect(() => {
    refreshProblems()
  }, [])

  async function openSettings() {
    setSettingsError(null)
    setSettingsOpen(true)
    setSettingsModels(null)
    try {
      const res = await getSettings()
      setSettingsModels(res.models)
      setSettingsBackends(res.backends)
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err))
    }
  }

  function closeSettings() {
    setSettingsOpen(false)
    setSettingsError(null)
    setSettingsModels(null)
  }

  async function saveSettingsPanel() {
    if (!settingsModels || settingsSaving) return
    setSettingsSaving(true)
    setSettingsError(null)
    try {
      await putSettings(settingsModels)
      closeSettings()
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err))
    } finally {
      setSettingsSaving(false)
    }
  }

  function patchRole(
    role: keyof AppSettingsModels,
    patch: Partial<AppSettingsModels[keyof AppSettingsModels]>,
  ) {
    setSettingsModels((cur) => (cur ? { ...cur, [role]: { ...cur[role], ...patch } } : cur))
  }

  // Returning to the hero — refresh the ledger.
  useEffect(() => {
    if (!problem && !loading) refreshProblems()
  }, [problem, loading])

  function scrollNotes() {
    const el = notesRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  useEffect(() => {
    scrollNotes()
  }, [notes, busy, stage])

  // Keep the margin usable when the window shrinks/grows.
  useEffect(() => {
    function onResize() {
      setMarginWidth((w) => {
        const next = clampMarginWidth(w)
        if (next !== w) persistMarginWidth(next)
        return next
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Auto-grow the composer until the user has manually sized it.
  useEffect(() => {
    if (composerManual) return
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    const next = Math.min(COMPOSER_AUTO_MAX_PX, Math.max(COMPOSER_MIN_PX, el.scrollHeight))
    el.style.height = `${next}px`
    setComposerHeight(next)
  }, [input, composerManual, sessionId])

  function setMarginWidthPersist(px: number) {
    const next = clampMarginWidth(px)
    setMarginWidth(next)
    persistMarginWidth(next)
  }

  function resetComposerSize() {
    setComposerManual(false)
    setComposerHeight(COMPOSER_MIN_PX)
  }

  function onMarginPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    const startX = e.clientX
    const startW = marginWidth
    let latest = startW
    handle.setPointerCapture(e.pointerId)

    function onMove(ev: PointerEvent) {
      // Dragging the left edge leftward widens the margin.
      latest = clampMarginWidth(startW + (startX - ev.clientX))
      setMarginWidth(latest)
    }
    function onUp(ev: PointerEvent) {
      handle.releasePointerCapture(ev.pointerId)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      persistMarginWidth(latest)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  function onMarginKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 40 : 16
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setMarginWidthPersist(marginWidth + step)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setMarginWidthPersist(marginWidth - step)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setMarginWidthPersist(MARGIN_MIN_PX)
    } else if (e.key === 'End') {
      e.preventDefault()
      setMarginWidthPersist(window.innerWidth * 0.5)
    }
  }

  function onComposerDragStart(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    const startY = e.clientY
    const startH = composerHeight
    handle.setPointerCapture(e.pointerId)
    setComposerManual(true)

    function onMove(ev: PointerEvent) {
      // Dragging the top edge upward grows the field.
      const next = Math.min(
        COMPOSER_MANUAL_MAX_PX,
        Math.max(COMPOSER_MIN_PX, startH + (startY - ev.clientY)),
      )
      setComposerHeight(next)
    }
    function onUp(ev: PointerEvent) {
      handle.releasePointerCapture(ev.pointerId)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  function queueEditorSave(id: string, nextCode: string, nextLang: string): Promise<void> {
    const queued = editorSaveRef.current
      .catch(() => {})
      .then(() => saveEditor(id, nextCode, nextLang))
    editorSaveRef.current = queued.catch(() => {})
    return queued
  }

  // Debounced editor sync while a session is active.
  useEffect(() => {
    if (!sessionId) return
    const timer = setTimeout(() => {
      if (!code && lang === savedLangRef.current) return
      void queueEditorSave(sessionId, code, lang)
        .then(() => {
          savedLangRef.current = lang
        })
        .catch(() => {})
    }, 2000)
    return () => clearTimeout(timer)
  }, [code, lang, sessionId])

  function applyTakes(next: PersistedTake[], selectSeq?: number) {
    setTakes(next)
    if (next.length === 0) {
      setSelectedTake(null)
      return
    }
    const seq = selectSeq ?? next[next.length - 1]!.seq
    setSelectedTake(seq)
  }

  const selected = takes.find((t) => t.seq === selectedTake) ?? null
  const selectedResults = selected?.results ?? null
  const dirty =
    takes.length > 0 && selected
      ? normalizeForDirty(code) !== normalizeForDirty(selected.code) ||
        lang !== selected.lang
      : false
  const scaffoldDirty =
    Boolean(sessionId) &&
    normalizeForDirty(code) !== normalizeForDirty(snippetFor(problem, lang))
  const stressCount = problem?.stressCount ?? 0
  let knownTotal: number | null = null
  for (let i = takes.length - 1; i >= 0; i--) {
    const res = takes[i]!.results
    if (res != null && !res.error) {
      knownTotal = officialCases(res).length
      break
    }
  }
  const solved =
    sessionSolved || takes.some(takeAllPass)

  function applyFreshSession(res: { sessionId: string; problem: Problem; vocab: Vocab }) {
    setSessionId(res.sessionId)
    setProblem(res.problem)
    setNotes([])
    setInput('')
    setError(null)
    applyTakes([])
    setSessionSolved(false)
    setAttemptsCollapsed(false)
    setVocab(res.vocab)
    setFresh(new Set())
    const stub = snippetFor(res.problem, lang)
    setCode(stub)
    setSeed(stub)
    savedLangRef.current = lang
    refreshProblems()
  }

  async function beginCard(name: string, label?: string) {
    if (loading) return
    setLoadingQuery(label ?? name)
    setIngesting(false)
    setLoading(true)
    setError(null)
    try {
      applyFreshSession(await createSession(name))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function resumeSession(id: string) {
    if (loading) return
    setLoadingQuery('resuming…')
    setIngesting(false)
    setLoading(true)
    setError(null)
    try {
      const res = await getSession(id)
      setSessionId(res.sessionId)
      setProblem(res.problem)
      setNotes(
        res.notes.map((n) => ({
          role: n.role,
          text: n.text,
          mode: n.mode as Mode | undefined,
          unlocked: n.unlocked,
          redrafted: n.redrafted,
          revealing: false,
        })),
      )
      const nextLang = res.lang || lang
      setLang(nextLang)
      savedLangRef.current = nextLang
      const stub = snippetFor(res.problem, nextLang)
      setCode(res.code ? res.code : stub)
      setSeed(stub)
      applyTakes(res.takes)
      setSessionSolved(res.solved || res.takes.some(takeAllPass))
      setAttemptsCollapsed(false)
      setVocab(res.vocab)
      setFresh(new Set())
      setInput('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function loadProblem() {
    const q = query.trim()
    if (!q || loading) return
    const match = problems.find(
      (c) => c.title.toLowerCase() === q.toLowerCase() || c.name === q.toLowerCase(),
    )
    setLoadingQuery(q)
    setIngesting(!match)
    setLoading(true)
    setError(null)
    try {
      const res = match ? await createSession(match.name) : await startSession(q)
      applyFreshSession(res)
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : String(err)) +
          " — if it's not a built-in problem, the server needs the on-the-fly ingest (restart it).",
      )
    } finally {
      setLoading(false)
    }
  }

  async function turn(sendText: string, displayText?: string) {
    if (!sessionId || busy) return
    setNotes((p) => [...p, { role: 'student', text: displayText ?? sendText }])
    setBusy(true)
    setStage(null)
    try {
      await queueEditorSave(sessionId, code, lang)
      savedLangRef.current = lang
      const r = await submitTurn(sessionId, sendText, {
        display: displayText,
        onStage: setStage,
      })
      setNotes((p) => [
        ...p,
        {
          role: 'tutor',
          text: r.reply,
          mode: r.mode,
          unlocked: r.unlockedThisTurn,
          redrafted: r.redrafted,
          revealing: true,
        },
      ])
    } catch (err) {
      setNotes((p) => [...p, { role: 'tutor', text: err instanceof Error ? err.message : String(err) }])
    } finally {
      setBusy(false)
      setStage(null)
    }
  }

  function finishReveal(index: number) {
    const unlocked = notes[index]?.unlocked
    setNotes((p) => p.map((n, i) => (i === index ? { ...n, revealing: false } : n)))
    if (!unlocked?.length || !vocab) return
    const already = new Set(vocab.earned)
    const appended = unlocked.filter((t) => !already.has(t))
    if (appended.length === 0) return
    setVocab({
      earned: [...vocab.earned, ...appended],
      lockedCount: Math.max(0, vocab.lockedCount - appended.length),
    })
    setFresh((prev) => {
      const next = new Set(prev)
      for (const t of appended) next.add(t)
      return next
    })
    window.setTimeout(() => {
      setFresh((prev) => {
        const next = new Set(prev)
        for (const t of appended) next.delete(t)
        return next
      })
    }, 1200)
  }

  function send() {
    const t = input.trim()
    if (!t) return
    setInput('')
    resetComposerSize()
    void turn(t)
  }

  function review() {
    const c = code.trim()
    if (!c || busy) return
    const notes = input.trim()
    setInput('')
    resetComposerSize()
    const display = notes ? '↳ review my work\n' + notes : '↳ review my work'
    void turn(reviewPrompt(notes), display)
  }

  async function runTheExamples() {
    if (!sessionId || running || !code.trim() || !RUNNABLE.has(lang)) return
    setRunning(true)
    setError(null)
    try {
      const { takes: next } = await runExamples(sessionId, code, lang)
      applyTakes(next)
      if (next.some(takeAllPass)) setSessionSolved(true)
      refreshProblems()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  async function chalkUpTougher() {
    if (!sessionId || stressing || stressCount > 0) return
    setStressing(true)
    setError(null)
    try {
      const { count } = await chalkStress(sessionId)
      setProblem((p) => (p ? { ...p, stressCount: count } : p))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStressing(false)
    }
  }

  async function checkoutTake(seq: number) {
    if (!sessionId || seq === selectedTake) return
    const target = takes.find((t) => t.seq === seq)
    if (!target) return
    if (dirty) {
      const res = await addTake(sessionId, code, lang)
      applyTakes(res.takes, seq)
    } else {
      setSelectedTake(seq)
    }
    setCode(target.code)
    setLang(target.lang)
  }

  async function resetToScaffold() {
    if (!sessionId || !scaffoldDirty) return
    if (dirty) {
      const res = await addTake(sessionId, code, lang)
      applyTakes(res.takes)
    }
    const stub = snippetFor(problem, lang)
    setCode(stub)
    setSeed(stub)
  }

  function onLedgerRow(p: ProblemSummary) {
    if (p.status === 'new' || p.sessions.length === 0) {
      void beginCard(p.name, p.title)
      return
    }
    setExpanded((cur) => (cur === p.name ? null : p.name))
  }

  function changeLang(next: string) {
    setLang(next)
    // Swap the scaffold only if the editor still holds the untouched stub (or is empty).
    if (
      normalizeForDirty(code) === normalizeForDirty(seed) ||
      code.trim() === ''
    ) {
      const stub = snippetFor(problem, next)
      setCode(stub)
      setSeed(stub)
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }
  function onLoaderKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') void loadProblem()
  }

  useEffect(() => {
    if (!settingsOpen) return
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen])

  const marginMax = clampMarginWidth(
    typeof window !== 'undefined' ? window.innerWidth * 0.5 : marginWidth,
  )

  const inDesktop = typeof window !== 'undefined' && Boolean(window.tutorDesktop)

  const showVocab =
    vocab != null && (vocab.lockedCount > 0 || vocab.earned.length > 0)

  return (
    <div className={inDesktop ? 'board in-desktop' : 'board'}>
      {/* chalk filter — displaces only the border layers, giving a hand-drawn edge */}
      <svg className="defs" aria-hidden="true" width="0" height="0" style={{ position: 'absolute' }}>
        <filter id="chalk-rough" x="-6%" y="-12%" width="112%" height="124%">
          {/* line wander: low-frequency displacement so long borders visibly drift */}
          <feTurbulence type="fractalNoise" baseFrequency="0.011 0.017" numOctaves="3" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="7" result="d" />
          {/* dry-chalk grain: high-frequency noise erodes the stroke's alpha */}
          <feTurbulence type="fractalNoise" baseFrequency="0.4" numOctaves="2" seed="3" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.6 -0.08" result="mask" />
          <feComposite in="d" in2="mask" operator="in" />
        </filter>
      </svg>

      <header className="strip">
        {/* Wordmark = way back to the ledger; the session lives server-side, so
            leaving is safe and it shows up under the problem as resumable. */}
        <button
          type="button"
          className="wordmark"
          onClick={() => {
            if (!problem || loading) return
            setSessionId(null)
            setProblem(null)
            setNotes([])
            applyTakes([])
            setSessionSolved(false)
            setVocab(null)
            setFresh(new Set())
            setInput('')
            setError(null)
            setExpanded(null)
          }}
          title={problem ? 'back to the board' : undefined}
        >
          <span className="sigma">Σ</span>
          <b>The Board</b>
          <span className="tail">// answers stay on my side</span>
        </button>
        <div className="loader">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onLoaderKey}
            placeholder="a problem name or a leetcode link…"
            spellCheck={false}
          />
          <button type="button" onClick={() => void loadProblem()} disabled={loading || !query.trim()}>
            {loading ? 'chalking…' : 'to the board'}
          </button>
        </div>
        <button type="button" className="stripbtn" onClick={() => void openSettings()}>
          providers
        </button>
        <WindowControls />
      </header>

      {settingsOpen && (
        <div
          className="settings-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSettings()
          }}
        >
          <div className="settings-panel chalk lit" role="dialog" aria-label="providers">
            <p className="eyebrow">providers</p>
            {settingsModels ? (
              (['teacher', 'gate', 'unlock', 'ingest'] as const).map((role) => (
                <div key={role} className="settings-row">
                  <span className="role">{role}</span>
                  <select
                    value={settingsModels[role].backend}
                    onChange={(e) => patchRole(role, { backend: e.target.value })}
                  >
                    {settingsBackends.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                  <input
                    value={settingsModels[role].model}
                    onChange={(e) => patchRole(role, { model: e.target.value })}
                    spellCheck={false}
                  />
                </div>
              ))
            ) : (
              !settingsError && <p className="settings-note">loading…</p>
            )}
            <p className="settings-note">
              applies to new turns · the chosen cli must be on your PATH
            </p>
            {settingsError && <p className="settings-error">{settingsError}</p>}
            <div className="settings-actions">
              <button type="button" className="settings-cancel" onClick={closeSettings}>
                cancel
              </button>
              <button
                type="button"
                className="settings-save"
                disabled={!settingsModels || settingsSaving}
                onClick={() => void saveSettingsPanel()}
              >
                {settingsSaving ? 'saving…' : 'save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <div className="banner">{error}</div>}

      <div className="stage" style={{ gridTemplateColumns: `1fr ${marginWidth}px` }}>
        <main className="desk">
          {loading ? (
            <LoadingBoard query={loadingQuery} ingesting={ingesting} />
          ) : problem ? (
            <>
              <article className={showVocab ? 'problem has-vocab' : 'problem'}>
                <p className="eyebrow">the problem</p>
                <div className="problem-title-row">
                  <h1>{problem.title}</h1>
                  {problem.difficulty && (
                    <span
                      className={`diff-badge ${difficultyClass(problem.difficulty)}`}
                    >
                      {problem.difficulty.toLowerCase()}
                    </span>
                  )}
                  {solved && <span className="solved-stamp">solved ✓</span>}
                </div>
                <div className="problem-body">
                  <h2>statement</h2>
                  <p className="statement">{problem.statement}</p>
                  <h2>constraints</h2>
                  <p className="constraints">{problem.constraints}</p>
                </div>
                {showVocab && vocab && (
                  <aside className="vocab" aria-label="the vocab">
                    <div className="vocab-surface">
                      <div className="vocab-head">
                        <span className="vocab-title">the vocab</span>
                        <button
                          type="button"
                          className="vocab-info"
                          aria-label="what is the vocab?"
                          aria-describedby="vocab-tip"
                        >
                          i
                        </button>
                        <span className="vocab-tip" id="vocab-tip" role="tooltip">
                          the ideas this problem is built on. the smudged ones I won't say yet —
                          commit to an idea of your own and I'll write it up here.
                        </span>
                      </div>
                      <div className="vocab-words">
                        {vocab.earned.map((t) => (
                          <span key={t} className={`vocab-word${fresh.has(t) ? ' fresh' : ''}`}>{t}</span>
                        ))}
                        {Array.from({ length: vocab.lockedCount }, (_, i) => (
                          <span key={`s${i}`} className="vocab-smear" style={{ width: smearWidth(i) }} aria-hidden="true" />
                        ))}
                      </div>
                    </div>
                    <div className="vocab-rail" aria-hidden="true">
                      <span className="vocab-chalkpiece" />
                    </div>
                  </aside>
                )}
              </article>
              <section className="workarea">
                <div className="worklabel">
                  <span>your work</span>
                  <div className="workactions">
                    {dirty && (
                      <span className="dirtyflag" title="changes since your last attempt — running or switching attempts snapshots them">
                        ● unsaved
                      </span>
                    )}
                    {sessionId && code.trim() && (
                      <button
                        type="button"
                        className="runbtn"
                        disabled={running}
                        title={dirty ? 'changes since your last attempt' : undefined}
                        onClick={() => void runTheExamples()}
                      >
                        <svg
                          className="run-tri"
                          viewBox="0 0 14 14"
                          width="14"
                          height="14"
                          aria-hidden="true"
                        >
                          <path
                            d="M3.5 2.2v9.6L11.5 7z"
                            fill="none"
                            stroke="var(--amber)"
                            strokeWidth="1.4"
                            strokeLinejoin="round"
                            filter="url(#chalk-rough)"
                          />
                        </svg>
                        <span>{running ? 'running…' : 'run'}</span>
                      </button>
                    )}
                    {sessionId && stressCount === 0 && (
                      <button
                        type="button"
                        className="stressbtn"
                        disabled={stressing}
                        onClick={() => void chalkUpTougher()}
                      >
                        {stressing ? 'chalking…' : 'chalk up tougher cases'}
                      </button>
                    )}
                    {sessionId && stressCount > 0 && (
                      <span className="stress-count">{stressCount} tougher</span>
                    )}
                    <select className="langpick" value={lang} onChange={(e) => changeLang(e.target.value)}>
                      {LANGS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                    {sessionId && (
                      <button
                        type="button"
                        className="resetbtn"
                        disabled={!scaffoldDirty}
                        title="reset to the language scaffold"
                        onClick={() => void resetToScaffold()}
                      >
                        reset
                      </button>
                    )}
                  </div>
                </div>
                <div className={`workrow${attemptsCollapsed ? ' rail-collapsed' : ''}`}>
                  <div className="editor-shell chalk lit">
                    <div className="monaco-host">
                      <CodeEditor value={code} onChange={setCode} language={lang} />
                    </div>
                  </div>
                  {takes.length > 0 && (
                    <aside
                      className={`attempts-rail${attemptsCollapsed ? ' collapsed' : ''}`}
                    >
                      <button
                        type="button"
                        className="attempts-toggle"
                        onClick={() => setAttemptsCollapsed((v) => !v)}
                        title={attemptsCollapsed ? 'expand attempts' : 'collapse attempts'}
                      >
                        {!attemptsCollapsed && <span className="attempts-eyebrow">attempts</span>}
                        {attemptsCollapsed && (
                          <span className="attempts-count">{takes.length}</span>
                        )}
                        <span className="attempts-glyph">{attemptsCollapsed ? '›' : '‹'}</span>
                      </button>
                      {!attemptsCollapsed && (
                        <div className="attempts-list">
                          {takes.map((t) => {
                            const res = t.results
                            const score = takeScoreLabel(t, knownTotal)
                            const allPass = takeAllPass(t)
                            const someFail =
                              res != null &&
                              !res.error &&
                              officialCases(res).some((c) => !c.pass)
                            const rowClass = [
                              'attempt-row',
                              t.seq === selectedTake ? 'selected' : '',
                              res == null || res.error
                                ? 'unrun'
                                : allPass
                                  ? 'allpass'
                                  : someFail
                                    ? 'somefail'
                                    : '',
                            ]
                              .filter(Boolean)
                              .join(' ')
                            return (
                              <button
                                key={t.seq}
                                type="button"
                                className={rowClass}
                                title={new Date(t.ts).toLocaleString()}
                                onClick={() => void checkoutTake(t.seq)}
                              >
                                <span className="attempt-label">attempt {t.seq}</span>
                                <span className="attempt-score">{score}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </aside>
                  )}
                </div>
                {takes.length > 0 && (
                  <div className="takes-cases">
                    {selectedResults == null ? (
                      <div className="unrun-note">no results yet — run the examples</div>
                    ) : selectedResults.error ? (
                      <div className="fail">{selectedResults.error}</div>
                    ) : (
                      (() => {
                        const official = officialCases(selectedResults)
                        const tougher = stressCases(selectedResults)
                        const renderRow = (c: RunCaseResult, i: number, stress: boolean) => (
                          <div
                            key={`${stress ? 's' : 'o'}-${i}`}
                            className={`${c.pass ? 'pass' : 'fail'}${stress ? ' stress-row' : ''}`}
                          >
                            <span className="mark">{c.pass ? '✓' : '✗'}</span>
                            <span className="disp">{c.display}</span>
                            {!c.pass &&
                              (c.error ? (
                                <span className="detail"> → {c.error}</span>
                              ) : (
                                <span className="detail">
                                  {' '}
                                  → got {c.got} (want {c.expected})
                                </span>
                              ))}
                          </div>
                        )
                        return (
                          <>
                            {official.length > 0 && (
                              <div className="case-group">
                                <div className="case-group-label">examples</div>
                                {official.map((c, i) => renderRow(c, i, false))}
                              </div>
                            )}
                            {tougher.length > 0 && (
                              <div className="case-group stress-group">
                                <div className="case-group-label">tougher</div>
                                {tougher.map((c, i) => renderRow(c, i, true))}
                              </div>
                            )}
                          </>
                        )
                      })()
                    )}
                  </div>
                )}
              </section>
            </>
          ) : (
            <>
              {/* leftover chalk on the empty side of the board — pure decoration */}
              <div className="doodles" aria-hidden="true">
                <pre className="doodle d1">console.log("hello, world!")</pre>
                <pre className="doodle d2">{'def fib(n):\n    return n if n < 2 else\n        fib(n-1) + fib(n-2)'}</pre>
                <span className="doodle d3 circled">O(n log n)</span>
                <pre className="doodle d4">{'      (8)\n     /   \\\n   (3)    (10)\n   / \\      \\\n (1) (6)    (14)'}</pre>
                <pre className="doodle d5">{'while (left < right) …'}</pre>
                <pre className="doodle d6">{'int[] nums = { 2, 7, 11, 15 };'}</pre>
                <span className="doodle d7">// TODO: think first</span>
                <span className="doodle d8">{'target − nums[i] ∈ seen ?'}</span>
              </div>
              <div className={`hero${problems.length > 0 ? ' compressed' : ''}`}>
              <p className="kicker">socratic coding tutor</p>
              <h1>
                I won't tell you<br />
                the answer. I'll get<br />
                you to <em>see it</em>.
              </h1>
              <p>
                Hand me a problem — by name or a LeetCode link — and we'll work it out
                together. I ask the questions; you do the thinking.
              </p>
              {problems.length === 0 ? (
                <p className="how">
                  try: <span>two sum</span> &nbsp;·&nbsp; <span>house robber</span> &nbsp;·&nbsp;{' '}
                  <span>container with most water</span>
                </p>
              ) : (
                <div className="ledger">
                  <p className="eyebrow">the board so far</p>
                  {problems.map((p) => {
                    const { mark, className } = statusMark(p.status)
                    const latest = p.sessions[0]
                    const n = p.sessions.length
                    const meta =
                      n === 0
                        ? null
                        : `${n} session${n === 1 ? '' : 's'} · ${shortDate(latest!.updatedAt)}`
                    const open = expanded === p.name
                    return (
                      <div key={p.name} className="ledger-block">
                        <button
                          type="button"
                          className="ledger-row"
                          onClick={() => onLedgerRow(p)}
                        >
                          <span className={`mark ${className}`}>{mark}</span>
                          <span className="title">{p.title}</span>
                          {(p.difficulty || meta) && (
                            <span className="ledger-end">
                              {p.difficulty && (
                                <span
                                  className={`diff-badge ${difficultyClass(p.difficulty)}`}
                                >
                                  {p.difficulty.toLowerCase()}
                                </span>
                              )}
                              {meta && <span className="meta">{meta}</span>}
                            </span>
                          )}
                        </button>
                        {open && (
                          <div className="ledger-sessions">
                            {p.sessions.map((s) => (
                              <div key={s.id} className="ledger-session">
                                <span className="sess-meta">
                                  {shortDate(s.updatedAt)} · {s.turns} turn{s.turns === 1 ? '' : 's'}
                                  {s.solved ? ' · ✓' : ''}
                                </span>
                                {s.first ? <span className="sess-first">{s.first}</span> : null}
                                <button
                                  type="button"
                                  className="sess-action"
                                  onClick={() => void resumeSession(s.id)}
                                >
                                  resume
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              className="ledger-fresh"
                              onClick={() => void beginCard(p.name, p.title)}
                            >
                              fresh start
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              </div>
            </>
          )}
        </main>

        <aside className="margin">
          <div
            className="margin-resize"
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={marginWidth}
            aria-valuemin={MARGIN_MIN_PX}
            aria-valuemax={marginMax}
            aria-label="tutor margin"
            tabIndex={0}
            onPointerDown={onMarginPointerDown}
            onKeyDown={onMarginKeyDown}
          />
          <div className="margin-head">
            <span className="m1">the tutor</span>
            <span className="m2">in the margin</span>
          </div>

          <div className="notes" ref={notesRef}>
            {!sessionId && (
              <p className="note-empty">
                Load a problem and I'll meet you here. Tell me where you're stuck, or take a
                first swing at it in your work area.
              </p>
            )}
            {sessionId && notes.length === 0 && !busy && (
              <p className="note-empty">
                What's your first instinct? Even a brute-force idea is a good start.
              </p>
            )}
            {notes.map((n, i) => (
              <div key={i} className={`note ${n.role === 'tutor' ? 'tutor' : 'you'}`}>
                <div className="who">
                  <span>{n.role === 'tutor' ? 'tutor' : 'you'}</span>
                  {n.mode && <span className={`badge ${n.mode}`}>{n.mode}</span>}
                  {n.redrafted && <span className="badge revised">reworded</span>}
                </div>
                {n.revealing ? (
                  <RevealingText
                    text={n.text}
                    onDone={() => finishReveal(i)}
                    onGrow={scrollNotes}
                  />
                ) : (
                  <p className="say">
                    {n.role === 'tutor' ? (
                      renderMd(parseMd(n.text))
                    ) : (() => {
                      const nl = n.text.startsWith('↳') ? n.text.indexOf('\n') : -1
                      if (nl < 0) return n.text
                      return (
                        <>
                          {n.text.slice(0, nl)}
                          <span className="say-sub">{n.text.slice(nl + 1)}</span>
                        </>
                      )
                    })()}
                  </p>
                )}
                {!n.revealing && n.unlocked && n.unlocked.length > 0 && (
                  <p className="unlocked">
                    <b>✓ you've got it:</b> {n.unlocked.join(' · ')}
                  </p>
                )}
              </div>
            ))}
            {busy && sessionId && (
              <div className="thinking" aria-live="polite">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
                {stage ? STAGE_COPY[stage] : 'reading your move…'}
              </div>
            )}
          </div>

          <div className="composer">
            {sessionId && (
              <button className="review chalk amber" type="button" onClick={review} disabled={busy || !code.trim()}>
                ✎ review my work
              </button>
            )}
            <div className="row composer-field chalk lit">
              <div
                className="composer-drag"
                onPointerDown={onComposerDragStart}
                aria-hidden="true"
              />
              <textarea
                ref={textareaRef}
                rows={2}
                value={input}
                disabled={!sessionId || busy}
                placeholder={sessionId ? 'say what you’re thinking…' : 'load a problem first'}
                style={{ height: composerHeight }}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
              />
            </div>
            <div className="row">
              <button className="send" type="button" onClick={send} disabled={!sessionId || busy || !input.trim()}>
                Send
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

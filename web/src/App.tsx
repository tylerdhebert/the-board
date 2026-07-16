import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import CodeEditor from './CodeEditor'
import { parseMd, renderMd, type MdFigure } from './md'
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
  type TurnStage,
  type Vocab,
} from './api'
import {
  COMPOSER_AUTO_MAX_PX,
  COMPOSER_MANUAL_MAX_PX,
  COMPOSER_MIN_PX,
  LANGS,
  MARGIN_MIN_PX,
  PROBLEM_MIN_PX,
  RUNNABLE,
  STAGE_COPY,
} from './appConstants'
import {
  blanksAllEmpty,
  buildCaseCards,
  clampMarginWidth,
  clampProblemWidth,
  composeFilledScaffold,
  difficultyClass,
  hasScaffoldBlanks,
  normalizeForDirty,
  officialCases,
  persistMarginWidth,
  persistProblemWidth,
  readStoredMarginWidth,
  readStoredProblemWidth,
  reviewPrompt,
  snippetFor,
  stressCases,
  takeAllPass,
  takeScoreLabel,
} from './appHelpers'
import type { CardState, Mode, Note, TeacherGesture } from './appTypes'
import FanOverlay from './FanOverlay'
import HeroLedger from './HeroLedger'
import LoadingBoard from './LoadingBoard'
import RevealingText from './RevealingText'
import ScaffoldBlankSay from './ScaffoldBlankSay'
import SettingsPanel from './SettingsPanel'
import VocabBoard from './VocabBoard'
import WindowControls from './WindowControls'

export { normalizeForDirty } from './appHelpers'

// Below this desk width the layout goes compact: vocab + example decks collapse
// into toggles so the statement and editor keep the room. Matches the former
// container-query threshold.
const COMPACT_DESK_PX = 1100

export default function App() {
  const [problems, setProblems] = useState<ProblemSummary[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [figureView, setFigureView] = useState<MdFigure | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [input, setInput] = useState('')
  const [code, setCode] = useState('')
  const [seed, setSeed] = useState('') // the scaffold currently loaded, to detect edits
  const [lang, setLang] = useState<string>('typescript')
  const [busy, setBusy] = useState(false)
  const [direct, setDirect] = useState(false)
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
  const [constraintsOpen, setConstraintsOpen] = useState(true)
  const [compact, setCompact] = useState(false)
  const [vocabOpen, setVocabOpen] = useState(false)
  const [sessionSolved, setSessionSolved] = useState(false)
  const [openStack, setOpenStack] = useState<null | 'examples' | 'tougher'>(null)
  const [vocab, setVocab] = useState<Vocab | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(() => new Set())
  const [point, setPoint] = useState<{ line: number; endLine?: number; quote: string } | null>(null)
  const [tapNonce, setTapNonce] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsModels, setSettingsModels] = useState<AppSettingsModels | null>(null)
  const [settingsBackends, setSettingsBackends] = useState<string[]>([])
  const [settingsLeetcode, setSettingsLeetcode] = useState<boolean | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [marginWidth, setMarginWidth] = useState(readStoredMarginWidth)
  const [problemWidth, setProblemWidth] = useState(readStoredProblemWidth)
  const [artifactsOpen, setArtifactsOpen] = useState(false)
  const [composerHeight, setComposerHeight] = useState(COMPOSER_MIN_PX)
  const [composerManual, setComposerManual] = useState(false)
  const deskRef = useRef<HTMLElement>(null)
  const notesRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editorSaveRef = useRef<Promise<void>>(Promise.resolve())
  const savedLangRef = useRef(lang)
  const codeRef = useRef(code)
  codeRef.current = code
  const notesSnapRef = useRef(notes)
  notesSnapRef.current = notes
  const problemRef = useRef(problem)
  problemRef.current = problem
  const vocabRef = useRef(vocab)
  vocabRef.current = vocab

  function refreshProblems() {
    getProblems().then(setProblems).catch(() => {})
  }

  useEffect(() => {
    refreshProblems()
  }, [])

  useEffect(() => {
    if (!figureView) return
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setFigureView(null)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [figureView])

  async function openSettings() {
    setSettingsError(null)
    setSettingsOpen(true)
    setSettingsModels(null)
    try {
      const res = await getSettings()
      setSettingsModels(res.models)
      setSettingsBackends(res.backends)
      setSettingsLeetcode(res.leetcode.signedIn)
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err))
    }
  }

  function closeSettings() {
    setSettingsOpen(false)
    setSettingsError(null)
    setSettingsModels(null)
    setSettingsLeetcode(null)
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

  // Re-clamp the statement column when the desk's real width changes —
  // window resizes AND tutor-margin drags both move the ceiling.
  useEffect(() => {
    function reclamp() {
      const desk = deskRef.current
      if (!desk) return
      setProblemWidth((w) => {
        const next = clampProblemWidth(w, desk.clientWidth)
        if (next !== w) persistProblemWidth(next)
        return next
      })
    }
    reclamp()
    window.addEventListener('resize', reclamp)
    return () => window.removeEventListener('resize', reclamp)
  }, [marginWidth])

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

  function openArtifact(artifact: { file: string; url?: string }) {
    if (!sessionId) return
    if (window.tutorDesktop) {
      void window.tutorDesktop.openArtifact(sessionId, artifact.file)
    } else {
      window.open(artifact.url ?? `/api/artifacts/${sessionId}/${artifact.file}`)
    }
  }

  function deskWidth(): number {
    return deskRef.current?.clientWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1200)
  }

  function setProblemWidthPersist(px: number) {
    const next = clampProblemWidth(px, deskWidth())
    setProblemWidth(next)
    persistProblemWidth(next)
  }

  function onWorkPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    const startX = e.clientX
    const startW = problemWidth
    let latest = startW
    handle.setPointerCapture(e.pointerId)

    function onMove(ev: PointerEvent) {
      // Dragging the editor's left edge rightward widens the statement column.
      latest = clampProblemWidth(startW + (ev.clientX - startX), deskWidth())
      setProblemWidth(latest)
    }
    function onUp(ev: PointerEvent) {
      handle.releasePointerCapture(ev.pointerId)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      persistProblemWidth(latest)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  function onWorkKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 40 : 16
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      setProblemWidthPersist(problemWidth + step)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setProblemWidthPersist(problemWidth - step)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setProblemWidthPersist(PROBLEM_MIN_PX)
    } else if (e.key === 'End') {
      e.preventDefault()
      setProblemWidthPersist(deskWidth())
    }
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

  const exampleRows = problem?.examples ?? []
  const stressRows = problem?.stress ?? []
  const runOverlay =
    selectedResults != null && !selectedResults.error
      ? {
          official: officialCases(selectedResults),
          stress: stressCases(selectedResults),
        }
      : null
  const exampleCards = buildCaseCards(exampleRows, runOverlay?.official ?? null)
  const tougherCards = buildCaseCards(stressRows, runOverlay?.stress ?? null)
  const fanCards = openStack === 'examples' ? exampleCards : openStack === 'tougher' ? tougherCards : []

  function showCardAt(caseNumber: number): (CardState & { tougher: boolean }) | null {
    if (caseNumber < 1) return null
    if (caseNumber <= exampleCards.length) {
      const c = exampleCards[caseNumber - 1]
      return c ? { ...c, tougher: false } : null
    }
    const si = caseNumber - 1 - exampleCards.length
    if (si < 0 || si >= tougherCards.length) return null
    const c = tougherCards[si]
    return c ? { ...c, tougher: true } : null
  }

  function applyFreshSession(res: { sessionId: string; problem: Problem; vocab: Vocab }) {
    setSessionId(res.sessionId)
    setProblem(res.problem)
    setNotes([])
    setPoint(null)
    setTapNonce(0)
    setDirect(false)
    setInput('')
    setError(null)
    applyTakes([])
    setSessionSolved(false)
    setAttemptsCollapsed(false)
    setOpenStack(null)
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
          artifact: n.artifact,
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
      setOpenStack(null)
      setVocab(res.vocab)
      setFresh(new Set())
      setPoint(null)
      setTapNonce(0)
      setDirect(false)
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
        direct,
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
          ...(r.gesture ? { gesture: r.gesture } : {}),
          ...(r.artifact ? { artifact: r.artifact } : {}),
        },
      ])
    } catch (err) {
      setNotes((p) => [...p, { role: 'tutor', text: err instanceof Error ? err.message : String(err) }])
    } finally {
      setBusy(false)
      setStage(null)
    }
  }

  function resolvePoint(
    candidate: { line: number; endLine?: number; quote: string },
    source: string,
  ): { line: number; endLine?: number; quote: string } | null {
    const lines = source.split(/\r?\n/)
    const quote = candidate.quote.trim()
    // The quote anchors the first line; a range keeps its span as the anchor moves.
    const span =
      candidate.endLine && candidate.endLine > candidate.line
        ? candidate.endLine - candidate.line
        : 0
    const build = (startLine: number) => {
      const endLine = startLine + span
      if (endLine > lines.length) return null
      return span > 0 ? { line: startLine, endLine, quote } : { line: startLine, quote }
    }
    if (lines[candidate.line - 1]?.trim() === quote) {
      return build(candidate.line)
    }
    const matches: number[] = []
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.trim() === quote) matches.push(i + 1)
    }
    if (matches.length === 1) return build(matches[0]!)
    return null
  }

  function finishReveal(index: number) {
    const note = notesSnapRef.current[index]
    const unlocked = note?.unlocked
    const g = note?.gesture
    let activated: TeacherGesture | null = null
    if (g?.kind === 'point') {
      const resolved = resolvePoint(g, codeRef.current)
      activated = resolved ? { kind: 'point', ...resolved } : null
    } else if (g?.kind === 'show') {
      const p = problemRef.current
      const total = (p?.examples.length ?? 0) + (p?.stress.length ?? 0)
      activated = g.caseNumber >= 1 && g.caseNumber <= total ? g : null
    } else if (g?.kind === 'tap') {
      const v = vocabRef.current
      activated = v != null && v.lockedCount > 0 ? g : null
    }
    setNotes((p) =>
      p.map((n, i) => {
        if (i !== index) return n
        const next: Note = { ...n, revealing: false }
        if (n.gesture) {
          if (activated) next.gesture = activated
          else delete next.gesture
        }
        return next
      }),
    )
    if (g?.kind === 'point') {
      // Activate after reveal (or clear if validation dropped it / replace prior).
      setPoint(
        activated?.kind === 'point'
          ? {
              line: activated.line,
              quote: activated.quote,
              ...(activated.endLine ? { endLine: activated.endLine } : {}),
            }
          : null,
      )
    }
    if (activated?.kind === 'tap') {
      setTapNonce((n) => n + 1)
    }
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

  function sendScaffoldBack(noteIndex: number) {
    const note = notes[noteIndex]
    if (!note || note.sentBack || busy) return
    if (!hasScaffoldBlanks(note.mode, note.text)) return
    const values = note.blanks ?? []
    if (blanksAllEmpty(note.text, values)) return
    const filled = composeFilledScaffold(note.text, values)
    setNotes((p) => p.map((n, i) => (i === noteIndex ? { ...n, sentBack: true } : n)))
    void turn(
      'Here is your scaffold with my blanks filled in:\n\n' + filled,
      '↳ sent the scaffold back',
    )
  }

  function setBlankValue(noteIndex: number, blankIndex: number, value: string) {
    setNotes((p) =>
      p.map((n, i) => {
        if (i !== noteIndex) return n
        const blanks = [...(n.blanks ?? [])]
        blanks[blankIndex] = value
        return { ...n, blanks }
      }),
    )
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
    if (!sessionId || stressing || (problem?.stress.length ?? 0) > 0) return
    setStressing(true)
    setError(null)
    try {
      const res = await chalkStress(sessionId)
      setProblem((p) =>
        p ? { ...p, stressCount: res.count, stress: res.stress } : p,
      )
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
    setPoint(null)
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
    setPoint(null)
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
    setPoint(null)
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

  useEffect(() => {
    if (!openStack) return
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setOpenStack(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openStack])

  // Compact mode keys off the desk's own width (the tutor margin is resizable,
  // so the window width alone would be wrong).
  useEffect(() => {
    const el = deskRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setCompact((prev) => {
        const next = w > 0 && w < COMPACT_DESK_PX
        if (!next && prev) setVocabOpen(false)
        return next
      })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!vocabOpen) return
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setVocabOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [vocabOpen])

  // Artifact shelf closes on Escape, outside click, or leaving the session.
  useEffect(() => {
    setArtifactsOpen(false)
  }, [sessionId])
  useEffect(() => {
    if (!artifactsOpen) return
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') setArtifactsOpen(false)
    }
    function onDown(e: globalThis.PointerEvent) {
      const t = e.target as HTMLElement | null
      if (!t?.closest('.artifact-pop') && !t?.closest('.margin-artifacts')) {
        setArtifactsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [artifactsOpen])

  const marginMax = clampMarginWidth(
    typeof window !== 'undefined' ? window.innerWidth * 0.5 : marginWidth,
  )

  const inDesktop = typeof window !== 'undefined' && Boolean(window.tutorDesktop)

  const showVocab =
    vocab != null && (vocab.lockedCount > 0 || vocab.earned.length > 0)

  const sessionArtifacts = notes.flatMap((n) => (n.artifact ? [n.artifact] : []))

  return (
    <div
      className={['board', inDesktop && 'in-desktop', compact && 'compact']
        .filter(Boolean)
        .join(' ')}
    >
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
            setPoint(null)
            setTapNonce(0)
            setDirect(false)
            applyTakes([])
            setSessionSolved(false)
            setOpenStack(null)
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
        {/* guaranteed grab zone — never shrinks away, so the frameless window
            stays draggable even at the 720px minimum */}
        <div className="strip-drag" aria-hidden="true" />
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
        <button
          type="button"
          className="stripbtn cog"
          onClick={() => void openSettings()}
          aria-label="settings"
          title="settings"
        >
          {/* monaco bundles the codicon font — VS Code's own gear, no new deps */}
          <span className="codicon codicon-gear" aria-hidden="true" />
        </button>
        <WindowControls />
      </header>

      {settingsOpen && (
        <SettingsPanel
          settingsModels={settingsModels}
          settingsBackends={settingsBackends}
          settingsLeetcode={settingsLeetcode}
          settingsError={settingsError}
          settingsSaving={settingsSaving}
          onClose={closeSettings}
          onSave={() => void saveSettingsPanel()}
          patchRole={patchRole}
          onLeetcodeChanged={setSettingsLeetcode}
        />
      )}

      {error && <div className="banner">{error}</div>}

      <div className="stage" style={{ gridTemplateColumns: `1fr ${marginWidth}px` }}>
        <main className="desk" ref={deskRef}>
          {loading ? (
            <LoadingBoard query={loadingQuery} ingesting={ingesting} />
          ) : problem ? (
            <>
              <div className="problem-work">
              <article
                className="problem"
                style={compact ? undefined : { flexBasis: problemWidth }}
              >
                {/* head lives INSIDE the left column so the editor column can
                    claim the desk's full height — no dead band beside the title */}
                <div className="problem-head">
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
                    {problem.url && (
                      <a className="lc-link" href={problem.url} target="_blank" rel="noreferrer">
                        on leetcode ↗
                      </a>
                    )}
                  </div>
                </div>
                <div className="problem-body">
                  <div className="statement-pane">
                    <h2>statement</h2>
                    <div className="statement">
                      {renderMd(parseMd(problem.statement), Infinity, {
                        figures: problem.figures,
                        onFigure: setFigureView,
                      })}
                    </div>
                  </div>
                  {problem.constraints?.trim() && (
                    <div className={`constraints-pane${constraintsOpen ? '' : ' collapsed'}`}>
                      <button
                        type="button"
                        className="constraints-toggle"
                        aria-expanded={constraintsOpen}
                        onClick={() => setConstraintsOpen((v) => !v)}
                      >
                        <span>constraints</span>
                        <span className="fold-glyph" aria-hidden="true">
                          {constraintsOpen ? '▾' : '▸'}
                        </span>
                      </button>
                      {constraintsOpen && (
                        <div className="constraints">{renderMd(parseMd(problem.constraints))}</div>
                      )}
                    </div>
                  )}
                </div>
                {showVocab && vocab && (
                  <VocabBoard vocab={vocab} fresh={fresh} tapNonce={tapNonce} />
                )}
              </article>
              <section className="workarea">
                {!compact && (
                  <div
                    className="work-resize"
                    role="separator"
                    aria-orientation="vertical"
                    aria-valuenow={problemWidth}
                    aria-valuemin={PROBLEM_MIN_PX}
                    aria-valuemax={clampProblemWidth(Number.MAX_SAFE_INTEGER, deskWidth())}
                    aria-label="statement column width"
                    tabIndex={0}
                    onPointerDown={onWorkPointerDown}
                    onKeyDown={onWorkKeyDown}
                  />
                )}
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
                {compact && (
                  <div className="compact-shelf">
                    {showVocab && (
                      <button
                        type="button"
                        className="shelf-chip"
                        onClick={() => setVocabOpen(true)}
                      >
                        the vocab
                      </button>
                    )}
                    <button
                      type="button"
                      className="shelf-chip"
                      onClick={() => setOpenStack('examples')}
                    >
                      examples · {exampleCards.length}
                    </button>
                    {stressRows.length > 0 ? (
                      <button
                        type="button"
                        className="shelf-chip"
                        onClick={() => setOpenStack('tougher')}
                      >
                        tougher · {tougherCards.length}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="shelf-chip"
                        disabled={stressing || !sessionId}
                        onClick={() => void chalkUpTougher()}
                      >
                        {stressing ? 'chalking…' : 'chalk up tougher'}
                      </button>
                    )}
                  </div>
                )}
                <div className={`workrow${attemptsCollapsed ? ' rail-collapsed' : ''}`}>
                  <div className="editor-shell chalk lit">
                    <div className="monaco-host">
                      <CodeEditor
                        value={code}
                        onChange={setCode}
                        language={lang}
                        point={point}
                        onPointInvalid={() => setPoint(null)}
                      />
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
                <div className="case-stacks">
                  <button
                    type="button"
                    className="case-stack"
                    onClick={() => setOpenStack('examples')}
                  >
                    <span className="stack-card ghost g2" />
                    <span className="stack-card ghost g1" />
                    <span className="stack-card top index-card">
                      <span className="stack-label">examples</span>
                      <span className="stack-meta">
                        {(() => {
                          const passCount = exampleCards.filter((c) => c.pass === true).length
                          const failCount = exampleCards.filter((c) => c.pass === false).length
                          if (passCount === 0 && failCount === 0) {
                            return `${exampleCards.length} cards`
                          }
                          return (
                            <>
                              {passCount > 0 && <span className="meta-pass">{passCount}✓</span>}
                              {passCount > 0 && failCount > 0 ? ' ' : null}
                              {failCount > 0 && <span className="meta-fail">{failCount}✗</span>}
                            </>
                          )
                        })()}
                      </span>
                    </span>
                  </button>
                  {stressRows.length > 0 ? (
                    <button
                      type="button"
                      className="case-stack"
                      onClick={() => setOpenStack('tougher')}
                    >
                      <span className="stack-card ghost g2" />
                      <span className="stack-card ghost g1" />
                      <span className="stack-card top index-card">
                        <span className="stack-label">tougher</span>
                        <span className="stack-meta">
                          {(() => {
                            const passCount = tougherCards.filter((c) => c.pass === true).length
                            const failCount = tougherCards.filter((c) => c.pass === false).length
                            if (passCount === 0 && failCount === 0) {
                              return `${tougherCards.length} cards`
                            }
                            return (
                              <>
                                {passCount > 0 && <span className="meta-pass">{passCount}✓</span>}
                                {passCount > 0 && failCount > 0 ? ' ' : null}
                                {failCount > 0 && <span className="meta-fail">{failCount}✗</span>}
                              </>
                            )
                          })()}
                        </span>
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="case-stack empty"
                      disabled={stressing || !sessionId}
                      onClick={() => void chalkUpTougher()}
                    >
                      <span className="stack-card top dashed">
                        <span className="stack-label">{stressing ? 'chalking…' : 'chalk up'}</span>
                        <span className="stack-meta">tougher cases</span>
                      </span>
                    </button>
                  )}
                </div>
                {selectedResults?.error && (
                  <div className="run-error">{selectedResults.error}</div>
                )}
                {openStack && (
                  <FanOverlay fanCards={fanCards} onClose={() => setOpenStack(null)} />
                )}
              </section>
              </div>
            </>
          ) : (
            <HeroLedger
              problems={problems}
              expanded={expanded}
              onLedgerRow={onLedgerRow}
              onResumeSession={(id) => void resumeSession(id)}
              onBeginCard={(name, label) => void beginCard(name, label)}
            />
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
            {sessionArtifacts.length > 0 && (
              <button
                type="button"
                className="margin-artifacts"
                aria-expanded={artifactsOpen}
                title="walkthroughs from this session"
                onClick={() => setArtifactsOpen((v) => !v)}
              >
                📄 {sessionArtifacts.length}
              </button>
            )}
            {artifactsOpen && sessionArtifacts.length > 0 && (
              <div className="artifact-pop" role="menu">
                {sessionArtifacts.map((a, i) => (
                  <button
                    key={`${a.file}${i}`}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      openArtifact(a)
                      setArtifactsOpen(false)
                    }}
                  >
                    <span>{a.title}</span>
                    <small>{a.file}</small>
                  </button>
                ))}
              </div>
            )}
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
                  {n.gesture?.kind === 'point' && !n.revealing && (
                    <span className="badge point">
                      ↳{' '}
                      {n.gesture.endLine
                        ? `lines ${n.gesture.line}–${n.gesture.endLine}`
                        : `line ${n.gesture.line}`}
                    </span>
                  )}
                </div>
                {n.revealing ? (
                  <RevealingText
                    text={n.text}
                    onDone={() => finishReveal(i)}
                    onGrow={scrollNotes}
                  />
                ) : n.role === 'tutor' && hasScaffoldBlanks(n.mode, n.text) ? (
                  // Fence-aware: ``` lines are stripped, fenced bodies render as
                  // mono pre with blanks; prose keeps its markdown (bold / `code`).
                  <ScaffoldBlankSay
                    text={n.text}
                    values={n.blanks ?? []}
                    disabled={busy || Boolean(n.sentBack)}
                    onChange={(blankIndex, value) => setBlankValue(i, blankIndex, value)}
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
                {hasScaffoldBlanks(n.mode, n.text) && !n.revealing && !n.sentBack && (
                  <button
                    type="button"
                    className="sendback chalk amber"
                    disabled={busy || blanksAllEmpty(n.text, n.blanks ?? [])}
                    onClick={() => sendScaffoldBack(i)}
                  >
                    send it back
                  </button>
                )}
                {n.gesture?.kind === 'show' && !n.revealing && (() => {
                  const g = n.gesture
                  if (g?.kind !== 'show') return null
                  const c = showCardAt(g.caseNumber)
                  if (!c) return null
                  return (
                    <div className="note-card-wrap">
                      <div
                        className={`index-card note-card${c.tougher ? ' tougher' : ''}${
                          c.pass === true ? ' pass' : c.pass === false ? ' fail' : ''
                        }`}
                      >
                        <div className="card-head">{c.input}</div>
                        <div className="card-line">
                          <span className="card-label">expected</span> {c.expected}
                        </div>
                        {c.got !== undefined && (
                          <div className="card-line got">
                            <span className="card-label">got</span> {c.got}
                          </div>
                        )}
                        {c.error && <div className="card-line err">{c.error}</div>}
                        {c.pass === true && <span className="card-stamp ok">✓</span>}
                        {c.pass === false && <span className="card-stamp no">✗</span>}
                      </div>
                    </div>
                  )
                })()}
                {n.artifact && !n.revealing && (
                  <button
                    type="button"
                    className="artifact-chip"
                    onClick={() => openArtifact(n.artifact!)}
                  >
                    <span>📄 {n.artifact.title}</span>
                    <small>{n.artifact.file}</small>
                  </button>
                )}
                {!n.revealing && n.unlocked && n.unlocked.length > 0 && (
                  <p className="unlocked">
                    <b>{n.mode === 'direct' ? '⏻ now on the table:' : "✓ you've got it:"}</b>{' '}
                    {n.unlocked.join(' · ')}
                  </p>
                )}
              </div>
            ))}
            {busy && sessionId && (
              <div className="thinking" aria-live="polite">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
                {stage
                  ? direct && stage === 'unlock'
                    ? 'noting what was said out loud…'
                    : STAGE_COPY[stage]
                  : 'reading your move…'}
              </div>
            )}
          </div>

          <div className="composer">
            {sessionId && (
              <button className="review chalk amber" type="button" onClick={review} disabled={busy || !code.trim()}>
                ✎ review my work
              </button>
            )}
            {sessionId && (
              <button
                className={`offrecord${direct ? ' on' : ''}`}
                type="button"
                onClick={() => setDirect((d) => !d)}
                disabled={busy}
                title={
                  direct
                    ? 'the gate is off — the tutor answers anything; whatever it reveals is unlocked for good'
                    : 'drop the socratic act for a straight conversation (what gets revealed stays revealed)'
                }
              >
                {direct ? '⏻ off the record — the gate is off' : '○ off the record'}
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
                placeholder={
                  sessionId
                    ? direct
                      ? 'off the record — ask me anything…'
                      : 'say what you’re thinking…'
                    : 'load a problem first'
                }
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
      {figureView && (
        <div
          className="figure-modal"
          role="dialog"
          aria-label={figureView.alt || 'figure'}
          onClick={() => setFigureView(null)}
        >
          <figure onClick={(e) => e.stopPropagation()}>
            <img src={figureView.data} alt={figureView.alt || 'figure'} />
            {figureView.alt && <figcaption>{figureView.alt}</figcaption>}
          </figure>
        </div>
      )}
      {vocabOpen && compact && showVocab && vocab && (
        <div
          className="vocab-modal-backdrop"
          role="dialog"
          aria-label="the vocab"
          onClick={(e) => {
            if (e.target === e.currentTarget) setVocabOpen(false)
          }}
        >
          <div className="vocab-modal">
            <VocabBoard vocab={vocab} fresh={fresh} tapNonce={tapNonce} />
            <button
              type="button"
              className="vocab-modal-close"
              onClick={() => setVocabOpen(false)}
            >
              close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

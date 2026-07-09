import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import CodeEditor from './CodeEditor'
import {
  createSession,
  getCards,
  startSession,
  submitTurn,
  type CardRef,
  type Problem,
} from './api'

const LANGS = ['csharp', 'typescript', 'python', 'javascript', 'java', 'cpp', 'go'] as const

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
}

function reviewPrompt(code: string): string {
  return (
    "Here's my current code. Review it and push me one step forward — point out " +
    'what to reconsider, but do NOT give me the answer or write the fix:\n\n' +
    code
  )
}

export default function App() {
  const [cards, setCards] = useState<CardRef[]>([])
  const [query, setQuery] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [input, setInput] = useState('')
  const [code, setCode] = useState('')
  const [lang, setLang] = useState<string>('python')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [loadingQuery, setLoadingQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const notesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getCards().then(setCards).catch(() => {})
  }, [])

  useEffect(() => {
    const el = notesRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [notes, busy])

  async function loadProblem() {
    const q = query.trim()
    if (!q || loading) return
    const match = cards.find(
      (c) => c.title.toLowerCase() === q.toLowerCase() || c.name === q.toLowerCase(),
    )
    setLoadingQuery(q)
    setIngesting(!match)
    setLoading(true)
    setError(null)
    try {
      const res = match ? await createSession(match.name) : await startSession(q)
      setSessionId(res.sessionId)
      setProblem(res.problem)
      setNotes([])
      setInput('')
      setCode('')
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
    try {
      const r = await submitTurn(sessionId, sendText)
      setNotes((p) => [
        ...p,
        { role: 'tutor', text: r.reply, mode: r.mode, unlocked: r.unlockedThisTurn, redrafted: r.redrafted },
      ])
    } catch (err) {
      setNotes((p) => [...p, { role: 'tutor', text: err instanceof Error ? err.message : String(err) }])
    } finally {
      setBusy(false)
    }
  }

  function send() {
    const t = input.trim()
    if (!t) return
    setInput('')
    void turn(t)
  }

  function review() {
    const c = code.trim()
    if (!c || busy) return
    void turn(reviewPrompt(c), '↳ review my work')
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

  return (
    <div className="board">
      {/* chalk filter — displaces only the border layers, giving a hand-drawn edge */}
      <svg className="defs" aria-hidden="true" width="0" height="0" style={{ position: 'absolute' }}>
        <filter id="chalk-rough" x="-3%" y="-3%" width="106%" height="106%">
          <feTurbulence type="fractalNoise" baseFrequency="0.014 0.02" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="3.6" />
        </filter>
      </svg>

      <header className="strip">
        <div className="wordmark">
          <span className="sigma">Σ</span>
          <b>The Board</b>
          <span className="tail">// answers stay on my side</span>
        </div>
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
      </header>

      {error && <div className="banner">{error}</div>}

      <div className="stage">
        <main className="desk">
          {loading ? (
            <LoadingBoard query={loadingQuery} ingesting={ingesting} />
          ) : problem ? (
            <>
              <article className="problem">
                <p className="eyebrow">the problem</p>
                <h1>{problem.title}</h1>
                <h2>statement</h2>
                <p className="statement">{problem.statement}</p>
                <h2>constraints</h2>
                <p className="constraints">{problem.constraints}</p>
              </article>
              <section className="workarea">
                <div className="worklabel">
                  <span>your work</span>
                  <select className="langpick" value={lang} onChange={(e) => setLang(e.target.value)}>
                    {LANGS.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="editor-shell chalk lit">
                  <div className="monaco-host">
                    <CodeEditor value={code} onChange={setCode} language={lang} />
                  </div>
                </div>
              </section>
            </>
          ) : (
            <div className="hero">
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
              <p className="how">
                try: <span>two sum</span> &nbsp;·&nbsp; <span>house robber</span> &nbsp;·&nbsp;{' '}
                <span>container with most water</span>
              </p>
            </div>
          )}
        </main>

        <aside className="margin">
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
                <p className="say">{n.text}</p>
                {n.unlocked && n.unlocked.length > 0 && (
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
                thinking about your move…
              </div>
            )}
          </div>

          <div className="composer">
            {sessionId && (
              <button className="review chalk amber" type="button" onClick={review} disabled={busy || !code.trim()}>
                ✎ review my work
              </button>
            )}
            <div className="row">
              <textarea
                rows={2}
                value={input}
                disabled={!sessionId || busy}
                placeholder={sessionId ? 'say what you’re thinking…' : 'load a problem first'}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
              />
              <button className="send" type="button" onClick={send} disabled={!sessionId || busy || !input.trim()}>
                Send
              </button>
            </div>
          </div>
          <p className="smudge">the tutor knows the solution. it will not be handing it over.</p>
        </aside>
      </div>
    </div>
  )
}

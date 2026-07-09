import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  createSession,
  getCards,
  submitTurn,
  type CardRef,
  type Problem,
} from './api'

type Message = {
  role: 'student' | 'tutor'
  text: string
  mode?: 'socratic' | 'analog' | 'scaffold'
  unlocked?: string[]
  redrafted?: boolean
}

function App() {
  const [cards, setCards] = useState<CardRef[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedName, setSelectedName] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    getCards()
      .then((list) => {
        if (!cancelled) {
          setCards(list)
          setLoadError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  async function pickProblem(name: string) {
    if (!name || busy) return
    setSelectedName(name)
    setBusy(true)
    setLoadError(null)
    try {
      const { sessionId: id, problem: next } = await createSession(name)
      setSessionId(id)
      setProblem(next)
      setMessages([])
      setInput('')
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || !sessionId || busy) return

    setInput('')
    setMessages((prev) => [...prev, { role: 'student', text }])
    setBusy(true)
    try {
      const result = await submitTurn(sessionId, text)
      setMessages((prev) => [
        ...prev,
        {
          role: 'tutor',
          text: result.reply,
          mode: result.mode,
          unlocked: result.unlockedThisTurn,
          redrafted: result.redrafted,
        },
      ])
    } catch (err: unknown) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'tutor',
          text: err instanceof Error ? err.message : String(err),
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">Σ</span>
          <span className="brand-name">Socratic Tutor</span>
        </div>
        <label className="picker">
          <span className="picker-label">Problem</span>
          <select
            value={selectedName}
            disabled={busy || cards.length === 0}
            onChange={(e) => void pickProblem(e.target.value)}
          >
            <option value="" disabled>
              {cards.length === 0 ? 'Loading…' : 'Choose a problem'}
            </option>
            {cards.map((card) => (
              <option key={card.name} value={card.name}>
                {card.title}
              </option>
            ))}
          </select>
        </label>
      </header>

      {loadError && <div className="banner">{loadError}</div>}

      <div className="workspace">
        <main className="problem-panel">
          {problem ? (
            <article className="problem">
              <h1>{problem.title}</h1>
              <section>
                <h2>Statement</h2>
                <p className="prose">{problem.statement}</p>
              </section>
              <section>
                <h2>Constraints</h2>
                <p className="prose constraints">{problem.constraints}</p>
              </section>
            </article>
          ) : (
            <div className="empty-problem">
              <p>Select a problem to begin.</p>
              <p className="hint">
                The tutor will guide you with questions — not answers.
              </p>
            </div>
          )}
        </main>

        <aside className="chat-rail">
          <div className="chat-header">Tutor</div>
          <div className="messages" ref={listRef}>
            {!sessionId && (
              <p className="chat-placeholder">
                Pick a problem to start a conversation.
              </p>
            )}
            {sessionId && messages.length === 0 && !busy && (
              <p className="chat-placeholder">
                Ask a question or share what you notice about the problem.
              </p>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`bubble ${msg.role}`}>
                <div className="bubble-meta">
                  <span className="role">{msg.role}</span>
                  {msg.mode && <span className={`mode mode-${msg.mode}`}>{msg.mode}</span>}
                  {msg.redrafted && <span className="redrafted">revised</span>}
                </div>
                <p className="bubble-text">{msg.text}</p>
                {msg.unlocked && msg.unlocked.length > 0 && (
                  <p className="unlocked">✓ unlocked: {msg.unlocked.join(', ')}</p>
                )}
              </div>
            ))}
            {busy && sessionId && (
              <div className="thinking" aria-live="polite">
                <span className="thinking-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                tutor is thinking…
              </div>
            )}
          </div>
          <div className="composer">
            <textarea
              rows={3}
              value={input}
              disabled={!sessionId || busy}
              placeholder={
                sessionId
                  ? 'Write to the tutor… (Enter to send)'
                  : 'Select a problem first'
              }
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button
              type="button"
              disabled={!sessionId || busy || !input.trim()}
              onClick={() => void send()}
            >
              Send
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}

export default App

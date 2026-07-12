import type { ProblemSummary } from './api'
import { difficultyClass, shortDate, statusMark } from './appHelpers'

export default function HeroLedger({
  problems,
  expanded,
  onLedgerRow,
  onResumeSession,
  onBeginCard,
}: {
  problems: ProblemSummary[]
  expanded: string | null
  onLedgerRow: (p: ProblemSummary) => void
  onResumeSession: (id: string) => void
  onBeginCard: (name: string, label?: string) => void
}) {
  return (
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
                          onClick={() => onResumeSession(s.id)}
                        >
                          resume
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="ledger-fresh"
                      onClick={() => onBeginCard(p.name, p.title)}
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
  )
}

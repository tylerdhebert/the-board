import type { Vocab } from './api'
import { smearWidth } from './appHelpers'

export default function VocabBoard({
  vocab,
  fresh,
  tapNonce,
}: {
  vocab: Vocab
  fresh: Set<string>
  tapNonce: number
}) {
  return (
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
            <span
              key={`s${i}-${tapNonce}`}
              className={`vocab-smear${tapNonce > 0 ? ' tapped' : ''}`}
              style={{
                width: smearWidth(i),
                ...(tapNonce > 0 ? { animationDelay: `${i * 40}ms` } : {}),
              }}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
      <div className="vocab-rail" aria-hidden="true">
        <span className="vocab-chalkpiece" />
      </div>
    </aside>
  )
}

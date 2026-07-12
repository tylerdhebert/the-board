import type { CardState } from './appTypes'
import { fanTransform } from './appHelpers'

export default function FanOverlay({
  fanCards,
  onClose,
}: {
  fanCards: CardState[]
  onClose: () => void
}) {
  return (
    <div
      className="fan-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="fan-hand">
        {fanCards.map((c, i) => (
          <div
            key={i}
            className="fan-slot"
            style={{
              ...fanTransform(i, fanCards.length),
              animationDelay: `${i * 30}ms`,
            }}
          >
            <div
              className={`index-card fan-card${c.pass === true ? ' pass' : c.pass === false ? ' fail' : ''}`}
              tabIndex={0}
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
        ))}
      </div>
    </div>
  )
}

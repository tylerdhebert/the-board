import { useEffect, useState } from 'react'

export default function LoadingBoard({ query, ingesting }: { query: string; ingesting: boolean }) {
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

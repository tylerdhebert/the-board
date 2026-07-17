import { useEffect, useState } from 'react'

export default function IngestLoadingBoard({
  query,
  error,
  onCancel,
  actionLabel = 'cancel',
}: {
  query: string
  error?: string | null
  onCancel: () => void
  actionLabel?: string
}) {
  const steps = [
    `finding ${query} on the board...`,
    'reading the problem...',
    'working it out before bringing it over...',
    'checking the examples...',
    'almost ready...',
  ]
  const [i, setI] = useState(0)
  useEffect(() => {
    setI(0)
    const timer = window.setInterval(() => setI((v) => (v + 1 < steps.length ? v + 1 : v)), 6500)
    return () => window.clearInterval(timer)
  }, [query, steps.length])

  return (
    <div className="loadingboard">
      <svg className="chalk-spin" viewBox="0 0 80 80" width="76" height="76" aria-hidden="true">
        <g className="spin-ring"><circle cx="40" cy="40" r="31" fill="none" stroke="#f0c34a" strokeWidth="2.4" strokeDasharray="17 13" filter="url(#chalk-rough)" /></g>
        <text x="40" y="52" textAnchor="middle" fontFamily="Bricolage Grotesque, sans-serif" fontWeight="800" fontSize="30" fill="#ece6d6">Σ</text>
      </svg>
      <p className="load-step">{error ? 'that one got stuck.' : steps[i]}</p>
      {error ? <p className="load-error">{error}</p> : <p className="load-note">you can come back to the board while this finishes.</p>}
      <button type="button" className="loading-cancel chalk amber" onClick={onCancel}>{actionLabel}</button>
    </div>
  )
}

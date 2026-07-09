import { useEffect, useState } from 'react'

export default function WindowControls() {
  const bridge = typeof window !== 'undefined' ? window.tutorDesktop : undefined
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!bridge) return
    void bridge.isMaximized().then(setMaximized)
    return bridge.onMaximizedChanged(setMaximized)
  }, [bridge])

  if (!bridge) return null

  return (
    <div className="winctl">
      <button type="button" aria-label="minimize" onClick={() => bridge.minimize()}>
        —
      </button>
      <button
        type="button"
        aria-label={maximized ? 'restore' : 'maximize'}
        onClick={() => bridge.toggleMaximize()}
      >
        {maximized ? '❐' : '□'}
      </button>
      <button type="button" className="close" aria-label="close" onClick={() => bridge.close()}>
        ×
      </button>
    </div>
  )
}

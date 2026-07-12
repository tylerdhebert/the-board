import { useEffect, useMemo, useRef, useState } from 'react'
import { mdLength, parseMd, renderMd } from './md'

export default function RevealingText({
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

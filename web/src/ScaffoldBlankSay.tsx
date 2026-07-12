import { Fragment, type ReactNode } from 'react'
import { renderScaffoldBlankPieces, splitScaffoldFences } from './appHelpers'

export default function ScaffoldBlankSay({
  text,
  values,
  disabled,
  onChange,
}: {
  text: string
  values: string[]
  disabled: boolean
  onChange: (blankIndex: number, value: string) => void
}) {
  const segs = splitScaffoldFences(text)
  const out: ReactNode[] = []
  let blank = 0
  for (let si = 0; si < segs.length; si++) {
    const seg = segs[si]!
    const { nodes, nextBlank } = renderScaffoldBlankPieces(
      seg.text,
      blank,
      values,
      disabled,
      onChange,
      seg.kind === 'prose',
    )
    blank = nextBlank
    if (seg.text === '') continue
    if (seg.kind === 'code') {
      out.push(
        <pre key={si} className="scaffold-code">
          {nodes}
        </pre>,
      )
    } else {
      out.push(<Fragment key={si}>{nodes}</Fragment>)
    }
  }
  return <div className="say scaffold-say">{out}</div>
}

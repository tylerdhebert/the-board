import type { ReactNode } from 'react'

// Tiny markdown subset for tutor notes: fenced code blocks, `inline code`,
// **bold**, *em*. Deliberately no library and no more syntax than the teacher
// actually emits — lists/plain lines read fine under white-space: pre-wrap.
// Segments (not a string) so the typewriter can reveal THROUGH styled spans
// without raw markers popping in first.
// Statements additionally carry ![alt](figure:N) refs into card figures.

export type MdFigure = { alt: string; data: string }

export type MdSeg =
  | { kind: 'text' | 'code' | 'bold' | 'em'; text: string }
  | { kind: 'block'; text: string }
  | { kind: 'figure'; text: string; index: number; alt: string }

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(!\[[^\]\n]*\]\(figure:\d+\))/g
const FENCE = /```[^\n`]*\n?([\s\S]*?)```/g
const FIGURE = /^!\[([^\]\n]*)\]\(figure:(\d+)\)$/

function parseInline(src: string, out: MdSeg[]): void {
  let last = 0
  for (const m of src.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push({ kind: 'text', text: src.slice(last, at) })
    if (m[1]) out.push({ kind: 'code', text: m[1].slice(1, -1) })
    else if (m[2]) out.push({ kind: 'bold', text: m[2].slice(2, -2) })
    else if (m[3]) out.push({ kind: 'em', text: m[3].slice(1, -1) })
    else if (m[4]) {
      const f = FIGURE.exec(m[4])
      // text '' so the typewriter's character budget ignores figures.
      out.push({ kind: 'figure', text: '', index: Number(f?.[2] ?? 0), alt: f?.[1] ?? '' })
    }
    last = at + m[0].length
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) })
}

export function parseMd(src: string): MdSeg[] {
  const segs: MdSeg[] = []
  let last = 0
  for (const m of src.matchAll(FENCE)) {
    const at = m.index ?? 0
    if (at > last) parseInline(src.slice(last, at), segs)
    segs.push({ kind: 'block', text: (m[1] ?? '').replace(/\n$/, '') })
    last = at + m[0].length
  }
  if (last < src.length) parseInline(src.slice(last), segs)
  return segs
}

/** Total revealable characters (markdown markers excluded). */
export function mdLength(segs: MdSeg[]): number {
  return segs.reduce((n, s) => n + s.text.length, 0)
}

export type MdRenderOpts = {
  figures?: MdFigure[]
  onFigure?: (figure: MdFigure) => void
}

/** Render segments, showing at most `limit` characters of content. */
export function renderMd(segs: MdSeg[], limit = Infinity, opts?: MdRenderOpts): ReactNode[] {
  const out: ReactNode[] = []
  let budget = limit
  for (let i = 0; i < segs.length; i++) {
    if (budget <= 0) break
    const s = segs[i]!
    const text = s.text.length <= budget ? s.text : s.text.slice(0, budget)
    budget -= s.text.length
    switch (s.kind) {
      case 'text':
        out.push(text)
        break
      case 'code':
        out.push(<code key={i}>{text}</code>)
        break
      case 'bold':
        out.push(<b key={i}>{text}</b>)
        break
      case 'em':
        out.push(<em key={i}>{text}</em>)
        break
      case 'block':
        out.push(
          <pre key={i}>
            <code>{text}</code>
          </pre>,
        )
        break
      case 'figure': {
        const fig = opts?.figures?.[s.index]
        if (!fig) break
        out.push(
          <button
            key={i}
            type="button"
            className="figure-thumb"
            title={fig.alt || 'figure — click to enlarge'}
            onClick={() => opts?.onFigure?.(fig)}
          >
            <img src={fig.data} alt={fig.alt || 'figure'} />
          </button>,
        )
        break
      }
    }
  }
  return out
}

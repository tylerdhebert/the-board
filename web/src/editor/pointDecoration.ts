import type { OnMount } from '@monaco-editor/react'

type Monaco = Parameters<OnMount>[1]
type Editor = Parameters<OnMount>[0]

export type PointTarget = { line: number; endLine?: number; quote: string }

export function clearPointDecorations(
  editor: Editor | null,
  pointDecoIdsRef: { current: string[] },
  activePointRef: { current: PointTarget | null },
): void {
  if (editor && pointDecoIdsRef.current.length > 0) {
    pointDecoIdsRef.current = editor.deltaDecorations(pointDecoIdsRef.current, [])
  } else {
    pointDecoIdsRef.current = []
  }
  activePointRef.current = null
}

export function isPointValid(
  model: NonNullable<ReturnType<Editor['getModel']>>,
  point: PointTarget,
): boolean {
  const { line, quote } = point
  const count = model.getLineCount()
  // The quote anchors the FIRST line; the range end just has to stay in bounds.
  if (line < 1 || line > count) return false
  if (model.getLineContent(line).trim() !== quote.trim()) return false
  if (point.endLine !== undefined && (point.endLine < line || point.endLine > count)) return false
  return true
}

export function applyPointDecoration(
  editor: Editor,
  monaco: Monaco,
  point: PointTarget,
): string[] {
  const model = editor.getModel()!
  const { line } = point
  const endLine = point.endLine && point.endLine > line ? point.endLine : line
  const sticky = monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
  return editor.deltaDecorations([], [
    // chalk highlight across the whole range (one line, or many)
    {
      range: new monaco.Range(line, 1, endLine, model.getLineMaxColumn(endLine)),
      options: { isWholeLine: true, className: 'point-line', stickiness: sticky },
    },
    // gutter arrow on the first line only, so a block still points at one place
    {
      range: new monaco.Range(line, 1, line, 1),
      options: { glyphMarginClassName: 'point-glyph', stickiness: sticky },
    },
  ])
}

export function subscribePointInvalidation(
  editor: Editor,
  activePointRef: { current: PointTarget | null },
  onInvalid: () => void,
  clearDecos: () => void,
): { dispose: () => void } {
  return editor.onDidChangeModelContent(() => {
    const active = activePointRef.current
    if (!active) return
    const m = editor.getModel()
    if (!m || !isPointValid(m, active)) {
      clearDecos()
      onInvalid()
    }
  })
}

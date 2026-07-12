import type { OnMount } from '@monaco-editor/react'

type Monaco = Parameters<OnMount>[1]
type Editor = Parameters<OnMount>[0]

export type PointTarget = { line: number; quote: string }

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
  if (line < 1 || line > model.getLineCount()) return false
  if (model.getLineContent(line).trim() !== quote.trim()) return false
  return true
}

export function applyPointDecoration(
  editor: Editor,
  monaco: Monaco,
  point: PointTarget,
): string[] {
  const model = editor.getModel()!
  const { line } = point
  return editor.deltaDecorations([], [
    {
      range: new monaco.Range(line, 1, line, model.getLineMaxColumn(line)),
      options: {
        isWholeLine: true,
        className: 'point-line',
        glyphMarginClassName: 'point-glyph',
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
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

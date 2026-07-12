import type { LspPosition, LspRange } from './types'

export function toLspPos(lineNumber: number, column: number): LspPosition {
  return { line: lineNumber - 1, character: column - 1 }
}

export function toMonacoPos(pos: LspPosition): { lineNumber: number; column: number } {
  return { lineNumber: pos.line + 1, column: pos.character + 1 }
}

export function toMonacoRange(range: LspRange): {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
} {
  const s = toMonacoPos(range.start)
  const e = toMonacoPos(range.end)
  return {
    startLineNumber: s.lineNumber,
    startColumn: s.column,
    endLineNumber: e.lineNumber,
    endColumn: e.column,
  }
}

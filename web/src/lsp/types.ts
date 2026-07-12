import type { OnMount } from '@monaco-editor/react'

export type Monaco = Parameters<OnMount>[1]
export type Editor = Parameters<OnMount>[0]
export type ITextModel = NonNullable<ReturnType<Editor['getModel']>>
export type IPosition = Parameters<ITextModel['getWordUntilPosition']>[0]
export type Disposable = { dispose(): void }

export type LspPosition = { line: number; character: number }
export type LspRange = { start: LspPosition; end: LspPosition }

export type CompletionItem = {
  label: string | { label: string }
  kind?: number
  detail?: string
  documentation?: string | { value: string }
  insertText?: string
  textEdit?: { newText: string; range: LspRange } | { newText: string; insert: LspRange }
}

export type HoverResult = {
  contents:
    | string
    | { value: string }
    | Array<string | { value: string }>
  range?: LspRange
}

export type SignatureHelp = {
  signatures: Array<{
    label: string
    documentation?: string | { value: string }
    parameters?: Array<{ label: string | [number, number]; documentation?: string | { value: string } }>
  }>
  activeSignature?: number
  activeParameter?: number
}

export type LspCfg = {
  lang: string
  languageId: string
  wsPath: string
  monacoLanguage: string
  /** Fallback ms after didOpen-empty before pushing buffer if $/progress never ends. */
  loadFallbackMs: number
  markerOwner: string
  unavailableLabel: string
}

export type LspHandle = {
  setActive(active: boolean): void
  dispose(): void
}

export type CsharpLspHandle = LspHandle

import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import {
  startCsharpLsp,
  startPythonLsp,
  type LspHandle,
} from './lsp/csharpLsp'
import {
  ghostMarginDisposables,
  mountGhostLineNumbers,
  updateGhostMargin,
} from './editor/ghostMargin'
import { isLspLang, type LspLang } from './editor/lspLang'
import { codeEditorOptions, setupChalkboardTheme, THEME } from './editor/monacoSetup'
import {
  applyPointDecoration,
  clearPointDecorations,
  isPointValid,
  subscribePointInvalidation,
  type PointTarget,
} from './editor/pointDecoration'

type Props = {
  value: string
  onChange: (v: string) => void
  language: string
  point?: PointTarget | null
  onPointInvalid?: () => void
}

export default function CodeEditor({
  value,
  onChange,
  language,
  point = null,
  onPointInvalid,
}: Props) {
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const lspMapRef = useRef<Map<LspLang, LspHandle>>(new Map())
  const lspStartingRef = useRef<Set<LspLang>>(new Set())
  const languageRef = useRef(language)
  languageRef.current = language
  const genRef = useRef(0)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const disposablesRef = useRef<{ dispose: () => void }[]>([])
  const pointDecoIdsRef = useRef<string[]>([])
  const activePointRef = useRef<PointTarget | null>(null)
  const onPointInvalidRef = useRef(onPointInvalid)
  onPointInvalidRef.current = onPointInvalid

  const syncActive = (current: string) => {
    for (const [lang, handle] of lspMapRef.current) {
      handle.setActive(lang === current)
    }
  }

  const ensureLsp = () => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) return
    const lang = languageRef.current
    if (!isLspLang(lang)) {
      syncActive('')
      return
    }
    const existing = lspMapRef.current.get(lang)
    if (existing) {
      syncActive(lang)
      return
    }
    if (lspStartingRef.current.has(lang)) {
      syncActive(lang)
      return
    }
    // Deactivate the other language while this one starts (shared model).
    syncActive(lang)
    const gen = genRef.current
    const starter = lang === 'csharp' ? startCsharpLsp : startPythonLsp
    lspStartingRef.current.add(lang)
    void starter(monaco, editor).then((session) => {
      lspStartingRef.current.delete(lang)
      if (gen !== genRef.current) {
        session.dispose()
        return
      }
      lspMapRef.current.set(lang, session)
      syncActive(languageRef.current)
    })
  }

  const updateGhost = () => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const ghost = ghostRef.current
    if (!editor || !monaco || !ghost) return
    updateGhostMargin(editor, monaco, ghost)
  }

  const clearPointDecos = () => {
    clearPointDecorations(editorRef.current, pointDecoIdsRef, activePointRef)
  }

  const onMount: OnMount = (editor, monaco) => {
    setupChalkboardTheme(monaco)
    editorRef.current = editor
    monacoRef.current = monaco

    // Ghost margin: numbers continuing past the buffer like ruled slate.
    ghostRef.current = mountGhostLineNumbers(editor)

    disposablesRef.current = ghostMarginDisposables(editor, updateGhost)
    requestAnimationFrame(() => updateGhost())

    ensureLsp()
  }

  useEffect(() => {
    ensureLsp()
  }, [language])

  useEffect(() => {
    requestAnimationFrame(() => updateGhost())
  }, [value])

  // POINT decoration: chalk underline + gutter arrow; invalidate when the line drifts.
  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    clearPointDecos()
    if (!editor || !monaco || !point) return

    const model = editor.getModel()
    if (!model) return
    if (!isPointValid(model, point)) {
      onPointInvalidRef.current?.()
      return
    }

    activePointRef.current = point
    pointDecoIdsRef.current = applyPointDecoration(editor, monaco, point)

    const sub = subscribePointInvalidation(
      editor,
      activePointRef,
      () => onPointInvalidRef.current?.(),
      clearPointDecos,
    )

    return () => {
      sub.dispose()
      clearPointDecos()
    }
  }, [point])

  useEffect(() => {
    return () => {
      genRef.current += 1
      lspStartingRef.current.clear()
      for (const handle of lspMapRef.current.values()) handle.dispose()
      lspMapRef.current.clear()
      for (const d of disposablesRef.current) d.dispose()
      disposablesRef.current = []
      ghostRef.current?.remove()
      ghostRef.current = null
      clearPointDecos()
    }
  }, [])

  return (
    <Editor
      height="100%"
      language={language}
      theme={THEME}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={onMount}
      loading={<div className="editor-loading">loading the chalk…</div>}
      options={codeEditorOptions}
    />
  )
}

import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import {
  startCsharpLsp,
  startPythonLsp,
  type LspHandle,
} from './lsp/csharpLsp'

type PointTarget = { line: number; quote: string }

type Props = {
  value: string
  onChange: (v: string) => void
  language: string
  point?: PointTarget | null
  onPointInvalid?: () => void
}

type LspLang = 'csharp' | 'python'

function isLspLang(lang: string): lang is LspLang {
  return lang === 'csharp' || lang === 'python'
}

// Monaco themed to the chalkboard: slate background, chalk text, colored-chalk tokens.
const THEME = 'chalkboard'
const GHOST_COLOR = 'rgba(58, 74, 65, 0.6)' // #3a4a41 at ~60%

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

  const updateGhostMargin = () => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const ghost = ghostRef.current
    if (!editor || !monaco || !ghost) return

    const { EditorOption } = monaco.editor
    const lineHeight = editor.getOption(EditorOption.lineHeight)
    const fontSize = editor.getOption(EditorOption.fontSize)
    const fontFamily = editor.getOption(EditorOption.fontFamily)
    const layout = editor.getLayoutInfo()
    const lineCount = editor.getModel()?.getLineCount() ?? 1
    const contentHeight = editor.getContentHeight()
    const scrollTop = editor.getScrollTop()
    const height = layout.height

    // Space below the last real line (content height minus scroll = bottom of
    // content in viewport coords). Ghosts fill from there to the container bottom.
    const contentBottom = contentHeight - scrollTop
    const remaining = height - contentBottom
    if (remaining < lineHeight * 0.5) {
      ghost.style.display = 'none'
      ghost.textContent = ''
      return
    }

    const ghostCount = Math.floor(remaining / lineHeight)
    if (ghostCount <= 0) {
      ghost.style.display = 'none'
      ghost.textContent = ''
      return
    }

    const numbers: string[] = []
    for (let i = 1; i <= ghostCount; i++) {
      numbers.push(String(lineCount + i))
    }

    ghost.style.display = 'block'
    ghost.style.top = `${contentBottom}px`
    ghost.style.left = '0'
    ghost.style.width = `${layout.lineNumbersLeft + layout.lineNumbersWidth}px`
    ghost.style.paddingLeft = `${layout.lineNumbersLeft}px`
    ghost.style.boxSizing = 'border-box'
    ghost.style.lineHeight = `${lineHeight}px`
    ghost.style.fontSize = `${fontSize}px`
    ghost.style.fontFamily = fontFamily
    ghost.style.color = GHOST_COLOR
    ghost.style.textAlign = 'right'
    ghost.textContent = numbers.join('\n')
  }

  const clearPointDecorations = () => {
    const editor = editorRef.current
    if (editor && pointDecoIdsRef.current.length > 0) {
      pointDecoIdsRef.current = editor.deltaDecorations(pointDecoIdsRef.current, [])
    } else {
      pointDecoIdsRef.current = []
    }
    activePointRef.current = null
  }

  const onMount: OnMount = (editor, monaco) => {
    monaco.editor.defineTheme(THEME, {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: 'ece6d6' },
        { token: 'comment', foreground: '52625a', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'f0c34a' },
        { token: 'string', foreground: 'ef8a6a' },
        { token: 'number', foreground: '8fc4cb' },
        { token: 'type', foreground: '8fc4cb' },
        { token: 'delimiter', foreground: '93a096' },
      ],
      colors: {
        'editor.background': '#101a15',
        'editor.foreground': '#ece6d6',
        'editorLineNumber.foreground': '#3a4a41',
        'editorLineNumber.activeForeground': '#93a096',
        'editor.selectionBackground': '#2a3d3388',
        'editorCursor.foreground': '#f0c34a',
        'editor.lineHighlightBackground': '#16241d',
        'editorWidget.background': '#16241d',
        'scrollbarSlider.background': '#3a4a4188',
      },
    })
    monaco.editor.setTheme(THEME)
    editorRef.current = editor
    monacoRef.current = monaco

    // Ghost margin: numbers continuing past the buffer like ruled slate.
    const dom = editor.getDomNode()
    if (dom) {
      const host = dom.parentElement
      if (host) {
        if (getComputedStyle(host).position === 'static') {
          host.style.position = 'relative'
        }
        const ghost = document.createElement('div')
        ghost.className = 'ghost-linenums'
        ghost.setAttribute('aria-hidden', 'true')
        Object.assign(ghost.style, {
          position: 'absolute',
          pointerEvents: 'none',
          overflow: 'hidden',
          whiteSpace: 'pre',
          zIndex: '1',
          userSelect: 'none',
          display: 'none',
        })
        host.appendChild(ghost)
        ghostRef.current = ghost
      }
    }

    disposablesRef.current = [
      editor.onDidContentSizeChange(() => updateGhostMargin()),
      editor.onDidLayoutChange(() => updateGhostMargin()),
      editor.onDidScrollChange(() => updateGhostMargin()),
      editor.onDidChangeModelContent(() => updateGhostMargin()),
    ]
    requestAnimationFrame(() => updateGhostMargin())

    ensureLsp()
  }

  useEffect(() => {
    ensureLsp()
  }, [language])

  useEffect(() => {
    requestAnimationFrame(() => updateGhostMargin())
  }, [value])

  // POINT decoration: chalk underline + gutter arrow; invalidate when the line drifts.
  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    clearPointDecorations()
    if (!editor || !monaco || !point) return

    const model = editor.getModel()
    if (!model) return
    const { line, quote } = point
    if (line < 1 || line > model.getLineCount()) {
      onPointInvalidRef.current?.()
      return
    }
    if (model.getLineContent(line).trim() !== quote.trim()) {
      onPointInvalidRef.current?.()
      return
    }

    activePointRef.current = point
    pointDecoIdsRef.current = editor.deltaDecorations([], [
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

    const sub = editor.onDidChangeModelContent(() => {
      const active = activePointRef.current
      if (!active) return
      const m = editor.getModel()
      if (
        !m ||
        active.line < 1 ||
        active.line > m.getLineCount() ||
        m.getLineContent(active.line).trim() !== active.quote.trim()
      ) {
        clearPointDecorations()
        onPointInvalidRef.current?.()
      }
    })

    return () => {
      sub.dispose()
      clearPointDecorations()
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
      clearPointDecorations()
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
      options={{
        fontFamily: "'Space Mono', ui-monospace, monospace",
        fontSize: 13.5,
        minimap: { enabled: false },
        lineNumbers: 'on',
        glyphMargin: true,
        scrollBeyondLastLine: false,
        padding: { top: 14, bottom: 14 },
        renderLineHighlight: 'none',
        overviewRulerLanes: 0,
        folding: false,
        guides: { indentation: false },
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        tabSize: 2,
        automaticLayout: true,
      }}
    />
  )
}

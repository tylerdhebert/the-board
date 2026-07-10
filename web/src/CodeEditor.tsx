import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { startCsharpLsp, type CsharpLspHandle } from './lsp/csharpLsp'

type Props = {
  value: string
  onChange: (v: string) => void
  language: string
}

// Monaco themed to the chalkboard: slate background, chalk text, colored-chalk tokens.
const THEME = 'chalkboard'
const GHOST_COLOR = 'rgba(58, 74, 65, 0.6)' // #3a4a41 at ~60%

export default function CodeEditor({ value, onChange, language }: Props) {
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const lspRef = useRef<CsharpLspHandle | null>(null)
  const languageRef = useRef(language)
  languageRef.current = language
  const genRef = useRef(0)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const disposablesRef = useRef<{ dispose: () => void }[]>([])

  const ensureLsp = () => {
    const monaco = monacoRef.current
    const editor = editorRef.current
    if (!monaco || !editor) return
    if (lspRef.current) {
      lspRef.current.setActive(languageRef.current === 'csharp')
      return
    }
    if (languageRef.current !== 'csharp') return
    const gen = ++genRef.current
    void startCsharpLsp(monaco, editor).then((session) => {
      if (gen !== genRef.current) {
        session.dispose()
        return
      }
      lspRef.current = session
      session.setActive(languageRef.current === 'csharp')
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

  useEffect(() => {
    return () => {
      genRef.current += 1
      lspRef.current?.dispose()
      lspRef.current = null
      for (const d of disposablesRef.current) d.dispose()
      disposablesRef.current = []
      ghostRef.current?.remove()
      ghostRef.current = null
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

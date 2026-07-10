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

export default function CodeEditor({ value, onChange, language }: Props) {
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const lspRef = useRef<CsharpLspHandle | null>(null)
  const languageRef = useRef(language)
  languageRef.current = language
  const genRef = useRef(0)

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
    ensureLsp()
  }

  useEffect(() => {
    ensureLsp()
  }, [language])

  useEffect(() => {
    return () => {
      genRef.current += 1
      lspRef.current?.dispose()
      lspRef.current = null
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

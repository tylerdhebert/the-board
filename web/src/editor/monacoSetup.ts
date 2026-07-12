import type { OnMount } from '@monaco-editor/react'

type Monaco = Parameters<OnMount>[1]

// Monaco themed to the chalkboard: slate background, chalk text, colored-chalk tokens.
export const THEME = 'chalkboard'

export function setupChalkboardTheme(monaco: Monaco): void {
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
}

export const codeEditorOptions = {
  fontFamily: "'Space Mono', ui-monospace, monospace",
  fontSize: 13.5,
  minimap: { enabled: false },
  lineNumbers: 'on' as const,
  glyphMargin: true,
  scrollBeyondLastLine: false,
  padding: { top: 14, bottom: 14 },
  renderLineHighlight: 'none' as const,
  overviewRulerLanes: 0,
  folding: false,
  guides: { indentation: false },
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  tabSize: 2,
  automaticLayout: true,
}

import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { loader } from '@monaco-editor/react'

self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    return label === 'typescript' || label === 'javascript'
      ? new tsWorker()
      : new editorWorker()
  },
}

loader.config({ monaco })

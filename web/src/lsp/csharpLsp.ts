import type { OnMount } from '@monaco-editor/react'
import { JsonRpcWs } from './jsonrpc'

type Monaco = Parameters<OnMount>[1]
type Editor = Parameters<OnMount>[0]
type ITextModel = NonNullable<ReturnType<Editor['getModel']>>
type IPosition = Parameters<ITextModel['getWordUntilPosition']>[0]
type Disposable = { dispose(): void }

type LspPosition = { line: number; character: number }
type LspRange = { start: LspPosition; end: LspPosition }

type CompletionItem = {
  label: string | { label: string }
  kind?: number
  detail?: string
  documentation?: string | { value: string }
  insertText?: string
  textEdit?: { newText: string; range: LspRange } | { newText: string; insert: LspRange }
}

type HoverResult = {
  contents:
    | string
    | { value: string }
    | Array<string | { value: string }>
  range?: LspRange
}

type SignatureHelp = {
  signatures: Array<{
    label: string
    documentation?: string | { value: string }
    parameters?: Array<{ label: string | [number, number]; documentation?: string | { value: string } }>
  }>
  activeSignature?: number
  activeParameter?: number
}

type LspCfg = {
  lang: string
  languageId: string
  wsPath: string
  monacoLanguage: string
  /** Fallback ms after didOpen-empty before pushing buffer if $/progress never ends. */
  loadFallbackMs: number
  markerOwner: string
  unavailableLabel: string
}

const COMPLETION_KIND_MAP: Record<number, number> = {}

function ensureKindMap(monaco: Monaco): void {
  if (Object.keys(COMPLETION_KIND_MAP).length) return
  const K = monaco.languages.CompletionItemKind
  const lspToMonaco = [
    K.Text, // 1
    K.Method,
    K.Function,
    K.Constructor,
    K.Field,
    K.Variable,
    K.Class,
    K.Interface,
    K.Module,
    K.Property,
    K.Unit,
    K.Value,
    K.Enum,
    K.Keyword,
    K.Snippet,
    K.Color,
    K.File,
    K.Reference,
    K.Folder,
    K.EnumMember,
    K.Constant,
    K.Struct,
    K.Event,
    K.Operator,
    K.TypeParameter, // 25
  ]
  for (let i = 0; i < lspToMonaco.length; i++) {
    COMPLETION_KIND_MAP[i + 1] = lspToMonaco[i]!
  }
}

function toLspPos(lineNumber: number, column: number): LspPosition {
  return { line: lineNumber - 1, character: column - 1 }
}

function toMonacoPos(pos: LspPosition): { lineNumber: number; column: number } {
  return { lineNumber: pos.line + 1, column: pos.character + 1 }
}

function toMonacoRange(range: LspRange): {
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

function docToString(doc: string | { value: string } | undefined): string | undefined {
  if (doc == null) return undefined
  return typeof doc === 'string' ? doc : doc.value
}

function hoverContentsToMarkdown(
  contents: HoverResult['contents'],
): Array<{ value: string }> {
  if (typeof contents === 'string') return [{ value: contents }]
  if (Array.isArray(contents)) {
    return contents.map((c) => ({ value: typeof c === 'string' ? c : c.value }))
  }
  return [{ value: contents.value }]
}

export type LspHandle = {
  setActive(active: boolean): void
  dispose(): void
}

export type CsharpLspHandle = LspHandle

async function startLsp(
  monaco: Monaco,
  editor: Editor,
  cfg: LspCfg,
): Promise<LspHandle> {
  const noop: LspHandle = { setActive() {}, dispose() {} }

  let info: { rootUri: string; fileUri: string }
  try {
    const res = await fetch(`/api/lsp/info?lang=${encodeURIComponent(cfg.lang)}`)
    if (!res.ok) throw new Error(`lsp/info ${res.status}`)
    info = (await res.json()) as { rootUri: string; fileUri: string }
  } catch (err) {
    console.warn(`${cfg.unavailableLabel} unavailable`, err)
    return noop
  }

  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${cfg.wsPath}`

  let rpc: JsonRpcWs
  try {
    rpc = await JsonRpcWs.connect(wsUrl)
  } catch (err) {
    console.warn(`${cfg.unavailableLabel} unavailable`, err)
    return noop
  }

  const model = editor.getModel()
  if (!model) {
    rpc.dispose()
    console.warn(`${cfg.unavailableLabel} unavailable`, new Error('no model'))
    return noop
  }

  const { rootUri, fileUri } = info
  let version = 1
  let active = true
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const disposables: Disposable[] = []

  try {
    await rpc.request('initialize', {
      processId: null,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: 'scratch' }],
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: false },
          completion: {
            dynamicRegistration: false,
            completionItem: { snippetSupport: false, documentationFormat: ['markdown', 'plaintext'] },
          },
          hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
          signatureHelp: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: false },
        },
        workspace: {
          workspaceFolders: true,
          configuration: true,
        },
        window: {
          workDoneProgress: true,
        },
      },
    })
    rpc.notify('initialized', {})
  } catch (err) {
    console.warn(`${cfg.unavailableLabel} unavailable`, err)
    rpc.dispose()
    return noop
  }

  const flushChange = () => {
    if (debounceTimer != null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    version += 1
    rpc.notify('textDocument/didChange', {
      textDocument: { uri: fileUri, version },
      contentChanges: [{ text: model.getValue() }],
    })
  }

  // Requests must see the current buffer: a pending debounce means the server
  // is stale, so flush before asking (completion racing didChange returns
  // wrong-context results — observed live).
  const syncBeforeRequest = () => {
    if (debounceTimer != null) flushChange()
  }

  // Open empty first — csharp-ls binds the overlay reliably only after the
  // project finishes loading; we push the real buffer via didChange then.
  // Python uses the same flow with a shorter fallback (no project load).
  let projectReady = false
  let loadFallbackTimer: ReturnType<typeof setTimeout> | null = null
  let unsubProgress: () => void = () => {}
  const pushBufferAfterLoad = () => {
    if (projectReady) return
    projectReady = true
    unsubProgress()
    if (loadFallbackTimer != null) {
      clearTimeout(loadFallbackTimer)
      loadFallbackTimer = null
    }
    if (active) flushChange()
  }
  unsubProgress = rpc.onNotification('$/progress', (params) => {
    const kind = (params as { value?: { kind?: string } } | undefined)?.value?.kind
    if (kind === 'end') pushBufferAfterLoad()
  })
  loadFallbackTimer = setTimeout(pushBufferAfterLoad, cfg.loadFallbackMs)

  rpc.notify('textDocument/didOpen', {
    textDocument: {
      uri: fileUri,
      languageId: cfg.languageId,
      version,
      text: '',
    },
  })

  disposables.push(
    model.onDidChangeContent(() => {
      if (!active) return
      if (debounceTimer != null) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(flushChange, 250)
    }),
  )

  ensureKindMap(monaco)

  disposables.push(
    monaco.languages.registerCompletionItemProvider(cfg.monacoLanguage, {
      triggerCharacters: ['.'],
      provideCompletionItems: async (m: ITextModel, position: IPosition) => {
        const word = m.getWordUntilPosition(position)
        const defaultRange = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        }
        try {
          syncBeforeRequest()
          const result = await rpc.request('textDocument/completion', {
            textDocument: { uri: fileUri },
            position: toLspPos(position.lineNumber, position.column),
          })
          const items: CompletionItem[] = Array.isArray(result)
            ? result
            : ((result as { items?: CompletionItem[] } | null)?.items ?? [])
          return {
            suggestions: items.map((item) => {
              const label = typeof item.label === 'string' ? item.label : item.label.label
              let insertText = item.insertText ?? label
              let range = defaultRange
              if (item.textEdit) {
                insertText = item.textEdit.newText
                const r =
                  'range' in item.textEdit
                    ? item.textEdit.range
                    : 'insert' in item.textEdit
                      ? item.textEdit.insert
                      : null
                if (r) range = toMonacoRange(r)
              }
              return {
                label,
                kind: COMPLETION_KIND_MAP[item.kind ?? 1] ?? monaco.languages.CompletionItemKind.Text,
                insertText,
                range,
                detail: item.detail,
                documentation: docToString(item.documentation),
              }
            }),
          }
        } catch {
          return { suggestions: [] }
        }
      },
    }),
  )

  disposables.push(
    monaco.languages.registerHoverProvider(cfg.monacoLanguage, {
      provideHover: async (_m: ITextModel, position: IPosition) => {
        try {
          syncBeforeRequest()
          const result = (await rpc.request('textDocument/hover', {
            textDocument: { uri: fileUri },
            position: toLspPos(position.lineNumber, position.column),
          })) as HoverResult | null
          if (!result?.contents) return null
          return {
            contents: hoverContentsToMarkdown(result.contents),
            range: result.range ? toMonacoRange(result.range) : undefined,
          }
        } catch {
          return null
        }
      },
    }),
  )

  disposables.push(
    monaco.languages.registerSignatureHelpProvider(cfg.monacoLanguage, {
      signatureHelpTriggerCharacters: ['(', ','],
      provideSignatureHelp: async (_m: ITextModel, position: IPosition) => {
        try {
          syncBeforeRequest()
          const result = (await rpc.request('textDocument/signatureHelp', {
            textDocument: { uri: fileUri },
            position: toLspPos(position.lineNumber, position.column),
          })) as SignatureHelp | null
          if (!result?.signatures?.length) return null
          return {
            value: {
              signatures: result.signatures.map((sig) => ({
                label: sig.label,
                documentation: docToString(sig.documentation),
                parameters: (sig.parameters ?? []).map((p) => ({
                  label: p.label,
                  documentation: docToString(p.documentation),
                })),
              })),
              activeSignature: result.activeSignature ?? 0,
              activeParameter: result.activeParameter ?? 0,
            },
            dispose() {},
          }
        } catch {
          return null
        }
      },
    }),
  )

  const unsubDiag = rpc.onNotification('textDocument/publishDiagnostics', (params) => {
    if (!active) return
    const p = params as {
      uri?: string
      diagnostics?: Array<{
        range: LspRange
        severity?: number
        message: string
        source?: string
        code?: string | number
      }>
    }
    if (p.uri && p.uri !== fileUri) return
    const Sev = monaco.MarkerSeverity
    const severityMap: Record<number, number> = {
      1: Sev.Error,
      2: Sev.Warning,
      3: Sev.Info,
      4: Sev.Hint,
    }
    const markers = (p.diagnostics ?? []).map((d) => ({
      ...toMonacoRange(d.range),
      message: d.message,
      severity: severityMap[d.severity ?? 1] ?? Sev.Error,
      source: d.source ?? cfg.markerOwner,
      code: d.code != null ? String(d.code) : undefined,
    }))
    monaco.editor.setModelMarkers(model, cfg.markerOwner, markers)
  })

  return {
    setActive(next: boolean) {
      if (next === active) return
      active = next
      if (!active) {
        if (debounceTimer != null) {
          clearTimeout(debounceTimer)
          debounceTimer = null
        }
        monaco.editor.setModelMarkers(model, cfg.markerOwner, [])
        return
      }
      // Re-entering this language: push one full didChange immediately, then
      // resume normal debounced sync via onDidChangeContent.
      flushChange()
    },
    dispose() {
      if (debounceTimer != null) clearTimeout(debounceTimer)
      if (loadFallbackTimer != null) clearTimeout(loadFallbackTimer)
      unsubProgress()
      unsubDiag()
      for (const d of disposables) d.dispose()
      monaco.editor.setModelMarkers(model, cfg.markerOwner, [])
      try {
        rpc.notify('textDocument/didClose', { textDocument: { uri: fileUri } })
      } catch {
        /* best-effort */
      }
      rpc.dispose()
    },
  }
}

export async function startCsharpLsp(
  monaco: Monaco,
  editor: Editor,
): Promise<LspHandle> {
  return startLsp(monaco, editor, {
    lang: 'csharp',
    languageId: 'csharp',
    wsPath: '/lsp/csharp',
    monacoLanguage: 'csharp',
    loadFallbackMs: 8000,
    markerOwner: 'csharp-ls',
    unavailableLabel: 'csharp-ls',
  })
}

export async function startPythonLsp(
  monaco: Monaco,
  editor: Editor,
): Promise<LspHandle> {
  return startLsp(monaco, editor, {
    lang: 'python',
    languageId: 'python',
    wsPath: '/lsp/python',
    monacoLanguage: 'python',
    loadFallbackMs: 1500,
    markerOwner: 'pyright',
    unavailableLabel: 'pyright',
  })
}

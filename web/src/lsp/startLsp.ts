import { connectLspRpc, fetchLspInfo } from './lspConnection'
import { clearDiagnostics, subscribeDiagnostics } from './lspDiagnostics'
import { initializeLsp } from './lspInit'
import { registerLspProviders } from './lspProviders'
import type { Disposable, Editor, LspCfg, LspHandle, Monaco } from './types'

async function startLsp(
  monaco: Monaco,
  editor: Editor,
  cfg: LspCfg,
): Promise<LspHandle> {
  const noop: LspHandle = { setActive() {}, dispose() {} }

  const info = await fetchLspInfo(cfg)
  if (!info) return noop

  const rpc = await connectLspRpc(cfg)
  if (!rpc) return noop

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
    await initializeLsp(rpc, rootUri)
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

  disposables.push(...registerLspProviders(monaco, rpc, cfg, fileUri, syncBeforeRequest))

  const unsubDiag = subscribeDiagnostics(rpc, monaco, model, cfg, fileUri, () => active)

  return {
    setActive(next: boolean) {
      if (next === active) return
      active = next
      if (!active) {
        if (debounceTimer != null) {
          clearTimeout(debounceTimer)
          debounceTimer = null
        }
        clearDiagnostics(monaco, model, cfg)
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
      clearDiagnostics(monaco, model, cfg)
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

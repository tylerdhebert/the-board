import { JsonRpcWs } from './jsonrpc'
import { toMonacoRange } from './lspCoordinates'
import type { ITextModel, LspCfg, LspRange, Monaco } from './types'

export function subscribeDiagnostics(
  rpc: JsonRpcWs,
  monaco: Monaco,
  model: ITextModel,
  cfg: LspCfg,
  fileUri: string,
  isActive: () => boolean,
): () => void {
  return rpc.onNotification('textDocument/publishDiagnostics', (params) => {
    if (!isActive()) return
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
}

export function clearDiagnostics(monaco: Monaco, model: ITextModel, cfg: LspCfg): void {
  monaco.editor.setModelMarkers(model, cfg.markerOwner, [])
}

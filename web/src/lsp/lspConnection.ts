import { JsonRpcWs } from './jsonrpc'
import type { LspCfg } from './types'

export async function fetchLspInfo(
  cfg: LspCfg,
): Promise<{ rootUri: string; fileUri: string } | null> {
  try {
    const res = await fetch(`/api/lsp/info?lang=${encodeURIComponent(cfg.lang)}`)
    if (!res.ok) throw new Error(`lsp/info ${res.status}`)
    return (await res.json()) as { rootUri: string; fileUri: string }
  } catch (err) {
    console.warn(`${cfg.unavailableLabel} unavailable`, err)
    return null
  }
}

export function buildWsUrl(cfg: LspCfg): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${cfg.wsPath}`
}

export async function connectLspRpc(
  cfg: LspCfg,
): Promise<JsonRpcWs | null> {
  try {
    return await JsonRpcWs.connect(buildWsUrl(cfg))
  } catch (err) {
    console.warn(`${cfg.unavailableLabel} unavailable`, err)
    return null
  }
}

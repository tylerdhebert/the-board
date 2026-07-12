import { JsonRpcWs } from './jsonrpc'

export function buildInitializeParams(rootUri: string) {
  return {
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
  }
}

export async function initializeLsp(
  rpc: JsonRpcWs,
  rootUri: string,
): Promise<void> {
  await rpc.request('initialize', buildInitializeParams(rootUri))
  rpc.notify('initialized', {})
}

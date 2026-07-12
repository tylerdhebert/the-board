import { JsonRpcWs } from './jsonrpc'
import { completionKindFor, ensureKindMap } from './completionKind'
import { toLspPos, toMonacoRange } from './lspCoordinates'
import { docToString, hoverContentsToMarkdown } from './lspFormatting'
import type {
  CompletionItem,
  Disposable,
  HoverResult,
  IPosition,
  ITextModel,
  LspCfg,
  Monaco,
  SignatureHelp,
} from './types'

export function registerLspProviders(
  monaco: Monaco,
  rpc: JsonRpcWs,
  cfg: LspCfg,
  fileUri: string,
  syncBeforeRequest: () => void,
): Disposable[] {
  ensureKindMap(monaco)

  return [
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
                kind: completionKindFor(monaco, item.kind),
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
  ]
}

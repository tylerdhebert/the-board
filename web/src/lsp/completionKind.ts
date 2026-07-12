import type { Monaco } from './types'

const COMPLETION_KIND_MAP: Record<number, number> = {}

export function ensureKindMap(monaco: Monaco): void {
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

export function completionKindFor(monaco: Monaco, kind: number | undefined): number {
  return COMPLETION_KIND_MAP[kind ?? 1] ?? monaco.languages.CompletionItemKind.Text
}

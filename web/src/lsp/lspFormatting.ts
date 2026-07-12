import type { HoverResult } from './types'

export function docToString(doc: string | { value: string } | undefined): string | undefined {
  if (doc == null) return undefined
  return typeof doc === 'string' ? doc : doc.value
}

export function hoverContentsToMarkdown(
  contents: HoverResult['contents'],
): Array<{ value: string }> {
  if (typeof contents === 'string') return [{ value: contents }]
  if (Array.isArray(contents)) {
    return contents.map((c) => ({ value: typeof c === 'string' ? c : c.value }))
  }
  return [{ value: contents.value }]
}

export type LspLang = 'csharp' | 'python'

export function isLspLang(lang: string): lang is LspLang {
  return lang === 'csharp' || lang === 'python'
}

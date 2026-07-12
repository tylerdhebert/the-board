import type { TurnStage } from './api'

export const LANGS = ['csharp', 'typescript', 'python', 'javascript'] as const
export const RUNNABLE = new Set(['python', 'typescript', 'javascript', 'csharp'])

// Monaco language id -> LeetCode langSlug (for picking the starter scaffold).
export const LANG_SLUG: Record<string, string> = {
  csharp: 'csharp',
  typescript: 'typescript',
  python: 'python3',
  javascript: 'javascript',
  java: 'java',
  cpp: 'cpp',
  go: 'golang',
}

export const STAGE_COPY: Record<TurnStage, string> = {
  unlock: "checking what you've earned…",
  draft: 'thinking about your move…',
  gate: "making sure i'm not giving it away…",
  redraft: 'rewording — i almost said too much…',
}

export const MARGIN_WIDTH_KEY = 'the-board:margin-width'
export const MARGIN_MIN_PX = 240
export const DESK_MIN_PX = 420
export const COMPOSER_LINE_PX = 22 // ~14.5px * 1.5
export const COMPOSER_PAD_PX = 16 // vertical padding inside the chalk field
export const COMPOSER_MIN_PX = COMPOSER_LINE_PX * 2 + COMPOSER_PAD_PX
export const COMPOSER_AUTO_MAX_PX = COMPOSER_LINE_PX * 6 + COMPOSER_PAD_PX
export const COMPOSER_MANUAL_MAX_PX = COMPOSER_LINE_PX * 16 + COMPOSER_PAD_PX

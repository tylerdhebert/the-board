import { Fragment, createElement, type ChangeEvent, type CSSProperties, type ReactNode } from 'react'
import type { PersistedTake, Problem, ProblemSummary, RunCaseResult, StudentRunResult } from './api'
import {
  DESK_CHROME_PX,
  DESK_MIN_PX,
  LANG_SLUG,
  MARGIN_MIN_PX,
  MARGIN_WIDTH_KEY,
  PROBLEM_MIN_PX,
  PROBLEM_WIDTH_KEY,
  WORK_MIN_PX,
} from './appConstants'
import type { CardState, Mode, ScaffoldSeg } from './appTypes'
import { parseMd, renderMd } from './md'

export function snippetFor(problem: Problem | null, lang: string): string {
  const slug = LANG_SLUG[lang] ?? lang
  return problem?.codeSnippets?.find((s) => s.langSlug === slug)?.code ?? ''
}

/** Right-trim every line, drop trailing blank lines. Indentation still counts. */
export function normalizeForDirty(code: string): string {
  return code
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n+$/, '')
}

export function difficultyClass(d: string): string {
  const lower = d.toLowerCase()
  if (lower === 'easy') return 'easy'
  if (lower === 'medium') return 'medium'
  if (lower === 'hard') return 'hard'
  return 'medium'
}

export function officialCases(res: StudentRunResult): RunCaseResult[] {
  return res.cases.filter((c) => !c.stress)
}

export function stressCases(res: StudentRunResult): RunCaseResult[] {
  return res.cases.filter((c) => c.stress)
}

export function takeAllPass(t: PersistedTake): boolean {
  const res = t.results
  if (res == null || res.error) return false
  const official = officialCases(res)
  return official.length > 0 && official.every((c) => c.pass)
}

export function takeScoreLabel(t: PersistedTake, knownTotal: number | null): string {
  const res = t.results
  if (res == null || res.error) {
    return knownTotal == null ? '–/–' : `–/${knownTotal}`
  }
  const official = officialCases(res)
  const tougher = stressCases(res)
  const oPass = official.filter((c) => c.pass).length
  const base = `${oPass}/${official.length}`
  if (tougher.length === 0) return base
  const tPass = tougher.filter((c) => c.pass).length
  return `${base} · ${tPass}/${tougher.length} tough`
}

export function buildCaseCards(
  rows: { input: string; output: string }[],
  runResults: RunCaseResult[] | null,
): CardState[] {
  return rows.map((row, i) => {
    const card: CardState = { input: row.input, expected: row.output }
    const r = runResults?.[i]
    if (r) {
      card.got = r.got
      card.pass = r.pass
      if (r.error) card.error = r.error
    }
    return card
  })
}

export function fanTransform(i: number, n: number): CSSProperties {
  const c = i - (n - 1) / 2
  const spread = Math.min(215, 1000 / Math.max(n - 1, 1))
  const rot = c * Math.min(7, (26 / Math.max(n - 1, 1)) * 2)
  const lift = Math.abs(c) * Math.abs(c) * 7
  return {
    position: 'absolute',
    left: '50%',
    bottom: 0,
    transform: `translateX(calc(-50% + ${c * spread}px)) translateY(${lift}px) rotate(${rot}deg)`,
    zIndex: 10 + i,
    ['--fan-rot' as string]: `${rot}deg`,
  } as CSSProperties
}

export function hasScaffoldBlanks(mode: Mode | undefined, text: string): boolean {
  return mode === 'scaffold' && /_{4,}/.test(text)
}

export function composeFilledScaffold(text: string, values: string[]): string {
  let i = 0
  return text.replace(/_{4,}/g, () => {
    const v = (values[i++] ?? '').trim()
    return v || '____'
  })
}

export function blanksAllEmpty(text: string, values: string[]): boolean {
  const count = text.match(/_{4,}/g)?.length ?? 0
  if (count === 0) return true
  for (let i = 0; i < count; i++) {
    if ((values[i] ?? '').trim() !== '') return false
  }
  return true
}

/** Split scaffold text on ``` fence lines (openers/closers omitted from output). */
export function splitScaffoldFences(text: string): ScaffoldSeg[] {
  const lines = text.split(/\r?\n/)
  const segs: ScaffoldSeg[] = []
  let inCode = false
  let buf: string[] = []

  const flush = (kind: 'prose' | 'code') => {
    segs.push({ kind, text: buf.join('\n') })
    buf = []
  }

  for (const line of lines) {
    if (/^```/.test(line)) {
      flush(inCode ? 'code' : 'prose')
      inCode = !inCode
      continue
    }
    buf.push(line)
  }
  flush(inCode ? 'code' : 'prose')
  return segs
}

export function renderScaffoldBlankPieces(
  text: string,
  startBlank: number,
  values: string[],
  disabled: boolean,
  onChange: (blankIndex: number, value: string) => void,
  markdown = false,
): { nodes: ReactNode[]; nextBlank: number } {
  const parts = text.split(/_{4,}/)
  const nodes: ReactNode[] = []
  let blank = startBlank
  for (let k = 0; k < parts.length; k++) {
    // Prose keeps its markdown (bold / `code`); code segments stay literal.
    const content = markdown ? renderMd(parseMd(parts[k]!)) : parts[k]
    nodes.push(createElement(Fragment, { key: `t${k}` }, content))
    if (k < parts.length - 1) {
      const idx = blank++
      nodes.push(
        createElement('input', {
          key: `b${idx}`,
          className: 'blank',
          size: Math.max(6, (values[idx] ?? '').length + 1),
          value: values[idx] ?? '',
          disabled,
          onChange: (e: ChangeEvent<HTMLInputElement>) => onChange(idx, e.target.value),
          'aria-label': `scaffold blank ${idx + 1}`,
        }),
      )
    }
  }
  return { nodes, nextBlank: blank }
}

export function defaultMarginWidth(viewport = typeof window !== 'undefined' ? window.innerWidth : 1200): number {
  return Math.round(viewport * 0.25)
}

export function clampMarginWidth(
  px: number,
  viewport = typeof window !== 'undefined' ? window.innerWidth : 1200,
): number {
  const max = Math.max(MARGIN_MIN_PX, Math.min(Math.round(viewport * 0.5), viewport - DESK_MIN_PX))
  return Math.min(max, Math.max(MARGIN_MIN_PX, Math.round(px)))
}

export function readStoredMarginWidth(): number {
  try {
    const raw = localStorage.getItem(MARGIN_WIDTH_KEY)
    if (raw != null) {
      const n = Number(raw)
      if (Number.isFinite(n)) return clampMarginWidth(n)
    }
  } catch {
    /* private mode / blocked storage */
  }
  return clampMarginWidth(defaultMarginWidth())
}

export function persistMarginWidth(px: number) {
  try {
    localStorage.setItem(MARGIN_WIDTH_KEY, String(px))
  } catch {
    /* ignore */
  }
}

/** Statement-column width: floor = its content-hug width; ceiling leaves the
    editor column at least WORK_MIN_PX of the desk. */
export function clampProblemWidth(px: number, deskWidth: number): number {
  const max = Math.max(PROBLEM_MIN_PX, deskWidth - DESK_CHROME_PX - WORK_MIN_PX)
  return Math.min(max, Math.max(PROBLEM_MIN_PX, Math.round(px)))
}

export function readStoredProblemWidth(): number {
  try {
    const raw = localStorage.getItem(PROBLEM_WIDTH_KEY)
    if (raw != null) {
      const n = Number(raw)
      // Clamped against the live desk width on first layout effect.
      if (Number.isFinite(n)) return Math.max(PROBLEM_MIN_PX, Math.round(n))
    }
  } catch {
    /* private mode / blocked storage */
  }
  return PROBLEM_MIN_PX
}

export function persistProblemWidth(px: number) {
  try {
    localStorage.setItem(PROBLEM_WIDTH_KEY, String(px))
  } catch {
    /* ignore */
  }
}

/** Hidden payload for review-my-work. Transcript still shows the short label. */
export function reviewPrompt(notes?: string): string {
  let prompt =
    'Please review my current board and push me one step forward — point out ' +
    'what to reconsider, but do NOT give me the answer or write the fix.'
  const noteText = notes?.trim()
  if (noteText) {
    prompt += `\n\nMy notes:\n${noteText}`
  }
  return prompt
}

export function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toLowerCase()
}

export function statusMark(status: ProblemSummary['status']): { mark: string; className: string } {
  if (status === 'solved') return { mark: '✓', className: 'mark-solved' }
  if (status === 'attempted') return { mark: '~', className: 'mark-attempted' }
  return { mark: '·', className: 'mark-new' }
}

/** Stable smear widths from slot index only — never from the real term. */
export function smearWidth(i: number): number {
  const w = [64, 88, 52, 76, 96, 58, 70, 82]
  return w[i % w.length]!
}

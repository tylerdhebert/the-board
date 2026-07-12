import type { OnMount } from '@monaco-editor/react'

type Monaco = Parameters<OnMount>[1]
type Editor = Parameters<OnMount>[0]

const GHOST_COLOR = 'rgba(58, 74, 65, 0.6)' // #3a4a41 at ~60%

export function mountGhostLineNumbers(editor: Editor): HTMLDivElement | null {
  const dom = editor.getDomNode()
  if (!dom) return null
  const host = dom.parentElement
  if (!host) return null

  if (getComputedStyle(host).position === 'static') {
    host.style.position = 'relative'
  }
  const ghost = document.createElement('div')
  ghost.className = 'ghost-linenums'
  ghost.setAttribute('aria-hidden', 'true')
  Object.assign(ghost.style, {
    position: 'absolute',
    pointerEvents: 'none',
    overflow: 'hidden',
    whiteSpace: 'pre',
    zIndex: '1',
    userSelect: 'none',
    display: 'none',
  })
  host.appendChild(ghost)
  return ghost
}

export function updateGhostMargin(
  editor: Editor,
  monaco: Monaco,
  ghost: HTMLDivElement,
): void {
  const { EditorOption } = monaco.editor
  const lineHeight = editor.getOption(EditorOption.lineHeight)
  const fontSize = editor.getOption(EditorOption.fontSize)
  const fontFamily = editor.getOption(EditorOption.fontFamily)
  const layout = editor.getLayoutInfo()
  const lineCount = editor.getModel()?.getLineCount() ?? 1
  const contentHeight = editor.getContentHeight()
  const scrollTop = editor.getScrollTop()
  const height = layout.height

  // Space below the last real line (content height minus scroll = bottom of
  // content in viewport coords). Ghosts fill from there to the container bottom.
  const contentBottom = contentHeight - scrollTop
  const remaining = height - contentBottom
  if (remaining < lineHeight * 0.5) {
    ghost.style.display = 'none'
    ghost.textContent = ''
    return
  }

  const ghostCount = Math.floor(remaining / lineHeight)
  if (ghostCount <= 0) {
    ghost.style.display = 'none'
    ghost.textContent = ''
    return
  }

  const numbers: string[] = []
  for (let i = 1; i <= ghostCount; i++) {
    numbers.push(String(lineCount + i))
  }

  ghost.style.display = 'block'
  ghost.style.top = `${contentBottom}px`
  ghost.style.left = '0'
  ghost.style.width = `${layout.lineNumbersLeft + layout.lineNumbersWidth}px`
  ghost.style.paddingLeft = `${layout.lineNumbersLeft}px`
  ghost.style.boxSizing = 'border-box'
  ghost.style.lineHeight = `${lineHeight}px`
  ghost.style.fontSize = `${fontSize}px`
  ghost.style.fontFamily = fontFamily
  ghost.style.color = GHOST_COLOR
  ghost.style.textAlign = 'right'
  ghost.textContent = numbers.join('\n')
}

export function ghostMarginDisposables(
  editor: Editor,
  update: () => void,
): { dispose: () => void }[] {
  return [
    editor.onDidContentSizeChange(() => update()),
    editor.onDidLayoutChange(() => update()),
    editor.onDidScrollChange(() => update()),
    editor.onDidChangeModelContent(() => update()),
  ]
}

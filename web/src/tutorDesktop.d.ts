export type TutorDesktopBridge = {
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  onMaximizedChanged: (cb: (max: boolean) => void) => () => void
  captureShot: (opts?: {
    name?: string
    outDir?: string
  }) => Promise<{ path: string; sha256: string }>
}

declare global {
  interface Window {
    tutorDesktop?: TutorDesktopBridge
  }
}

export {}

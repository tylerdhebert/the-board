const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tutorDesktop', {
  minimize() {
    ipcRenderer.send('win:minimize')
  },
  toggleMaximize() {
    ipcRenderer.send('win:toggle-maximize')
  },
  close() {
    ipcRenderer.send('win:close')
  },
  isMaximized() {
    return ipcRenderer.invoke('win:is-maximized')
  },
  onMaximizedChanged(cb) {
    const listener = (_event, max) => cb(max)
    ipcRenderer.on('win:maximized-changed', listener)
    return () => ipcRenderer.removeListener('win:maximized-changed', listener)
  },
  captureShot(opts) {
    return ipcRenderer.invoke('debug:capture', opts ?? {})
  },
})

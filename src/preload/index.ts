import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AgentEvent, Api } from '../shared'

const listen = (channel: string, cb: () => void) => {
  const listener = () => cb()
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: Api = {
  models: () => ipcRenderer.invoke('models'),
  threads: () => ipcRenderer.invoke('threads'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  newThread: (cwd) => ipcRenderer.invoke('new-thread', cwd),
  openThread: (thread) => ipcRenderer.invoke('open-thread', thread),
  renameThread: (thread, title) => ipcRenderer.invoke('rename-thread', thread, title),
  deleteThread: (thread) => ipcRenderer.invoke('delete-thread', thread),
  send: (prompt, model, effort) => ipcRenderer.invoke('send', prompt, model, effort),
  stop: () => ipcRenderer.invoke('stop'),
  reply: (id, answer) => ipcRenderer.send('reply', id, answer),
  settings: () => ipcRenderer.invoke('settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  piInfo: () => ipcRenderer.invoke('pi-info'),
  openSettings: () => ipcRenderer.send('open-settings'),
  diff: (cwd) => ipcRenderer.invoke('diff', cwd),
  onChanged: (cb) => listen('changed', cb),
  onEvent: (cb) => {
    const listener = (_: IpcRendererEvent, e: AgentEvent) => cb(e)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },
  term: {
    start: (id, cwd, cols, rows) => ipcRenderer.send('term-start', id, cwd, cols, rows),
    input: (id, data) => ipcRenderer.send('term-input', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('term-resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('term-kill', id),
    onData: (cb) => {
      const listener = (_: IpcRendererEvent, id: number, data: string) => cb(id, data)
      ipcRenderer.on('term:data', listener)
      return () => ipcRenderer.removeListener('term:data', listener)
    },
    onExit: (cb) => {
      const listener = (_: IpcRendererEvent, id: number) => cb(id)
      ipcRenderer.on('term:exit', listener)
      return () => ipcRenderer.removeListener('term:exit', listener)
    },
  },
}

contextBridge.exposeInMainWorld('api', api)

type Key = { code: string; shift: boolean; alt: boolean; control: boolean }
ipcRenderer.on('webview-key', (_, k: Key) =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', { code: k.code, metaKey: true, shiftKey: k.shift, altKey: k.alt, ctrlKey: k.control }),
  ),
)
ipcRenderer.on('fullscreen', (_, on: boolean) => document.documentElement.classList.toggle('fullscreen', on))

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
  send: (prompt, model) => ipcRenderer.invoke('send', prompt, model),
  stop: () => ipcRenderer.invoke('stop'),
  reply: (id, answer) => ipcRenderer.send('reply', id, answer),
  settings: () => ipcRenderer.invoke('settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  piInfo: () => ipcRenderer.invoke('pi-info'),
  piLogout: (provider) => ipcRenderer.invoke('pi-logout', provider),
  openSettings: () => ipcRenderer.send('open-settings'),
  refresh: () => ipcRenderer.send('refresh'),
  onChanged: (cb) => listen('changed', cb),
  onEvent: (cb) => {
    const listener = (_: IpcRendererEvent, e: AgentEvent) => cb(e)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },
  term: {
    start: (cwd, cols, rows) => ipcRenderer.send('term-start', cwd, cols, rows),
    input: (data) => ipcRenderer.send('term-input', data),
    resize: (cols, rows) => ipcRenderer.send('term-resize', cols, rows),
    kill: () => ipcRenderer.send('term-kill'),
    run: (command) => ipcRenderer.send('term-run', command),
    onData: (cb) => {
      const listener = (_: IpcRendererEvent, data: string) => cb(data)
      ipcRenderer.on('term:data', listener)
      return () => ipcRenderer.removeListener('term:data', listener)
    },
    onExit: (cb) => listen('term:exit', cb),
    onShow: (cb) => listen('term:show', cb),
  },
}

contextBridge.exposeInMainWorld('api', api)

ipcRenderer.on('fullscreen', (_, on: boolean) => document.documentElement.classList.toggle('fullscreen', on))

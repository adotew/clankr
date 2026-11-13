import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AgentEvent, Api } from '../shared'

const api: Api = {
  models: () => ipcRenderer.invoke('models'),
  threads: () => ipcRenderer.invoke('threads'),
  newThread: () => ipcRenderer.invoke('new-thread'),
  openThread: (thread) => ipcRenderer.invoke('open-thread', thread),
  send: (prompt, model) => ipcRenderer.invoke('send', prompt, model),
  stop: () => ipcRenderer.invoke('stop'),
  reply: (id, allow) => ipcRenderer.send('permission', id, allow),
  onEvent: (cb) => {
    const listener = (_: IpcRendererEvent, e: AgentEvent) => cb(e)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },
}

contextBridge.exposeInMainWorld('api', api)

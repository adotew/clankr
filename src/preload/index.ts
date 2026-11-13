import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AgentEvent, Api } from '../shared'

const api: Api = {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  send: (prompt) => ipcRenderer.invoke('send', prompt),
  stop: () => ipcRenderer.invoke('stop'),
  reply: (id, allow) => ipcRenderer.send('permission', id, allow),
  onEvent: (cb) => {
    const listener = (_: IpcRendererEvent, e: AgentEvent) => cb(e)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },
}

contextBridge.exposeInMainWorld('api', api)

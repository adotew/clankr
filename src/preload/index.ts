import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { AgentEvent, Api, Command } from '../shared'

// Subscribes to a message from the main process; returns the unsubscribe.
const listen = <A extends unknown[]>(channel: string, cb: (...args: A) => void) => {
  const listener = (_: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: Api = {
  models: () => ipcRenderer.invoke('models'),
  threads: () => ipcRenderer.invoke('threads'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickFiles: (cwd) => ipcRenderer.invoke('pick-files', cwd),
  pathOf: (file) => webUtils.getPathForFile(file),
  saveAttachment: (name, data) => ipcRenderer.invoke('save-attachment', name, data),
  openThread: (thread) => ipcRenderer.invoke('open-thread', thread),
  renameThread: (thread, title) => ipcRenderer.invoke('rename-thread', thread, title),
  deleteThread: (thread) => ipcRenderer.invoke('delete-thread', thread),
  send: (thread, prompt, model, effort) => ipcRenderer.invoke('send', thread, prompt, model, effort),
  stop: (thread) => ipcRenderer.invoke('stop', thread),
  release: (thread) => ipcRenderer.send('release', thread),
  reply: (id, answer) => ipcRenderer.send('reply', id, answer),
  settings: () => ipcRenderer.invoke('settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  piInfo: () => ipcRenderer.invoke('pi-info'),
  openSettings: () => ipcRenderer.send('open-settings'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  diff: (cwd) => ipcRenderer.invoke('diff', cwd),
  branch: (cwd) => ipcRenderer.invoke('branch', cwd),
  commands: (backend, cwd) => ipcRenderer.invoke('commands', backend, cwd),
  docs: (cwd) => ipcRenderer.invoke('docs', cwd),
  readDoc: (path) => ipcRenderer.invoke('read-doc', path),
  onChanged: (cb) => listen('changed', cb),
  onEvent: (cb) => listen<[string, AgentEvent]>('agent:event', cb),
  onCommand: (cb) => listen<[Command]>('command', cb),
  term: {
    start: (cwd, cols, rows) => ipcRenderer.invoke('term-start', cwd, cols, rows),
    input: (id, data) => ipcRenderer.send('term-input', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('term-resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('term-kill', id),
    onData: (cb) => listen<[number, string]>('term:data', cb),
    onProc: (cb) => listen<[number, string]>('term:proc', cb),
    onExit: (cb) => listen<[number]>('term:exit', cb),
  },
}

contextBridge.exposeInMainWorld('api', api)

ipcRenderer.on('fullscreen', (_, on: boolean) => document.documentElement.classList.toggle('fullscreen', on))

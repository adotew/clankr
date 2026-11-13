import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { query, type CanUseTool, type PermissionResult, type Query } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent } from '../shared'

let win: BrowserWindow
let cwd: string | undefined
let sessionId: string | undefined
let current: Query | undefined
const pending = new Map<string, (r: PermissionResult) => void>()

const emit = (e: AgentEvent) => win.webContents.send('agent:event', e)

const toText = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n')
      : ''

const canUseTool: CanUseTool = (name, input, { signal }) =>
  new Promise((resolve) => {
    const id = randomUUID()
    pending.set(id, resolve)
    signal.addEventListener('abort', () => {
      pending.delete(id)
      resolve({ behavior: 'deny', message: 'Aborted' })
    })
    emit({ kind: 'permission', id, name, input })
  })

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  if (!r.canceled && !current) {
    cwd = r.filePaths[0]
    sessionId = undefined
  }
  return cwd
})

ipcMain.handle('send', async (_, prompt: string) => {
  if (!cwd || current) return
  current = query({ prompt, options: { cwd, resume: sessionId, canUseTool } })
  try {
    for await (const msg of current) {
      // Subagent internals are skipped; their final report arrives as the parent tool's result.
      if ('parent_tool_use_id' in msg && msg.parent_tool_use_id) continue
      if (msg.type === 'system' && msg.subtype === 'init') sessionId = msg.session_id
      else if (msg.type === 'assistant') {
        for (const b of msg.message.content) {
          if (b.type === 'text') emit({ kind: 'text', text: b.text })
          else if (b.type === 'tool_use') emit({ kind: 'tool', id: b.id, name: b.name, input: b.input as Record<string, unknown> })
        }
      } else if (msg.type === 'user' && Array.isArray(msg.message.content)) {
        for (const b of msg.message.content) {
          if (b.type === 'tool_result')
            emit({ kind: 'result', id: b.tool_use_id, text: toText(b.content), isError: !!b.is_error })
        }
      } else if (msg.type === 'result' && msg.subtype !== 'success') emit({ kind: 'error', text: msg.subtype })
    }
  } catch (err) {
    emit({ kind: 'error', text: String(err) })
  } finally {
    current = undefined
    emit({ kind: 'done' })
  }
})

ipcMain.handle('stop', async () => {
  await current?.interrupt()
})

ipcMain.on('permission', (_, id: string, allow: boolean) => {
  pending.get(id)?.(allow ? { behavior: 'allow' } : { behavior: 'deny', message: 'User denied this action' })
  pending.delete(id)
})

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs') },
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
})

app.on('window-all-closed', () => app.quit())

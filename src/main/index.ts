import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import {
  getSessionMessages,
  listSessions,
  query,
  tagSession,
  type CanUseTool,
  type PermissionResult,
  type Query,
} from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, Model, Thread } from '../shared'

// Marks sessions created by this app so other Claude Code sessions stay out of the sidebar.
const TAG = 'clankr'

let win: BrowserWindow
let cwd: string | undefined
let sessionId: string | undefined
let current: Query | undefined
let models: Promise<Model[]> | undefined
const pending = new Map<string, (r: PermissionResult) => void>()

const emit = (e: AgentEvent) => win.webContents.send('agent:event', e)

const toText = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n')
      : ''

type Block = { type: string; [k: string]: unknown }

// Converts a Messages API message into UI events. User text is only included for history,
// because live prompts are already shown by the renderer.
function toEvents(type: string, message: unknown, withUserText: boolean): AgentEvent[] {
  const content = (message as { content?: unknown })?.content
  if (type === 'user' && typeof content === 'string') return withUserText ? [{ kind: 'user', text: content }] : []
  if (!Array.isArray(content)) return []
  return (content as Block[]).flatMap((b): AgentEvent[] => {
    if (type === 'assistant' && b.type === 'text') return [{ kind: 'text', text: b.text as string }]
    if (type === 'assistant' && b.type === 'tool_use')
      return [{ kind: 'tool', id: b.id as string, name: b.name as string, input: b.input as Record<string, unknown> }]
    if (type === 'user' && b.type === 'tool_result')
      return [{ kind: 'result', id: b.tool_use_id as string, text: toText(b.content), isError: b.is_error === true }]
    if (type === 'user' && b.type === 'text' && withUserText) return [{ kind: 'user', text: b.text as string }]
    return []
  })
}

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

// supportedModels() needs a live CLI process; open one with a prompt that never arrives, then close it.
async function loadModels(): Promise<Model[]> {
  let release = () => {}
  const idle = new Promise<void>((r) => (release = r))
  const q = query({ prompt: (async function* () { await idle })() })
  try {
    return (await q.supportedModels()).map(({ value, displayName }) => ({ value, displayName }))
  } finally {
    q.close()
    release()
  }
}

ipcMain.handle('models', () => {
  models ??= loadModels().catch((err) => {
    models = undefined
    throw err
  })
  return models
})

ipcMain.handle('threads', async (): Promise<Thread[]> =>
  (await listSessions())
    .filter((s) => s.tag === TAG && s.cwd)
    .map((s) => ({ id: s.sessionId, title: s.summary, cwd: s.cwd!, folder: basename(s.cwd!) })),
)

ipcMain.handle('new-thread', async () => {
  if (current) return
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  if (r.canceled) return
  cwd = r.filePaths[0]
  sessionId = undefined
  return cwd
})

ipcMain.handle('open-thread', async (_, thread: Thread): Promise<AgentEvent[]> => {
  if (current) return []
  cwd = thread.cwd
  sessionId = thread.id
  const messages = await getSessionMessages(thread.id, { dir: thread.cwd })
  return messages.filter((m) => !m.parent_tool_use_id).flatMap((m) => toEvents(m.type, m.message, true))
})

ipcMain.handle('send', async (_, prompt: string, model: string) => {
  if (!cwd || current) return
  const isNew = !sessionId
  current = query({
    prompt,
    options: { cwd, resume: sessionId, canUseTool, model: model === 'default' ? undefined : model },
  })
  try {
    for await (const msg of current) {
      // Subagent internals are skipped; their final report arrives as the parent tool's result.
      if ('parent_tool_use_id' in msg && msg.parent_tool_use_id) continue
      if (msg.type === 'system' && msg.subtype === 'init') sessionId = msg.session_id
      else if (msg.type === 'assistant' || msg.type === 'user') toEvents(msg.type, msg.message, false).forEach(emit)
      else if (msg.type === 'result' && msg.subtype !== 'success') emit({ kind: 'error', text: msg.subtype })
    }
    if (isNew && sessionId) await tagSession(sessionId, TAG, { dir: cwd })
  } catch (err) {
    emit({ kind: 'error', text: String(err) })
  } finally {
    current = undefined
    emit({ kind: 'done' })
  }
  return sessionId
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
    width: 1100,
    height: 800,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs') },
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
})

app.on('window-all-closed', () => app.quit())

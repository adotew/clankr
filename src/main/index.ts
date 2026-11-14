import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron'
import { spawn, type IPty } from '@lydell/node-pty'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import {
  deleteSession,
  getSessionMessages,
  listSessions,
  query,
  renameSession,
  tagSession,
  type CanUseTool,
  type EffortLevel,
  type Query,
} from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, Backend, Model, PiInfo, Settings, Thread } from '../shared'
import { modified, piEfforts, piModels, PiRpc, piVersion, readPiSession, shellEnv, toEvents as piEvents } from './pi'

// Marks sessions created by this app so other Claude Code sessions stay out of the sidebar.
const TAG = 'clankr'

// "No project" threads each get an empty folder here, so they run without any project context
// and can be deleted without touching anything else.
const scratchRoot = join(app.getPath('userData'), 'no-project')
const isScratch = (dir: string) => dir.startsWith(scratchRoot + sep)

const settingsFile = join(app.getPath('userData'), 'settings.json')
// The user's `pi`, found through their login shell's PATH.
const piBin = 'pi'
let settings: Settings = { claude: true, pi: true }
try {
  settings = { ...settings, ...JSON.parse(readFileSync(settingsFile, 'utf8')) }
} catch {
  // First launch, or an unreadable file: keep the defaults.
}

// Pi sessions this app started, so the user's other Pi sessions stay out of the sidebar.
type PiThread = { file: string; cwd: string; title: string }
const piIndex = join(app.getPath('userData'), 'pi-sessions.json')
const readPiIndex = async (): Promise<PiThread[]> => {
  try {
    return JSON.parse(await readFile(piIndex, 'utf8'))
  } catch {
    return []
  }
}
const writePiIndex = (threads: PiThread[]) => writeFile(piIndex, JSON.stringify(threads))

let win: BrowserWindow
let settingsWin: BrowserWindow | undefined

// Matches --background in styles.css, so resizing never flashes white before the page repaints.
const background = () => (nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff')
nativeTheme.on('updated', () => {
  for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(background())
})

const load = (w: BrowserWindow, hash = '') => {
  if (process.env.ELECTRON_RENDERER_URL) w.loadURL(process.env.ELECTRON_RENDERER_URL + hash)
  else w.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash })
}

// Settings or Pi logins changed: drop cached models and tell every window to reload.
const changed = () => {
  models = undefined
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('changed')
}
let cwd: string | undefined
// The active thread: a Claude session ID or a Pi session file, depending on `backend`.
let backend: Backend = 'claude'
let sessionId: string | undefined
let busy = false
let current: Query | undefined
// Stays alive between prompts of the active Pi thread.
let pi: PiRpc | undefined
// Ends the Pi run in progress, with an error if pi died.
let settle: ((err?: Error) => void) | undefined
let models: Promise<Model[]> | undefined
const pending = new Map<string, (answer: boolean | string | undefined) => void>()

const closePi = () => {
  pi?.close()
  pi = undefined
}

const emit = (e: AgentEvent) => win.webContents.send('agent:event', e)

const toText = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n')
      : ''

type Block = { type: string; [k: string]: unknown }

// Converts a Messages API message into UI events. Text is only included for history: live,
// the renderer already shows the prompt and assistant text arrives as stream deltas.
function toEvents(type: string, message: unknown, history: boolean): AgentEvent[] {
  const content = (message as { content?: unknown })?.content
  if (type === 'user' && typeof content === 'string') return history ? [{ kind: 'user', text: content }] : []
  if (!Array.isArray(content)) return []
  return (content as Block[]).flatMap((b): AgentEvent[] => {
    if (type === 'assistant' && b.type === 'text' && history) return [{ kind: 'text', text: b.text as string }]
    if (type === 'assistant' && b.type === 'tool_use')
      return [{ kind: 'tool', id: b.id as string, name: b.name as string, input: b.input as Record<string, unknown> }]
    if (type === 'user' && b.type === 'tool_result')
      return [{ kind: 'result', id: b.tool_use_id as string, text: toText(b.content), isError: b.is_error === true }]
    if (type === 'user' && b.type === 'text' && history) return [{ kind: 'user', text: b.text as string }]
    return []
  })
}

const canUseTool: CanUseTool = (name, input, { signal }) =>
  new Promise((resolve) => {
    const id = randomUUID()
    pending.set(id, (allow) =>
      resolve(allow === true ? { behavior: 'allow' } : { behavior: 'deny', message: 'User denied this action' }),
    )
    signal.addEventListener('abort', () => {
      pending.delete(id)
      resolve({ behavior: 'deny', message: 'Aborted' })
    })
    const { command, file_path, description } = input
    const detail = [command, file_path, description].find((v) => typeof v === 'string') as string | undefined
    emit({ kind: 'ask', id, title: `Allow ${name}?`, detail })
  })

// supportedModels() needs a live CLI process; open one with a prompt that never arrives, then close it.
async function claudeModels(): Promise<Model[]> {
  let release = () => {}
  const idle = new Promise<void>((r) => (release = r))
  const q = query({
    prompt: (async function* () {
      await idle
    })(),
  })
  try {
    return (await q.supportedModels()).map(({ value, displayName, supportedEffortLevels }) => ({
      value: `claude:${value}`,
      displayName,
      backend: 'claude',
      group: 'Claude',
      efforts: supportedEffortLevels,
    }))
  } finally {
    q.close()
    release()
  }
}

const pi2Models = async (): Promise<Model[]> => [
  { value: 'pi:default', displayName: 'Pi default', backend: 'pi', group: 'Pi' },
  ...(await piModels(piBin)).map((m): Model => ({
    value: `pi:${m.provider}/${m.id}`,
    displayName: m.name,
    backend: 'pi',
    group: `Pi · ${m.provider}`,
    efforts: piEfforts(m),
  })),
]

// One backend failing (e.g. pi not installed) still leaves the other's models; fail only if none load.
async function loadModels(): Promise<Model[]> {
  const loaders = [settings.claude && claudeModels(), settings.pi && pi2Models()].filter((l) => l !== false)
  const results = await Promise.allSettled(loaders)
  const loaded = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  const failed = results.find((r) => r.status === 'rejected')
  if (failed && !loaded.length) throw failed.reason
  return loaded
}

ipcMain.handle('models', () => {
  models ??= loadModels().catch((err) => {
    models = undefined
    throw err
  })
  return models
})

const folderOf = (dir: string) => (isScratch(dir) ? undefined : basename(dir))

const claudeThreads = async (): Promise<Thread[]> =>
  (await listSessions())
    .filter((s) => s.tag === TAG && s.cwd)
    .map((s) => ({
      id: s.sessionId,
      title: s.summary,
      cwd: s.cwd!,
      folder: folderOf(s.cwd!),
      backend: 'claude',
      updated: s.lastModified,
    }))

// Threads whose session file was deleted (e.g. from pi's /resume) drop out.
const piThreads = async (): Promise<Thread[]> =>
  (
    await Promise.all(
      (await readPiIndex()).map(async (t): Promise<Thread[]> => {
        const updated = await modified(t.file)
        return updated
          ? [{ id: t.file, title: t.title, cwd: t.cwd, folder: folderOf(t.cwd), backend: 'pi', updated }]
          : []
      }),
    )
  ).flat()

ipcMain.handle('threads', async (): Promise<Thread[]> => {
  const lists = await Promise.all([settings.claude ? claudeThreads() : [], settings.pi ? piThreads() : []])
  return lists.flat().sort((a, b) => b.updated - a.updated)
})

ipcMain.handle('settings', () => settings)

ipcMain.handle('save-settings', async (_, next: Settings) => {
  settings = next
  if (!busy) closePi()
  await writeFile(settingsFile, JSON.stringify(settings, null, 2))
  changed()
})

const openSettings = () => {
  if (settingsWin) return settingsWin.focus()
  settingsWin = new BrowserWindow({
    width: 520,
    height: 640,
    minWidth: 420,
    minHeight: 400,
    parent: win,
    title: 'Settings',
    titleBarStyle: 'hiddenInset',
    backgroundColor: background(),
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs') },
  })
  settingsWin.on('closed', () => (settingsWin = undefined))
  load(settingsWin, '#settings')
}
ipcMain.on('open-settings', openSettings)

ipcMain.handle('pi-info', async (): Promise<PiInfo> => {
  const version = await piVersion(piBin)
  return { ok: version.ok, version: version.out }
})

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  return r.canceled ? undefined : r.filePaths[0]
})

// Without a project folder (or from a "No project" thread), the next send creates a fresh scratch folder.
ipcMain.handle('new-thread', (_, dir: string | undefined) => {
  if (busy) return
  cwd = dir && !isScratch(dir) ? dir : undefined
  sessionId = undefined
  closePi()
})

ipcMain.handle('open-thread', async (_, thread: Thread): Promise<AgentEvent[]> => {
  if (busy) return []
  closePi()
  cwd = thread.cwd
  sessionId = thread.id
  backend = thread.backend
  if (thread.backend === 'pi') return readPiSession(thread.id)
  const messages = await getSessionMessages(thread.id, { dir: thread.cwd })
  return messages.filter((m) => !m.parent_tool_use_id).flatMap((m) => toEvents(m.type, m.message, true))
})

ipcMain.handle('rename-thread', async (_, thread: Thread, title: string) => {
  title = title.trim()
  if (!title) return
  if (thread.backend === 'pi')
    await writePiIndex((await readPiIndex()).map((t) => (t.file === thread.id ? { ...t, title } : t)))
  else await renameSession(thread.id, title, { dir: thread.cwd })
})

ipcMain.handle('delete-thread', async (_, thread: Thread): Promise<boolean> => {
  if (busy) return false
  const { response } = await dialog.showMessageBox(BrowserWindow.getFocusedWindow() ?? win, {
    type: 'warning',
    message: `Delete “${thread.title}”?`,
    detail: thread.folder
      ? 'The conversation is deleted. Files in the project folder are kept.'
      : 'The conversation and the files it created are deleted.',
    buttons: ['Delete', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  })
  if (response !== 0) return false

  // Paths come from the renderer, so only delete what this app created: indexed Pi sessions and scratch folders.
  let dir = thread.cwd
  if (thread.backend === 'pi') {
    const index = await readPiIndex()
    const entry = index.find((t) => t.file === thread.id)
    if (!entry) return false
    dir = entry.cwd
    await rm(entry.file, { force: true })
    // Pi keeps one folder per cwd; a scratch thread's is empty now.
    await rmdir(dirname(entry.file)).catch(() => {})
    await writePiIndex(index.filter((t) => t !== entry))
  } else await deleteSession(thread.id, { dir })
  if (dirname(resolve(dir)) === scratchRoot) await rm(dir, { recursive: true, force: true })

  if (thread.id === sessionId) {
    sessionId = undefined
    cwd = undefined
    closePi()
  }
  return true
})

ipcMain.handle('send', async (_, prompt: string, model: string, effort: string | undefined) => {
  if (busy) return
  const [next, id] = model.split(/:(.*)/) as [Backend, string]
  // A thread keeps the backend it started with; their sessions aren't interchangeable.
  if (sessionId && next !== backend) {
    emit({
      kind: 'error',
      text: `This thread runs on ${backend === 'pi' ? 'Pi' : 'Claude'}; start a new thread to switch.`,
    })
    emit({ kind: 'done' })
    return
  }
  backend = next
  busy = true
  if (!cwd) {
    cwd = join(scratchRoot, randomUUID())
    await mkdir(cwd, { recursive: true })
  }
  try {
    await (backend === 'pi' ? sendPi(prompt, id, effort, cwd) : sendClaude(prompt, id, effort, cwd))
  } catch (err) {
    emit({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
  } finally {
    busy = false
    emit({ kind: 'done' })
  }
  return { sessionId, cwd, backend }
})

async function sendPi(prompt: string, model: string, effort: string | undefined, cwd: string) {
  const isNew = !sessionId
  if (!pi) {
    const rpc = new PiRpc(piBin, sessionId ? ['--session', sessionId] : [], cwd, await shellEnv)
    rpc.onRecord = (r) =>
      piEvents(r).forEach((e) => {
        if (e.kind === 'ask')
          pending.set(e.id, (answer) =>
            rpc.send({
              type: 'extension_ui_response',
              id: e.id,
              ...(answer === undefined
                ? { cancelled: true }
                : typeof answer === 'boolean'
                  ? { confirmed: answer }
                  : { value: answer }),
            }),
          )
        emit(e)
      })
    rpc.onSettled = () => settle?.()
    rpc.onExit = (reason) => {
      if (pi === rpc) pi = undefined
      settle?.(new Error(reason))
    }
    pi = rpc
  }
  const rpc = pi
  if (model !== 'default') {
    const [provider, modelId] = model.split(/\/(.*)/)
    await rpc.call({ type: 'set_model', provider, modelId })
  }
  // Without an effort, set_model has already applied pi's own default level for the model.
  if (effort) await rpc.call({ type: 'set_thinking_level', level: effort })
  // Listen before prompting: a fast run can settle before the prompt's response arrives.
  const settled = new Promise<void>((resolve, reject) => {
    settle = (err) => (err ? reject(err) : resolve())
  })
  settled.catch(() => {})
  try {
    const { disposition } = await rpc.call<{ disposition: string }>({ type: 'prompt', message: prompt })
    if (disposition !== 'handled') await settled
  } finally {
    settle = undefined
  }
  const state = await rpc.call<{ sessionFile?: string }>({ type: 'get_state' })
  sessionId = state.sessionFile
  if (isNew && sessionId)
    await writePiIndex([...(await readPiIndex()), { file: sessionId, cwd, title: prompt.slice(0, 120) }])
}

async function sendClaude(prompt: string, model: string, effort: string | undefined, cwd: string) {
  const isNew = !sessionId
  current = query({
    prompt,
    options: {
      cwd,
      resume: sessionId,
      canUseTool,
      model: model === 'default' ? undefined : model,
      effort: effort as EffortLevel | undefined,
      includePartialMessages: true,
      // Skip ~/.claude settings: global hooks there can answer permission requests before our
      // approval UI sees them. Project settings and CLAUDE.md still load.
      settingSources: ['project', 'local'],
    },
  })
  try {
    for await (const msg of current) {
      // Subagent internals are skipped; their final report arrives as the parent tool's result.
      if ('parent_tool_use_id' in msg && msg.parent_tool_use_id) continue
      if (msg.type === 'system' && msg.subtype === 'init') sessionId = msg.session_id
      else if (msg.type === 'stream_event') {
        const e = msg.event
        if (e.type === 'content_block_start' && e.content_block.type === 'text') emit({ kind: 'text', text: '' })
        else if (e.type === 'content_block_delta' && e.delta.type === 'text_delta')
          emit({ kind: 'delta', text: e.delta.text })
      } else if (msg.type === 'assistant' || msg.type === 'user') toEvents(msg.type, msg.message, false).forEach(emit)
      else if (msg.type === 'result' && msg.subtype !== 'success') emit({ kind: 'error', text: msg.subtype })
    }
    if (isNew && sessionId) await tagSession(sessionId, TAG, { dir: cwd })
  } finally {
    current = undefined
  }
}

ipcMain.handle('stop', async () => {
  await (backend === 'pi' ? pi?.call({ type: 'abort' }) : current?.interrupt())
})

ipcMain.on('reply', (_, id: string, answer: boolean | string | undefined) => {
  pending.get(id)?.(answer)
  pending.delete(id)
})

// One shell at a time; opening a terminal in a new folder replaces the old one.
let shell: IPty | undefined

ipcMain.on('term-start', (_, cwd: string | undefined, cols: number, rows: number) => {
  shell?.kill()
  const pty = spawn(process.env.SHELL ?? '/bin/zsh', ['-l'], {
    name: 'xterm-256color',
    cwd: cwd ?? homedir(),
    cols,
    rows,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  })
  shell = pty
  pty.onData((data) => win.webContents.send('term:data', data))
  pty.onExit(() => {
    if (shell !== pty) return
    shell = undefined
    win.webContents.send('term:exit')
  })
})
ipcMain.on('term-input', (_, data: string) => shell?.write(data))
ipcMain.on('term-resize', (_, cols: number, rows: number) => shell?.resize(cols, rows))
ipcMain.on('term-kill', () => {
  shell?.kill()
  shell = undefined
})

// Resolves stdout even on a non-zero exit, since `git diff --no-index` exits 1 when files differ.
const git = (cwd: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      err && !stdout && err.code !== 1 ? reject(err) : resolve(stdout),
    ),
  )
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

// Uncommitted changes as one patch, including untracked files; undefined outside a git repo.
ipcMain.handle('diff', async (_, dir: string): Promise<string | undefined> => {
  // From the repo root, so untracked paths match tracked ones and cover the whole repo.
  let cwd: string
  try {
    cwd = (await git(dir, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    return undefined
  }
  const base = await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']).then((s) => s.trim() || EMPTY_TREE)
  const tracked = await git(cwd, ['diff', '--no-color', base])
  // shortcut: caps untracked files at 200, raise if large untracked trees matter.
  const untracked = (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
  const added = await Promise.all(
    untracked.slice(0, 200).map((f) => git(cwd, ['diff', '--no-color', '--no-index', '--', '/dev/null', f])),
  )
  return tracked + added.join('')
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettings },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  )
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    titleBarStyle: 'hiddenInset',
    backgroundColor: background(),
    trafficLightPosition: { x: 20, y: 20 },
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs') },
  })
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true))
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false))
  load(win)
})

app.on('window-all-closed', () => {
  shell?.kill()
  closePi()
  app.quit()
})

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron'
import { spawn, type IPty } from '@lydell/node-pty'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
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
  type Options,
  type Query,
} from '@anthropic-ai/claude-agent-sdk'
import { allowed, toUrl, type AgentEvent, type Answer, Backend, Command, Context, Model, PiInfo, Settings, type SlashCommand, type Thread, type ThreadRef, type Turn } from '../shared'
import openScript from './clankr-open.sh?raw'
import { modified, piCommands, piEfforts, piModels, PiRpc, piVersion, readPiSession, shellEnv, toEvents as piEvents } from './pi'

// Marks sessions created by this app so other Claude Code sessions stay out of the dock.
const TAG = 'clankr'

// "Chat" threads each get an empty folder here, so they run without any project context
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

// Pi sessions this app started, so the user's other Pi sessions stay out of the dock.
type PiThread = { file: string; cwd: string; title: string }
const piIndex = join(app.getPath('userData'), 'pi-sessions.json')
const readPiIndex = async (): Promise<PiThread[]> => {
  try {
    return JSON.parse(await readFile(piIndex, 'utf8'))
  } catch {
    return []
  }
}
// Edits run one at a time, so parallel threads can't overwrite each other's change.
let piIndexQueue: Promise<unknown> = Promise.resolve()
const updatePiIndex = (edit: (threads: PiThread[]) => PiThread[]) => {
  const next = piIndexQueue.then(async () => writeFile(piIndex, JSON.stringify(edit(await readPiIndex()))))
  piIndexQueue = next.catch(() => {})
  return next
}

// User settings load for ~/.claude's skills and commands, but only managed hooks run: global hooks there
// can answer permission requests before our approval UI sees them.
const claudeOptions: Options = {
  settingSources: ['user', 'project', 'local'],
  managedSettings: { allowManagedHooksOnly: true },
}

let win: BrowserWindow
let settingsWin: BrowserWindow | undefined

// Matches --background in styles.css, so resizing never flashes white before the page repaints.
const background = () => (nativeTheme.shouldUseDarkColors ? '#141414' : '#ffffff')
nativeTheme.on('updated', () => {
  for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(background())
})

// `clankr-open <url>` lets any agent show a page in its own thread's browser panel: the app puts the script on the
// agent's PATH and the thread's key in its environment, and the script sends both over this socket.
const browserSock = join(tmpdir(), `clankr-${process.pid}.sock`)
const binDir = join(app.getPath('userData'), 'bin')
const browserPrompt =
  'To show the user a web page, e.g. a local dev server or docs, run `clankr-open <url>`. It opens in the browser panel next to this chat.'
// Only project threads have the panel.
const browserEnv = (run: Run, env: NodeJS.ProcessEnv) =>
  isScratch(run.cwd)
    ? env
    : { ...env, PATH: `${binDir}:${env.PATH ?? ''}`, CLANKR_SOCK: browserSock, CLANKR_THREAD: run.key }

const browserServer = createServer((socket) => {
  let buf = ''
  socket.on('error', () => {})
  socket.setEncoding('utf8').on('data', (chunk: string) => {
    buf += chunk
    const end = buf.indexOf('\n')
    if (end < 0) {
      if (buf.length > 8192) socket.destroy()
      return
    }
    const line = buf.slice(0, end)
    const tab = line.indexOf('\t')
    const run = tab > 0 ? runs.get(line.slice(0, tab)) : undefined
    const url = toUrl(line.slice(tab + 1).trim())
    if (!run || isScratch(run.cwd)) socket.end('error: not running in a clankr project thread\n')
    else if (!allowed(url)) socket.end('error: only http and https URLs can be opened\n')
    else {
      win.webContents.send('browser-open', run.key, url)
      socket.end(`opened ${url}\n`)
    }
  })
})

const isWeb = (url: string) => /^https?:\/\//i.test(url)

app.on('web-contents-created', (_, contents) => {
  // The browser panel's <webview>: no preload or Node, web URLs only.
  contents.on('will-attach-webview', (e, prefs, params) => {
    delete prefs.preload
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    if (!/^(https?:|about:blank$)/.test(params.src)) e.preventDefault()
  })
  // Popups in the browser panel load in place; links that would open a window from the app itself open in the
  // default browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (contents.getType() === 'webview') {
      if (isWeb(url)) contents.loadURL(url)
    } else if (isWeb(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
})

const load = (w: BrowserWindow, hash = '') => {
  if (process.env.ELECTRON_RENDERER_URL) w.loadURL(process.env.ELECTRON_RENDERER_URL + hash)
  else w.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash })
}

// A thread the page has sent to, keyed by the page's thread key, so threads run in parallel. `sessionId` is a
// Claude session ID or a Pi session file, depending on `backend`; unset until a new thread's first turn starts.
type Run = {
  key: string
  cwd: string
  backend: Backend
  sessionId?: string
  busy: boolean
  current?: Query
  // Stays alive between prompts, until the page releases the thread.
  pi?: PiRpc
  // Ends the Pi run in progress, with an error if pi died.
  settle?: (err?: Error) => void
  // As of the last finished turn.
  context?: Context
}
const runs = new Map<string, Run>()
let models: Promise<Model[]> | undefined
const pending = new Map<string, (answer: Answer) => void>()

const closePi = (run: Run) => {
  run.pi?.close()
  run.pi = undefined
}

// Text deltas are merged and sent about once a frame: sent per token, the page re-rendered per token. Any other event
// sends the pending text first, so the order holds.
const emitTo = (thread: string) => {
  let text = ''
  const flush = () => {
    if (text && !win.isDestroyed()) win.webContents.send('agent:event', thread, { kind: 'delta', text })
    text = ''
  }
  return (event: AgentEvent) => {
    if (event.kind === 'delta') {
      if (!text) setTimeout(flush, 16)
      text += event.text
      return
    }
    flush()
    if (!win.isDestroyed()) win.webContents.send('agent:event', thread, event)
  }
}

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

const canUseTool =
  (emit: (e: AgentEvent) => void): CanUseTool =>
  (name, input, { signal }) =>
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

// Some queries need a live CLI process; open one with a prompt that never arrives, then close it.
async function idleClaude<T>(cwd: string, use: (q: Query) => Promise<T>): Promise<T> {
  let release = () => {}
  const idle = new Promise<void>((r) => (release = r))
  const q = query({
    prompt: (async function* () {
      await idle
    })(),
    options: { ...claudeOptions, cwd },
  })
  try {
    return await use(q)
  } finally {
    q.close()
    release()
  }
}

const claudeModels = () =>
  idleClaude(tmpdir(), async (q) =>
    (await q.supportedModels()).map(
      ({ value, displayName, supportedEffortLevels }): Model => ({
        value: `claude:${value}`,
        displayName,
        backend: 'claude',
        group: 'Claude',
        efforts: supportedEffortLevels,
      }),
    ),
  )

// shortcut: cached until settings change, so skills added meanwhile only show up after that or a restart.
const commandCache = new Map<string, Promise<SlashCommand[]>>()
function slashCommands(backend: Backend, cwd: string) {
  const key = `${backend}:${cwd}`
  let commands = commandCache.get(key)
  if (!commands) {
    commands = (
      backend === 'pi'
        ? piCommands(piBin, cwd)
        : idleClaude(cwd, async (q) => (await q.supportedCommands()).map(({ name, description }) => ({ name, description })))
    ).catch((err) => {
      commandCache.delete(key)
      throw err
    })
    commandCache.set(key, commands)
  }
  return commands
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
  // One lookup per project folder.
  const branches = new Map<string, Promise<string | undefined>>()
  const branchOf = (dir: string) => {
    if (!branches.has(dir)) branches.set(dir, currentBranch(dir))
    return branches.get(dir)!
  }
  const threads = lists.flat().sort((a, b) => b.updated - a.updated)
  return Promise.all(threads.map(async (t) => (t.folder ? { ...t, branch: await branchOf(t.cwd) } : t)))
})

ipcMain.handle('branch', (_, cwd: string) => currentBranch(cwd))
ipcMain.handle('commands', (_, backend: Backend, cwd: string | undefined) => slashCommands(backend, cwd ?? tmpdir()))

// shortcut: lists only git's files (tracked and untracked, minus ignored); scan the folder if non-git projects need
// docs too.
ipcMain.handle('docs', (_, cwd: string) =>
  git(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.md']).then(
    (out) => [...new Set(out.split('\0'))].filter((f) => f && existsSync(join(cwd, f))),
    () => [],
  ),
)
ipcMain.handle('read-doc', (_, path: string) =>
  /\.md$/i.test(path) ? readFile(path, 'utf8').catch(() => undefined) : undefined,
)

ipcMain.handle('settings', () => settings)

ipcMain.handle('save-settings', async (_, next: Settings) => {
  settings = next
  for (const run of runs.values()) if (!run.busy) closePi(run)
  await writeFile(settingsFile, JSON.stringify(settings, null, 2))
  changed()
})

// Settings or Pi logins changed: drop cached models and commands and tell every window to reload them.
function changed() {
  models = undefined
  commandCache.clear()
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('changed')
}

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
ipcMain.on('open-external', (_, url: string) => {
  if (isWeb(url)) shell.openExternal(url)
})

ipcMain.handle('pi-info', async (): Promise<PiInfo> => {
  const version = await piVersion(piBin)
  return { ok: version.ok, version: version.out }
})

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { defaultPath: homedir(), properties: ['openDirectory'] })
  return r.canceled ? undefined : r.filePaths[0]
})

ipcMain.handle('pick-files', async (_, cwd: string | undefined) => {
  const r = await dialog.showOpenDialog(win, { defaultPath: cwd ?? homedir(), properties: ['openFile', 'multiSelections'] })
  return r.canceled ? [] : r.filePaths
})

ipcMain.handle('save-attachment', async (_, name: string, data: ArrayBuffer) => {
  const dir = join(tmpdir(), 'clankr-attachments', randomUUID())
  await mkdir(dir, { recursive: true })
  // basename keeps a crafted name from writing outside `dir`.
  const path = join(dir, basename(name) || 'file')
  await writeFile(path, Buffer.from(data))
  return path
})

ipcMain.handle('open-thread', async (_, thread: Thread): Promise<AgentEvent[]> => {
  if (thread.backend === 'pi') return readPiSession(thread.id)
  const messages = await getSessionMessages(thread.id, { dir: thread.cwd })
  return messages.filter((m) => !m.parent_tool_use_id).flatMap((m) => toEvents(m.type, m.message, true))
})

ipcMain.handle('rename-thread', async (_, thread: Thread, title: string) => {
  title = title.trim()
  if (!title) return
  if (thread.backend === 'pi') await updatePiIndex((index) => index.map((t) => (t.file === thread.id ? { ...t, title } : t)))
  else await renameSession(thread.id, title, { dir: thread.cwd })
})

ipcMain.handle('delete-thread', async (_, thread: Thread): Promise<boolean> => {
  const threadRuns = [...runs].filter(([, run]) => run.sessionId === thread.id)
  if (threadRuns.some(([, run]) => run.busy)) return false
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
    const entry = (await readPiIndex()).find((t) => t.file === thread.id)
    if (!entry) return false
    dir = entry.cwd
    await rm(entry.file, { force: true })
    // Pi keeps one folder per cwd; a scratch thread's is empty now.
    await rmdir(dirname(entry.file)).catch(() => {})
    await updatePiIndex((index) => index.filter((t) => t.file !== entry.file))
  } else await deleteSession(thread.id, { dir })
  if (dirname(resolve(dir)) === scratchRoot) await rm(dir, { recursive: true, force: true })

  for (const [key, run] of threadRuns) {
    closePi(run)
    runs.delete(key)
  }
  return true
})

ipcMain.handle(
  'send',
  async (_, thread: ThreadRef, prompt: string, model: string, effort: string | undefined): Promise<Turn | undefined> => {
    const emit = emitTo(thread.key)
    const [backend, id] = model.split(/:(.*)/) as [Backend, string]
    let run = runs.get(thread.key)
    if (run?.busy) return
    // A thread keeps the backend it started with; their sessions aren't interchangeable.
    const started = run?.sessionId ? run.backend : thread.id ? thread.backend : undefined
    if (started && started !== backend) {
      emit({
        kind: 'error',
        text: `This thread runs on ${started === 'pi' ? 'Pi' : 'Claude'}; start a new thread to switch.`,
      })
      emit({ kind: 'done' })
      return
    }
    if (!run) {
      // A new thread without a project folder gets a fresh scratch folder; a "Chat" thread's is never reused.
      let cwd = thread.cwd && (thread.id || !isScratch(thread.cwd)) ? thread.cwd : undefined
      if (!cwd) {
        cwd = join(scratchRoot, randomUUID())
        await mkdir(cwd, { recursive: true })
      }
      run = { key: thread.key, cwd, backend, sessionId: thread.id, busy: false }
      runs.set(thread.key, run)
    }
    run.backend = backend
    run.busy = true
    try {
      await (backend === 'pi' ? sendPi : sendClaude)(run, emit, prompt, id, effort)
    } catch (err) {
      emit({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      run.busy = false
      emit({ kind: 'done' })
    }
    return { sessionId: run.sessionId, cwd: run.cwd, backend, context: run.context }
  },
)

async function sendPi(run: Run, emit: (e: AgentEvent) => void, prompt: string, model: string, effort?: string) {
  const isNew = !run.sessionId
  if (!run.pi) {
    const rpc = new PiRpc(
      piBin,
      [...(isScratch(run.cwd) ? [] : ['--append-system-prompt', browserPrompt]), ...(run.sessionId ? ['--session', run.sessionId] : [])],
      run.cwd,
      browserEnv(run, await shellEnv),
    )
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
    rpc.onSettled = () => run.settle?.()
    rpc.onExit = (reason) => {
      if (run.pi === rpc) run.pi = undefined
      run.settle?.(new Error(reason))
    }
    run.pi = rpc
  }
  const rpc = run.pi
  if (model !== 'default') {
    const [provider, modelId] = model.split(/\/(.*)/)
    await rpc.call({ type: 'set_model', provider, modelId })
  }
  // Without an effort, set_model has already applied pi's own default level for the model.
  if (effort) await rpc.call({ type: 'set_thinking_level', level: effort })
  // Listen before prompting: a fast run can settle before the prompt's response arrives.
  const settled = new Promise<void>((resolve, reject) => {
    run.settle = (err) => (err ? reject(err) : resolve())
  })
  settled.catch(() => {})
  try {
    const { disposition } = await rpc.call<{ disposition: string }>({ type: 'prompt', message: prompt })
    if (disposition !== 'handled') await settled
  } finally {
    run.settle = undefined
  }
  const state = await rpc.call<{ sessionFile?: string }>({ type: 'get_state' })
  const file = (run.sessionId = state.sessionFile)
  const { contextUsage: usage } = await rpc.call<{ contextUsage?: { tokens: number | null; contextWindow: number } }>({
    type: 'get_session_stats',
  })
  run.context = usage && { tokens: usage.tokens, window: usage.contextWindow }
  if (isNew && file) await updatePiIndex((index) => [...index, { file, cwd: run.cwd, title: prompt.slice(0, 120) }])
}

async function sendClaude(run: Run, emit: (e: AgentEvent) => void, prompt: string, model: string, effort?: string) {
  const isNew = !run.sessionId
  const current = (run.current = query({
    prompt,
    options: {
      cwd: run.cwd,
      resume: run.sessionId,
      canUseTool: canUseTool(emit),
      model: model === 'default' ? undefined : model,
      effort: effort as EffortLevel | undefined,
      includePartialMessages: true,
      ...claudeOptions,
      ...(!isScratch(run.cwd) && {
        env: browserEnv(run, process.env),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: browserPrompt },
      }),
    },
  }))
  try {
    for await (const msg of current) {
      // Subagent internals are skipped; their final report arrives as the parent tool's result.
      if ('parent_tool_use_id' in msg && msg.parent_tool_use_id) continue
      if (msg.type === 'system' && msg.subtype === 'init') run.sessionId = msg.session_id
      else if (msg.type === 'stream_event') {
        const e = msg.event
        if (e.type === 'content_block_start' && e.content_block.type === 'text') emit({ kind: 'text', text: '' })
        else if (e.type === 'content_block_delta' && e.delta.type === 'text_delta')
          emit({ kind: 'delta', text: e.delta.text })
      } else if (msg.type === 'assistant')
        // Local commands like /usage reply with a whole synthetic message instead of stream deltas.
        toEvents(msg.type, msg.message, msg.message.model === '<synthetic>').forEach(emit)
      else if (msg.type === 'user') toEvents(msg.type, msg.message, false).forEach(emit)
      else if (msg.type === 'result') {
        if (msg.subtype !== 'success') emit({ kind: 'error', text: msg.subtype })
        run.context = await current.getContextUsage({ detail: 'summary' }).then(
          (u) => ({ tokens: u.totalTokens, window: u.maxTokens }),
          () => run.context,
        )
      }
    }
    if (isNew && run.sessionId) await tagSession(run.sessionId, TAG, { dir: run.cwd })
  } finally {
    run.current = undefined
  }
}

ipcMain.handle('stop', async (_, thread: string) => {
  const run = runs.get(thread)
  await (run?.backend === 'pi' ? run.pi?.call({ type: 'abort' }) : run?.current?.interrupt())
})

ipcMain.on('release', (_, thread: string) => {
  const run = runs.get(thread)
  if (!run || run.busy) return
  closePi(run)
  runs.delete(thread)
})

ipcMain.on('reply', (_, id: string, answer: Answer) => {
  pending.get(id)?.(answer)
  pending.delete(id)
})

// One shell per terminal pane, keyed by an id the page gets back from term-start.
const shells = new Map<number, IPty>()
// The program last reported for each shell, so the poll only sends changes.
const procNames = new Map<number, string>()
let nextShell = 0
let procPoll: ReturnType<typeof setInterval> | undefined

// The program in each shell's foreground, e.g. "nvim" or "btop"; a shell at a prompt is its own foreground process.
function pollProcs() {
  if (shells.size === 0) {
    clearInterval(procPoll)
    procPoll = undefined
    return
  }
  for (const [id, pty] of shells) {
    // node-pty reports no process while the shell is exiting or the lookup fails.
    const proc = pty.process
    if (!proc) continue
    const name = basename(proc).replace(/^-/, '')
    if (!name || procNames.get(id) === name || win.isDestroyed()) continue
    procNames.set(id, name)
    win.webContents.send('term:proc', id, name)
  }
}

ipcMain.handle('term-start', (_, cwd: string | undefined, cols: number, rows: number) => {
  const id = nextShell++
  const shellPath = process.env.SHELL ?? '/bin/zsh'
  const name = basename(shellPath)
  const pty = spawn(shellPath, ['-l'], {
    name: 'xterm-256color',
    cwd: cwd ?? homedir(),
    cols,
    rows,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  })
  shells.set(id, pty)
  procNames.set(id, name)
  procPoll ??= setInterval(pollProcs, 1000)
  pty.onData((data) => win.webContents.send('term:data', id, data))
  pty.onExit(() => {
    if (shells.get(id) !== pty) return
    shells.delete(id)
    procNames.delete(id)
    if (!win.isDestroyed()) win.webContents.send('term:exit', id)
  })
  return { id, name }
})
ipcMain.on('term-input', (_, id: number, data: string) => shells.get(id)?.write(data))
ipcMain.on('term-resize', (_, id: number, cols: number, rows: number) => shells.get(id)?.resize(cols, rows))
ipcMain.on('term-kill', (_, id: number) => {
  const pty = shells.get(id)
  shells.delete(id)
  procNames.delete(id)
  pty?.kill()
})

// Resolves stdout even on a non-zero exit, since `git diff --no-index` exits 1 when files differ.
const git = (cwd: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      err && !stdout && err.code !== 1 ? reject(err) : resolve(stdout),
    ),
  )
// Undefined outside a repo or on a detached HEAD.
const currentBranch = (cwd: string) =>
  git(cwd, ['branch', '--show-current']).then(
    (s) => s.trim() || undefined,
    () => undefined,
  )
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

// Uncommitted changes as one patch, including untracked files; undefined outside a git repo.
ipcMain.handle('diff', async (_, dir: string): Promise<string | undefined> => {
  // From the repo root, so untracked paths match tracked ones and cover the whole repo.
  let root: string
  try {
    root = (await git(dir, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    return undefined
  }
  if (!root) return undefined
  const base = (await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])).trim() || EMPTY_TREE
  const tracked = await git(root, ['diff', '--no-color', base])
  // shortcut: caps untracked files at 200, raise if large untracked trees matter.
  const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
  const added = await Promise.all(
    untracked.slice(0, 200).map((f) => git(root, ['diff', '--no-color', '--no-index', '--', '/dev/null', f])),
  )
  return tracked + added.join('')
})

// Menu items for the page's shortcuts. While the page has focus it handles them itself and the menu doesn't fire;
// while the browser panel's page has focus, the menu sends them on.
const command = (action: Command, label: string, accelerator: string): MenuItemConstructorOptions => ({
  label,
  accelerator,
  click: () => win.webContents.send('command', action),
})

app.whenReady().then(async () => {
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
      {
        label: 'File',
        submenu: [
          command('newThread', 'New Thread', 'CmdOrCtrl+N'),
          command('threads', 'Switch Thread…', 'CmdOrCtrl+P'),
          command('commands', 'Commands…', 'CmdOrCtrl+Shift+P'),
          { type: 'separator' },
          command('effort', 'Next Effort Level', 'CmdOrCtrl+Shift+E'),
          { type: 'separator' },
          { role: 'close' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          command('terminal', 'Toggle Terminal', 'CmdOrCtrl+J'),
          command('diff', 'Toggle Diff', 'CmdOrCtrl+G'),
          command('browser', 'Toggle Browser', 'CmdOrCtrl+B'),
          command('docs', 'Toggle Docs', 'CmdOrCtrl+Shift+M'),
          { type: 'separator' },
          { role: 'toggleDevTools' },
          { role: 'togglefullscreen' },
        ],
      },
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
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), webviewTag: true },
  })
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true))
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false))
  load(win)
  await mkdir(binDir, { recursive: true })
  await writeFile(join(binDir, 'clankr-open'), openScript)
  await chmod(join(binDir, 'clankr-open'), 0o755)
  await rm(browserSock, { force: true })
  browserServer.listen(browserSock)
})

app.on('window-all-closed', () => {
  for (const pty of shells.values()) pty.kill()
  for (const run of runs.values()) closePi(run)
  browserServer.close()
  app.quit()
})

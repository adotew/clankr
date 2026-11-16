export type Backend = 'claude' | 'pi'

// Text that doesn't look like an address, e.g. with spaces or without a dot or port, is a DuckDuckGo search.
export const toUrl = (s: string) =>
  /^([a-z]+:\/\/|about:)/i.test(s)
    ? s
    : /\s/.test(s) || !/[.:]|^localhost$/.test(s)
      ? `https://duckduckgo.com/?q=${encodeURIComponent(s)}`
      : (/^(localhost|127\.|\[::1\])/.test(s) ? 'http://' : 'https://') + s
// Web pages only: no files or app schemes.
export const allowed = (url: string) => /^(https?:|about:blank$)/i.test(url)

export type AgentEvent =
  | { kind: 'user' | 'text' | 'delta' | 'error'; text: string }
  | { kind: 'tool'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'result'; id: string; text: string; isError: boolean }
  // A question for the user: yes/no by default, a choice when `options` is set, free text when `input` is.
  | { kind: 'ask'; id: string; title: string; detail?: string; options?: string[]; input?: boolean }
  | { kind: 'done' }

// `folder` is undefined for "Chat" threads; `branch` is the folder's current git branch, if it has one.
// For Pi threads, `id` is the session file path.
export type Thread = {
  id: string
  title: string
  cwd: string
  folder?: string
  branch?: string
  backend: Backend
  updated: number
}
// `value` is prefixed with its backend, e.g. "claude:default" or "pi:anthropic/claude-opus-5-5".
// `efforts` lists the effort/thinking levels the model accepts, weakest first; absent when it has none.
export type Model = { value: string; displayName: string; backend: Backend; group: string; efforts?: string[] }
export type Settings = { claude: boolean; pi: boolean }
export type PiInfo = { ok: boolean; version: string }
// A skill or command the agent runs when a prompt starts with `/name`.
export type SlashCommand = { name: string; description?: string }
export type Answer = boolean | string | undefined
// How full the agent's context window is; `tokens` is null right after a compaction, until the next reply.
export type Context = { tokens: number | null; window: number }
export type Turn = { sessionId?: string; cwd: string; backend: Backend; context?: Context }
// The thread a turn runs in. `key` is the page's id for it, which a new thread has before its session ID. `id`,
// `cwd` and `backend` are unset for a new thread; `cwd` is unset for a new "Chat" thread.
export type ThreadRef = { key: string; id?: string; cwd?: string; backend?: Backend }

// Menu items whose shortcut the page handles itself while it has focus; the menu only fires them otherwise,
// e.g. while the browser panel's page has focus.
export type Command = 'newThread' | 'threads' | 'commands' | 'terminal' | 'diff' | 'browser' | 'docs' | 'effort'

export type Api = {
  models: () => Promise<Model[]>
  threads: () => Promise<Thread[]>
  pickFolder: () => Promise<string | undefined>
  // Starts in `cwd`, or the home folder; empty if cancelled.
  pickFiles: (cwd: string | undefined) => Promise<string[]>
  // A dropped file's path on disk; empty for a file that has none, e.g. an image dragged from a web page.
  pathOf: (file: File) => string
  // Saves a dropped file that has no path of its own to a temp folder; returns its path.
  saveAttachment: (name: string, data: ArrayBuffer) => Promise<string>
  openThread: (thread: Thread) => Promise<AgentEvent[]>
  renameThread: (thread: Thread, title: string) => Promise<void>
  // Asks for confirmation; resolves false if the user cancels.
  deleteThread: (thread: Thread) => Promise<boolean>
  // Resolves when the turn ends; undefined if the thread's turn was already running. `effort` undefined leaves the
  // model's default.
  send: (thread: ThreadRef, prompt: string, model: string, effort: string | undefined) => Promise<Turn | undefined>
  stop: (thread: string) => Promise<void>
  // The page is done with an idle thread: its Pi process can go.
  release: (thread: string) => void
  reply: (id: string, answer: Answer) => void
  settings: () => Promise<Settings>
  saveSettings: (settings: Settings) => Promise<void>
  piInfo: () => Promise<PiInfo>
  openSettings: () => void
  openExternal: (url: string) => void
  // Uncommitted changes in `cwd` as a unified patch; undefined when it isn't a git repo.
  diff: (cwd: string) => Promise<string | undefined>
  branch: (cwd: string) => Promise<string | undefined>
  // The backend's slash commands in `cwd`, or outside any project when it's unset.
  commands: (backend: Backend, cwd: string | undefined) => Promise<SlashCommand[]>
  // The Markdown files in `cwd`, relative to it; empty outside a git repo.
  docs: (cwd: string) => Promise<string[]>
  // An absolute path; undefined unless it's a readable `.md` file.
  readDoc: (path: string) => Promise<string | undefined>
  // Settings or Pi logins changed: reload models and threads.
  onChanged: (cb: () => void) => () => void
  onEvent: (cb: (thread: string, e: AgentEvent) => void) => () => void
  onCommand: (cb: (command: Command) => void) => () => void
  // An agent ran `clankr-open` in the thread with this key.
  onBrowserOpen: (cb: (thread: string, url: string) => void) => () => void
  term: {
    // Returns the new shell's id and its program name, e.g. "zsh".
    start: (cwd: string | undefined, cols: number, rows: number) => Promise<{ id: number; name: string }>
    input: (id: number, data: string) => void
    resize: (id: number, cols: number, rows: number) => void
    kill: (id: number) => void
    onData: (cb: (id: number, data: string) => void) => () => void
    // The program in the shell's foreground, e.g. "nvim" or "btop"; the shell itself at a prompt.
    onProc: (cb: (id: number, name: string) => void) => () => void
    onExit: (cb: (id: number) => void) => () => void
  }
}

declare global {
  interface Window {
    api: Api
  }
}

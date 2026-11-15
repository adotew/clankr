export type Backend = 'claude' | 'pi'

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

export type Api = {
  models: () => Promise<Model[]>
  threads: () => Promise<Thread[]>
  pickFolder: () => Promise<string | undefined>
  newThread: (cwd: string | undefined) => Promise<void>
  openThread: (thread: Thread) => Promise<AgentEvent[]>
  renameThread: (thread: Thread, title: string) => Promise<void>
  // Asks for confirmation; resolves false if the user cancels.
  deleteThread: (thread: Thread) => Promise<boolean>
  // `effort` undefined leaves the model at its default level.
  send: (prompt: string, model: string, effort: string | undefined) => Promise<{ sessionId?: string; cwd: string; backend: Backend } | undefined>
  stop: () => Promise<void>
  reply: (id: string, answer: boolean | string | undefined) => void
  settings: () => Promise<Settings>
  saveSettings: (settings: Settings) => Promise<void>
  piInfo: () => Promise<PiInfo>
  openSettings: () => void
  // Uncommitted changes in `cwd` as a unified patch; undefined when it isn't a git repo.
  diff: (cwd: string) => Promise<string | undefined>
  onChanged: (cb: () => void) => () => void
  onEvent: (cb: (e: AgentEvent) => void) => () => void
  term: {
    start: (id: number, cwd: string | undefined, cols: number, rows: number) => void
    input: (id: number, data: string) => void
    resize: (id: number, cols: number, rows: number) => void
    kill: (id: number) => void
    onData: (cb: (id: number, data: string) => void) => () => void
    onExit: (cb: (id: number) => void) => () => void
  }
}

declare global {
  interface Window {
    api: Api
  }
}

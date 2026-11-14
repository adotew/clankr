export type Backend = 'claude' | 'pi'

export type AgentEvent =
  | { kind: 'user' | 'text' | 'delta' | 'error'; text: string }
  | { kind: 'tool'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'result'; id: string; text: string; isError: boolean }
  // A question for the user: yes/no by default, a choice when `options` is set, free text when `input` is.
  | { kind: 'ask'; id: string; title: string; detail?: string; options?: string[]; input?: boolean }
  | { kind: 'done' }

// `folder` is undefined for "No project" threads.
// For Pi threads, `id` is the session file path.
export type Thread = { id: string; title: string; cwd: string; folder?: string; backend: Backend; updated: number }
// `value` is prefixed with its backend, e.g. "claude:default" or "pi:anthropic/claude-opus-5-5".
export type Model = { value: string; displayName: string; backend: Backend; group: string }
export type Settings = { claude: boolean; pi: boolean; piPath: string }
// `providers` can be logged in with `pi auth login`; `stored` already have saved credentials.
export type PiInfo = { ok: boolean; version: string; providers: string[]; stored: string[] }

export type Api = {
  models: () => Promise<Model[]>
  threads: () => Promise<Thread[]>
  pickFolder: () => Promise<string | undefined>
  newThread: (cwd: string | undefined) => Promise<void>
  openThread: (thread: Thread) => Promise<AgentEvent[]>
  send: (prompt: string, model: string) => Promise<{ sessionId?: string; cwd: string; backend: Backend } | undefined>
  stop: () => Promise<void>
  reply: (id: string, answer: boolean | string | undefined) => void
  settings: () => Promise<Settings>
  saveSettings: (settings: Settings) => Promise<void>
  piInfo: () => Promise<PiInfo>
  piLogout: (provider: string) => Promise<void>
  openSettings: () => void
  // Drops cached models (e.g. after `pi auth login`) and notifies every window through onChanged.
  refresh: () => void
  onChanged: (cb: () => void) => () => void
  onEvent: (cb: (e: AgentEvent) => void) => () => void
  term: {
    start: (cwd: string | undefined, cols: number, rows: number) => void
    input: (data: string) => void
    resize: (cols: number, rows: number) => void
    kill: () => void
    // Types a command into the shell, or into the next one started if none is running.
    run: (command: string) => void
    onData: (cb: (data: string) => void) => () => void
    onExit: (cb: () => void) => () => void
    // Fires when the terminal panel should open, e.g. after `run` from the settings window.
    onShow: (cb: () => void) => () => void
  }
}

declare global {
  interface Window {
    api: Api
  }
}

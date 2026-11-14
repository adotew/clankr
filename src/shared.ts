export type AgentEvent =
  | { kind: 'user' | 'text' | 'delta' | 'error'; text: string }
  | { kind: 'tool'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'result'; id: string; text: string; isError: boolean }
  | { kind: 'permission'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'done' }

// `folder` is undefined for "No project" threads.
export type Thread = { id: string; title: string; cwd: string; folder?: string }
export type Model = { value: string; displayName: string }

export type Api = {
  models: () => Promise<Model[]>
  threads: () => Promise<Thread[]>
  pickFolder: () => Promise<string | undefined>
  newThread: (cwd: string | undefined) => Promise<void>
  openThread: (thread: Thread) => Promise<AgentEvent[]>
  send: (prompt: string, model: string) => Promise<{ sessionId?: string; cwd: string } | undefined>
  stop: () => Promise<void>
  reply: (id: string, allow: boolean) => void
  onEvent: (cb: (e: AgentEvent) => void) => () => void
  term: {
    start: (cwd: string | undefined, cols: number, rows: number) => void
    input: (data: string) => void
    resize: (cols: number, rows: number) => void
    kill: () => void
    onData: (cb: (data: string) => void) => () => void
    onExit: (cb: () => void) => () => void
  }
}

declare global {
  interface Window {
    api: Api
  }
}
